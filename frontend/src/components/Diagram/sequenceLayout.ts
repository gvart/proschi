import type { OutlineBranchItem, OutlineItem, OutlineStep, UseCaseOutline } from '../../dsl/edit';
import { outlineSteps } from './flows';

/**
 * The Flows pane's sequence diagram (FlowsPane.tsx, SequenceDiagram.tsx), as
 * plain functions: what one tab shows of a use case's outline, the order of
 * its lanes, and where each lane, message and frame goes. It reads the
 * line-addressed outline (dsl/edit.ts outlineOf), so every message is the
 * step on one line of the text, which the edits address.
 */

/** What a tab shows, in text order. */
export type SequenceEntry =
  | { kind: 'step'; step: OutlineStep }
  | { kind: 'parallel'; line: number; steps: OutlineStep[]; other: number }
  /** The chosen scenario's branch, in place of its set of alternatives. */
  | { kind: 'scenario'; name: string; line: number; entries: SequenceEntry[]; other: number }
  /** A set of alternatives whose steps another tab shows. */
  | { kind: 'scenarios'; line: number; names: string[] }
  /** A block left to the code. */
  | { kind: 'other'; line: number };

const branchEntries = (items: OutlineBranchItem[]): SequenceEntry[] =>
  items.map((i) => (i.kind === 'step' ? i : { kind: 'parallel', line: i.block.line, steps: i.block.steps, other: i.block.other }));

/**
 * What the tab of `scenario` shows: the main flow's steps and `par` blocks,
 * with the chosen scenario's branch in place of its set of alternatives. The
 * main flow (`scenario` empty) shows each set folded, to be opened on its tab.
 */
export function sequenceEntries(items: OutlineItem[], scenario: string): SequenceEntry[] {
  return items.map((item): SequenceEntry => {
    if (item.kind === 'step' || item.kind === 'other') return item.kind === 'step' ? item : { kind: 'other', line: item.line };
    if (item.kind === 'parallel') return { kind: 'parallel', line: item.block.line, steps: item.block.steps, other: item.block.other };
    const chosen = scenario ? item.branches.find((b) => b.name === scenario) : undefined;
    if (!chosen) return { kind: 'scenarios', line: item.branches[0]?.line ?? 0, names: item.branches.map((b) => b.name) };
    // The par blocks are counted in `other` too; only what the outline does not show is left.
    const other = chosen.other - chosen.items.filter((i) => i.kind === 'parallel').length;
    return { kind: 'scenario', name: chosen.name, line: chosen.line, entries: branchEntries(chosen.items), other };
  });
}

/** Every step a tab shows, in the order drawn (and numbered). */
export function entrySteps(entries: SequenceEntry[]): OutlineStep[] {
  return entries.flatMap((e) => (e.kind === 'step' ? [e.step] : e.kind === 'parallel' ? e.steps : e.kind === 'scenario' ? entrySteps(e.entries) : []));
}

/**
 * The lanes, one per component the use case's steps go between, in the order
 * they first appear in its text: every scenario's too, so the lanes stay put
 * when another tab is chosen.
 */
export function laneOrder(outline: Pick<UseCaseOutline, 'items'>): string[] {
  const lanes: string[] = [];
  for (const s of outlineSteps(outline.items)) {
    for (const id of [s.from, s.to]) if (!lanes.includes(id)) lanes.push(id);
  }
  return lanes;
}

/** The scenario whose branch has the step on `line`, or undefined for a step of the main flow (or none). */
export function scenarioOfStep(items: OutlineItem[], line: number): string | undefined {
  for (const item of items) {
    if (item.kind !== 'scenarios') continue;
    const branch = item.branches.find((b) => b.items.some((i) => (i.kind === 'step' ? i.step.line === line : i.block.steps.some((s) => s.line === line))));
    if (branch) return branch.name;
  }
  return undefined;
}

const sameEnds = (a: OutlineStep, b: OutlineStep) => a.from === b.from && a.to === b.to && a.kind === b.kind;

/**
 * The selected step after the text changed: the step on its line while it is
 * still the same call (its label may have been edited), else the one step
 * with the same ends, kind and label (it was moved, or lines were added
 * above it), else none.
 */
export function followStep(selected: OutlineStep | undefined, steps: OutlineStep[]): OutlineStep | undefined {
  if (!selected) return undefined;
  const at = steps.find((s) => s.line === selected.line);
  if (at && sameEnds(at, selected)) return at;
  const same = steps.filter((s) => sameEnds(s, selected) && s.label === selected.label);
  return same.length === 1 ? same[0] : undefined;
}

// ---------------------------------------------------------------------------
// Geometry, in pixels: the lanes left to right, the rows top to bottom.

