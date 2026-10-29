import type { Layout, Point } from '../../../frontend/src/dsl/autoLayout';
import { fallbackRoute, labelPoint } from '../../../frontend/src/dsl/edgePath';
import type { Diagram, DiagramEdge, DiagramNode } from '../../../frontend/src/dsl/types';
import { E, N, S, W } from './grid';

/**
 * The diagram in character cells: the browser's ELK layout (autoLayout.ts),
 * scaled so a 240px card is about 30 columns wide and 5 rows tall, and
 * squeezed sideways when it would not fit the terminal. Edge routes become
 * runs of cells, each with the directions its line leaves in.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell {
  x: number;
  y: number;
}

export interface SceneNode {
  node: DiagramNode;
  rect: Rect;
  depth: number;
}

export interface Path {
  /** In travel order, ends outside both boxes; the last cell holds the arrowhead. */
  cells: Cell[];
  /** Line directions of each cell. */
  dirs: number[];
  /** Direction the arrowhead points. */
  head: number;
}

export interface SceneEdge {
  edge: DiagramEdge;
  path: Path;
  label?: Cell;
}

export interface Scene {
  diagram: Diagram;
  columns: number;
  rows: number;
  nodes: Map<string, SceneNode>;
  edges: SceneEdge[];
  /** The first row below the drawing, where the legend goes. */
  legendRow: number;
}

/** Pixels per cell at full size: cells are about twice as tall as wide. */
const SX = 8;
const SY = 12;
/** Narrower than this (in pixels per column) and names stop being readable. */
const MAX_SX = 16;
const MARGIN = 1;

export function buildScene(diagram: Diagram, layout: Layout, maxColumns = 160): Scene {
  const boxes = new Map(layout.nodes.map((b) => [b.id, b]));
  const absolute = (id: string): Point => {
    const b = boxes.get(id);
    if (!b) return { x: 0, y: 0 };
    const parent = b.parent ? absolute(b.parent) : { x: 0, y: 0 };
    return { x: parent.x + b.position.x, y: parent.y + b.position.y };
  };

  const px = diagram.nodes.filter((n) => boxes.has(n.id)).map((node) => ({ node, at: absolute(node.id), box: boxes.get(node.id)! }));
  const bends = Object.values(layout.routes).flatMap((r) => r.points);
  const xs = [...px.flatMap((p) => [p.at.x, p.at.x + p.box.width]), ...bends.map((p) => p.x)];
  const ys = [...px.flatMap((p) => [p.at.y, p.at.y + p.box.height]), ...bends.map((p) => p.y)];
  const minX = Math.min(0, ...xs);
  const minY = Math.min(0, ...ys);
  const widthPx = Math.max(1, ...xs) - minX;
  const sx = Math.min(MAX_SX, Math.max(SX, widthPx / Math.max(1, maxColumns - 2 * MARGIN - 1)));
  const cx = (x: number) => Math.round((x - minX) / sx) + MARGIN;
  const cy = (y: number) => Math.round((y - minY) / SY) + MARGIN;

  const depthOf = (n: DiagramNode): number => {
    const parent = n.parent ? diagram.nodes.find((p) => p.id === n.parent) : undefined;
    return parent ? depthOf(parent) + 1 : 0;
  };
  const nodes = new Map<string, SceneNode>();
  for (const { node, at, box } of px) {
    const x = cx(at.x);
    const y = cy(at.y);
    const w = Math.max(node.kind === 'group' ? 8 : 6, cx(at.x + box.width) - x);
    const h = node.kind === 'component' ? 5 : Math.max(node.kind === 'group' ? 3 : 4, cy(at.y + box.height) - y);
    nodes.set(node.id, { node, rect: { x, y, w, h }, depth: depthOf(node) });
  }

  const edges: SceneEdge[] = [];
  for (const edge of diagram.edges) {
    const s = nodes.get(edge.source);
    const t = nodes.get(edge.target);
    if (!s || !t || s === t) continue;
    const route = layout.routes[edge.id];
    const points = route ? route.points.map((p) => ({ x: cx(p.x), y: cy(p.y) })) : undefined;
    const path = points ? routePath(points, s.rect, t.rect) : fallbackPath(s.rect, t.rect);
    if (!path) continue;
    const at = route?.label ? { x: cx(route.label.x), y: cy(route.label.y) } : labelPoint(path.cells);
    edges.push({ edge, path, ...(edge.label ? { label: { x: Math.round(at.x), y: Math.round(at.y) } } : {}) });
  }

  let right = 0;
  let bottom = 0;
  for (const { node, rect } of nodes.values()) {
    // Cards cast a shadow one cell right and down.
    const cast = node.kind === 'group' ? 0 : 1;
    right = Math.max(right, rect.x + rect.w + cast);
    bottom = Math.max(bottom, rect.y + rect.h + cast);
  }
  for (const { path } of edges)
    for (const c of path.cells) {
      right = Math.max(right, c.x + 1);
      bottom = Math.max(bottom, c.y + 1);
    }
  for (const e of edges) if (e.label && e.edge.label) right = Math.max(right, e.label.x + Math.ceil(e.edge.label.length / 2) + 1);
  const legendRows = diagram.legend?.length ? 2 : 0;
  return {
    diagram,
    columns: Math.min(512, Math.max(1, right + MARGIN)),
    rows: Math.min(256, Math.max(1, bottom + MARGIN + legendRows)),
    nodes,
    edges,
    legendRow: bottom + MARGIN,
  };
}

