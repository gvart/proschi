import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { OutlineStep, UseCaseOutline } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import { shorten } from '../../dsl/sequence';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow } from '../Playground/ui';
import { entrySteps, laneOrder, layoutSequence, SEQ, sequenceEntries, type MessageBox } from './sequenceLayout';

/**
 * A use case as a sequence diagram (the Flows pane, FlowsPane.tsx): one lane
 * per component, one numbered message per step, top to bottom as written.
 * Responses (`-->`) are dashed arrows back, messages (`->>`) have an open
 * head, failed calls (`-x`) end in a red cross, and a `par` block is a frame.
 * The main flow folds its scenarios; a scenario's tab shows its branch in
 * place. The messages are a list box: a click or Up and Down select a step,
 * which the canvas and the step list show too.
 */

interface SequenceDiagramProps {
  outline: UseCaseOutline;
  /** The scenario whose tab is shown; empty for the main flow. */
  scenario: string;
  diagram: Diagram;
  /** The line of the selected step, if any. */
  selected?: number;
  onSelect: (step: OutlineStep) => void;
  /** Opens a folded scenario's tab. */
  onScenario: (name: string) => void;
}

/** The arrow sits under its label, this far below the row's centre. */
const LINE_DY = 8;
/** The lane headers' strip, which stays at the top as the diagram scrolls. */
const HEADER = 52;

