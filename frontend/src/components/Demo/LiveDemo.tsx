import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { parse } from '../../dsl';
import CodeEditor from '../Playground/CodeEditor';
import DiagramCanvas from '../Diagram/DiagramCanvas';
import { useDiagramLayout } from '../Diagram/useDiagramLayout';
import { UseCasePlayer } from '../UseCases/UseCasePlayback';
import { DEMO_FILE, DEMO_SCRIPT, DEMO_SOURCE, TOUR_END, Tour, captionAt, chapterAt, sourceAt, type TourFrame } from './demoScript';
import { demoEditorTheme, editorLabel, typingCaret } from './demoTheme';
import './demo.css';

/**
 * The landing page's hero: the real editor, layout and player, running a
 * scripted tour (type → the diagram grows → play the happy path and a failing
 * one) and then handing the editor to the visitor.
 *
 * It keeps nothing: no storage, no share links, no history entries; what the
 * visitor types is gone on reload. LiveDemo.test.ts checks its imports.
 *
 * Accessibility: the typing is hidden from assistive technology and summed up
 * in a status line; the tour can be paused (and pauses itself offscreen or in
 * a background tab); it never moves focus. Under reduced motion it starts at
 * the end, with a button to play the tour.
 */

const PARSE_DELAY_MS = 150;
const TOUR_EXTENSIONS = [typingCaret];
const FREE_EXTENSIONS = [editorLabel];
const NO_OP = () => {};

const CHAPTERS = ['Write it', 'See it', 'Play it'] as const;

interface LiveDemoProps {
  /** A link that opens `source` in the full editor. */
  editorHref: (source: string) => string;
  /** Start at the end with a "Play tour" button instead of playing (reduced motion). */
  still?: boolean;
}

type Mode = 'tour' | 'free';

function useOnScreen<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, onScreen];
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