/** Under the sticky lane headers. */
export const SEQ = {
  /** The margin left and right of the outermost frames. */
  margin: 20,
  /** The least distance between two lanes. */
  minGap: 132,
  /** A lane header's widest. */
  headerMax: 176,
  /** A row of one message. */
  row: 44,
  /** A frame's title strip, and the room under its last row. */
  frameHead: 30,
  frameFoot: 10,
  /** How far a frame reaches past the lanes of its messages; a frame inside another reaches a little less. */
  framePad: 30,
  nestedPad: 16,
  /** A folded set of scenarios, or a block left to the code. */
  note: 40,
  /** The space above the first row and below the last. */
  top: 14,
  bottom: 18,
  /** A message's label at its widest; longer ones are cut, with the whole in a tooltip. */
  labelMax: 300,
  /** The room a label takes beside its text: the step's number and the padding. */
  labelChrome: 44,
  /** How far a message to its own lane loops out. */
  loop: 44,
} as const;

export interface LaneBox {
  id: string;
  /** The lane's centre. */
  x: number;
  /** Its header's width. */
  width: number;
}

export interface MessageBox {
  step: OutlineStep;
  /** Its number, in the order the tab draws. */
  n: number;
  /** The centre of its row. */
  y: number;
  /** Where it leaves and where it arrives: the lanes' centres (a message to its own lane loops out to the right). */
  x1: number;
  x2: number;
  /** The label's width, cut at SEQ.labelMax. */
  labelWidth: number;
}

