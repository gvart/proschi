import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleCheck, Eye, CircleX, Code2, FlaskConical, Flag, Keyboard, MessagesSquare, Mic, MoreHorizontal, PanelRightClose, PanelRightOpen, Pause, Presentation, Timer, Volume2, VolumeX, X } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import CodeEditor from '../../components/Playground/CodeEditor';
import EditableCanvas from '../../components/Diagram/EditableCanvas';
import { EmptyCanvas } from '../../components/Diagram/CanvasEditing';
import Menu, { MenuItem } from '../../components/Playground/Menu';
import { iconButton, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { DifficultyBadge } from '../Badges';
import type { Problem } from '../types';
import { PROBLEM_FILE, type RunResult } from '../workspace';
import { formatClock, PHASES, type Phase } from '../modes/session';
import { useToastClearance } from '../../design/toastClearance';
import type { Talk } from './prefs';
import { stageLabel } from './stages';
import type { Whiteboard } from './useRoom';
import './room.css';

/**
 * The interview room (docs/design/paid-plans.md P45): a whiteboard and a
 * chat, like a video call's. The whiteboard (the visual canvas, with the
 * palette and the Flows builder) takes the page; the rail on the right holds
 * the conversation (or, on your own, the phase's questions) and folds away.
 * The top bar has the phases, the clock, the toggles and the two actions:
 * check the design, finish. The code is hidden until "Show code", for those
 * who know Proschi. Phones get Chat and Whiteboard tabs, the chat first.
 *
 * Each phase is its own stage screen (P49): Clarify and Estimate bring their
 * own `screen`, Design and Wrap-up are the whiteboard. "Next" moves on (the
 * user decides); past stages open read-only from the stepper.
 */

export type RoomTab = 'chat' | 'board' | 'code';

interface RoomProps {
  problem: Problem;
  board: Whiteboard;
  phone: boolean;
  /** The stage the interview is on. */
  phase: Phase;
  /** A past stage open read-only, from the stepper. */
  viewing?: Phase;
  onView: (stage: Phase | undefined) => void;
  /** Moves on to the next stage; absent in the wrap-up, where finishing is the way on. */
  next?: { label: string; onClick: () => void; disabled?: boolean };
  /** The stage's own screen, in place of the whiteboard and the rail (Clarify, Estimate, a past stage). */
  screen?: ReactNode;
  /** The wrap-up: the chat takes more of the room. */
  railWide?: boolean;
  /** Pulses the current phase when it changes. */
  pulse: number;
  clock: { left: number; paused?: boolean; onToggle?: () => void; flash?: 'warn5' | 'warn1' };
  /** Voice or text, with the interviewer only. */
  talk?: { value: Talk; onChange: (t: Talk) => void; voiceOk: boolean };
  sound: { on: boolean; onChange: (on: boolean) => void };
  code: { shown: boolean; onChange: (shown: boolean) => void };
  onCheck: () => void;
  finish: { label: string; busy?: boolean; loud?: boolean; onClick: () => void; disabled?: boolean };
  onExit: () => void;
  rail: { title: string; content: ReactNode; folded: boolean; onFold: (folded: boolean) => void; unread?: boolean };
  /** The checks' results over the whiteboard's foot, with what to do about them. */
  checks?: ReactNode;
  tab: RoomTab;
  onTab: (tab: RoomTab) => void;
}

export default function Room({ problem, board, phone, phase, viewing, onView, next, screen, railWide, pulse, clock, talk, sound, code, onCheck, finish, onExit, rail, checks, tab, onTab }: RoomProps) {
  const { source, setSource, parsed, layout, editor } = board;
  const rootDiagnostics = useMemo(() => parsed.diagnostics.filter((d) => d.file === undefined), [parsed]);
  const nodeIds = useMemo(() => parsed.diagram.nodes.map((n) => n.id), [parsed]);
  const [fitTick, setFitTick] = useState(0);
  const refit = useCallback(() => setFitTick((n) => n + 1), []);
  const shownTab = tab === 'code' && !code.shown ? 'board' : tab;
  const boardStage = !screen;
  const clearToasts = useToastClearance();

  // Focus moves to each new stage's heading (not on the first render: the room's own focus stands then).
  const root = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[data-stage-heading]')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [phase, viewing]);
  const shown = viewing ?? phase;

  const whiteboard = (
    <section aria-label="Whiteboard" className="ps-room-board relative h-full min-w-0">
      <EditableCanvas
        source={source}
        diagram={parsed.diagram}
        onChange={board.edit}
        onUndo={() => void editor.current?.undo()}
        onRedo={() => void editor.current?.redo()}
        nodes={layout.nodes}
        edges={layout.edges}
        fitKey={`${shownTab}:${layout.settled}:${fitTick}:${code.shown}:${rail.folded}`}
        layoutBusy={layout.busy}
        problemCapacity
        paletteKey="proschi.interview.palette"
        phone={phone}
        flows
      />
      {layout.nodes.length === 0 && <EmptyCanvas />}
      {checks}
    </section>
  );
  const editorPane = (
    <section aria-label="Code" className="flex h-full min-w-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-ink/15 px-3 py-1.5 font-mono text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">
          solution.proschi <span className="font-sans">· imports</span> {PROBLEM_FILE}
        </span>
        {!phone && (
          <button type="button" onClick={() => code.onChange(false)} className={`${iconButton} !h-7 !w-7`} aria-label="Hide the code" title="Hide the code">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <CodeEditor ref={editor} value={source} onChange={setSource} diagnostics={rootDiagnostics} nodeIds={nodeIds} diagram={parsed.diagram} />
      </div>
    </section>
  );

  const railBox = (
    <aside aria-label={rail.title} className="flex h-full min-h-0 flex-col bg-paper">
      {!phone && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b-bw-1 border-ink bg-surface pl-3 pr-1">
          <MessagesSquare size={15} aria-hidden="true" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{rail.title}</h2>
          <button type="button" onClick={() => rail.onFold(true)} className={`${iconButton} !h-8 !w-8`} aria-label={`Hide the ${rail.title.toLowerCase()}`} title="Hide (the whiteboard gets the room)">
            <PanelRightClose size={16} />
          </button>
        </div>
      )}
      {rail.content}
    </aside>
  );

  const boardLayout = phone ? (
    <>
      <div role="tablist" aria-label="Room" className="ps-tabs ps-tabs--fill flex bg-surface">
        {(
          [
            ['chat', rail.title, MessagesSquare],
            ['board', 'Whiteboard', Presentation],
            ...(code.shown ? ([['code', 'Code', Code2]] as const) : []),
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={shownTab === id} onClick={() => onTab(id)} className="ps-tab relative !px-2">
            <Icon size={15} className="hidden min-[420px]:block" aria-hidden="true" />
            {label}
            {id === 'chat' && rail.unread && shownTab !== 'chat' && <span aria-label="New message" className="absolute right-3 top-2 h-2 w-2 rounded-full bg-pop-pink" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <div className={shownTab === 'chat' ? 'h-full' : 'hidden'}>{railBox}</div>
        <div className={shownTab === 'board' ? 'h-full' : 'hidden'}>{whiteboard}</div>
        {code.shown && <div className={shownTab === 'code' ? 'h-full' : 'hidden'}>{editorPane}</div>}
      </div>
    </>
  ) : (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1">
        {code.shown ? (
          <Group orientation="horizontal" className="h-full" onLayoutChanged={refit}>
            <Panel id="room-code" defaultSize="38%" minSize="22%" maxSize="60%">
              {editorPane}
            </Panel>
            <Separator className="ps-splitter w-[var(--bw-1)]" aria-label="Resize the code and the whiteboard" />
            <Panel id="room-board" minSize="30%">
              {whiteboard}
            </Panel>
          </Group>
        ) : (
          whiteboard
        )}
      </div>
      {rail.folded ? (
        <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-l-bw-1 border-ink bg-surface py-2">
          <button type="button" onClick={() => rail.onFold(false)} className={`${iconButton} relative`} aria-label={`Show the ${rail.title.toLowerCase()}`} title={`Show the ${rail.title.toLowerCase()}`}>
            <PanelRightOpen size={18} />
            {rail.unread && <span aria-label="New message" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-pop-pink" />}
          </button>
        </div>
      ) : (
        <div className={`shrink-0 border-l-bw-1 border-ink ${railWide ? 'w-[440px] xl:w-[520px]' : 'w-[380px] xl:w-[400px]'}`} data-testid="interview-rail">
          {railBox}
        </div>
      )}
    </div>
  );

  return (
    <div ref={root} className="flex h-[100dvh] flex-col bg-paper text-ink" data-testid="interview-room" data-stage={phase} data-viewing={viewing}>
      <TopBar
        problem={problem}
        phone={phone}
        phase={phase}
        viewing={viewing}
        onView={onView}
        next={next}
        boardTools={boardStage}
        pulse={pulse}
        clock={clock}
        talk={talk}
        sound={sound}
        code={code}
        onCheck={onCheck}
        finish={finish}
        onExit={onExit}
      />
      {viewing && (
        <div role="status" data-testid="stage-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b-bw-1 border-ink bg-pop-blue/15 px-4 py-2 text-sm text-ink">
          <Eye size={15} aria-hidden="true" />
          <span className="font-semibold">Viewing {stageLabel(viewing)} (read-only)</span>
          <span aria-hidden="true" className="text-muted">·</span>
          <button type="button" onClick={() => onView(undefined)} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-ink/80">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to {stageLabel(phase)}
          </button>
        </div>
      )}
      <div key={shown} className="ps-stage-enter flex min-h-0 flex-1 flex-col">
        {boardStage && (
          <h2 data-stage-heading tabIndex={-1} className="sr-only">
            {stageLabel(phase)}
          </h2>
        )}
        {screen ?? boardLayout}
      </div>
      {phone && !viewing && (next || phase === 'wrapup') && (
        <div ref={clearToasts} className="shrink-0 border-t-bw-1 border-ink bg-surface px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="next-bar">
          {next ? (
            <button type="button" onClick={next.onClick} disabled={next.disabled} className={`${primaryButton} w-full justify-center disabled:opacity-50`}>
              {next.label}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={finish.onClick} disabled={finish.busy || finish.disabled} className={`${primaryButton} w-full justify-center disabled:opacity-50`}>
              <Flag size={15} aria-hidden="true" />
              {finish.busy ? 'Writing the verdict…' : finish.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type TopBarProps = Pick<RoomProps, 'problem' | 'phone' | 'phase' | 'viewing' | 'onView' | 'next' | 'pulse' | 'clock' | 'talk' | 'sound' | 'code' | 'onCheck' | 'finish' | 'onExit'> & { boardTools: boolean };

function TopBar({ problem, phone, phase, viewing, onView, next, boardTools, pulse, clock, talk, sound, code, onCheck, finish, onExit }: TopBarProps) {
  const index = PHASES.findIndex((p) => p.id === phase);
  const late = clock.left <= 60_000 ? 'text-red-700 dark:text-red-300' : clock.left <= 5 * 60_000 ? 'text-amber-700 dark:text-amber-300' : 'text-ink';
  const wrapup = phase === 'wrapup';
  const timer = (
    <button
      type="button"
      role="timer"
      onClick={clock.onToggle}
      disabled={!clock.onToggle}
      aria-label={`Time left: ${formatClock(clock.left)}${clock.onToggle ? `. ${clock.paused ? 'Resume' : 'Pause'} the clock` : ''}`}
      title={clock.onToggle ? (clock.paused ? 'Resume the clock' : 'Pause the clock') : 'Time left'}
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-lg font-bold tabular-nums ${late} ${clock.onToggle ? 'hover:bg-ink/5' : 'cursor-default'} disabled:opacity-100`}
    >
      <span key={clock.flash} className={`inline-flex ${clock.flash ? 'ps-room-warn' : ''}`}>
        {clock.paused ? <Pause size={15} aria-hidden="true" /> : <Timer size={15} aria-hidden="true" />}
      </span>
      {formatClock(clock.left)}
    </button>
  );
  // The stages: the current one, the past ones open read-only, the later ones not yet.
  const stepper = (
    <ol aria-label="Stages" className="flex min-w-0 items-center gap-1">
      {PHASES.map((p, i) => {
        const now = i === index;
        const done = i < index;
        const open = viewing === p.id || (now && !viewing);
        const look = open
          ? `border-ink bg-pop-yellow text-on-accent ${now && pulse ? 'ps-room-pulse' : ''}`
          : now
            ? 'border-ink bg-pop-yellow/30 text-ink hover:bg-pop-yellow/60'
            : done
              ? 'border-ink/40 text-ink hover:border-ink hover:bg-paper'
              : 'border-ink/15 text-muted';
        const named = open || (now && !phone);
        const label = <span className={named ? '' : phone ? 'sr-only' : 'max-[1439px]:sr-only'}>{p.label}</span>;
        const inner = (
          <>
            {done ? <Check size={11} aria-hidden="true" /> : <span className="font-mono">{i + 1}</span>}
            {label}
          </>
        );
        const pill = `flex items-center gap-1 whitespace-nowrap rounded-full border-bw-1 px-2 py-0.5 text-xs font-semibold ${look}`;
        return (
          <li key={now ? `${p.id}:${pulse}` : p.id} aria-current={now ? 'step' : undefined} className={phone && !open && !now && !done ? 'max-[479px]:hidden' : ''}>
            {done || (now && viewing) ? (
              <button
                type="button"
                onClick={() => onView(now ? undefined : p.id)}
                aria-pressed={viewing === p.id}
                aria-label={now ? `Back to ${p.label}` : `View ${p.label} (read-only)`}
                title={now ? `Back to ${p.label}` : `View ${p.label}, read-only`}
                className={`${pill} min-h-[28px]`}
              >
                {inner}
              </button>
            ) : (
              <span className={`${pill} min-h-[28px]`}>{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
  const exit = (
    <button type="button" onClick={onExit} className={toolButton} aria-label="Exit the interview" title="Exit the interview">
      <X size={16} aria-hidden="true" />
      <span className="max-lg:hidden">Exit</span>
    </button>
  );

  if (phone) {
    return (
      <header className="shrink-0 border-b-bw-1 border-ink bg-surface">
        <div className="flex items-center gap-1 px-1.5 py-1">
          {exit}
          <div className="min-w-0 flex-1 overflow-hidden">{stepper}</div>
          {timer}
          <Menu label="Room options" align="right" trigger={<MoreHorizontal size={18} />}>
            {(close) => (
              <>
                {boardTools && (
                  <MenuItem
                    icon={<FlaskConical size={14} />}
                    onSelect={() => {
                      close();
                      onCheck();
                    }}
                  >
                    Check my design
                  </MenuItem>
                )}
                {talk && (
                  <MenuItem
                    icon={talk.value === 'voice' ? <Keyboard size={14} /> : <Mic size={14} />}
                    onSelect={() => {
                      close();
                      talk.onChange(talk.value === 'voice' ? 'text' : 'voice');
                    }}
                  >
                    {talk.value === 'voice' ? 'Switch to text' : 'Switch to voice'}
                  </MenuItem>
                )}
                <MenuItem
                  icon={sound.on ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  onSelect={() => {
                    close();
                    sound.onChange(!sound.on);
                  }}
                >
                  {sound.on ? 'Turn sounds off' : 'Turn sounds on'}
                </MenuItem>
                {boardTools && (
                  <MenuItem
                    icon={<Code2 size={14} />}
                    onSelect={() => {
                      close();
                      code.onChange(!code.shown);
                    }}
                  >
                    {code.shown ? 'Hide code' : 'Show code'}
                  </MenuItem>
                )}
                {!wrapup && (
                  <>
                    <div className="my-1 border-t border-ink/10" />
                    <MenuItem
                      icon={<Flag size={14} />}
                      onSelect={() => {
                        close();
                        finish.onClick();
                      }}
                    >
                      {finish.label}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b-bw-1 border-ink bg-surface px-2">
      {exit}
      <div className="flex min-w-0 shrink items-center gap-2 border-l border-ink/15 pl-3">
        <h1 className="min-w-0 truncate font-display text-base font-bold tracking-tight text-ink" title={problem.title}>
          {problem.title}
        </h1>
        <span className="max-xl:hidden">
          <DifficultyBadge difficulty={problem.difficulty} />
        </span>
      </div>
      <div className="mx-auto flex min-w-0 items-center gap-2 px-2">
        {stepper}
        {timer}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {talk && (
          <div role="radiogroup" aria-label="Talk with the interviewer" className="mr-1 inline-flex rounded-sm border-bw-1 border-ink bg-paper p-0.5">
            {(['voice', 'text'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={talk.value === t}
                disabled={t === 'voice' && !talk.voiceOk}
                onClick={() => talk.onChange(t)}
                title={t === 'voice' ? (talk.voiceOk ? 'Talk: the mic listens and the interviewer speaks' : 'This browser cannot listen') : 'Type your answers'}
                className={`inline-flex items-center gap-1 rounded-[2px] px-2 py-1 text-xs font-semibold disabled:opacity-40 ${talk.value === t ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/5'}`}
              >
                {t === 'voice' ? <Mic size={13} aria-hidden="true" /> : <Keyboard size={13} aria-hidden="true" />}
                {t === 'voice' ? 'Voice' : 'Text'}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-pressed={sound.on}
          onClick={() => sound.onChange(!sound.on)}
          className={iconButton}
          aria-label="Sound effects"
          title={sound.on ? 'Sound effects are on' : 'Sound effects are off'}
          data-testid="room-sound"
        >
          {sound.on ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        {boardTools && (
          <>
            <button type="button" aria-label="Show code" aria-pressed={code.shown} onClick={() => code.onChange(!code.shown)} className={`${toolButton} aria-pressed:border-ink aria-pressed:bg-pop-yellow aria-pressed:text-on-accent`} title="The design as Proschi code, beside the whiteboard">
              <Code2 size={15} aria-hidden="true" />
              <span className="max-[1279px]:sr-only">Code</span>
            </button>
            <button type="button" onClick={onCheck} className={outlineButton} title="Run the problem's tests on the whiteboard">
              <FlaskConical size={15} aria-hidden="true" />
              <span className="max-xl:sr-only">Check my design</span>
            </button>
          </>
        )}
        {wrapup ? (
          <button type="button" onClick={finish.onClick} disabled={finish.busy || finish.disabled} className={`${primaryButton} disabled:opacity-50`}>
            <Flag size={15} aria-hidden="true" />
            {finish.busy ? 'Writing the verdict…' : finish.label}
          </button>
        ) : (
          <button type="button" onClick={finish.onClick} disabled={finish.busy || finish.disabled} aria-label={finish.label} title={finish.label} className={`${finish.loud ? outlineButton : toolButton} disabled:opacity-50`}>
            <Flag size={15} aria-hidden="true" />
            {finish.busy ? 'Writing the verdict…' : 'Finish'}
          </button>
        )}
        {next && (
          <button type="button" onClick={next.onClick} disabled={next.disabled || !!viewing} className={`${primaryButton} ml-1 disabled:opacity-50`} data-testid="stage-next">
            {next.label}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}

/** The checks' results, over the foot of the whiteboard: how many pass, and each with its message. */
export function ChecksSheet({ run, stale, onClose, children }: { run: RunResult; stale: boolean; onClose: () => void; children?: ReactNode }) {
  const failed = run.results.filter((r) => !r.passed);
  const heading = run.blocked === 'errors' ? 'The design has errors to fix first' : run.blocked ? 'The checks could not run' : `${run.passed} of ${run.results.length} checks pass`;
  return (
    <section
      aria-label="Checks"
      data-testid="checks"
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[45%] flex-col overflow-hidden rounded-sm border-bw-1 border-ink bg-surface shadow-brutal-md md:left-auto md:right-3 md:w-[26rem]"
    >
      <div className={`flex items-center gap-2 border-b-bw-1 border-ink px-3 py-2 ${run.solved ? 'bg-pass/20' : 'bg-fail/15'}`}>
        {run.solved ? <CircleCheck size={16} aria-hidden="true" /> : <CircleX size={16} aria-hidden="true" />}
        <h2 role="status" className="min-w-0 flex-1 text-sm font-bold text-ink">
          {run.solved ? `All ${run.results.length} checks pass` : heading}
        </h2>
        <button type="button" onClick={onClose} className={`${iconButton} !h-7 !w-7`} aria-label="Close the checks">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {stale && <p className="text-xs text-muted">The whiteboard changed since; check again to see where it stands.</p>}
        {run.blocked === 'errors' && <p className="text-sm text-ink">Show the code to see the errors, or undo the last change.</p>}
        <ul className="space-y-1.5">
          {[...failed, ...run.results.filter((r) => r.passed)].map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm text-ink">
              {r.passed ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-700 dark:text-green-300" aria-label="Passes" /> : <CircleX size={15} className="mt-0.5 shrink-0 text-red-700 dark:text-red-300" aria-label="Fails" />}
              <span className="min-w-0">
                <span className="font-semibold">{r.name}</span>
                {!r.passed && <span className="block text-xs text-muted">{r.message}</span>}
              </span>
            </li>
          ))}
        </ul>
        {children}
      </div>
    </section>
  );
}
