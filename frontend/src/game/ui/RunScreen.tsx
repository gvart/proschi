import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Code2, FastForward, LayoutGrid, FlaskConical, Pause, Play, Redo2, Rocket, SkipForward, Undo2, Volume2, VolumeX, Zap } from 'lucide-react';
import { celebrate } from '../../design/celebrate';
import { prefersReducedMotion } from '../../design/motion';
import { eyebrow, outlineButton, primaryButton } from '../../components/Playground/ui';
import { canWire, cloneBoard, roleOf } from '../engine/board';
import { compile } from '../engine/compile';
import { Game, GameError, type TickResult } from '../engine/run';
import { LOADTEST_COST, ONCALL_COST, SLOTS, WAVES, WIDE_SLOTS } from '../engine/rules';
import type { Action, Board, GameContent, RunSetup } from '../engine/types';
import GameCanvas from './GameCanvas';
import { boardToDsl, dslToBoard } from '../engine/boardDsl';
import type { Diagnostic } from '../../dsl/types';
import { IconTile } from './gameIcons';
import { RARITY_TILE } from './visual';

const CodeEditor = lazy(() => import('../../components/Playground/CodeEditor'));
import { placeComponent, removeNode, rowOf, toggleWire, updateNode, type Row } from './layout';
import { BreachCard, Contracts, Draft, ForecastPanel, Hud, Inspector, Palette, WaveResult, type PaletteItem } from './Panels';
import Report from './Report';
import { ChangesPanel, DiagnosisPanel, TicketCard } from './Modes';
import { buzz, play, setSound } from './sound';
import { saveRun, type Settings } from './store';
import type { Arcade, RunResult } from './useArcade';

/**
 * One run: plan the board (tap or drag components from the palette, tap a
 * node to scale it, wire it or remove it), deploy, watch the wave's eight
 * ticks (requests flowing, nodes heating up, the on-call to page), then the
 * wave's result and debrief, the card draft and the contracts, until the run
 * is won or lost. The engine does every rule; this only shows it.
 */

const TICK_MS = 2200;

export interface RunScreenProps {
  content: GameContent;
  setup: RunSetup;
  runId?: string;
  /** Actions of a saved run to carry on from. */
  resume?: Action[];
  arcade: Arcade;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onExit: () => void;
  onAgain: () => void;
}

