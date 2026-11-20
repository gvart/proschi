import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CornerDownLeft, Plus, Ungroup } from 'lucide-react';
import type { OutlineStep, StepKind, UseCaseOutline } from '../../dsl/edit';
import type { Diagram } from '../../dsl/types';
import { shorten } from '../../dsl/sequence';
import { getTechStackIcon } from '../../utils/iconMapping';
import { eyebrow } from '../Playground/ui';
import { entrySteps, laneOrder, layoutSequence, sameSlot, SEQ, sequenceEntries, type MessageBox, type Slot, type SlotBox } from './sequenceLayout';
import { slotNear } from './sequenceEdit';
import { MOD_KEY } from '../Playground/modKey';

/**
 * A use case as a sequence diagram (the Flows view, FlowsView.tsx): one lane
 * per component, one numbered message per step, top to bottom as written.
 * Responses (`-->`) are dashed arrows back, messages (`->>`) have an open
 * head, failed calls (`-x`) end in a red cross, and a `par` block is a frame.
 * The main flow folds its scenarios; a scenario's tab shows its branch in
 * place. The messages are a list box: a click or Up and Down select a step,
 * which the architecture map lights up; Shift or Cmd/Ctrl select several. It
 * is edited in place (FlowsPanel.tsx does the edits): the selected step has
 * a toolbar under it, in room the rows below make for it (and for its
 * details card), so nothing of the diagram is ever covered; its label is
 * edited on its arrow (Enter or a double click), and its ends are dragged by
 * their handles to other lanes (or moved with Alt+Left and Right). Steps are
 * added by one draft arrow, drawn in place: an "Add step" row at the end of
 * the flow and of each frame, a "+" between the rows or a drag from one
 * lifeline to another starts it; its ends are picked by a click on a lane
 * (or the arrow keys and Enter), and its label is typed on it.
 */

/** How a click or a key changes the selection: to the one step, the steps from the anchor to it, or with it added or taken out. */
export type SelectMode = 'only' | 'range' | 'toggle';

/** A step being drafted at an insertion point (FlowsPanel.tsx keeps it): the arrow drawn in place. */
export interface DraftView {
  slot: Slot;
  from?: string;
  to?: string;
  kind: StepKind;
  /** The hint under its row. */
  status: string;
  /** The label's field on the arrow, once both ends are known. */
  field?: ReactNode;
  /** Under the hint, once both ends are known: its kind. */
  toolbar?: ReactNode;
  /** An answer to the request waiting for one, offered while the draft has no target: Enter takes it. */
  reply?: { text: string; onTake: () => void };
  /** A lane chosen for it (a click on its row, or the arrow keys and Enter): its start while it has none, else where it goes. */
  onLane: (id: string) => void;
  onCancel: () => void;
}

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
  /** Starts a draft at an insertion point (`index`: how many messages are drawn before it), with both ends when a drag drew them. */
  onInsert?: (slot: Slot, index: number, ends?: { from: string; to: string }) => void;
  /** The keys on a selected step: Alt+Up and Down move it, Delete removes the selection, Enter edits its label, Escape lets go. */
  onMove?: (direction: 'up' | 'down') => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onClear?: () => void;
  /** A `par` frame's Ungroup, by the line that opens it. */
  onUngroup?: (line: number) => void;
  /** Under the selected step (the one in focus): its toolbar, and under that its details card. */
  toolbar?: ReactNode;
  card?: ReactNode;
  /** The selected step's label being edited: the field, drawn on its arrow in place of the label. */
  editing?: { line: number; node: ReactNode };
  /** A step's end dragged to another lane (FlowsPanel moves them with Alt+Left and Right too). */
  onRetarget?: (step: OutlineStep, end: 'from' | 'to', id: string) => void;
  /** The keys on a selected step that FlowsPanel acts on (its kind, its ends, reply, details, a new step); true when it did. */
  onStepKey?: (e: KeyboardEvent) => boolean;
  /** Changed to put the focus back on the selected message (after an edit took it away). */
  focusKey?: number;
  /** While a step's ends are being picked: a click on a lane's header or lifeline picks its component, as a click on the map does. */
  onPickLane?: (id: string) => void;
  /** The width the lanes fit in (the Flows view's); narrower lanes are centred in it. */
  fitWidth?: number;
  /** Lanes no step uses yet (added with + Lane, a draft's ends), drawn dashed after the others. */
  extraLanes?: string[];
  /** More lanes to show while the use case has no steps (the design's components, in the order they connect), as many as fit. */
  candidates?: string[];
  /** The "+ Lane" control, at the end of the lane headers. */
  laneAdder?: ReactNode;
  /** The step being drafted. */
  draft?: DraftView;
}

