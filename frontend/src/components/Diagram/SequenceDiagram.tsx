import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Plus, Ungroup } from 'lucide-react';
import type { OutlineStep, UseCaseOutline } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import { shorten } from '../../dsl/sequence';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow } from '../Playground/ui';
import { entrySteps, laneOrder, layoutSequence, sameSlot, SEQ, sequenceEntries, type MessageBox, type Slot, type SlotBox } from './sequenceLayout';
import { slotNear } from './sequenceEdit';

/**
 * A use case as a sequence diagram (the Flows pane, FlowsPane.tsx): one lane
 * per component, one numbered message per step, top to bottom as written.
 * Responses (`-->`) are dashed arrows back, messages (`->>`) have an open
 * head, failed calls (`-x`) end in a red cross, and a `par` block is a frame.
 * The main flow folds its scenarios; a scenario's tab shows its branch in
 * place. The messages are a list box: a click or Up and Down select a step,
 * which the canvas and the details beside the diagram show too; Shift or
 * Cmd/Ctrl select several. It is edited in place (FlowsPanel.tsx does the
 * edits): a "+" between the rows, or a drag from one lifeline to another,
 * opens the composer there; Alt+Up and Down move the selected step, Delete
 * removes it, and a `par` frame can be ungrouped or added to.
 */

/** How a click or a key changes the selection: to the one step, the steps from the anchor to it, or with it added or taken out. */
export type SelectMode = 'only' | 'range' | 'toggle';

interface SequenceDiagramProps {
  outline: UseCaseOutline;
  /** The scenario whose tab is shown; empty for the main flow. */
  scenario: string;
  diagram: Diagram;
  /** The lines of the selected steps; the last is the one in focus. */
  selected: number[];
  onSelect: (step: OutlineStep, mode: SelectMode) => void;
  /** Opens a folded scenario's tab. */
  onScenario: (name: string) => void;
  /** Opens the composer at an insertion point (`index`: how many messages are drawn before it), with the step's ends when a drag drew them. */
  onInsert?: (slot: Slot, index: number, ends?: { from: string; to: string }) => void;
  /** The keys on a selected step: Alt+Up and Down move it, Delete removes the selection, Enter goes to its form, Escape lets go. */
  onMove?: (direction: 'up' | 'down') => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onClear?: () => void;
  /** A `par` frame's Ungroup, by the line that opens it. */
  onUngroup?: (line: number) => void;
  /** The open composer, drawn at its insertion point. */
  composer?: { slot: Slot; node: ReactNode };
  /** Changed to put the focus back on the selected message (after an edit took it away). */
  focusKey?: number;
  /** While a step's ends are being picked: a click on a lane's header or lifeline picks its component, as a click on the canvas does. */
  onPickLane?: (id: string) => void;
}

/** The arrow sits under its label, this far below the row's centre. */
const LINE_DY = 8;
/** The lane headers' strip, which stays at the top as the diagram scrolls. */
const HEADER = 52;