/** Below the desktop layout's breakpoint: the phone layout, with the dock. */
function useNarrow(): boolean {
  const query = '(max-width: 1023px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function RunScreen(props: RunScreenProps) {
  const { content, setup, runId, arcade, settings } = props;
  const [game] = useState(() => (props.resume?.length ? Game.replay(content, setup, props.resume) : new Game(content, setup)));
  const [, setRev] = useState(0);
  const rerender = useCallback(() => setRev((r) => r + 1), []);
  const s = game.state;
  const components = useMemo(() => new Map(content.components.map((c) => [c.id, c])), [content]);
  const events = useMemo(() => new Map(content.events.map((e) => [e.id, e])), [content]);
  const unlocked = useMemo(() => new Set([...setup.loadout.unlocked, ...game.scenario.grants]), [setup, game]);
  const wide = unlocked.has('wide-lanes');
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // Planning state.
  const [plan, setPlan] = useState<Board>(() => cloneBoard(s.board));
  const [undo, setUndo] = useState<Board[]>([]);
  const [redo, setRedo] = useState<Board[]>([]);
  const [selected, setSelected] = useState<string>();
  const [placing, setPlacing] = useState<string>();
  const [wiring, setWiring] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' }>();
  const [shake, setShake] = useState<string>();
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<TickResult>();
  // Run state.
  const [playing, setPlaying] = useState(true);
  const [last, setLast] = useState<TickResult>();
  const [callout, setCallout] = useState<TickResult['breaches'][number]>();
  const [showResult, setShowResult] = useState(false);
  const [stamp, setStamp] = useState<string>();
  const [result, setResult] = useState<RunResult>();
  const finished = useRef(false);
  const calloutShown = useRef(-1);
  const dropRow = useRef<(x: number, y: number) => Row | undefined>(undefined);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean }>();
  const hold = useRef<number | undefined>(undefined);
  const narrow = useNarrow();
  /** The board as Proschi text: a second way to edit the plan, for those who would rather type. */
  const [pane, setPane] = useState<'board' | 'code'>('board');
  const [code, setCode] = useState('');
  const [codeProblems, setCodeProblems] = useState<Diagnostic[]>([]);
  const typed = useRef<Board | undefined>(undefined);

  useEffect(() => setSound(settings.sound), [settings.sound]);

  // On a phone the inspector is a sheet over the bottom of the screen: keep the node it is about above it.
  useEffect(() => {
    if (!narrow || !selected) return;
    const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(selected)}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const want = window.innerHeight * 0.2;
    if (Math.abs(top - want) > 40) window.scrollBy({ top: top - want, behavior: reduced ? 'auto' : 'smooth' });
  }, [selected, narrow, reduced]);

  const save = useCallback(() => saveRun(s.phase === 'over' ? undefined : { setup, actions: s.log, ...(runId ? { runId } : {}) }), [s, setup, runId]);

  const apply = useCallback(
    (action: Action): TickResult | undefined => {
      try {
        const r = game.apply(action);
        save();
        rerender();
        return r;
      } catch (e) {
        if (e instanceof GameError) {
          setMessage({ text: e.message, tone: 'error' });
          play('error');
          return undefined;
        }
        throw e;
      }
    },
    [game, save, rerender],
  );

  // A new wave: a fresh plan from the deployed board, and its stamp.
  const waveKey = `${s.wave}:${s.phase === 'plan'}`;
  useEffect(() => {
    if (s.phase !== 'plan') return;
    setPlan(cloneBoard(s.board));
    setUndo([]);
    setRedo([]);
    setPreview(undefined);
    setFresh(new Set());
    setSelected(undefined);
    setPlacing(undefined);
    setWiring(false);
    const w = game.waveDef();
    setStamp(`Wave ${s.wave + 1}${w.name ? ` · ${w.name}` : w.ticket ? ' · new ticket' : ''}`);
    if (w.boss) {
      play('boss');
      buzz(80);
    }
    const t = setTimeout(() => setStamp(undefined), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveKey]);

  const edit = useCallback(
    (next: Board) => {
      setUndo((u) => [...u.slice(-40), plan]);
      setRedo([]);
      setPlan(next);
      setPreview(undefined);
    },
    [plan],
  );

  const ctx = useMemo(() => ({ components, scenario: game.scenario }), [components, game]);

  // The text follows the plan, except right after the player typed it (their formatting stays).
  const shownBoard = s.phase === 'plan' ? plan : s.board;
  useEffect(() => {
    if (pane !== 'code') return;
    if (typed.current === shownBoard) return;
    setCode(boardToDsl(shownBoard, ctx));
    setCodeProblems([]);
  }, [pane, shownBoard, ctx]);

  const onCode = (text: string) => {
    setCode(text);
    if (s.phase !== 'plan') return;
    const r = dslToBoard(text, { ...ctx, previous: plan, unlocked });
    setCodeProblems(r.diagnostics);
    if (r.board) {
      typed.current = r.board;
      edit(r.board);
    }
  };
  const slots = wide ? WIDE_SLOTS : SLOTS;
  const placeOf = (id: string) => components.get(id)?.lane;

  const place = useCallback(
    (componentId: string) => {
      const lane = placeOf(componentId);
      if (!lane) return;
      const inLane = plan.nodes.filter((n) => rowOf(n, components, game.scenario) === lane).length;
      if (inLane >= slots) {
        setMessage({ text: `The ${lane} row is full (${slots} components).`, tone: 'error' });
        return;
      }
      const { board, id } = placeComponent(plan, componentId, ctx);
      edit(board);
      setFresh((f) => new Set([...f, id]));
      setSelected(id);
      setPlacing(undefined);
      const wires = board.edges.filter(([a, b]) => a === id || b === id).length;
      setMessage({ text: `${components.get(componentId)?.name} placed${wires ? ` and wired (${wires} wire${wires === 1 ? '' : 's'})` : ''}. Undo if that is not what you want.`, tone: 'info' });
      play('place');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, ctx, edit, components, game, slots],
  );

  const wire = (from: string, to: string) => {
    if (s.phase !== 'plan' || plan.edges.some(([a, b]) => a === from && b === to)) return;
    const r = toggleWire(plan, from, to, ctx);
    if ('error' in r) {
      setMessage({ text: r.error, tone: 'error' });
      setShake(to);
      setTimeout(() => setShake(undefined), 400);
      play('error');
    } else {
      edit(r.board);
      play('wire');
    }
  };

  const onNode = (id: string) => {
    if (s.phase === 'plan' && wiring && selected && selected !== id) {
      const r = toggleWire(plan, selected, id, ctx);
      if ('error' in r) {
        setMessage({ text: r.error, tone: 'error' });
        setShake(id);
        setTimeout(() => setShake(undefined), 400);
        play('error');
      } else {
        edit(r.board);
        play('wire');
      }
      return;
    }
    setWiring(false);
    setPlacing(undefined);
    setSelected((cur) => (cur === id ? undefined : id));
  };

  // Valid wiring targets of the selected node.
  const validTargets = useMemo(() => {
    if (!wiring || !selected) return undefined;
    const from = plan.nodes.find((n) => n.id === selected);
    const fr = from && roleOf(from, components, game.scenario);
    if (!fr) return undefined;
    return new Set(
      plan.nodes
        .filter((n) => n.id !== selected)
        .filter((n) => {
          const tr = roleOf(n, components, game.scenario);
          return tr && canWire(fr, tr).ok;
        })
        .map((n) => n.id),
    );
  }, [wiring, selected, plan, components, game]);

  // Planning feedback: what the plan breaks, what it costs a month.
  const needsDiagnosis = s.phase === 'plan' && !!game.waveDef().diagnosis && !s.diagnosis;
  const problems = useMemo(
    () => (s.phase === 'plan' ? [...(needsDiagnosis ? ['Name the root cause first: the fix depends on it.'] : []), ...game.problems(plan)] : []),
    [s.phase, plan, game, needsDiagnosis],
  );
  const broken = useMemo(() => {
    if (s.phase !== 'plan' || problems.length) return [];
    try {
      return Object.values(compile(game.scenario, plan, components, s.useCases).broken);
    } catch {
      return [];
    }
  }, [s.phase, problems, plan, game, components, s.useCases]);
  const monthly = useMemo(() => {
    if (s.phase !== 'plan' || problems.length) return undefined;
    try {
      return game.monthlyCost(plan);
    } catch {
      return undefined;
    }
  }, [s.phase, problems, plan, game]);

  // ---- The run ----
  const tickNow = useCallback(() => {
    if (game.state.phase !== 'run') return;
    const r = game.advance();
    setLast(r);
    rerender();
    if (r.breaches.length) {
      play('breach');
      buzz();
      if (calloutShown.current !== r.wave) {
        calloutShown.current = r.wave;
        setCallout(r.breaches.slice().sort((a, b) => b.trust - a.trust)[0]);
      }
    } else play('tick');
    if (game.state.phase !== 'run') {
      setShowResult(true);
      setCallout(undefined);
      save();
    }
  }, [game, rerender, save]);

  useEffect(() => {
    if (s.phase !== 'run' || !playing || showResult) return;
    const pause = callout ? 1800 : 0;
    const t = setTimeout(
      () => {
        setCallout(undefined);
        tickNow();
      },
      TICK_MS / settings.speed + pause,
    );
    return () => clearTimeout(t);
  }, [s.phase, s.tick, playing, settings.speed, tickNow, callout, showResult]);

  const deploy = () => {
    if (problems.length) {
      setMessage({ text: problems[0], tone: 'error' });
      play('error');
      return;
    }
    apply({ t: 'deploy', board: plan });
    setSelected(undefined);
    setWiring(false);
    setPlacing(undefined);
    setPlaying(true);
    setLast(undefined);
    calloutShown.current = -1;
    play('deploy');
  };

  const skip = () => {
    while (game.state.phase === 'run') tickNow();
  };

  const loadTest = () => {
    const r = apply({ t: 'loadtest', board: plan });
    if (r) {
      setPreview(r);
      setMessage({ text: r.breaches.length ? `At the peak: ${r.breaches[0].message}` : 'At the forecast peak this plan holds every requirement.', tone: r.breaches.length ? 'error' : 'info' });
    }
  };

  // The end of the run.
  useEffect(() => {
    if (s.phase !== 'over' || finished.current) return;
    finished.current = true;
    saveRun(undefined);
    play(s.cleared ? 'win' : 'lose');
    void arcade.finish(game, runId).then(setResult);
  }, [s.phase, s.cleared, arcade, game, runId]);

  useEffect(() => {
    if (s.phase === 'cleared') play('win');
  }, [s.phase]);

  // Drag a chip from the palette onto a row.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 });
    const up = (e: PointerEvent) => {
      const d = drag;
      setDrag(undefined);
      if (!d.moved) return;
      const row = dropRow.current?.(e.clientX, e.clientY);
      if (row && row === placeOf(d.id)) place(d.id);
      else if (row) setMessage({ text: `${components.get(d.id)?.name} goes in the ${placeOf(d.id)} row.`, tone: 'error' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, place]);

  if (s.phase === 'over' || s.phase === 'cleared') {
    return (
      <Report
        game={game}
        content={content}
        result={result}
        onEndless={() => apply({ t: 'endless' })}
        onRetire={() => apply({ t: 'retire' })}
        onAgain={props.onAgain}
        onExit={props.onExit}
        signedIn={arcade.signedIn}
      />
    );
  }

  const onGhost = () => placing && place(placing);
  const onBackground = () => {
    setSelected(undefined);
    setWiring(false);
  };
  const forecast = game.forecast();
  const planning = s.phase === 'plan';
  const shown = planning ? plan : s.board;
  const shownTick = planning ? preview : (last ?? s.ticks[s.ticks.length - 1]);
  const node = selected ? shown.nodes.find((n) => n.id === selected) : undefined;
  const mods = game.mods;
  const paletteItems: PaletteItem[] = content.components.map((def) => ({
    def,
    available: def.unlock === 0 || unlocked.has(def.id),
    full: plan.nodes.filter((n) => n.component !== 'users' && components.get(n.component)?.lane === def.lane).length >= slots,
  }));
  const act = s.wave % 4 === 0 && s.wave < WAVES ? game.scenario.sections[`Act ${s.wave / 4 + 1}`] : undefined;
  const lastSummary = s.history[s.history.length - 1];

  const hud = (
    <Hud
      compact={narrow}
      wave={s.wave}
      waves={game.scenario.waves.length}
      endless={s.endless}
      cash={s.cash}
      monthly={planning ? monthly : undefined}
      trust={s.trust}
      maxTrust={s.maxTrust}
      score={s.score}
      streak={s.streak}
      streakStep={mods.streakStep}
      tick={planning ? undefined : s.tick}
    />
  );
  const undoRedo = (
    <>
      <button type="button" className={outlineButton} aria-label="Undo" disabled={!undo.length} onClick={() => { setRedo((r) => [...r, plan]); setPlan(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)); setPreview(undefined); }}>
        <Undo2 size={14} aria-hidden="true" /> {!narrow && 'Undo'}
      </button>
      <button type="button" className={outlineButton} aria-label="Redo" disabled={!redo.length} onClick={() => { setUndo((u) => [...u, plan]); setPlan(redo[redo.length - 1]); setRedo((r) => r.slice(0, -1)); setPreview(undefined); }}>
        <Redo2 size={14} aria-hidden="true" /> {!narrow && 'Redo'}
      </button>
    </>
  );
  const loadTestButton = (
    <button type="button" className={`${outlineButton} justify-center`} aria-label={`Load test the peak (${s.loadtestsFree > 0 ? `${s.loadtestsFree} free` : `$${LOADTEST_COST}`})`} disabled={problems.length > 0 || (s.loadtestsFree === 0 && s.cash < LOADTEST_COST)} onClick={loadTest}>
      <FlaskConical size={14} aria-hidden="true" /> {narrow ? 'Test' : `Load test the peak (${s.loadtestsFree > 0 ? `${s.loadtestsFree} free` : `$${LOADTEST_COST}`})`}
    </button>
  );
  const deployButton = (
    <button type="button" className={`${primaryButton} justify-center ${narrow ? '' : 'text-base py-3'}`} onClick={deploy} disabled={problems.length > 0}>
      <Rocket size={16} aria-hidden="true" /> Deploy wave {s.wave + 1}
    </button>
  );
  const palette = (
    <Palette
      items={paletteItems}
      placing={placing}
      onPick={(id) => {
        setPlacing((p) => (p === id ? undefined : id));
        setSelected(undefined);
        setWiring(false);
      }}
      onDragStart={(id, e) => {
        // A finger drags after a short hold, so a swipe still scrolls the palette.
        if (e.pointerType === 'mouse') setDrag({ id, x: e.clientX, y: e.clientY, moved: false });
        else {
          const { clientX: x, clientY: y } = e;
          window.clearTimeout(hold.current);
          hold.current = window.setTimeout(() => {
            setDrag({ id, x, y, moved: true });
            buzz(15);
          }, 260);
        }
      }}
      onPointerEnd={() => window.clearTimeout(hold.current)}
    />
  );
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={outlineButton} onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
      </button>
      {([1, 2, 4] as const).map((sp) => (
        <button key={sp} type="button" className={settings.speed === sp ? primaryButton : outlineButton} aria-pressed={settings.speed === sp} aria-label={`Speed ×${sp}`} onClick={() => props.onSettings({ ...settings, speed: sp })}>
          {!narrow && <FastForward size={14} aria-hidden="true" />}×{sp}
        </button>
      ))}
      <button type="button" className={outlineButton} onClick={skip}>
        <SkipForward size={14} aria-hidden="true" /> Skip
      </button>
      <span className="text-xs sm:text-sm text-muted inline-flex items-center gap-1">
        <Zap size={14} aria-hidden="true" /> On-call: {s.oncallLeft} left{narrow ? '' : ' (tap a node)'}
      </span>
    </div>
  );
  const feedback = (
    <>
      {callout && !planning && (
        <div className="sf-stamp" role="alert">
          <BreachCard breach={callout} during={last?.events.map((id) => events.get(id)).filter((d) => d !== undefined)} />
        </div>
      )}
      {message && planning && (
        <p role="status" className={`text-sm ${message.tone === 'error' ? 'text-fail' : 'text-muted'}`}>
          {message.text}
        </p>
      )}
      {planning && placing && <p className="text-sm text-muted">Tap the + in the {placeOf(placing)} row{narrow ? ', or hold the chip and drag it there' : ', or drag the chip onto the board'}.</p>}
      {planning && (problems.length > 0 || broken.length > 0) && (
        <ul className="text-sm text-fail list-disc pl-5">
          {[...problems, ...broken].slice(0, narrow ? 2 : 4).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </>
  );
  const inspector = node && (
    <Inspector
      node={node}
      board={shown}
      content={content}
      scenario={game.scenario}
      components={components}
      unlocked={unlocked}
      useCases={s.useCases}
      stats={shownTick?.nodes.find((n) => n.id === node.id)}
      editable={planning}
      wiring={wiring}
      compact={narrow}
      onChange={(patch) => edit(updateNode(plan, node.id, patch))}
      onWire={() => setWiring((w) => !w)}
      onUnwire={(to) => edit({ ...plan, edges: plan.edges.filter(([a, b]) => !(a === node.id && b === to)) })}
      onRemove={() => {
        edit(removeNode(plan, node.id, ctx));
        setSelected(undefined);
        play('remove');
      }}
      onClose={() => {
        setSelected(undefined);
        setWiring(false);
      }}
      oncall={
        !planning && components.has(node.component)
          ? {
              left: s.oncallLeft,
              cost: ONCALL_COST,
              onPage: () => {
                apply({ t: 'oncall', tick: s.tick, node: node.id });
                play('cash');
              },
            }
          : undefined
      }
    />
  );
  const hand = s.hand.length > 0 && (
    <>
      <p className={`${eyebrow} mt-3`}>Your cards</p>
      <ul className="mt-1 flex flex-wrap gap-1">
        {s.hand.map((id) => {
          const c = content.cards.find((x) => x.id === id);
          return (
            <li key={id} className="inline-flex items-center gap-1 rounded border-bw-1 border-ink/40 bg-surface py-0.5 pl-0.5 pr-1.5 text-xs text-ink" title={c?.text}>
              {c && <IconTile name={c.icon} tone={RARITY_TILE[c.rarity]} size="sm" />}
              {c?.name ?? id}
            </li>
          );
        })}
      </ul>
    </>
  );
  const tabs = (
    <div role="tablist" aria-label="Board view" className="flex gap-1">
      {(
        [
          ['board', 'Board', LayoutGrid],
          ['code', 'Code', Code2],
        ] as const
      ).map(([id, label, Icon]) => (
        <button key={id} type="button" role="tab" aria-selected={pane === id} className={pane === id ? primaryButton : outlineButton} onClick={() => setPane(id)}>
          <Icon size={14} aria-hidden="true" /> {label}
        </button>
      ))}
    </div>
  );
  const boardView = (
    <div className="space-y-2">
      {tabs}
      <div className="rounded-brutal border-bw-2 border-ink bg-paper shadow-brutal-md overflow-hidden">
        {pane === 'board' ? (
          <GameCanvas
            board={shown}
            components={components}
            scenario={game.scenario}
            wide={wide}
            compact={narrow}
            tick={shownTick}
            animate={!planning && !reduced && playing}
            speed={settings.speed}
            selected={selected}
            wiringFrom={wiring ? selected : undefined}
            validTargets={validTargets}
            placingRow={planning && placing ? placeOf(placing) : undefined}
            fresh={fresh}
            shake={shake}
            editable={planning}
            onNode={onNode}
            onGhost={onGhost}
            onBackground={onBackground}
            onWire={wire}
            rowAt={(fn) => (dropRow.current = fn)}
          />
        ) : (
          <div className="h-[min(60vh,480px)] flex flex-col">
            <Suspense fallback={<p className="p-3 text-sm text-muted">Loading the editor…</p>}>
              <CodeEditor value={code} onChange={onCode} diagnostics={codeProblems} nodeIds={shown.nodes.map((n) => n.id)} readOnly={!planning} />
            </Suspense>
            {codeProblems.length > 0 && (
              <ul className="border-t border-ink/15 px-3 py-1.5 text-xs text-fail">
                {codeProblems.slice(0, 3).map((d) => (
                  <li key={`${d.line}:${d.message}`}>
                    Line {d.line}: {d.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
  const top = (
    <div className="flex items-center justify-between gap-2">
      <button type="button" className={outlineButton} onClick={props.onExit} aria-label="Back to the Arcade">
        <ArrowLeft size={14} aria-hidden="true" /> {!narrow && 'Arcade'}
      </button>
      <h1 className="font-display font-extrabold truncate">
        {game.scenario.title}
        {setup.ascension > 0 && <span className="ml-1 text-sm text-pop-pink">A{setup.ascension}</span>}
        {setup.mode === 'daily' && <span className="ml-1 text-sm text-muted">daily</span>}
      </h1>
      <button type="button" className={outlineButton} aria-pressed={settings.sound} aria-label={settings.sound ? 'Sound on' : 'Sound off'} onClick={() => props.onSettings({ ...settings, sound: !settings.sound })}>
        {settings.sound ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}
      </button>
    </div>
  );
  const stampEl = stamp && (
    <div className="pointer-events-none fixed inset-x-0 top-1/3 z-40 flex justify-center px-3" aria-hidden="true">
      <p className={`sf-stamp rounded-brutal border-bw-3 border-ink px-5 py-3 text-center font-display text-3xl sm:text-5xl font-extrabold shadow-brutal-lg ${forecast.boss ? 'bg-fail text-white' : 'bg-pop-yellow text-on-accent'}`}>
        {stamp.toUpperCase()}
      </p>
    </div>
  );

  return (
    <div className={`max-w-5xl mx-auto px-3 sm:px-4 py-4 space-y-3 ${narrow ? 'pb-56' : ''}`}>
      {top}
      {!narrow && hud}
      {stampEl}
      {planning && forecast.ticket && <TicketCard ticket={forecast.ticket} key={`ticket-${s.wave}`} />}
      {planning && game.waveDef().diagnosis && (
        <DiagnosisPanel key={`diagnosis-${s.wave}`} diagnosis={game.waveDef().diagnosis!} picked={s.diagnosis} onPick={(pick) => apply({ t: 'diagnose', pick })} />
      )}
      {planning && <ForecastPanel forecast={forecast} scenario={game.scenario} events={events} act={act} collapsible={narrow} key={`forecast-${s.wave}`} />}
      {planning && (
        <ChangesPanel
          game={game}
          planning={planning}
          onMigrate={(id, to) => {
            apply({ t: 'migrate', id, to });
            setPreview(undefined);
          }}
          onSunset={(useCase) => {
            apply({ t: 'sunset', useCase });
            setPreview(undefined);
          }}
        />
      )}

      {narrow ? (
        <>
          {boardView}
          {hand && <div className="text-sm">{hand}</div>}
          {/* The dock: what a thumb needs, always on screen. */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t-bw-2 border-ink bg-paper shadow-[0_-4px_0_rgb(var(--c-shadow)/0.15)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className="mx-auto max-w-5xl space-y-2 px-3 py-2">
              {inspector && <div className="max-h-[40dvh] overflow-y-auto overscroll-contain">{inspector}</div>}
              {!inspector && feedback}
              {hud}
              {inspector ? null : planning ? (
                <>
                  {palette}
                  <div className="grid grid-cols-[auto_auto_auto_1fr] gap-2">
                    {undoRedo}
                    {loadTestButton}
                    {deployButton}
                  </div>
                </>
              ) : (
                controls
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-2">
            {boardView}
            {planning ? palette : controls}
            {feedback}
          </div>
          <div className="min-w-0 space-y-3">
            {inspector ?? (
              <div className="rounded-brutal border-bw-1 border-dashed border-ink/50 p-3 text-sm text-muted">
                <p className={eyebrow}>How to play</p>
                <p className="mt-1">
                  {planning
                    ? 'Pick a component below and tap the + in its row (or drag it there). Tap a node to scale it, size it, wire it or remove it. Deploy when the forecast looks covered.'
                    : 'Watch the requests flow. Hot nodes turn yellow, then pink, then red. Tap a node to page the on-call for one more replica.'}
                </p>
                {hand}
              </div>
            )}
            {planning && (
              <div className="grid grid-cols-2 gap-2">
                {undoRedo}
                <div className="col-span-2 grid">{loadTestButton}</div>
                <div className="col-span-2 grid">{deployButton}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {drag?.moved && (
        <div className="pointer-events-none fixed z-50 rounded-brutal border-bw-1 border-ink bg-pop-yellow px-2.5 py-1.5 text-sm font-semibold text-on-accent shadow-brutal-md" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden="true">
          {components.get(drag.id)?.name}
        </div>
      )}

      {showResult && lastSummary && (
        <WaveResult
          summary={lastSummary}
          scenario={game.scenario}
          events={events}
          onContinue={() => {
            setShowResult(false);
            if (lastSummary.clean) play('cash');
          }}
        />
      )}
      {!showResult && s.phase === 'draft' && (
        <Draft
          offer={s.offer.map((id) => content.cards.find((c) => c.id === id)!).filter(Boolean)}
          cash={s.cash}
          rerollCost={game.rerollCost()}
          onPick={(i) => {
            apply({ t: 'pick', card: i });
            if (i !== null) {
              play('card');
              const el = document.querySelector('[role="status"]');
              if (el) void celebrate(el, { count: 10 });
            }
          }}
          onReroll={() => apply({ t: 'reroll' })}
        />
      )}
      {!showResult && s.phase === 'contract' && (
        <Contracts offer={s.contractOffer.map((id) => game.scenario.contracts.find((c) => c.id === id)!).filter(Boolean)} scenario={game.scenario} onPick={(i) => apply({ t: 'contract', pick: i })} />
      )}
      <p className="sr-only" aria-live="polite">
        {last && !planning ? `Tick ${last.tick + 1}: ${last.breaches.length ? last.breaches[0].message : 'all good'}` : ''}
      </p>
    </div>
  );
}