export default function SequenceDiagram({ outline, scenario, diagram, selected, onSelect, onScenario }: SequenceDiagramProps) {
  const nodes = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);
  const name = (id: string) => nodes.get(id)?.name ?? id;
  const lanes = useMemo(() => laneOrder(outline), [outline]);
  const entries = useMemo(() => sequenceEntries(outline.items, scenario), [outline, scenario]);
  const layout = useMemo(() => layoutSequence(entries, lanes, (id) => nodes.get(id)?.name ?? id), [entries, lanes, nodes]);
  const listRef = useRef<HTMLDivElement>(null);
  /** The selection was moved with the keyboard, so the focus follows it. */
  const moved = useRef(false);

  // The selected message in sight (below the sticky headers), and focused when the keys moved it.
  useEffect(() => {
    if (selected === undefined) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[data-line="${selected}"]`);
    if (!option) return;
    option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (moved.current) option.focus({ preventScroll: true });
    moved.current = false;
  }, [selected, layout]);

  if (lanes.length === 0) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center p-6 text-center text-sm text-muted">
        <p className="max-w-sm">
          <span className="block font-semibold text-ink">No steps yet</span>
          Add the first request, from where the user starts. Each step is drawn here, with a lane per component.
        </p>
      </div>
    );
  }

  const shown = entrySteps(entries);
  const onKey = (e: KeyboardEvent) => {
    const at = shown.findIndex((s) => s.line === selected);
    const next =
      e.key === 'ArrowDown' ? Math.min(shown.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at === -1 ? 0 : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault();
    if (shown[next] && shown[next].line !== selected) {
      moved.current = true;
      onSelect(shown[next]);
    }
  };
  const focusable = shown.some((s) => s.line === selected) ? selected : shown[0]?.line;

  return (
    <div className="relative min-w-full" style={{ width: layout.width }}>
      {/* The lane headers: each component's icon and name, like its node on the canvas. */}
      <div className="sticky top-0 z-20 border-b border-ink/15 bg-surface" style={{ height: HEADER, width: layout.width, minWidth: '100%' }} aria-hidden="true">
        {layout.lanes.map((lane) => {
          const node = nodes.get(lane.id);
          return (
            <div
              key={lane.id}
              data-lane={lane.id}
              title={node ? `${node.name} (${node.techStack})` : lane.id}
              className="absolute top-2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-sm border-bw-1 border-ink bg-surface py-1 pl-1 pr-2 text-ink shadow-brutal-sm"
              style={{ left: lane.x, maxWidth: lane.width }}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border-bw-1 border-ink bg-paper [&_svg]:h-3.5 [&_svg]:w-3.5">
                {node ? getTechStackIcon(node.techStack, node.type) : null}
              </span>
              <span className="truncate text-[13px] font-bold">{name(lane.id)}</span>
            </div>
          );
        })}
      </div>
      <div className="relative" style={{ height: layout.height }}>
        {/* Frames under everything: a par block, the chosen scenario's branch. */}
        {layout.frames.map((f) => (
          <div
            key={`${f.kind}${f.line}`}
            data-frame={f.kind}
            className={`absolute rounded-sm border-bw-1 ${f.kind === 'parallel' ? 'border-ink/45 bg-ink/[0.025]' : 'border-dashed border-ink/50 bg-pop-yellow/10'}`}
            style={{ left: f.x, top: f.y, width: f.width, height: f.height }}
          >
            <span className={`absolute left-0 top-0 rounded-br-sm border-b border-r px-1.5 py-0.5 ${eyebrow} !text-ink/75 ${f.kind === 'parallel' ? 'border-ink/45 bg-surface' : 'border-dashed border-ink/50 bg-pop-yellow/30'}`}>
              {f.title}
            </span>
          </div>
        ))}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.lanes.map((lane) => (
            <line key={lane.id} x1={lane.x} x2={lane.x} y1={0} y2={layout.height} className="stroke-ink/25" strokeWidth={1.5} strokeDasharray="4 5" />
          ))}
          {layout.messages.map((m) => (
            <Arrow key={m.step.line} m={m} selected={m.step.line === selected} />
          ))}
        </svg>
        {layout.notes.map((note) => (
          <div
            key={`${note.kind}${note.line}`}
            className={`absolute flex items-center gap-2 rounded-sm px-2.5 text-xs ${note.kind === 'scenarios' ? 'border-bw-1 border-dashed border-ink/35 bg-surface' : 'text-muted'}`}
            style={{ left: note.x, top: note.y, width: note.width, height: note.height }}
          >
            {note.kind === 'scenarios' ? (
              <>
                <span className={eyebrow}>Scenarios</span>
                <span className="flex min-w-0 flex-wrap gap-1">
                  {note.names.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onScenario(n)}
                      aria-label={`Show the scenario ${n}`}
                      title={`Show the steps of ${n}`}
                      className="scroll-mt-16 rounded-full border-bw-1 border-ink/40 bg-surface px-2 py-0.5 text-xs font-semibold text-ink hover:border-ink hover:bg-pop-yellow/30"
                    >
                      {n}
                    </button>
                  ))}
                </span>
                <span className="ml-auto hidden truncate text-muted @2xl:inline">Pick one to see its steps</span>
              </>
            ) : note.kind === 'empty' ? (
              'No steps yet.'
            ) : (
              'A block you can edit in Code mode.'
            )}
          </div>
        ))}
        <div ref={listRef} role="listbox" aria-label={`Sequence of ${outline.name}`} aria-orientation="vertical" onKeyDown={onKey} className="pointer-events-none absolute inset-0">
          {layout.messages.map((m) => (
            <Message key={m.step.line} m={m} name={name} selected={m.step.line === selected} focusable={m.step.line === focusable} onSelect={() => onSelect(m.step)} />
          ))}
        </div>
      </div>
    </div>
  );
}

const KIND_TAG: Partial<Record<OutlineStep['kind'], string>> = { async: 'message', failed: 'fails' };

/** A message's row: its number and label over the arrow, the target of clicks and keys. */
function Message({ m, name, selected, focusable, onSelect }: { m: MessageBox; name: (id: string) => string; selected: boolean; focusable: boolean; onSelect: () => void }) {
  const { step } = m;
  const self = m.x1 === m.x2;
  const left = self ? m.x1 + 6 : Math.min(m.x1, m.x2) + 6;
  const width = self ? SEQ.loop + m.labelWidth + SEQ.labelChrome + 24 : Math.abs(m.x2 - m.x1) - 12;
  const reply = step.kind === 'response';
  const tag = KIND_TAG[step.kind];
  const text = `${name(step.from)} ${reply ? 'answers' : 'to'} ${name(step.to)}${step.label ? `: ${step.label}` : ''}${reply ? ' (response)' : tag ? ` (${tag})` : ''}`;
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${m.n}. ${text}`}
      data-line={step.line}
      tabIndex={focusable ? 0 : -1}
      title={step.label ? `${m.n}. ${step.label}` : undefined}
      onClick={onSelect}
      className={`group/msg pointer-events-auto absolute flex scroll-mt-16 cursor-pointer justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ink ${self ? '!justify-start pl-[52px]' : ''}`}
      style={{ left, width, top: m.y - SEQ.row / 2 + 1, height: SEQ.row - 2 }}
    >
      <span
        className={`mt-0.5 inline-flex h-[21px] max-w-full items-center gap-1.5 self-start rounded-sm border-bw-1 bg-surface pl-0.5 pr-1.5 ${
          selected ? 'border-ink shadow-brutal-sm' : 'border-transparent group-hover/msg:border-ink/40'
        }`}
      >
        <span
          className={`grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 font-mono text-[10px] font-bold tabular-nums ${
            selected ? 'bg-pop-pink text-on-accent' : step.kind === 'failed' ? 'bg-fail text-on-accent' : 'bg-ink text-paper'
          }`}
        >
          {m.n}
        </span>
        <span className={`truncate font-mono text-[11.5px] leading-none ${reply ? 'text-ink/70' : 'text-ink'} ${selected ? 'font-semibold' : ''}`}>{step.label ? shorten(step.label, 80) : <span className="italic text-muted">no label</span>}</span>
        {tag && <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${step.kind === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}>{tag}</span>}
      </span>
    </div>
  );
}