export default function SequenceDiagram({ outline, scenario, diagram, selected, onSelect, onScenario, onInsert, onMove, onDelete, onEdit, onClear, onUngroup, composer, focusKey, onPickLane }: SequenceDiagramProps) {
  const nodes = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);
  const name = (id: string) => nodes.get(id)?.name ?? id;
  const lanes = useMemo(() => laneOrder(outline), [outline]);
  const entries = useMemo(() => sequenceEntries(outline.items, scenario), [outline, scenario]);
  const rootRef = useRef<HTMLDivElement>(null);
  const empty = lanes.length === 0;
  /** The width the diagram has (its scrolling box's), which the labels give room back to fit. */
  const [fit, setFit] = useState<number>();
  const layout = useMemo(() => layoutSequence(entries, lanes, (id) => nodes.get(id)?.name ?? id, undefined, fit), [entries, lanes, nodes, fit]);  /** The height of the diagram in sight (its scrolling box, as the pane clips it), which the composer fits in. */
  const [view, setView] = useState<number>();
  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = root?.parentElement;
    if (!root || !box) return;
    const measure = () => {
      setFit(box.clientWidth || undefined);
      setView(visibleHeight(root) || undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    // The pane resized changes what is in sight, where the column scrolls rather than the diagram's own box.
    const pane = root.closest('[role="region"]');
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [empty]);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  /** The selection was moved with the keyboard, so the focus follows it. */
  const moved = useRef(false);
  const primary = selected.at(-1);
  const shown = entrySteps(entries);
  const focusable = shown.some((s) => s.line === primary) ? primary : shown[0]?.line;

  // The selected message in sight (below the sticky headers), and focused when the keys moved it; again when it moves in
  // the diagram, but not when the same diagram is only drawn again (the design parsed anew), which would undo a scroll.
  const primaryAt = layout.messages.find((m) => m.step.line === primary)?.y;
  useEffect(() => {
    if (primary === undefined) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[data-line="${primary}"]`);
    if (!option) return;
    option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (moved.current) option.focus({ preventScroll: true });
    moved.current = false;
  }, [primary, primaryAt]);
  // After an edit that took the focus away (its button or the composer is gone), back on the message.
  const lastFocusKey = useRef(focusKey);
  useEffect(() => {
    if (focusKey === lastFocusKey.current) return;
    lastFocusKey.current = focusKey;
    listRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus({ preventScroll: true });
  }, [focusKey]);
  // A message is keyed by its line, so an edit of the text (an undo, a move) can take the focused one away: the focus stays on the diagram.
  const listFocused = useRef(false);
  useEffect(() => {
    if (listFocused.current && (document.activeElement === document.body || document.activeElement === null)) listRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus({ preventScroll: true });
  }, [layout]);
  // The composer's height, measured before paint, so it is placed (under or over its insertion point) before it shows.
  const composerAt = composer && slotKey(composer.slot);
  const [composerHeight, setComposerHeight] = useState(0);
  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    setComposerHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setComposerHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [composerAt]);

  /** Where the composer goes: its insertion point, and the row it is anchored to (a reply's request), which it never covers. */
  const placement = ((): { x: number; top: number; bottom: number } | undefined => {
    if (!composer) return undefined;
    const { slot } = composer;
    const drawn = layout.slots.find((b) => sameSlot(b.slot, slot));
    const m = slot.kind === 'after' ? layout.messages.find((msg) => msg.step.line === slot.line) : undefined;
    if (m) {
      // After a step (a reply to it): under its row, which is the anchor; where no "+" is drawn, at the row's foot.
      const box = drawn ?? layout.slots.find((b) => b.slot.kind === 'before' && b.slot.line === m.step.line);
      return { x: box?.x ?? 2, top: m.y - SEQ.row / 2, bottom: drawn?.y ?? m.y + SEQ.row / 2 };
    }
    if (drawn) return { x: drawn.x, top: drawn.y, bottom: drawn.y };
    const last = layout.slots.at(-1);
    return last && { x: last.x, top: last.y, bottom: last.y };
  })();
  const anchored = !!placement && placement.bottom > placement.top;
  /** At most the height in sight under the sticky headers (with the anchored row in sight too), so its buttons always are; its body scrolls inside it. */
  const composerMax = view && (empty ? view - 24 : Math.max(Math.min(view - 8, 120), view - HEADER - 16 - (anchored ? SEQ.row + 4 : 0)));
  // Under its insertion point; over it (and over the row it is anchored to) only when there is no room under it and there is over it.
  const roomBelow = placement ? Math.max(layout.height, (view ?? 0) - HEADER) - placement.bottom : 0;
  const above = !!placement && composerHeight > 0 && roomBelow < composerHeight + 8 && placement.top >= composerHeight + 8;
  const composerTop = placement && (above ? placement.top - 4 - composerHeight : placement.bottom + 4);

  // Wholly in sight when it opens or grows: below the sticky headers, its buttons first, then its top, then the row it answers.
  useLayoutEffect(() => {
    const el = composerRef.current;
    const root = rootRef.current;
    if (!composerAt || !el || !root || !contentRef.current) return;
    const scroller = verticalScroller(root);
    const s = scroller.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const content = contentRef.current.getBoundingClientRect().top;
    const a = placement ? { top: content + placement.top, bottom: content + placement.bottom } : { top: c.top, bottom: c.bottom };
    const lo = s.top + (scroller === root.parentElement ? HEADER : 0) + 4;
    const hi = s.top + scroller.clientHeight - 4;
    // How far to scroll down (up when negative).
    let d = Math.max(0, c.bottom - hi);
    if (c.top - d < lo) d = Math.max(c.top - lo, c.bottom - hi);
    if (a.top - d < lo && c.bottom - (a.top - lo) <= hi) d = a.top - lo;
    else if (a.bottom - d > hi && c.top - (a.bottom - hi) >= lo) d = a.bottom - hi;
    if (d) scroller.scrollTop += d;
    // Sideways, in the diagram's own box.
    const box = root.parentElement!;
    const b = box.getBoundingClientRect();
    if (c.right > b.right - 4) box.scrollLeft += Math.min(c.right - b.right + 4, c.left - b.left - 4);
    else if (c.left < b.left + 4) box.scrollLeft -= b.left + 4 - c.left;
    // Measured, not its inputs: it runs when the composer opens, is placed or grows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerAt, composerHeight, composerTop]);

  /** A drag from a lifeline: the lane it started at, and where the pointer went down (a press that hardly moves is a click). */
  const [drag, setDrag] = useState<{ from: string; x1: number; x: number; y: number; x0: number; y0: number } | null>(null);

  if (empty) {
    return (
      <div ref={rootRef} className="flex h-full min-h-32 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
        <p className="max-w-sm">
          <span className="block font-semibold text-ink">No steps yet</span>
          Add the first request, from where the user starts. Each step is drawn here, with a lane per component.
        </p>
        {composer ? (
          <div className="w-80 max-w-full text-left" style={composerMax ? ({ '--composer-max': `${composerMax}px` } as CSSProperties) : undefined}>
            {composer.node}
          </div>
        ) : (
          onInsert && (
            <button type="button" onClick={() => onInsert({ kind: 'end' }, 0)} className="inline-flex items-center gap-1.5 rounded-sm border-bw-1 border-ink bg-surface px-2.5 py-1 text-xs font-semibold text-ink shadow-brutal-sm hover:bg-pop-yellow/40">
              <Plus size={13} aria-hidden="true" />
              Add the first step
            </button>
          )
        )}
      </div>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as Element).getAttribute('role') !== 'option') return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (primary === undefined || !onMove) return;
      moved.current = true;
      onMove(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && onDelete) {
      e.preventDefault();
      moved.current = true;
      onDelete();
      return;
    }
    if (e.key === 'Enter' && primary !== undefined && onEdit) {
      e.preventDefault();
      onEdit();
      return;
    }
    if (e.key === 'Escape' && selected.length && onClear) {
      e.preventDefault();
      e.stopPropagation();
      onClear();
      return;
    }
    const at = shown.findIndex((s) => s.line === primary);
    const next =
      e.key === 'ArrowDown' ? Math.min(shown.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at === -1 ? 0 : at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1 : undefined;
    if (next === undefined) return;
    e.preventDefault();
    const range = e.shiftKey && primary !== undefined;
    if (shown[next] && (shown[next].line !== primary || (!range && selected.length > 1))) {
      moved.current = true;
      onSelect(shown[next], range ? 'range' : 'only');
    }
  };

  // A drag from one lifeline to another: the lane nearest the pointer, if it is close enough and not the one it started at.
  const pointerAt = (e: ReactPointerEvent) => {
    const r = contentRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const dropLane = (x: number, from: string) => {
    const near = layout.lanes.reduce((best, l) => (Math.abs(l.x - x) < Math.abs(best.x - x) ? l : best), layout.lanes[0]);
    return near && near.id !== from && Math.abs(near.x - x) <= 48 ? near : undefined;
  };
  const target = drag ? dropLane(drag.x, drag.from) : undefined;
  const ghostSlot = drag && target ? slotNear(layout.slots, drag.y) : undefined;

  const number = (line: number) => layout.messages.find((m) => m.step.line === line)?.n;

  return (
    <div ref={rootRef} className="group/seq relative min-w-full" style={{ width: layout.width }}>
      {/* The lane headers: each component's icon and name, like its node on the canvas, and while a step's ends are
          picked, buttons that pick it. Over the composer, which scrolls under them. */}
      <div
        role={onPickLane ? 'group' : undefined}
        aria-label={onPickLane ? 'Lanes' : undefined}
        aria-hidden={onPickLane ? undefined : true}
        className="sticky top-0 z-40 border-b border-ink/15 bg-surface"
        style={{ height: HEADER, width: layout.width, minWidth: '100%' }}
      >
        {layout.lanes.map((lane) => {
          const node = nodes.get(lane.id);
          const Tag = onPickLane ? 'button' : 'div';
          return (
            <Tag
              key={lane.id}
              data-lane={lane.id}
              {...(onPickLane ? { type: 'button' as const, 'aria-label': `Pick ${name(lane.id)}`, onClick: () => onPickLane(lane.id) } : {})}
              title={onPickLane ? `Pick ${name(lane.id)} for the step` : node ? `${node.name} (${node.techStack})` : lane.id}
              className={`absolute top-2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-sm border-bw-1 border-ink bg-surface py-1 pl-1 pr-2 text-ink shadow-brutal-sm ${
                onPickLane ? 'cursor-pointer outline-hidden hover:bg-pop-yellow focus-visible:bg-pop-yellow focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1' : ''
              }`}
              style={{ left: lane.x, maxWidth: lane.width }}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border-bw-1 border-ink bg-paper [&_svg]:h-3.5 [&_svg]:w-3.5">
                {node ? getTechStackIcon(node.techStack, node.type) : null}
              </span>
              <span className="truncate text-[13px] font-bold">{name(lane.id)}</span>
            </Tag>
          );
        })}
      </div>
      {/* As tall as the composer reaches too, so what scrolls the diagram (its own box, or the column on a narrow pane) takes it in. */}
      <div ref={contentRef} className="relative" style={{ height: Math.max(layout.height, composerTop === undefined ? 0 : composerTop + composerHeight + 8) }}>
        {/* Frames under everything: a par block, the chosen scenario's branch. Their titles (and a par block's actions) go over the lifelines, below. */}
        {layout.frames.map((f) => (
          <div
            key={`${f.kind}${f.line}`}
            data-frame={f.kind}
            className={`absolute rounded-sm border-bw-1 ${f.kind === 'parallel' ? 'border-ink/45 bg-ink/[0.025]' : 'border-dashed border-ink/50 bg-pop-yellow/10'}`}
            style={{ left: f.x, top: f.y, width: f.width, height: f.height }}
          />
        ))}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.lanes.map((lane) => (
            <line key={lane.id} x1={lane.x} x2={lane.x} y1={0} y2={layout.height} className={target?.id === lane.id || drag?.from === lane.id ? 'stroke-pop-pink' : 'stroke-ink/25'} strokeWidth={1.5} strokeDasharray="4 5" />
          ))}
          {layout.messages.map((m) => (
            <Arrow key={m.step.line} m={m} selected={selected.includes(m.step.line)} />
          ))}
          {drag && (
            <g className="stroke-pop-pink" strokeWidth={2} fill="none">
              {ghostSlot && <line x1={ghostSlot.x + 22} x2={layout.width - 8} y1={ghostSlot.y} y2={ghostSlot.y} strokeDasharray="5 4" strokeWidth={1.5} />}
              <line x1={drag.x1} y1={drag.y} x2={target?.x ?? drag.x} y2={drag.y} strokeDasharray={target ? undefined : '4 4'} />
              {target && <Head x={target.x} y={drag.y} dir={Math.sign(target.x - drag.x1)} kind="request" fill="fill-pop-pink" />}
            </g>
          )}
        </svg>
        {/* A lifeline's strip, to drag a new step from it to another (the messages leave them clear). */}
        {onInsert &&
          layout.lanes.map((lane) => (
            <div
              key={lane.id}
              data-lifeline={lane.id}
              aria-hidden="true"
              title={onPickLane ? `Click to pick ${name(lane.id)} for the step, or drag to another lifeline to add a step from it` : `Drag to another lifeline to add a step from ${name(lane.id)}`}
              className={`absolute top-0 w-3 -translate-x-1/2 touch-none ${onPickLane ? 'cursor-pointer hover:bg-pop-pink/25' : 'cursor-crosshair'}`}
              style={{ left: lane.x, height: layout.height }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                const at = pointerAt(e);
                setDrag({ from: lane.id, x1: lane.x, ...at, x0: at.x, y0: at.y });
              }}
              onPointerMove={(e) => drag && setDrag({ ...drag, ...pointerAt(e) })}
              onPointerUp={(e) => {
                if (!drag) return;
                const at = pointerAt(e);
                const to = dropLane(at.x, drag.from);
                const slot = to && slotNear(layout.slots, at.y);
                setDrag(null);
                if (to && slot) onInsert(slot.slot, slot.index, { from: drag.from, to: to.id });
                // A click (a press that hardly moved) picks the lane's component while a step's ends are picked.
                else if (onPickLane && Math.hypot(at.x - drag.x0, at.y - drag.y0) < 4) onPickLane(drag.from);
              }}
              onPointerCancel={() => setDrag(null)}
            />
          ))}
        {layout.frames.map((f) => (
          <div
            key={`${f.kind}${f.line}`}
            data-frame-title={f.kind}
            className={`absolute flex items-center rounded-br-sm border-b border-r ${f.kind === 'parallel' ? 'border-ink/45 bg-surface' : 'border-dashed border-ink/50 bg-pop-yellow/30'}`}
            style={{ left: f.x + 1, top: f.y + 1 }}
          >
            <span className={`px-1.5 py-0.5 ${eyebrow} !text-ink/75`}>{f.title}</span>
            {f.kind === 'parallel' && (onInsert || onUngroup) && (
              <span className="flex items-center self-stretch border-l border-ink/20">
                {onInsert && (
                  <button
                    type="button"
                    onClick={() => {
                      const box = layout.slots.find((b) => b.slot.kind === 'par' && b.slot.line === f.line);
                      if (box) onInsert(box.slot, box.index);
                    }}
                    title="Add a step that runs at the same time as these"
                    className="inline-flex h-full items-center gap-0.5 px-1.5 text-[11px] font-semibold text-ink/80 hover:bg-pop-yellow/40 hover:text-ink focus-visible:bg-pop-yellow/40"
                  >
                    <Plus size={11} aria-hidden="true" />
                    Add alongside
                  </button>
                )}
                {onUngroup && (
                  <button
                    type="button"
                    onClick={() => onUngroup(f.line)}
                    title="Run these one after another again"
                    className="inline-flex h-full items-center gap-0.5 border-l border-ink/20 px-1.5 text-[11px] font-semibold text-ink/80 hover:bg-pop-yellow/40 hover:text-ink focus-visible:bg-pop-yellow/40"
                  >
                    <Ungroup size={11} aria-hidden="true" />
                    Ungroup
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
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
        <div
          ref={listRef}
          role="listbox"
          aria-label={`Sequence of ${outline.name}`}
          aria-orientation="vertical"
          aria-multiselectable="true"
          onKeyDown={onKey}
          onFocus={() => (listFocused.current = true)}
          // Gone elsewhere (not with its message, which takes no focus with it).
          onBlur={(e) => e.relatedTarget && (listFocused.current = false)}
          className="pointer-events-none absolute inset-0"
        >
          {layout.messages.map((m) => (
            <Message key={m.step.line} m={m} name={name} selected={selected.includes(m.step.line)} focusable={m.step.line === focusable} onSelect={(mode) => onSelect(m.step, mode)} />
          ))}
        </div>
        {/* The insertion points: a "+" at the left of each row boundary, seen while the pointer is over the diagram or one is focused. */}
        {onInsert &&
          layout.slots.map((box) => (
            <InsertPoint
              key={slotKey(box.slot)}
              box={box}
              width={layout.width}
              open={!!composer && sameSlot(composer.slot, box.slot)}
              label={
                box.slot.kind === 'before'
                  ? `Add a step before step ${number(box.slot.line)}`
                  : box.slot.kind === 'after'
                    ? `Add a step after step ${number(box.slot.line)}`
                    : box.slot.kind === 'scenario'
                    ? `Add a step at the end of ${box.slot.name}`
                    : box.slot.kind === 'par'
                      ? 'Add a step at the end of the block, at the same time'
                      : 'Add a step at the end'
              }
              onOpen={() => onInsert(box.slot, box.index)}
            />
          ))}
        {composer && placement && composerTop !== undefined && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute border-t-2 border-dashed border-pop-pink" style={{ left: placement.x + 22, top: placement.bottom - 1, width: Math.max(0, layout.width - placement.x - 30) }} />
            <div
              ref={composerRef}
              data-placement={above ? 'above' : 'below'}
              className="absolute z-30 w-80 py-1"
              style={{ left: Math.max(2, placement.x), top: composerTop, ...(composerMax ? { '--composer-max': `${composerMax}px` } : {}) } as CSSProperties}
            >
              {composer.node}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const KIND_TAG: Partial<Record<OutlineStep['kind'], string>> = { async: 'message', failed: 'fails' };

/**
 * The height of the diagram in sight: the pane's body under its header (which the diagram's own box fills on a wide
 * pane, and which scrolls the diagram and the column on a narrow one), less the box's sideways scrollbar.
 */
function visibleHeight(root: HTMLElement): number {
  const box = root.parentElement!;
  const region = box.closest('[role="region"]');
  let body: HTMLElement = box;
  while (region && body.parentElement && body.parentElement !== region) body = body.parentElement;
  return body.clientHeight - (box.offsetHeight - box.clientHeight);
}

/** What scrolls the diagram up and down: its own box on a wide pane, the pane's column on a narrow one. */
function verticalScroller(root: HTMLElement): HTMLElement {
  for (let p = root.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    if (p.getAttribute('role') === 'region') break;
  }
  return root.parentElement!;
}

const slotKey = (slot: Slot) => `${slot.kind}:${'line' in slot ? slot.line : 'name' in slot ? slot.name : ''}`;

/** A "+" at a row boundary, with a guide across the diagram while it is hovered or focused. */
function InsertPoint({ box, width, open, label, onOpen }: { box: SlotBox; width: number; open: boolean; label: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={onOpen}
        className={`peer absolute z-10 grid h-5 w-5 scroll-mt-16 place-items-center rounded-full border-bw-1 border-ink transition-opacity hover:!opacity-100 focus-visible:!opacity-100 ${open ? 'bg-pop-pink text-on-accent' : 'bg-surface text-ink opacity-0 hover:bg-pop-yellow focus-visible:bg-pop-yellow group-hover/seq:opacity-60'}`}
        style={{ left: box.x, top: box.y - 10 }}
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="pointer-events-none absolute border-t-2 border-dashed border-ink/40 opacity-0 peer-hover:opacity-100 peer-focus-visible:opacity-100" style={{ left: box.x + 22, top: box.y - 1, width: Math.max(0, width - box.x - 30) }} />
    </>
  );
}

/** A message's row: its number and label over the arrow, the target of clicks and keys. */
function Message({ m, name, selected, focusable, onSelect }: { m: MessageBox; name: (id: string) => string; selected: boolean; focusable: boolean; onSelect: (mode: SelectMode) => void }) {
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
      // Shift-click picks a range, so it selects no text.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onClick={(e) => {
        // The one clicked has the focus, a Shift-click's too.
        e.currentTarget.focus({ preventScroll: true });
        onSelect(e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'only');
      }}
      className={`group/msg pointer-events-auto absolute flex scroll-mt-16 cursor-pointer select-none justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ink ${self ? '!justify-start pl-[52px]' : ''}`}
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