export interface FrameBox {
  kind: 'parallel' | 'scenario';
  title: string;
  /** The line that opens it. */
  line: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NoteBox {
  kind: 'scenarios' | 'other' | 'empty';
  line: number;
  /** The scenarios of a folded set. */
  names: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SequenceLayout {
  lanes: LaneBox[];
  messages: MessageBox[];
  frames: FrameBox[];
  notes: NoteBox[];
  width: number;
  height: number;
}

export interface Measure {
  /** A lane header's text width (the component's name). */
  name: (text: string) => number;
  /** A message label's text width. */
  label: (text: string) => number;
}

/** Monospace labels at 11.5px and names in bold 13px, near enough to lay out by (the text is cut to fit anyway). */
export const ESTIMATE: Measure = {
  name: (text) => Math.ceil(text.length * 7.6),
  label: (text) => Math.ceil(text.length * 6.95),
};

/** The width a lane header asks for: its icon, its name and padding, at most SEQ.headerMax. */
const headerWidth = (name: string, measure: Measure) => Math.min(SEQ.headerMax, 50 + measure.name(name));

/**
 * Lays a tab out. The lanes are spread so every label fits over its arrow:
 * each gap starts at what the two headers beside it need, and a message whose
 * label is wider than the lanes it spans widens them, the shortest spans
 * first. Rows follow the text, a frame around each `par` block and the chosen
 * scenario's branch.
 */
export function layoutSequence(entries: SequenceEntry[], laneIds: string[], names: (id: string) => string, measure: Measure = ESTIMATE): SequenceLayout {
  const index = new Map(laneIds.map((id, i) => [id, i]));
  const widths = laneIds.map((id) => headerWidth(names(id), measure));
  const gaps = widths.slice(1).map((w, i) => Math.max(SEQ.minGap, (widths[i] + w) / 2 + 20));
  const steps = entrySteps(entries);
  const labelOf = (s: OutlineStep) => Math.min(SEQ.labelMax, measure.label(s.label || ' '));
  /** The word after a message's or a failed call's label. */
  const tagOf = (s: OutlineStep) => (s.kind === 'async' ? 62 : s.kind === 'failed' ? 40 : 0);
  // A message to its own lane loops out right: its label sits beside the loop, in the gap after the lane.
  const spans = steps
    .map((s) => {
      const a = index.get(s.from) ?? 0;
      const b = index.get(s.to) ?? 0;
      return { lo: Math.min(a, b), hi: a === b ? Math.min(a + 1, laneIds.length - 1) : Math.max(a, b), need: labelOf(s) + tagOf(s) + SEQ.labelChrome + (a === b ? SEQ.loop : 0) };
    })
    .filter((s) => s.hi > s.lo)
    .sort((p, q) => p.hi - p.lo - (q.hi - q.lo));
  for (const { lo, hi, need } of spans) {
    const have = gaps.slice(lo, hi).reduce((sum, g) => sum + g, 0);
    if (have >= need) continue;
    const more = (need - have) / (hi - lo);
    for (let i = lo; i < hi; i++) gaps[i] += more;
  }

  // The left edge: room for the first header, the outermost frame and a message to the first lane's own.
  const depth = maxDepth(entries);
  const left = SEQ.margin + Math.max((widths[0] ?? 0) / 2, depth > 0 ? SEQ.framePad + (depth - 1) * SEQ.nestedPad : 0);
  const xs: number[] = [];
  laneIds.forEach((_, i) => xs.push(i === 0 ? left : xs[i - 1] + gaps[i - 1]));
  const lanes = laneIds.map((id, i) => ({ id, x: Math.round(xs[i]), width: widths[i] }));
  const laneX = (id: string) => lanes[index.get(id) ?? 0]?.x ?? left;
  const firstX = lanes[0]?.x ?? left;
  const lastX = lanes.at(-1)?.x ?? left;

  const messages: MessageBox[] = [];
  const frames: FrameBox[] = [];
  const notes: NoteBox[] = [];
  let y = SEQ.top;
  let n = 0;

  /** Lays out `list` from the current row; returns the horizontal reach of its messages. */
  const place = (list: SequenceEntry[], level: number): { lo: number; hi: number } => {
    let lo = Infinity;
    let hi = -Infinity;
    const reach = (a: number, b: number) => {
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    };
    const message = (step: OutlineStep) => {
      const x1 = laneX(step.from);
      const self = step.from === step.to;
      const x2 = self ? x1 : laneX(step.to);
      messages.push({ step, n: ++n, y: y + SEQ.row / 2, x1, x2, labelWidth: labelOf(step) });
      reach(Math.min(x1, x2), self ? x1 + SEQ.loop : Math.max(x1, x2));
      y += SEQ.row;
    };
    const frame = (kind: FrameBox['kind'], title: string, line: number, body: () => { lo: number; hi: number }) => {
      const top = y;
      y += SEQ.frameHead;
      const inner = body();
      const pad = level === 0 ? SEQ.framePad : SEQ.nestedPad;
      const from = Number.isFinite(inner.lo) ? inner.lo : firstX;
      const to = Number.isFinite(inner.hi) ? inner.hi : Math.max(lastX, firstX + SEQ.minGap);
      const x = from - pad;
      const width = Math.max(to + pad - x, measure.name(title) + 40);
      y += SEQ.frameFoot;
      frames.push({ kind, title, line, x, y: top, width, height: y - top });
      reach(x, x + width);
    };
    const note = (kind: NoteBox['kind'], line: number, names: string[] = [], at = level) => {
      // Inside a frame, a little inside its edge.
      const pad = SEQ.framePad - 10 * at;
      const x = firstX - pad;
      const width = Math.max(lastX + pad, firstX + 260) - x;
      notes.push({ kind, line, names, x, y: y + 4, width, height: SEQ.note - 8 });
      y += SEQ.note;
    };
    for (const e of list) {
      if (e.kind === 'step') message(e.step);
      else if (e.kind === 'parallel')
        frame('parallel', 'At the same time', e.line, () => {
          const inner = place(
            e.steps.map((step) => ({ kind: 'step', step })),
            level + 1,
          );
          if (e.steps.length === 0) note('empty', e.line, [], level + 1);
          return inner;
        });
      else if (e.kind === 'scenario')
        frame('scenario', `Scenario: ${e.name}`, e.line, () => {
          const inner = place(e.entries, level + 1);
          if (e.entries.length === 0) note('empty', e.line, [], level + 1);
          if (e.other > 0) note('other', e.line, [], level + 1);
          return inner;
        });
      else if (e.kind === 'scenarios') note('scenarios', e.line, e.names);
      else note('other', e.line);
    }
    return { lo, hi };
  };
  place(entries, 0);
  y += SEQ.bottom;

  // Everything right of zero, and the width to the farthest frame, label or header.
  const rights = [
    ...lanes.map((l) => l.x + l.width / 2),
    ...frames.map((f) => f.x + f.width),
    ...notes.map((nb) => nb.x + nb.width),
    ...messages.map((m) => (m.x1 === m.x2 ? m.x1 + SEQ.loop + 8 + m.labelWidth + SEQ.labelChrome : Math.max(m.x1, m.x2))),
  ];
  const lefts = [...frames.map((f) => f.x), ...notes.map((nb) => nb.x), ...lanes.map((l) => l.x - l.width / 2)];
  const shift = Math.max(0, SEQ.margin - Math.min(SEQ.margin, ...lefts));
  if (shift > 0) {
    for (const l of lanes) l.x += shift;
    for (const m of messages) {
      m.x1 += shift;
      m.x2 += shift;
    }
    for (const f of frames) f.x += shift;
    for (const nb of notes) nb.x += shift;
  }
  const width = Math.ceil(Math.max(0, ...rights) + shift + SEQ.margin);
  return { lanes, messages, frames, notes, width, height: Math.ceil(y) };
}

/** How deep the frames nest: 1 for a `par` block or a scenario, 2 for a `par` block in a scenario. */
function maxDepth(entries: SequenceEntry[]): number {
  return Math.max(0, ...entries.map((e) => (e.kind === 'parallel' ? 1 : e.kind === 'scenario' ? 1 + maxDepth(e.entries) : 0)));
}
