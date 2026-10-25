import type { Point } from './autoLayout';

/**
 * Edge geometry shared by the canvas (RoutedEdge, AnimatedPlaybackEdge) and
 * `proschi render`: a routed polyline drawn with rounded corners, where its
 * label goes, and the orthogonal fallback for edges without a route (a node
 * was dragged or pinned with `pos`).
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CORNER = 8;

/** Length and half-width of the arrowhead drawn at the target. */
const HEAD = { length: 10, half: 5 };

/** An SVG path through `points`, with each bend rounded off (by at most half of the shorter leg). */
export function roundedPath(points: Point[], radius = CORNER): string {
  if (points.length === 0) return '';
  const r = (n: number) => Math.round(n * 10) / 10;
  const out = [`M${r(points[0].x)},${r(points[0].y)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
    const inLen = Math.hypot(b.x - a.x, b.y - a.y);
    const outLen = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(radius, inLen / 2, outLen / 2);
    if (k < 0.5) {
      out.push(`L${r(b.x)},${r(b.y)}`);
      continue;
    }
    const p = { x: b.x - ((b.x - a.x) / inLen) * k, y: b.y - ((b.y - a.y) / inLen) * k };
    const q = { x: b.x + ((c.x - b.x) / outLen) * k, y: b.y + ((c.y - b.y) / outLen) * k };
    out.push(`L${r(p.x)},${r(p.y)}`, `Q${r(b.x)},${r(b.y)} ${r(q.x)},${r(q.y)}`);
  }
  const last = points[points.length - 1];
  out.push(`L${r(last.x)},${r(last.y)}`);
  return out.join(' ');
}

/** The middle of the longest segment: a label there sits on a straight run, clear of the bends. */
export function labelPoint(points: Point[]): Point {
  let best = { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 };
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > longest) {
      longest = len;
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return best;
}

/**
 * An orthogonal route between two boxes when the layout has none: from the
 * middle of the side of `s` that faces `t` to the facing side of `t`, with
 * the turn halfway. Boxes stacked one over the other connect bottom to top
 * (or top to bottom); boxes side by side connect left and right.
 */
export function fallbackRoute(s: Box, t: Box): Point[] {
  const sc = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const tc = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const gapY = Math.max(t.y - (s.y + s.height), s.y - (t.y + t.height));
  const gapX = Math.max(t.x - (s.x + s.width), s.x - (t.x + t.width));
  if (gapY >= 0 || gapY >= gapX) {
    const down = tc.y >= sc.y;
    const from = { x: sc.x, y: down ? s.y + s.height : s.y };
    const to = { x: tc.x, y: down ? t.y : t.y + t.height };
    if (Math.abs(from.x - to.x) < 1) return [from, to];
    const midY = (from.y + to.y) / 2;
    return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
  }
  const right = tc.x >= sc.x;
  const from = { x: right ? s.x + s.width : s.x, y: sc.y };
  const to = { x: right ? t.x : t.x + t.width, y: tc.y };
  if (Math.abs(from.y - to.y) < 1) return [from, to];
  const midX = (from.x + to.x) / 2;
  return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
}

/**
 * Moves an end of a route that leaves or enters `box` through its bottom onto
 * the bottom as drawn, for nodes drawn taller or shorter than the layout
 * assumed (a note's text, the static renderer's cards). Ends on the top or the
 * sides already sit on the drawn border.
 */
export function snapToBottom(points: Point[], end: 'start' | 'end', box: Box): Point[] {
  const i = end === 'start' ? 0 : points.length - 1;
  const p = points[i];
  const next = points[end === 'start' ? 1 : points.length - 2];
  const bottom = box.y + box.height;
  const inside = p && next && p.x > box.x + 0.5 && p.x < box.x + box.width - 0.5 && p.y > box.y + 0.5;
  if (!inside || Math.abs(p.y - bottom) < 0.5 || Math.abs(next.x - p.x) > 0.5 || next.y < bottom) return points;
  const out = points.slice();
  out[i] = { x: p.x, y: bottom };
  return out;
}

/** The arrowhead at the end of `points`; the line is cut back to its base so it does not poke through the tip. */
export function withHead(points: Point[]): { points: Point[]; head: string } {
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const len = Math.hypot(tip.x - before.x, tip.y - before.y);
  if (len < HEAD.length) return { points, head: '' };
  const ux = (tip.x - before.x) / len;
  const uy = (tip.y - before.y) / len;
  const base = { x: tip.x - ux * HEAD.length, y: tip.y - uy * HEAD.length };
  const r = (n: number) => Math.round(n * 10) / 10;
  const head = `M${r(tip.x)},${r(tip.y)} L${r(base.x - uy * HEAD.half)},${r(base.y + ux * HEAD.half)} L${r(base.x + uy * HEAD.half)},${r(base.y - ux * HEAD.half)} Z`;
  return { points: [...points.slice(0, -1), base], head };
}
