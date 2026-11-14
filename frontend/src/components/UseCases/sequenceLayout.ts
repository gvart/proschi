import { buildSequence, sectionedItems, type Participant, type SequenceMessage } from '../../dsl/sequence';
import type { DiagramNode, DiagramScenario, DiagramUseCase, FlowStep } from '../../dsl/types';
import { framesOf } from './playbackView';

/**
 * Where everything of a scenario's sequence diagram goes, for SequenceView:
 * one column per participant, then rows top to bottom for messages, `par`
 * regions and `section` frames. Pure, so it is tested without a browser.
 *
 * Labels are drawn in the mono font, so their width is estimated from the
 * number of characters rather than measured.
 */

export const SEQ = {
  /** Space left and right of the outer participants. */
  margin: 28,
  /** Height of the participant header row (the cards sit in it). */
  header: 72,
  row: 46,
  selfRow: 62,
  /** Room above a section's first message for its title tab, and how far each nested frame is inset. */
  sectionHead: 28,
  sectionInset: 8,
  parPad: 14,
  minGap: 190,
  /** A mono character at the label size (11px), in px. */
  charWidth: 6.7,
  /** Labels longer than this many characters are cut, with the full text in a tooltip. */
  labelChars: 56,
} as const;

export interface SeqColumn extends Participant {
  x: number;
  width: number;
  node?: DiagramNode;
}

export interface SeqMessageRow {
  kind: 'message';
  message: SequenceMessage;
  /** The arrow's y. */
  y: number;
  x1: number;
  x2: number;
  /** The label as drawn (cut to SEQ.labelChars). */
  label: string;
  /** Index into `messages`, in display order. */
  index: number;
  /** The playback frame (UseCasePlayback's step) this message belongs to. */
  frame: number;
}

export interface SeqBox {
  kind: 'section' | 'par';
  name: string;
  top: number;
  bottom: number;
  depth: number;
  /** y of each dashed line between `par` branches. */
  dividers: number[];
}

export interface SequenceLayout {
  columns: SeqColumn[];
  rows: SeqMessageRow[];
  boxes: SeqBox[];
  width: number;
  /** Height of the body under the header row. */
  height: number;
  frameCount: number;
}

/** Cuts `text` to SEQ.labelChars characters, ending with an ellipsis. */
export function cutLabel(text: string): string {
  return text.length > SEQ.labelChars ? `${text.slice(0, SEQ.labelChars - 1).trimEnd()}…` : text;
}

/** Width a message's label needs between its two lifelines (number badge included). */
function labelNeed(label: string, request: boolean): number {
  return label.length * SEQ.charWidth + (request ? 30 : 0) + 32;
}

function columnWidth(p: Participant): number {
  return Math.min(230, Math.max(160, p.name.length * 8 + 76, (p.tech?.length ?? 0) * 7 + 76));
}

/**
 * The playback frame of each message. A request belongs to the frame it is
 * sent in; an answer to the frame its `-->` plays in, but never to one before
 * the message above it, so answers that close a call after nested calls light
 * up with the last of those calls rather than ahead of them.
 */
export function messageFrames(steps: FlowStep[], messages: SequenceMessage[]): number[] {
  const sent = new Map<FlowStep, number>();
  const answered = new Map<FlowStep, number>();
  framesOf(steps).forEach((frame, i) => {
    for (const step of frame.steps) sent.set(step, i);
    for (const step of frame.responses) answered.set(step, i);
  });
  let previous = 0;
  return messages.map((m) => {
    const own = m.kind === 'request' ? sent.get(m.step) : (answered.get(m.step) ?? sent.get(m.step));
    const frame = m.kind === 'request' ? (own ?? previous) : Math.max(own ?? previous, previous);
    previous = frame;
    return frame;
  });
}