const contains = (r: Rect, c: Cell) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;

/** Moves an end that the scaling left off its box back onto the box's border, along the segment it starts. */
function attach(end: Cell, next: Cell, r: Rect): Cell {
  const vertical = end.x === next.x;
  if (vertical && end.x >= r.x && end.x < r.x + r.w) {
    if (end.y >= r.y + r.h) return { x: end.x, y: r.y + r.h - 1 };
    if (end.y < r.y) return { x: end.x, y: r.y };
  }
  if (!vertical && end.y >= r.y && end.y < r.y + r.h) {
    if (end.x >= r.x + r.w) return { x: r.x + r.w - 1, y: end.y };
    if (end.x < r.x) return { x: r.x, y: end.y };
  }
  return end;
}

/** Every cell from `a` to `b`, turning once where rounding made the segment diagonal. */
function segment(a: Cell, b: Cell, out: Cell[]): void {
  const corner = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  for (const [from, to] of [
    [a, corner],
    [corner, b],
  ]) {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    let { x, y } = from;
    while (x !== to.x || y !== to.y) {
      x += dx;
      y += dy;
      out.push({ x, y });
    }
  }
}

const dirTo = (a: Cell, b: Cell): number => (b.x > a.x ? E : b.x < a.x ? W : b.y > a.y ? S : N);
const opposite = (d: number): number => (d === N ? S : d === S ? N : d === E ? W : E);

/**
 * Drops a short sideways step just before the end (`│` then `╰──╮` then `▼`):
 * at this scale a few pixels of offset between a group's port and its member
 * become a jog of a few cells. When the line already runs over the box, it
 * goes straight in.
 */
function unjog(pts: Cell[], box: Rect): Cell[] {
  const n = pts.length;
  if (n < 3) return pts;
  const [a, b, c] = [pts[n - 3], pts[n - 2], pts[n - 1]];
  const sideways = a.y === b.y && Math.abs(b.x - a.x) <= 4 && b.x === c.x && Math.abs(c.y - b.y) <= 3;
  if (!sideways || a.x < box.x + 1 || a.x > box.x + box.w - 2) return pts;
  return [...pts.slice(0, n - 2), { x: a.x, y: c.y }];
}

/** The cells of a polyline between two boxes, outside both. */
export function routePath(points: Cell[], from: Rect, to: Rect): Path | undefined {
  if (points.length < 2) return undefined;
  const pts = unjog(unjog(points.slice(), to).reverse(), from).reverse();
  pts[0] = attach(pts[0], pts[1], from);
  pts[pts.length - 1] = attach(pts[pts.length - 1], pts[pts.length - 2], to);
  const all: Cell[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) segment(pts[i - 1], pts[i], all);
  // Drop repeats and the cells inside either box (the line runs from border to border).
  const run: Cell[] = [];
  for (const c of all) {
    const last = run[run.length - 1];
    if (last && last.x === c.x && last.y === c.y) continue;
    run.push(c);
  }
  let start = 0;
  while (start < run.length && contains(from, run[start])) start++;
  let end = run.length - 1;
  while (end >= start && contains(to, run[end])) end--;
  const cells = run.slice(start, end + 1);
  if (cells.length === 0) return undefined;
  // The cells just inside each box say which way the line leaves and enters.
  const before = run[start - 1] ?? undefined;
  const after = run[end + 1] ?? undefined;
  const dirs = cells.map((c, i) => {
    let d = 0;
    const prev = i > 0 ? cells[i - 1] : before;
    const next = i < cells.length - 1 ? cells[i + 1] : undefined;
    if (prev) d |= dirTo(c, prev);
    if (next) d |= dirTo(c, next);
    return d;
  });
  const last = cells[cells.length - 1];
  const head = after ? dirTo(last, after) : cells.length > 1 ? opposite(dirTo(last, cells[cells.length - 2])) : S;
  return { cells, dirs, head };
}

/** A route between two boxes that the layout did not connect (a use case step without an edge). */
export function fallbackPath(from: Rect, to: Rect): Path | undefined {
  const box = (r: Rect) => ({ x: r.x, y: r.y, width: r.w - 1, height: r.h - 1 });
  const points = fallbackRoute(box(from), box(to)).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  return routePath(points, from, to);
}