/** The arrow of a message: solid for a call, dashed back for an answer, an open head for a message, a cross for a call that fails. */
function Arrow({ m, selected }: { m: MessageBox; selected: boolean }) {
  const { step } = m;
  const y = m.y + LINE_DY;
  const failed = step.kind === 'failed';
  const [stroke, fill] = selected ? ['stroke-pop-pink', 'fill-pop-pink'] : failed ? ['stroke-fail', 'fill-fail'] : step.kind === 'response' ? ['stroke-ink/60', 'fill-ink/60'] : ['stroke-ink', 'fill-ink'];
  const width = selected ? 2.5 : 1.75;
  const dash = step.kind === 'response' ? '6 4' : undefined;
  if (m.x1 === m.x2) {
    // To its own lane: out to the right and back.
    const x = m.x1;
    const out = x + SEQ.loop - 14;
    return (
      <g className={stroke} fill="none" strokeWidth={width}>
        <path d={`M ${x} ${y - 8} H ${out} V ${y + 6} H ${x + 8}`} strokeDasharray={dash} />
        <Head x={x} y={y + 6} dir={-1} kind={step.kind} fill={fill} />
      </g>
    );
  }
  const dir = Math.sign(m.x2 - m.x1);
  // The shaft stops short of the head, so the head's point is on the lifeline.
  const end = m.x2 - dir * (failed ? 7 : step.kind === 'request' ? 8 : 1);
  return (
    <g className={stroke} fill="none" strokeWidth={width}>
      <line x1={m.x1} y1={y} x2={end} y2={y} strokeDasharray={dash} />
      <Head x={m.x2} y={y} dir={dir} kind={step.kind} fill={fill} />
    </g>
  );
}

function Head({ x, y, dir, kind, fill }: { x: number; y: number; dir: number; kind: OutlineStep['kind']; fill: string }) {
  if (kind === 'failed') {
    const c = x - dir * 7;
    return <path d={`M ${c - 5} ${y - 5} L ${c + 5} ${y + 5} M ${c - 5} ${y + 5} L ${c + 5} ${y - 5}`} strokeWidth={2.25} strokeLinecap="round" />;
  }
  const back = x - dir * 9;
  if (kind === 'request') return <path d={`M ${x} ${y} L ${back} ${y - 4.5} L ${back} ${y + 4.5} Z`} className={fill} stroke="none" />;
  return <path d={`M ${back} ${y - 5} L ${x} ${y} L ${back} ${y + 5}`} strokeLinejoin="round" strokeLinecap="round" />;
}
