import type { Diagram } from './types';
import type { LaidOutNode } from './autoLayout';

/**
 * How readable a laid-out diagram is, in numbers: edge crossings, edge length,
 * bends, overlapping boxes, edges drawn through nodes and the overall shape.
 * Used by layoutMetrics.test.ts to keep the auto layout from regressing and to
 * compare engine settings (`npm run layout:metrics` prints the table).
 */

export interface Point {
  x: number;
  y: number;
}

/** A node or group in absolute canvas coordinates. */
export interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  group: boolean;
  /** Enclosing groups, innermost first. */
  ancestors: string[];
}

/** An edge as drawn: a polyline (curves are sampled) and how many times it turns. */
export interface Polyline {
  id: string;
  source: string;
  target: string;
  points: Point[];
  bends: number;
  /** Drawn along a route from the layout, not by the fallback. */
  routed?: boolean;
}

export interface LayoutMetrics {
  nodes: number;
  edges: number;
  /** Edges the layout gave no route, drawn by the fallback. */
  unrouted: number;
  crossings: number;
  totalLength: number;
  maxLength: number;
  bends: number;
  /** Pairs of boxes that overlap, where neither contains the other. */
  overlaps: number;
  /** Edges drawn across a node that is neither of their ends. */
  throughNodes: number;
  width: number;
  height: number;
  /** Width over height of the bounding box. */
  aspect: number;
}

/** Absolute rectangles of a layout (group members are placed relative to their group). */
export function toRects(boxes: LaidOutNode[], diagram: Diagram): Rect[] {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const kinds = new Map(diagram.nodes.map((n) => [n.id, n.kind]));
  const absolute = (b: LaidOutNode): Point => {
    const parent = b.parent ? byId.get(b.parent) : undefined;
    const origin = parent ? absolute(parent) : { x: 0, y: 0 };
    return { x: origin.x + b.position.x, y: origin.y + b.position.y };
  };
  return boxes.map((b) => {
    const ancestors: string[] = [];
    for (let p = b.parent; p; p = byId.get(p)?.parent) ancestors.push(p);
    return { id: b.id, ...absolute(b), width: b.width, height: b.height, group: kinds.get(b.id) === 'group', ancestors };
  });
}

/** React Flow's default bezier from the bottom of `s` to the top of `t`, sampled (the canvas before routed edges). */
export function bezierPolyline(id: string, s: Rect, t: Rect, samples = 24): Polyline {
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height;
  const tx = t.x + t.width / 2;
  const ty = t.y;
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const c1y = sy + offset(ty - sy);
  const c2y = ty - offset(ty - sy);
  const points: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u ** 2;
    const d = u ** 3;
    points.push({ x: a * sx + b * sx + c * tx + d * tx, y: a * sy + b * c1y + c * c2y + d * ty });
  }
  // An S-curve turns twice; a straight drop does not turn.
  return { id, source: s.id, target: t.id, points, bends: Math.abs(sx - tx) > 1 ? 2 : 0 };
}

const length = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Segments cross at a point inside both (touching ends and collinear runs do not count). */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  const eps = 1e-6;
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** The segment passes through the inside of the rectangle (shrunk by `inset`, so running along a border is fine). */
function segmentHitsRect(a: Point, b: Point, r: Rect, inset = 4): boolean {
  const x0 = r.x + inset;
  const y0 = r.y + inset;
  const x1 = r.x + r.width - inset;
  const y1 = r.y + r.height - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clips: [number, number][] = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

export function computeMetrics(rects: Rect[], lines: Polyline[]): LayoutMetrics {
  let crossings = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i].points;
      const b = lines[j].points;
      for (let p = 1; p < a.length; p++) {
        for (let q = 1; q < b.length; q++) {
          if (segmentsCross(a[p - 1], a[p], b[q - 1], b[q])) crossings++;
        }
      }
    }
  }

  let overlaps = 0;
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.ancestors.includes(b.id) || b.ancestors.includes(a.id)) continue;
      if (intersects(a, b)) overlaps++;
    }
  }

  const cards = rects.filter((r) => !r.group);
  let throughNodes = 0;
  for (const line of lines) {
    const hit = cards.some(
      (r) => r.id !== line.source && r.id !== line.target && line.points.slice(1).some((p, i) => segmentHitsRect(line.points[i], p, r)),
    );
    if (hit) throughNodes++;
  }

  const lengths = lines.map((l) => length(l.points));
  const xs = [...rects.flatMap((r) => [r.x, r.x + r.width]), ...lines.flatMap((l) => l.points.map((p) => p.x))];
  const ys = [...rects.flatMap((r) => [r.y, r.y + r.height]), ...lines.flatMap((l) => l.points.map((p) => p.y))];
  const width = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const height = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;

  return {
    nodes: rects.length,
    edges: lines.length,
    unrouted: lines.filter((l) => !l.routed).length,
    crossings,
    totalLength: Math.round(lengths.reduce((a, b) => a + b, 0)),
    maxLength: Math.round(Math.max(0, ...lengths)),
    bends: lines.reduce((sum, l) => sum + l.bends, 0),
    overlaps,
    throughNodes,
    width: Math.round(width),
    height: Math.round(height),
    aspect: height ? Math.round((width / height) * 100) / 100 : 0,
  };
}

/** A table of metrics per fixture, for the console. */
export function formatMetrics(rows: Record<string, LayoutMetrics>): string {
  const columns: (keyof LayoutMetrics)[] = ['nodes', 'edges', 'unrouted', 'crossings', 'totalLength', 'maxLength', 'bends', 'overlaps', 'throughNodes', 'width', 'height', 'aspect'];
  const names = Object.keys(rows);
  const nameWidth = Math.max(7, ...names.map((n) => n.length));
  const widths = columns.map((c) => Math.max(c.length, ...names.map((n) => String(rows[n][c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(nameWidth) : c.padStart(widths[i - 1]))).join(' | ');
  return [
    line(['fixture', ...columns]),
    [nameWidth, ...widths].map((w) => '-'.repeat(w)).join('-|-'),
    ...names.map((n) => line([n, ...columns.map((c) => String(rows[n][c]))])),
  ].join('\n');
}