/** The arrow sits under its label, this far below the row's centre. */
const LINE_DY = 8;
/** The lane headers' strip, which stays at the top as the diagram scrolls. */
const HEADER = 52;
/** The room "+ Lane" takes after the last lane. */
const ADDER_W = 96;
/** A draft's row: the arrow and its label, the hint, and under it the kind or a reply. */
const DRAFT_H = SEQ.row + 64;
/** What is under a selected step keeps this far from the row boundaries (and their "+"s) above and below it. */
const UNDER_GAP = 12;

export default function SequenceDiagram({
  outline,
  scenario,
  diagram,
  selected,
  onSelect,
  onScenario,
  onInsert,
  onMove,
  onDelete,
  onEdit,
  onClear,
  onUngroup,
  focusKey,
  onPickLane,
  fitWidth,
  toolbar,
  card,
  editing,
  onRetarget,
  onStepKey,
  extraLanes = [],
  candidates = [],
  laneAdder,
  draft,
}: SequenceDiagramProps) {
  const nodes = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);
  const name = (id: string) => nodes.get(id)?.name ?? id;
  const own = useMemo(() => laneOrder(outline), [outline]);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The width the diagram has (the Flows view's, else its box's), which the labels give room back to fit. */
  const [measured, setMeasured] = useState<number>();
  const fit = fitWidth ?? measured;
  const roomy = laneAdder ? ADDER_W : 0;
  const extraKey = extraLanes.join(' ');
  const candidateKey = candidates.join(' ');
  /** The steps' lanes, then the extra ones; with no steps yet, as many of the candidates as fit. */
  const lanes = useMemo(() => {
    const more = extraLanes.filter((id, i) => nodes.has(id) && !own.includes(id) && extraLanes.indexOf(id) === i);
    if (own.length) return [...own, ...more];
    const room = Math.max(2, Math.floor(((fit ?? 1000) - roomy - 2 * SEQ.margin - 120) / SEQ.minGap) + 1);
    const fill = candidates.filter((id) => nodes.has(id) && !more.includes(id));
    return [...more, ...fill.slice(0, Math.max(0, room - more.length))];
    // By what they hold: the arrays are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, extraKey, candidateKey, nodes, fit, roomy]);
  const entries = useMemo(() => sequenceEntries(outline.items, scenario), [outline, scenario]);
  const primary = selected.at(-1);

  // What goes under the selected step (its toolbar, its card) and under a label being edited (its warnings): the rows
  // below move down to make room for it, so it covers nothing.
  const underRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState(0);
  const [editorExtra, setEditorExtra] = useState(0);
  const hasUnder = (toolbar !== undefined && toolbar !== null && toolbar !== false) || !!card;
  // Clear of the "+"s on the row boundaries above and below it.
  const room = primary !== undefined && (hasUnder || editing?.line === primary) ? { line: primary, below: (hasUnder ? under + UNDER_GAP * 2 : 0) + editorExtra } : undefined;
  const draftSlot = draft?.slot;
  /** The draft's row is as tall as what it shows (its field may grow with warnings). */
  const [draftHeight, setDraftHeight] = useState(DRAFT_H);
  const layout = useMemo(
    () =>
      layoutSequence(entries, lanes, (id) => nodes.get(id)?.name ?? id, undefined, fit === undefined ? undefined : fit - roomy, {
        room,
        draft: draftSlot && { slot: draftSlot, height: draftHeight },
        // While a step is drafted, it is the one place a step is added: no "Add step" row besides it.
        adds: !!onInsert && !draftSlot,
      }),
    // `room` by what it holds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, lanes, nodes, fit, roomy, room?.line, room?.below, draftSlot, draftHeight, onInsert],
  );
  const hasDraft = !!draft;
  useLayoutEffect(() => {
    const el = draftBodyRef.current;
    if (!el) return;
    const measure = () => setDraftHeight(Math.max(DRAFT_H, el.offsetHeight + 12));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasDraft]);
  useLayoutEffect(() => {
    const el = underRef.current;
    if (!el) {
      setUnder(0);
      return;
    }
    const measure = () => setUnder(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasUnder, primary]);
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) {
      setEditorExtra(0);
      return;
    }
    const measure = () => setEditorExtra(Math.max(0, el.offsetHeight + 1 - SEQ.row));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editing?.line]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = root?.parentElement;
    if (!root || !box) return;
    const measure = () => setMeasured(box.clientWidth || undefined);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const width = layout.width + roomy;
  /** Lanes narrower than the width they have are centred in it. */
  const offset = fit && width < fit ? Math.floor((fit - width) / 2) : 0;
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const draftBodyRef = useRef<HTMLDivElement>(null);
  /** The selection was moved with the keyboard, so the focus follows it. */
  const moved = useRef(false);
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
  // What is under the selected step in sight when it opens or grows (a details card).
  useEffect(() => {
    if (!card) return;
    underRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [card, under]);
  // After an edit that took the focus away (its button or the draft is gone), back on the message.
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

  /** A drag from a lifeline: the lane it started at, and where the pointer went down (a press that hardly moves is a click). */
  const [drag, setDrag] = useState<{ from: string; x1: number; x: number; y: number; x0: number; y0: number } | null>(null);
  /** A selected step's end being dragged to another lane: the step, which end, and where the pointer is. */
  const [dragged, setEndDrag] = useState<{ line: number; end: 'from' | 'to'; x: number } | null>(null);
  // Escape lets the drag go.
  useEffect(() => {
    if (!dragged) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setEndDrag(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragged]);

  // The draft without a target: the lane the pointer or the arrow keys aim at, and where the pointer is.
  const [aim, setAim] = useState<string>();
  const [pointerX, setPointerX] = useState<number>();
  const choosing = !!draft && !draft.to;
  const draftKey = draft ? `${slotKey(draft.slot)}|${draft.from ?? ''}|${draft.to ?? ''}` : '';
  // A new draft, or one that changed ends, starts with nothing aimed at; one choosing a lane has the focus, and is in sight.
  useEffect(() => {
    setAim(undefined);
    setPointerX(undefined);
    if (!draftKey) return;
    draftRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (choosing) draftRef.current?.querySelector<HTMLElement>('[data-draft-band]')?.focus({ preventScroll: true });
    // On the draft's slot and ends only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // The toolbar under the selected step, kept in sight across the width the diagram is shown in.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    setToolbarWidth(el.offsetWidth);
    const observer = new ResizeObserver(() => setToolbarWidth(el.offsetWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasUnder, primary]);

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as Element).getAttribute('role') !== 'option') return;
    if (primary !== undefined && onStepKey?.(e)) {
      e.preventDefault();
      moved.current = true;
      return;
    }
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

  const pointerAt = (e: { clientX: number; clientY: number }) => {
    const r = contentRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nearest = (x: number, except?: string) =>
    layout.lanes.filter((l) => l.id !== except).reduce<(typeof layout.lanes)[number] | undefined>((best, l) => (!best || Math.abs(l.x - x) < Math.abs(best.x - x) ? l : best), undefined);
  // A drag from one lifeline to another: the lane nearest the pointer, if it is close enough and not the one it started at.
  const dropLane = (x: number, from: string) => {
    const near = nearest(x);
    return near && near.id !== from && Math.abs(near.x - x) <= 48 ? near : undefined;
  };
  const target = drag ? dropLane(drag.x, drag.from) : undefined;
  const ghostSlot = drag && target ? slotNear(layout.slots, drag.y) : undefined;
  const laneX = (id?: string) => (id === undefined ? undefined : layout.lanes.find((l) => l.id === id)?.x);

  const number = (line: number) => layout.messages.find((m) => m.step.line === line)?.n;

  // The step in focus: its toolbar, its label's field and (when it alone is selected) its end handles go with it.
  const focused = layout.messages.find((m) => m.step.line === primary);
  // Only for the step it started on, while it is still the one selected.
  const endDrag = dragged && focused && dragged.line === focused.step.line && selected.length === 1 ? dragged : null;
  const span = Math.max(width, (fit ?? width) - offset);
  const toolbarLeft = (() => {
    if (!focused) return 0;
    const centre = focused.x1 === focused.x2 ? focused.x1 + SEQ.loop + 40 : (focused.x1 + focused.x2) / 2;
    // In the width the diagram is shown in: from the left of the view (the lanes may be centred in it) to its right.
    return Math.max(4 - offset, Math.min(span - toolbarWidth - 4, centre - toolbarWidth / 2));
  })();
  const editBox = editing && layout.messages.find((m) => m.step.line === editing.line);
  /** The lane an end is dragged to: the nearest, near enough; the step's other end (a step to itself) is refused. */
  const endTarget = (() => {
    if (!endDrag || !focused) return undefined;
    const near = nearest(endDrag.x);
    if (!near || Math.abs(near.x - endDrag.x) > 48) return undefined;
    const other = endDrag.end === 'from' ? focused.step.to : focused.step.from;
    return { lane: near, refused: near.id === other };
  })();

  // The draft: its row, its ends, and the lane it aims at (the pointer's, near enough, or the keys').
  const box = layout.draft;
  const fromX = laneX(draft?.from);
  const pointerLane = draft && choosing && pointerX !== undefined ? nearest(pointerX, draft.from) : undefined;
  const aimed = aim ?? (pointerLane && Math.abs(pointerLane.x - pointerX!) <= 48 ? pointerLane.id : undefined);
  // With nothing aimed at, a short arrow leaves its start, inwards.
  const stub = fromX === undefined ? undefined : fromX + (fromX > layout.width - 120 ? -72 : 72);
  const toX = draft?.to ? laneX(draft.to) : aimed ? laneX(aimed) : (pointerX ?? stub);
  const draftY = box ? box.top + SEQ.row / 2 : 0;
  const lanePick = (id: string) => (draft ? draft.onLane(id) : onPickLane?.(id));
  const onDraftKey = (e: KeyboardEvent) => {
    if (!draft) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      draft.onCancel();
      return;
    }
    const choices = layout.lanes.filter((l) => l.id !== draft.from);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!choices.length) return;
      const at = choices.findIndex((l) => l.id === aimed);
      const d = e.key === 'ArrowRight' ? 1 : -1;
      // From the start, the first press goes to the lane beside it on that side.
      const from = fromX ?? -Infinity;
      const next = at >= 0 ? choices[(at + d + choices.length) % choices.length] : d > 0 ? (choices.find((l) => l.x > from) ?? choices[0]) : ([...choices].reverse().find((l) => l.x < from) ?? choices.at(-1)!);
      setAim(next.id);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (aimed) draft.onLane(aimed);
      else draft.reply?.onTake();
    }
  };
  const lit = (id: string) =>
    target?.id === id || drag?.from === id || (endTarget && !endTarget.refused && endTarget.lane.id === id) || (!!draft && (draft.from === id || draft.to === id || aimed === id));
  const dashed = (id: string) => !own.includes(id);
  const move = 'transition-[top,height] duration-[120ms] ease-out motion-reduce:transition-none';

  return (
    <div ref={rootRef} className="group/seq relative min-w-full" style={{ width }}>
      {/* The lane headers: each component's icon and name, like its node on the canvas, and while a step's ends are
          picked, buttons that pick it; a lane no step uses yet is dashed. Then "+ Lane". Over what scrolls under them. */}
      <div
        role={onPickLane || draft ? 'group' : undefined}
        aria-label="Lanes"
        className="sticky top-0 z-40 border-b border-ink/15 bg-surface"
        style={{ height: HEADER, width, minWidth: '100%' }}
      >
        {layout.lanes.map((lane) => {
          const node = nodes.get(lane.id);
          const picks = !!onPickLane || !!draft;
          const Tag = picks ? 'button' : 'div';
          return (
            <Tag
              key={lane.id}
              data-lane={lane.id}
              data-dashed={dashed(lane.id) || undefined}
              {...(picks ? { type: 'button' as const, 'aria-label': `Pick ${name(lane.id)}`, onClick: () => lanePick(lane.id) } : { 'aria-hidden': true })}
              title={picks ? `Pick ${name(lane.id)} for the step` : node ? `${node.name} (${node.techStack})` : lane.id}
              className={`absolute top-2 flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-sm border-bw-1 py-1 pl-1 pr-2 text-ink ${move} ${
                dashed(lane.id) ? 'border-dashed border-ink/50 bg-surface/80' : 'border-ink bg-surface shadow-brutal-sm'
              } ${lit(lane.id) ? '!border-pop-pink' : ''} ${
                picks ? 'cursor-pointer outline-hidden hover:bg-pop-yellow focus-visible:bg-pop-yellow focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1' : ''
              }`}
              style={{ left: lane.x + offset, maxWidth: lane.width }}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-sm border-bw-1 bg-paper [&_svg]:h-3.5 [&_svg]:w-3.5 ${dashed(lane.id) ? 'border-ink/40' : 'border-ink'}`}>
                {node ? getTechStackIcon(node.techStack, node.type) : null}
              </span>
              <span className={`truncate text-[13px] font-bold ${dashed(lane.id) ? 'text-ink/70' : ''}`}>{name(lane.id)}</span>
            </Tag>
          );
        })}
        {laneAdder && (
          <div className="absolute top-2.5" style={{ left: (layout.lanes.at(-1) ? layout.lanes.at(-1)!.x + layout.lanes.at(-1)!.width / 2 + 16 : SEQ.margin) + offset }}>
            {laneAdder}
          </div>
        )}
      </div>
      <div
        ref={contentRef}
        className="relative"
        style={{ marginLeft: offset, width: layout.width, height: layout.height }}
        onPointerMove={(e) => choosing && setPointerX(pointerAt(e).x)}
        onPointerLeave={() => choosing && setPointerX(undefined)}
      >
        {/* Frames under everything: a par block, the chosen scenario's branch. Their titles (and a par block's Ungroup) go over the lifelines, below. */}
        {layout.frames.map((f) => (
          <div
            key={`${f.kind}${f.line}`}
            data-frame={f.kind}
            className={`absolute rounded-sm border-bw-1 ${move} ${f.kind === 'parallel' ? 'border-ink/45 bg-ink/[0.025]' : 'border-dashed border-ink/50 bg-pop-yellow/10'}`}
            style={{ left: f.x, top: f.y, width: f.width, height: f.height }}
          />
        ))}
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.lanes.map((lane) => (
            <line key={lane.id} x1={lane.x} x2={lane.x} y1={0} y2={layout.height} className={lit(lane.id) ? 'stroke-pop-pink' : dashed(lane.id) ? 'stroke-ink/15' : 'stroke-ink/25'} strokeWidth={1.5} strokeDasharray="4 5" />
          ))}
          {layout.messages.map((m) => (
            <g key={m.step.line} style={{ transform: `translateY(${m.y}px)` }} className="transition-transform duration-[120ms] ease-out motion-reduce:transition-none">
              <Arrow m={{ ...m, y: 0 }} selected={selected.includes(m.step.line)} />
            </g>
          ))}
          {endDrag && focused && (
            // The arrow as it would be: from the end that stays to the lane it would go to, or the pointer.
            <line
              data-end-ghost={endTarget?.refused ? 'refused' : endTarget ? 'lane' : 'free'}
              className={endTarget?.refused ? 'stroke-fail' : 'stroke-pop-pink'}
              strokeWidth={2}
              strokeDasharray="5 4"
              x1={endDrag.end === 'from' ? focused.x2 : focused.x1}
              x2={endTarget && !endTarget.refused ? endTarget.lane.x : endDrag.x}
              y1={focused.y + LINE_DY}
              y2={focused.y + LINE_DY}
            />
          )}
          {drag && (
            <g className="stroke-pop-pink" strokeWidth={2} fill="none">
              {ghostSlot && <line x1={ghostSlot.x + 22} x2={layout.width - 8} y1={ghostSlot.y} y2={ghostSlot.y} strokeDasharray="5 4" strokeWidth={1.5} />}
              <line x1={drag.x1} y1={drag.y} x2={target?.x ?? drag.x} y2={drag.y} strokeDasharray={target ? undefined : '4 4'} />
              {target && <Head x={target.x} y={drag.y} dir={Math.sign(target.x - drag.x1)} kind="request" fill="fill-pop-pink" />}
            </g>
          )}
          {box && draft && fromX !== undefined && toX !== undefined && toX !== fromX && (
            // The draft's arrow: dashed, from its start to its target, or to the pointer while it has none.
            <g data-draft-arrow={draft.to ? 'set' : aimed ? 'lane' : 'free'} className="stroke-pop-pink" fill="none" strokeWidth={2}>
              <circle cx={fromX} cy={draftY + LINE_DY} r={4} className="fill-pop-pink" stroke="none" />
              <line x1={fromX} y1={draftY + LINE_DY} x2={toX - Math.sign(toX - fromX) * 6} y2={draftY + LINE_DY} strokeDasharray={draft.to ? undefined : '5 4'} />
              {(draft.to || aimed) && <Head x={toX} y={draftY + LINE_DY} dir={Math.sign(toX - fromX)} kind={draft.kind} fill="fill-pop-pink" />}
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
              title={onPickLane || draft ? `Click to pick ${name(lane.id)} for the step, or drag to another lifeline to add a step from it` : `Drag to another lifeline to add a step from ${name(lane.id)}`}
              className={`absolute top-0 w-3 -translate-x-1/2 touch-none ${onPickLane || draft ? 'cursor-pointer hover:bg-pop-pink/25' : 'cursor-crosshair'}`}
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
                else if ((onPickLane || draft) && Math.hypot(at.x - drag.x0, at.y - drag.y0) < 4) lanePick(drag.from);
              }}
              onPointerCancel={() => setDrag(null)}
            />
          ))}
        {layout.frames.map((f) => (
          <div
            key={`${f.kind}${f.line}`}
            data-frame-title={f.kind}
            className={`absolute flex items-center rounded-br-sm border-b border-r ${move} ${f.kind === 'parallel' ? 'border-ink/45 bg-surface' : 'border-dashed border-ink/50 bg-pop-yellow/30'}`}
            style={{ left: f.x + 1, top: f.y + 1 }}
          >
            <span className={`px-1.5 py-0.5 ${eyebrow} !text-ink/75`}>{f.title}</span>
            {f.kind === 'parallel' && onUngroup && (
              <span className="flex items-center self-stretch border-l border-ink/20">
                <button
                  type="button"
                  onClick={() => onUngroup(f.line)}
                  title={`Run these one after another again (${MOD_KEY}+Shift+G)`}
                  className="inline-flex h-full items-center gap-0.5 px-1.5 text-[11px] font-semibold text-ink/80 hover:bg-pop-yellow/40 hover:text-ink focus-visible:bg-pop-yellow/40"
                >
                  <Ungroup size={11} aria-hidden="true" />
                  Ungroup
                </button>
              </span>
            )}
          </div>
        ))}
        {layout.notes.map((note) => (
          <div
            key={`${note.kind}${note.line}`}
            className={`absolute flex items-center gap-2 rounded-sm px-2.5 text-xs ${move} ${note.kind === 'scenarios' ? 'border-bw-1 border-dashed border-ink/35 bg-surface' : 'text-muted'}`}
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
          data-sequence
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
            <Message
              key={m.step.line}
              m={m}
              name={name}
              selected={selected.includes(m.step.line)}
              focusable={m.step.line === focusable}
              editing={editing?.line === m.step.line}
              onSelect={(mode) => onSelect(m.step, mode)}
              onEdit={onEdit}
              className={move}
            />
          ))}
        </div>
        {/* Right after the list, so Tab goes from the selected step to its toolbar. In the room the rows below made. */}
        {focused && hasUnder && (
          <div
            ref={underRef}
            data-under
            className="pointer-events-none absolute z-30 flex flex-col items-start gap-1.5"
            style={{ left: 0, top: focused.y + SEQ.row / 2 + editorExtra + UNDER_GAP, width: span }}
          >
            {toolbar && (
              <div ref={toolbarRef} data-step-toolbar className="pointer-events-auto" style={{ marginLeft: toolbarLeft }}>
                {toolbar}
              </div>
            )}
            {card && (
              <div data-card className="pointer-events-auto" style={{ marginLeft: Math.max(4 - offset, Math.min(span - 330, Math.min(focused.x1, focused.x2) - 8)) }}>
                {card}
              </div>
            )}
          </div>
        )}
        {editBox && editing && (
          <div
            ref={editorRef}
            data-label-editor
            className="absolute z-30"
            style={{
              left: Math.min(editBox.x1, editBox.x2) + 6,
              top: editBox.y - SEQ.row / 2 + 1,
              width: Math.max(260, editBox.x1 === editBox.x2 ? SEQ.loop + editBox.labelWidth + SEQ.labelChrome + 24 : Math.abs(editBox.x2 - editBox.x1) - 12),
            }}
          >
            {editing.node}
          </div>
        )}
        {/* The selected step's end handles: drag one to another lane to change where the step starts or goes. Over the lifelines' strips. */}
        {onRetarget &&
          focused &&
          selected.length === 1 &&
          focused.x1 !== focused.x2 &&
          (['from', 'to'] as const).map((end) => (
            <div
              key={end}
              data-end-handle={end}
              aria-hidden="true"
              title={end === 'from' ? `Drag to change where it starts (${ALT_KEY}+Shift+← →)` : `Drag to change where it goes (${ALT_KEY}+← →)`}
              className="group/end absolute z-20 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center"
              style={{ left: endDrag?.end === end ? endDrag.x : end === 'from' ? focused.x1 : focused.x2, top: focused.y + LINE_DY }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setEndDrag({ line: focused.step.line, end, x: pointerAt(e).x });
              }}
              onPointerMove={(e) => endDrag && setEndDrag({ ...endDrag, x: pointerAt(e).x })}
              onPointerUp={() => {
                if (!endDrag) return;
                const t = endTarget;
                setEndDrag(null);
                if (t && t.lane.id !== (end === 'from' ? focused.step.from : focused.step.to)) onRetarget(focused.step, end, t.lane.id);
              }}
              onPointerCancel={() => setEndDrag(null)}
            >
              <span className="h-2.5 w-2.5 rounded-full border-2 border-pop-pink bg-surface transition-transform group-hover/end:scale-150" />
            </div>
          ))}
        {/* The insertion points between the rows: a "+" at the left of each boundary, seen while the pointer is over the
            diagram or one is focused. The ends of the flow and of its frames have their "Add step" rows instead. */}
        {onInsert &&
          layout.slots
            .filter((b) => b.slot.kind === 'before' || b.slot.kind === 'after')
            .map((b) => (
              <InsertPoint
                key={slotKey(b.slot)}
                box={b}
                width={layout.width}
                open={!!draft && sameSlot(draft.slot, b.slot)}
                label={`Add a step ${b.slot.kind === 'before' ? 'before' : 'after'} step ${number((b.slot as { line: number }).line)}`}
                onOpen={() => onInsert(b.slot, b.index)}
              />
            ))}
        {onInsert &&
          layout.adds.map((a) => {
            const index = layout.slots.find((s) => sameSlot(s.slot, a.slot))?.index ?? 0;
            const par = a.slot.kind === 'par';
            const label = par ? 'Add alongside' : a.slot.kind === 'scenario' ? `Add a step to ${a.slot.name}` : 'Add step';
            return (
              <button
                key={slotKey(a.slot)}
                type="button"
                data-add-row={a.slot.kind}
                aria-label={label}
                title={par ? 'Add a step that runs at the same time as these' : 'Add a step here, then click where it goes (N)'}
                onClick={() => onInsert(a.slot, index)}
                className={`absolute flex scroll-mt-16 items-center gap-1.5 rounded-sm border-bw-1 border-dashed border-ink/35 px-2 text-xs font-semibold text-ink/70 hover:border-ink hover:bg-pop-yellow/30 hover:text-ink focus-visible:border-ink focus-visible:bg-pop-yellow/30 focus-visible:outline-hidden ${move}`}
                style={{ left: a.x, top: a.y, width: a.width, height: SEQ.add - 6 }}
              >
                <span className="grid h-4 w-4 place-items-center rounded-full border-bw-1 border-current">
                  <Plus size={10} aria-hidden="true" />
                </span>
                {par ? 'Add alongside' : 'Add step'}
              </button>
            );
          })}
        {box && draft && (
          // The draft's row: a band to click a lane on (the arrow keys and Enter pick one too), its label's field on the
          // arrow once both ends are known, the hint under it, and under that its kind or a reply.
          <div ref={draftRef} data-draft className="absolute z-30" style={{ left: 0, top: box.top, width: layout.width, height: box.height }}>
            <div
              data-draft-band
              role="group"
              tabIndex={choosing ? 0 : -1}
              aria-label={`New step: ${draft.status}`}
              aria-keyshortcuts="ArrowLeft ArrowRight Enter Escape"
              onKeyDown={onDraftKey}
              onClick={(e) => {
                if (!choosing) return;
                const lane = nearest(pointerAt(e).x, draft.from);
                if (lane) draft.onLane(lane.id);
              }}
              className={`absolute inset-x-0 top-0 rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-pop-pink ${choosing ? 'cursor-crosshair bg-pop-pink/[0.06]' : ''}`}
              style={{ height: SEQ.row }}
            />
            {/* What it shows, in one column measured for the room its row takes: the field (and its warnings), the hint, the kind or a reply. */}
            <div ref={draftBodyRef} className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-1">
              {draft.field && fromX !== undefined && toX !== undefined ? (
                <div data-draft-field className="pointer-events-auto pt-px" style={{ marginLeft: Math.min(fromX, toX) + 6, width: Math.max(260, Math.abs(toX - fromX) - 12), minHeight: SEQ.row - 4 }}>
                  {draft.field}
                </div>
              ) : (
                <div aria-hidden="true" style={{ height: SEQ.row - 4 }} />
              )}
            <div className="pointer-events-auto flex flex-col items-start gap-1" style={{ marginLeft: Math.max(4, Math.min((fromX ?? layout.lanes[0]?.x ?? SEQ.margin) + 8, layout.width - 300)) }}>
              <p data-draft-status className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-ink">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pop-pink" />
                {draft.status}
              </p>
              {draft.reply && !draft.to && (
                <button
                  type="button"
                  onClick={draft.reply.onTake}
                  title="Add the answer (Enter)"
                  className="inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink bg-surface px-1.5 py-0.5 text-xs font-semibold shadow-brutal-sm hover:bg-pop-yellow/40"
                >
                  <CornerDownLeft size={12} aria-hidden="true" />
                  {draft.reply.text}
                </button>
              )}
              {draft.to && draft.toolbar}
            </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_TAG: Partial<Record<OutlineStep['kind'], string>> = { async: 'message', failed: 'fails' };
const ALT_KEY = MOD_KEY === '⌘' ? '⌥' : 'Alt';

const slotKey = (slot: Slot) => `${slot.kind}:${'line' in slot ? slot.line : 'name' in slot ? slot.name : ''}`;

/** A "+" at a row boundary, with a guide across the diagram while it is hovered or focused. */
function InsertPoint({ box, width, open, label, onOpen }: { box: SlotBox; width: number; open: boolean; label: string; onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={`${label} (Shift+N before the selected step)`}
        onClick={onOpen}
        className={`peer absolute z-10 grid h-5 w-5 scroll-mt-16 place-items-center rounded-full border-bw-1 border-ink transition-[opacity,top] duration-[120ms] hover:!opacity-100 focus-visible:!opacity-100 motion-reduce:transition-none ${open ? 'bg-pop-pink text-on-accent' : 'bg-surface text-ink opacity-0 hover:bg-pop-yellow focus-visible:bg-pop-yellow group-hover/seq:opacity-60'}`}
        style={{ left: box.x, top: box.y - 10 }}
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      <span aria-hidden="true" className="pointer-events-none absolute border-t-2 border-dashed border-ink/40 opacity-0 peer-hover:opacity-100 peer-focus-visible:opacity-100" style={{ left: box.x + 22, top: box.y - 1, width: Math.max(0, width - box.x - 30) }} />
    </>
  );
}

/** A message's row: its number and label over the arrow, the target of clicks and keys. */
function Message({
  m,
  name,
  selected,
  focusable,
  editing,
  onSelect,
  onEdit,
  className = '',
}: {
  m: MessageBox;
  name: (id: string) => string;
  selected: boolean;
  focusable: boolean;
  /** Its label is being edited: the field is drawn over it. */
  editing: boolean;
  onSelect: (mode: SelectMode) => void;
  /** A double click edits the label. */
  onEdit?: () => void;
  className?: string;
}) {
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
      onDoubleClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
        onEdit?.();
      }}
      className={`group/msg pointer-events-auto absolute flex scroll-mt-16 cursor-pointer select-none justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ink ${className} ${self ? '!justify-start pl-[52px]' : ''}`}
      style={{ left, width, top: m.y - SEQ.row / 2 + 1, height: SEQ.row - 2 }}
    >
      <span
        className={`mt-0.5 inline-flex h-[21px] max-w-full items-center gap-1.5 self-start rounded-sm border-bw-1 bg-surface pl-0.5 pr-1.5 ${editing ? 'invisible' : ''} ${
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
