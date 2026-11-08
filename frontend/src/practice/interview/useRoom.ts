import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notify } from '../../design/dialogs';
import type { CodeEditorHandle } from '../../components/Playground/CodeEditor';
import { useDiagramLayout } from '../../components/Diagram/useDiagramLayout';
import type { Engine } from '../../hld/engine';
import type { Problem } from '../types';
import { parseSolution, runTests, type RunResult } from '../workspace';
import { PHASES, type Phase } from '../modes/session';
import { loadDesign, saveDesign } from './prefs';
import { playCue, type Cue } from './sounds';

/** The interview room's state (Room.tsx): the whiteboard's design, and the sound cues of the clock and phases. */

const PARSE_DELAY_MS = 150;
const SAVE_DELAY_MS = 400;

/** The design on the whiteboard: kept per problem in this browser while the interview runs, checked on demand. */
export function useWhiteboard(problem: Problem, engine: Engine) {
  const [source, setSource] = useState(() => loadDesign(problem.id) ?? problem.starter);
  const [parsedSource, setParsedSource] = useState(source);
  useEffect(() => {
    const parse = setTimeout(() => setParsedSource(source), PARSE_DELAY_MS);
    const save = setTimeout(() => saveDesign(problem.id, source), SAVE_DELAY_MS);
    return () => {
      clearTimeout(parse);
      clearTimeout(save);
    };
  }, [source, problem.id]);
  const parsed = useMemo(() => parseSolution(problem, parsedSource), [problem, parsedSource]);
  const layout = useDiagramLayout(parsed.diagram);
  const editor = useRef<CodeEditorHandle>(null);
  const sourceNow = useRef(source);
  useEffect(() => {
    sourceNow.current = source;
  }, [source]);
  const getSource = useCallback(() => sourceNow.current, []);
  const [run, setRun] = useState<{ result: RunResult; source: string }>();
  /** Runs the problem's tests on the design as it is now. */
  const check = useCallback(() => {
    const now = sourceNow.current;
    const result = runTests(parseSolution(problem, now), engine);
    setRun({ result, source: now });
    return result;
  }, [problem, engine]);
  /** A canvas edit: through the editor when it is open (one undo step), and parsed at once, so quick clicks build on each other. */
  const edit = useCallback((next: string) => {
    if (editor.current) editor.current.replace(next);
    else setSource(next);
    setParsedSource(next);
  }, []);
  return { source, setSource, edit, parsed, layout, editor, getSource, run, check, closeRun: () => setRun(undefined) };
}

export type Whiteboard = ReturnType<typeof useWhiteboard>;

/** Plays the cues of the clock: 5 and 1 minute left, once each (not for a time already past when the room opened). */
export function useClockCues(left: number, running: boolean, play: (cue: Cue) => void): 'warn5' | 'warn1' | undefined {
  const fired = useRef<Set<Cue> | undefined>(undefined);
  fired.current ??= new Set<Cue>(left <= 60_000 ? ['warn5', 'warn1'] : left <= 5 * 60_000 ? ['warn5'] : []);
  const [flash, setFlash] = useState<'warn5' | 'warn1'>();
  useEffect(() => {
    if (!running) return;
    const due: 'warn5' | 'warn1' | undefined = left <= 60_000 ? 'warn1' : left <= 5 * 60_000 ? 'warn5' : undefined;
    if (!due || fired.current!.has(due)) return;
    fired.current!.add(due);
    if (due === 'warn1') fired.current!.add('warn5');
    play(due);
    setFlash(due);
  }, [left, running, play]);
  return flash;
}

/** Plays the phase cue (and pulses the stepper) when the phase changes after the room opened. */
export function usePhaseCue(phase: Phase, play: (cue: Cue) => void): number {
  const last = useRef(phase);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (last.current === phase) return;
    last.current = phase;
    play('phase');
    setPulse((n) => n + 1);
  }, [phase, play]);
  return pulse;
}

const at = (p: Phase) => PHASES.findIndex((x) => x.id === p);

/**
 * The clock's nudge (P49): when the clock's phase passes the stage the user
 * is on, once per phase, a toast offers to move on and the phase cue plays.
 * The user still decides; nothing moves by itself.
 */
export function useStageNudge(clock: Phase, stage: Phase, running: boolean, onNext: () => void, play: (cue: Cue) => void): void {
  const nudged = useRef(new Set<Phase>());
  const next = useRef(onNext);
  useEffect(() => {
    next.current = onNext;
  });
  useEffect(() => {
    if (!running || at(clock) <= at(stage) || nudged.current.has(clock)) return;
    nudged.current.add(clock);
    const following = PHASES[at(stage) + 1];
    play('phase');
    notify({ title: `Time to move on to ${following.label}?`, body: 'The clock is past this stage. Move on when you are ready.', action: { label: `Next: ${following.label}`, onClick: () => next.current() }, duration: 12_000 });
  }, [clock, stage, running, play]);
}

/** `play` that is silent while sound is off. */
export function useCues(on: boolean) {
  return useCallback((cue: Cue) => on && playCue(cue), [on]);
}
