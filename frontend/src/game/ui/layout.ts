import { canWire, nextId, roleOf, type NodeRole } from '../engine/board';
import { USERS } from '../engine/compile';
import { SLOTS, WIDE_SLOTS } from '../engine/rules';
import type { Board, BoardNode, ComponentDef, ScenarioDef } from '../engine/types';

/**
 * The board's geometry and the edits a tap makes, as pure functions (the
 * page draws what these return): rows top to bottom, Users first and the
 * external systems last, so requests fall down the screen; and placing,
 * removing and wiring components with sensible automatic wires, so a phone
 * player never has to draw every edge by hand.
 */

export const ROWS = ['users', 'edge', 'compute', 'cache', 'data', 'async', 'external'] as const;
export type Row = (typeof ROWS)[number];

export const ROW_LABEL: Record<Row, string> = {
  users: 'Users',
  edge: 'Edge',
  compute: 'Compute',
  cache: 'Cache',
  data: 'Data',
  async: 'Async',
  external: 'External',
};

export interface Placed {
  id: string;
  row: Row;
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  width: number;
  height: number;
  rowHeight: number;
  rows: { row: Row; y: number }[];
  nodes: Map<string, Placed>;
  /** Where a new component would go in a row (the next free slot). */
  ghost: (row: Row) => { x: number; y: number } | undefined;
}

export function rowOf(node: BoardNode, components: ReadonlyMap<string, ComponentDef>, scenario: ScenarioDef): Row {
  if (node.component === USERS) return 'users';
  if (scenario.externals.some((e) => e.id === node.component)) return 'external';
  return components.get(node.component)?.lane ?? 'compute';
}

export function layoutBoard(board: Board, components: ReadonlyMap<string, ComponentDef>, scenario: ScenarioDef, width = 640, wide = false, compact = false): Layout {
  const slots = wide ? WIDE_SLOTS : SLOTS;
  const rowHeight = compact ? 66 : 80;
  const top = 18;
  const byRow = new Map<Row, BoardNode[]>(ROWS.map((r) => [r, []]));
  for (const n of board.nodes) byRow.get(rowOf(n, components, scenario))!.push(n);
  const rows = ROWS.filter((r) => r !== 'external' || byRow.get(r)!.length > 0).map((row, i) => ({ row, y: top + rowHeight * i + rowHeight / 2 }));
  const yOf = new Map(rows.map((r) => [r.row, r.y]));
  const w = Math.min(124, width / slots - 14);
  const h = compact ? 46 : 54;
  const nodes = new Map<string, Placed>();
  for (const { row, y } of rows) {
    const list = byRow.get(row)!;
    const n = Math.max(list.length, 1);
    list.forEach((node, i) => nodes.set(node.id, { id: node.id, row, x: (width / n) * (i + 0.5), y, w, h }));
  }
  return {
    width,
    height: top * 2 + rowHeight * rows.length,
    rowHeight,
    rows,
    nodes,
    ghost: (row) => {
      const y = yOf.get(row);
      const count = byRow.get(row)?.length ?? 0;
      if (y === undefined || count >= slots) return undefined;
      // The existing nodes shift left to make room: the new one is the last of count + 1.
      return { x: (width / (count + 1)) * (count + 0.5), y };
    },
  };
}

// ---- Edits ----

export interface EditContext {
  components: ReadonlyMap<string, ComponentDef>;
  scenario: ScenarioDef;
}

const EDGE: ReadonlySet<NodeRole> = new Set(['lb', 'waf', 'cdn', 'gateway']);
const STORE: ReadonlySet<NodeRole> = new Set(['db', 'blob', 'search', 'warehouse']);

function roles(board: Board, ctx: EditContext): Map<string, NodeRole | undefined> {
  return new Map(board.nodes.map((n) => [n.id, roleOf(n, ctx.components, ctx.scenario)]));
}

function addEdge(board: Board, from: string, to: string, role: Map<string, NodeRole | undefined>): void {
  const a = role.get(from);
  const b = role.get(to);
  if (!a || !b || from === to) return;
  if (board.edges.some(([x, y]) => x === from && y === to)) return;
  if (canWire(a, b).ok) board.edges.push([from, to]);
}