export function layoutSequence(useCase: DiagramUseCase, scenario: DiagramScenario, nodes: DiagramNode[]): SequenceLayout {
  const seq = buildSequence(useCase, scenario, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const index = new Map(seq.participants.map((p, i) => [p.id, i]));
  const widths = seq.participants.map(columnWidth);
  const gaps = seq.participants.slice(1).map((_, i) => Math.max(SEQ.minGap, (widths[i] + widths[i + 1]) / 2 + 36));

  const messages = seq.items.flatMap((item) => (item.kind === 'message' ? [item.message] : item.branches.flat()));
  const labels = new Map(messages.map((m) => [m, cutLabel(m.label)]));

  // Widen the narrowest spans first so long labels fit between their lifelines.
  let selfExtra = 0;
  const spans = messages
    .map((m) => ({ m, a: Math.min(index.get(m.from)!, index.get(m.to)!), b: Math.max(index.get(m.from)!, index.get(m.to)!) }))
    .sort((x, y) => x.b - x.a - (y.b - y.a));
  for (const { m, a, b } of spans) {
    const need = labelNeed(labels.get(m)!, m.kind === 'request');
    if (a === b) {
      if (a < gaps.length) gaps[a] = Math.max(gaps[a], need + 48);
      else selfExtra = Math.max(selfExtra, need + 48 - widths[a] / 2);
      continue;
    }
    const have = gaps.slice(a, b).reduce((s, g) => s + g, 0);
    if (need > have) for (let i = a; i < b; i++) gaps[i] += (need - have) / (b - a);
  }

  const xs: number[] = [];
  seq.participants.forEach((_, i) => xs.push(i === 0 ? SEQ.margin + widths[0] / 2 : xs[i - 1] + gaps[i - 1]));
  const width = Math.max((xs.at(-1) ?? SEQ.margin) + (widths.at(-1) ?? 0) / 2 + SEQ.margin + Math.max(selfExtra, 0), 320);
  const columns: SeqColumn[] = seq.participants.map((p, i) => ({ ...p, x: xs[i], width: widths[i], node: byId.get(p.id) }));

  const frames = messageFrames(scenario.steps, messages);
  const frameOf = new Map(messages.map((m, i) => [m, frames[i]]));
  const rows: SeqMessageRow[] = [];
  const boxes: SeqBox[] = [];
  const openSections: { name: string; top: number }[] = [];
  // `y` is where the next arrow goes; a label sits about 20px above its arrow.
  let y = 40;
  const place = (m: SequenceMessage) => {
    const self = m.from === m.to;
    if (self) y += SEQ.selfRow - SEQ.row;
    rows.push({
      kind: 'message',
      message: m,
      y: self ? y - 18 : y,
      x1: xs[index.get(m.from)!],
      x2: xs[index.get(m.to)!],
      label: labels.get(m)!,
      index: rows.length,
      frame: frameOf.get(m) ?? 0,
    });
    y += SEQ.row;
  };

  for (const entry of sectionedItems(seq.items)) {
    if (entry.kind === 'open') {
      openSections.push({ name: entry.section.name, top: y - 30 });
      y += SEQ.sectionHead;
      continue;
    }
    if (entry.kind === 'close') {
      const open = openSections.pop()!;
      boxes.push({ kind: 'section', name: open.name, top: open.top, bottom: y - SEQ.row + SEQ.parPad, depth: entry.depth, dividers: [] });
      y += 10;
      continue;
    }
    const item = entry.item;
    if (item.kind === 'message') {
      place(item.message);
      continue;
    }
    y += SEQ.parPad + 10;
    const top = y - 22 - SEQ.parPad - 10;
    const dividers: number[] = [];
    item.branches.forEach((branch, i) => {
      if (i > 0) {
        dividers.push(y - SEQ.row + SEQ.parPad);
        y += 10;
      }
      branch.forEach(place);
    });
    boxes.push({ kind: 'par', name: 'par', top, bottom: y - SEQ.row + SEQ.parPad, depth: entry.depth, dividers });
    y += 10;
  }

  return {
    columns,
    rows,
    // Outermost first, so nested frames draw over the ones around them.
    boxes: boxes.sort((a, b) => a.depth - b.depth || a.top - b.top),
    width,
    height: Math.max(y - SEQ.row / 2 + 24, 120),
    frameCount: framesOf(scenario.steps).length,
  };
}

/** How a message reads at a frame of playback: the one playing, one played before, or one still to come. */
export type SeqLook = 'lit' | 'past' | 'future';

export function lookAt(row: SeqMessageRow, frame: number): SeqLook {
  return row.frame === frame ? 'lit' : row.frame < frame ? 'past' : 'future';
}

/** The participants of the frame's messages: the accent for each, the failure colour for the one a failing call goes to. */
export function litParticipants(rows: SeqMessageRow[], frame: number): Map<string, 'active' | 'failing'> {
  const lit = new Map<string, 'active' | 'failing'>();
  for (const row of rows) {
    if (row.frame !== frame) continue;
    const m = row.message;
    // The node that fails is the one called: the target of a call that got no answer, the sender of an error answer.
    const failing = m.failed ? m.to : m.kind === 'response' && m.error ? m.from : undefined;
    for (const id of [m.from, m.to]) if (!lit.has(id)) lit.set(id, 'active');
    if (failing) lit.set(failing, 'failing');
  }
  return lit;
}

type Point = { x: number; y: number };

/**
 * The points a message's arrow is drawn through, from sender to receiver: a
 * straight line that stops short of the lifeline (further for a call that
 * never arrives), or a loop out and back for a message to itself.
 */
export function arrowPoints(row: Pick<SeqMessageRow, 'message' | 'x1' | 'x2' | 'y'>): Point[] {
  const { x1, x2, y } = row;
  if (x1 === x2) return [{ x: x1, y }, { x: x1 + 38, y }, { x: x1 + 38, y: y + 20 }, { x: x1 + 3, y: y + 20 }];
  const dir = Math.sign(x2 - x1);
  return [{ x: x1, y }, { x: row.message.failed ? x2 - dir * 16 : x2 - dir * 3, y }];
}

/** The point `share` (0–1) of the way along an arrow. */
export function pointAlong(points: Point[], share: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = Math.min(Math.max(share, 0), 1) * lengths.reduce((s, l) => s + l, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(left / lengths[i], 1);
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    left -= lengths[i];
  }
  return points[0];
}

/**
 * When, in the frame's progress (0–100, the playback clock), the packet of
 * each message playing in `frame` rides its arrow, by row index. As on the
 * canvas: a call answered in the same frame goes out in the first half and its
 * answer comes back in the second; anything else (an async send, a call
 * answered later, an answer on its own) takes the whole step.
 */
export function packetWindows(rows: SeqMessageRow[], frame: number): Map<number, [number, number]> {
  const playing = rows.filter((r) => r.frame === frame);
  const has = (kind: SequenceMessage['kind'], row: SeqMessageRow) => playing.some((r) => r.message.step === row.message.step && r.message.kind === kind);
  return new Map(
    playing.map((row): [number, [number, number]] => {
      const { kind, failed } = row.message;
      if (kind === 'request' && !failed && has('response', row)) return [row.index, [0, 50]];
      if (kind === 'response' && has('request', row)) return [row.index, [50, 100]];
      return [row.index, [0, 100]];
    }),
  );
}

/** How far the sequence view zooms, and the step of its + and − buttons. */
export const ZOOM = { min: 0.25, max: 2, step: 1.2, /** Fitting the width shrinks no further than this; past it, the view scrolls sideways. */ widthFloor: 0.6 } as const;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));
}

/**
 * The zoom that fits the diagram in a pane of `paneWidth` × `paneHeight`:
 * `width` fits its width (never past 100%, nor below ZOOM.widthFloor, so
 * labels stay readable), `all` fits all of it, zooming in as far as
 * ZOOM.max when it is small.
 */
export function fitZoom(layout: Pick<SequenceLayout, 'width' | 'height'>, paneWidth: number, paneHeight: number, mode: 'width' | 'all'): number {
  const byWidth = (paneWidth - 8) / layout.width;
  if (mode === 'width') return Math.min(1, Math.max(ZOOM.widthFloor, byWidth));
  // The body's bottom padding (24) is part of what has to fit.
  const byHeight = (paneHeight - 8) / (SEQ.header + layout.height + 24);
  return clampZoom(Math.min(byWidth, byHeight));
}