export default function LiveDemo({ editorHref, still = false }: LiveDemoProps) {
  const [mode, setMode] = useState<Mode>(still ? 'free' : 'tour');
  const [frame, setFrame] = useState<TourFrame>(still ? TOUR_END : { index: 0, typed: 0 });
  const [userPaused, setUserPaused] = useState(false);
  const [freeSource, setFreeSource] = useState(DEMO_SOURCE);
  const [freePlay, setFreePlay] = useState<string>();
  const [playStep, setPlayStep] = useState(0);
  // Under reduced motion the demo opens at the end; until the tour is played, say what it is.
  const [intro, setIntro] = useState(still);
  const [rootRef, onScreen] = useOnScreen<HTMLDivElement>();
  const pageVisible = usePageVisible();
  const codeRef = useRef<HTMLDivElement>(null);

  const tourRef = useRef<Tour | null>(null);
  if (!tourRef.current) tourRef.current = new Tour({ onFrame: setFrame });
  const tour = tourRef.current;

  const step = DEMO_SCRIPT[frame.index];
  const touring = mode === 'tour';
  const running = touring && !userPaused && onScreen && pageVisible;
  const source = touring ? sourceAt(frame) : freeSource;

  // The tour runs only while it is on screen, in a visible tab, and not paused.
  const started = useRef(false);
  useEffect(() => {
    if (!running) return tour.pause();
    if (started.current) tour.resume();
    else {
      started.current = true;
      tour.start();
    }
  }, [running, tour]);
  useEffect(() => () => tour.pause(), [tour]);

  // The hand-off: the finished document becomes the visitor's.
  useEffect(() => {
    if (touring && step?.kind === 'handoff') {
      setFreeSource(DEMO_SOURCE);
      setMode('free');
    }
  }, [touring, step]);

  // Parse shortly after typing stops, as the editor does; the tour pauses between chunks.
  const [parsedSource, setParsedSource] = useState(source);
  useEffect(() => {
    const timer = setTimeout(() => setParsedSource(source), PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source]);
  const { diagram, diagnostics } = useMemo(() => parse(parsedSource), [parsedSource]);
  const nodeIds = useMemo(() => diagram.nodes.map((n) => n.id), [diagram]);
  const { nodes, edges, settled } = useDiagramLayout(diagram);

  // Keep the newest typed line in view, inside the editor only (never scrolling the page).
  useEffect(() => {
    if (!touring) return;
    const scroller = codeRef.current?.querySelector<HTMLElement>('.cm-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [touring, source]);

  // Which scenario is on the canvas: the tour's (kept between its two plays), or one the visitor picked.
  const scenarios = useMemo(
    () => diagram.useCases.flatMap((u) => u.scenarios.filter((s) => s.steps.length > 0).map((s) => ({ key: `${u.id}/${s.id}`, useCase: u, scenario: s }))),
    [diagram],
  );
  const tourScenario = useMemo(() => {
    if (!touring) return undefined;
    for (let i = frame.index; i >= 0; i--) {
      const s = DEMO_SCRIPT[i];
      if (s.kind === 'play') return s.scenario;
    }
    return undefined;
  }, [touring, frame.index]);
  const playing = touring ? scenarios.find((o) => o.scenario.id === tourScenario) : scenarios.find((o) => o.key === freePlay);
  const played = useMemo(
    () => (playing ? { id: playing.key, name: playing.useCase.name, steps: playing.scenario.steps, condition: playing.scenario.condition } : undefined),
    [playing],
  );
  const currentStep = played?.steps[Math.min(playStep, played.steps.length - 1)];
  const nodeName = (id: string) => diagram.nodes.find((n) => n.id === id)?.name ?? id;

  const href = useMemo(() => editorHref(parsedSource), [editorHref, parsedSource]);

  const caption = touring ? captionAt(frame) : intro ? 'This is the real editor. Edit anything, or play the tour.' : captionAt(TOUR_END);
  const chapter = touring ? chapterAt(frame) : 4;
  const status = touring ? (running || !userPaused ? caption : `Paused: ${caption}`) : caption;

  const finishTour = () => {
    tour.finish();
    setUserPaused(false);
  };
  const playTour = () => {
    setFreePlay(undefined);
    setUserPaused(false);
    setIntro(false);
    setMode('tour');
    started.current = false;
    setFrame({ index: 0, typed: 0 });
  };

  return (
    <div ref={rootRef} className="demo" data-mode={mode} data-chapter={chapter} data-failing={currentStep && isError(currentStep) ? '' : undefined}>
      <div className="demo__bar">
        <span className="demo__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="demo__file">{DEMO_FILE}</span>
        <ol className="demo__chapters" aria-hidden="true">
          {CHAPTERS.map((name, i) => (
            <li key={name} data-on={chapter === i + 1 ? '' : undefined} data-done={chapter > i + 1 ? '' : undefined}>
              <b>{i + 1}</b> {name}
            </li>
          ))}
        </ol>
      </div>

      <div className="demo__body">
        <div
          ref={codeRef}
          className="demo__code"
          aria-hidden={touring || undefined}
          // Clicking into the code during the tour skips to the end, so it can be edited.
          onPointerDown={touring ? finishTour : undefined}
        >
          <CodeEditor
            value={source}
            onChange={touring ? NO_OP : setFreeSource}
            diagnostics={touring ? [] : diagnostics}
            nodeIds={nodeIds}
            readOnly={touring}
            theme={demoEditorTheme}
            extensions={touring ? TOUR_EXTENSIONS : FREE_EXTENSIONS}
          />
        </div>

        <div className="demo__canvas ps-light">
          <div className="demo__flow">
            {played ? (
              <UseCasePlayer
                useCase={played}
                nodes={nodes}
                edges={edges}
                onBack={NO_OP}
                showHeader={false}
                bare
                autoPlay={touring ? running && step?.kind === 'play' : true}
                onFinished={touring ? () => tour.played() : () => setFreePlay(undefined)}
                onStepChange={setPlayStep}
              />
            ) : (
              <DiagramCanvas nodes={nodes} edges={edges} fitKey={String(settled)} still compact fitDuration={still ? 0 : 400} />
            )}
            {nodes.length === 0 && <p className="demo__empty">The diagram appears here as you type.</p>}
          </div>
          <div className="demo__caption" aria-hidden="true">
            <p key={caption} className="demo__say">
              {caption}
            </p>
            {played && currentStep && (
              <p key={`${played.id}:${playStep}`} className="demo__step" data-error={isError(currentStep) ? '' : undefined}>
                <b>{Math.min(playStep, played.steps.length - 1) + 1}</b>
                <span>
                  {nodeName(currentStep.fromServiceId)} → {nodeName(currentStep.toServiceId)}
                </span>
                {currentStep.failed ? <em>no answer</em> : (currentStep.statusCode ?? 0) > 0 && <em>{currentStep.statusCode}</em>}
                <code>{currentStep.stepName}</code>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="demo__controls">
        {/* Read out; on screen the caption above says the same. */}
        <p className="demo__status" role="status">
          {status}
        </p>
        {touring ? (
          <div className="demo__buttons">
            <button type="button" className="ps-btn ps-btn--sm" aria-pressed={userPaused} onClick={() => setUserPaused((p) => !p)}>
              {userPaused ? 'Resume tour' : 'Pause tour'}
            </button>
            <button type="button" className="ps-btn ps-btn--sm ps-btn--ghost" onClick={finishTour}>
              Skip to the end
            </button>
          </div>
        ) : (
          <div className="demo__buttons">
            {scenarios.length > 0 && (
              <span className="demo__play" role="group" aria-label="Play a scenario">
                {scenarios.slice(0, 4).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className="ps-btn ps-btn--sm demo__scenario"
                    data-outcome={o.scenario.outcome}
                    aria-pressed={freePlay === o.key}
                    onClick={() => setFreePlay(freePlay === o.key ? undefined : o.key)}
                  >
                    <span aria-hidden="true">{freePlay === o.key ? '■' : '▶'}</span> {o.scenario.name}
                  </button>
                ))}
              </span>
            )}
            <button type="button" className="ps-btn ps-btn--sm ps-btn--ghost" onClick={playTour}>
              Play tour
            </button>
            <a className="ps-btn ps-btn--sm ps-btn--primary" href={href}>
              Open in the editor <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function isError(step: { failed?: boolean; statusCode?: number }): boolean {
  return !!step.failed || (step.statusCode ?? 0) >= 400;
}