/**
 * Places a component and wires it the way it is usually wired: an edge
 * component goes in front of what Users call; an app server joins the other
 * app servers (same callers, same stores); a store, cache or queue is wired
 * from every app server; a worker takes the first queue's jobs and reaches
 * what the app servers reach.
 */
export function placeComponent(board: Board, componentId: string, ctx: EditContext): { board: Board; id: string } {
  const c = ctx.components.get(componentId);
  if (!c) throw new Error(`Unknown component ${componentId}`);
  const id = nextId(board, componentId);
  const next: Board = { nodes: [...board.nodes, { id, component: componentId, replicas: 1 }], edges: board.edges.map(([a, b]) => [a, b]) };
  const role = roles(next, ctx);
  const of = (r: NodeRole) => next.nodes.filter((n) => role.get(n.id) === r && n.id !== id).map((n) => n.id);
  const users = next.nodes.find((n) => n.component === USERS)?.id;

  if (EDGE.has(c.role) && users) {
    // In front: Users → new → whatever Users called.
    const targets = next.edges.filter(([a]) => a === users).map(([, b]) => b);
    next.edges = next.edges.filter(([a]) => a !== users);
    addEdge(next, users, id, role);
    for (const t of targets) addEdge(next, id, t, role);
    if (!next.edges.some(([a]) => a === id)) for (const app of of('app')) addEdge(next, id, app, role);
  } else if (c.role === 'app') {
    const peers = of('app');
    const callers = new Set(next.edges.filter(([, b]) => peers.includes(b)).map(([a]) => a));
    if (callers.size === 0 && users) callers.add(users);
    for (const caller of callers) addEdge(next, caller, id, role);
    const callees = new Set(next.edges.filter(([a]) => peers.includes(a)).map(([, b]) => b));
    for (const callee of callees) addEdge(next, id, callee, role);
  } else if (c.role === 'worker') {
    const queue = of('queue')[0];
    if (queue) addEdge(next, queue, id, role);
    const apps = of('app');
    const reached = new Set(next.edges.filter(([a, b]) => apps.includes(a) && (STORE.has(role.get(b)!) || role.get(b) === 'external')).map(([, b]) => b));
    for (const t of reached) addEdge(next, id, t, role);
  } else {
    for (const app of of('app')) addEdge(next, app, id, role);
    if (c.role === 'queue') for (const w of of('worker')) addEdge(next, id, w, role);
  }
  return { board: next, id };
}

/** Removes a node and joins its callers to what it called, where that wire is allowed (taking out a load balancer keeps Users wired). */
export function removeNode(board: Board, id: string, ctx: EditContext): Board {
  const preds = board.edges.filter(([, b]) => b === id).map(([a]) => a);
  const succs = board.edges.filter(([a]) => a === id).map(([, b]) => b);
  const next: Board = { nodes: board.nodes.filter((n) => n.id !== id), edges: board.edges.filter(([a, b]) => a !== id && b !== id) };
  const role = roles(next, ctx);
  for (const p of preds) for (const s of succs) addEdge(next, p, s, role);
  return next;
}

/** Adds the wire, or removes it if it is there. */
export function toggleWire(board: Board, from: string, to: string, ctx: EditContext): { board: Board } | { error: string } {
  if (board.edges.some(([a, b]) => a === from && b === to)) return { board: { ...board, edges: board.edges.filter(([a, b]) => !(a === from && b === to)) } };
  const role = roles(board, ctx);
  const a = role.get(from);
  const b = role.get(to);
  if (!a || !b) return { error: 'Pick a component on the board' };
  if (from === to) return { error: 'A component does not call itself' };
  const ok = canWire(a, b);
  if (!ok.ok) return { error: ok.reason };
  return { board: { ...board, edges: [...board.edges, [from, to]] } };
}

/** Changes one node's fields. */
export const updateNode = (board: Board, id: string, patch: Partial<BoardNode>): Board => ({
  ...board,
  nodes: board.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
});
