import { USERS, WAN } from './compile';
import { MAX_NODES, MAX_REPLICAS, MAX_SHARDS, SLOTS, TIERS, WIDE_SLOTS, WIRES, wireAdvice } from './rules';
import type { Board, BoardNode, ComponentDef, Lane, Role, ScenarioDef } from './types';

/**
 * The board's rules: which components may be placed, how many per lane, who
 * may call whom. The Arcade page checks a plan with these before Deploy, and
 * the engine checks every deployed board again, so a replayed run cannot hold
 * a board the page would not have allowed.
 */

const ID = /^[a-z][a-z0-9_]{0,15}$/;

export type NodeRole = Role | 'users' | 'external';

export function roleOf(node: BoardNode, components: ReadonlyMap<string, ComponentDef>, scenario: ScenarioDef): NodeRole | undefined {
  if (node.component === USERS) return 'users';
  if (scenario.externals.some((e) => e.id === node.component)) return 'external';
  return components.get(node.component)?.role;
}

export function laneOf(node: BoardNode, components: ReadonlyMap<string, ComponentDef>): Lane | undefined {
  return components.get(node.component)?.lane;
}

/** Whether `from` may call `to`, and if not, why. */
export function canWire(from: NodeRole, to: NodeRole): { ok: true } | { ok: false; reason: string } {
  if (to !== 'users' && WIRES[from].includes(to)) return { ok: true };
  return { ok: false, reason: wireAdvice(from, to) };
}

export interface BoardLimits {
  unlocked: ReadonlySet<string>;
  /** Total app replicas may not drop below this (Reserved instances). */
  reservedFloor?: number;
}

/** Problems with a board, empty when it can be deployed. */
export function boardProblems(board: Board, scenario: ScenarioDef, components: ReadonlyMap<string, ComponentDef>, limits: BoardLimits): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (board.nodes.length > MAX_NODES) problems.push(`At most ${MAX_NODES} nodes`);
  const slots = limits.unlocked.has('wide-lanes') ? WIDE_SLOTS : SLOTS;
  const perLane = new Map<Lane, number>();
  for (const n of board.nodes) {
    if (!ID.test(n.id) || n.id === WAN) problems.push(`Node id '${n.id}' must be lowercase letters, digits or _, up to 16, and not '${WAN}'`);
    if (ids.has(n.id)) problems.push(`Two nodes are called '${n.id}'`);
    ids.add(n.id);
    const role = roleOf(n, components, scenario);
    if (!role) {
      problems.push(`'${n.id}' is an unknown component '${n.component}'`);
      continue;
    }
    if (role === 'users' || role === 'external') continue;
    const c = components.get(n.component)!;
    if (c.unlock > 0 && !limits.unlocked.has(c.id)) problems.push(`${c.name} is not unlocked yet`);
    perLane.set(c.lane, (perLane.get(c.lane) ?? 0) + 1);
    if (!Number.isInteger(n.replicas) || n.replicas < 1 || n.replicas > MAX_REPLICAS) problems.push(`'${n.id}' needs 1 to ${MAX_REPLICAS} replicas`);
    const tier = n.tier ?? 0;
    if (!Number.isInteger(tier) || tier < 0 || tier >= TIERS.length) problems.push(`'${n.id}' has an unknown size`);
    else if (tier > 0 && !limits.unlocked.has('tiers')) problems.push('Instance sizes are not unlocked yet');
    else if (tier > 0 && !['app', 'worker', 'cache', 'db', 'search'].includes(c.role)) problems.push(`${c.name} comes in one size`);
    const shards = n.shards ?? 1;
    if (!Number.isInteger(shards) || shards < 1 || shards > MAX_SHARDS) problems.push(`'${n.id}' needs 1 to ${MAX_SHARDS} shards`);
    else if (shards > 1 && !limits.unlocked.has('shards')) problems.push('Sharding is not unlocked yet');
    else if (shards > 1 && c.role !== 'db') problems.push(`Only databases are sharded, not ${c.name}`);
    if (n.handles?.some((k) => !scenario.useCases[k])) problems.push(`'${n.id}' handles an unknown use case`);
    if (n.handles?.length && c.role !== 'app') problems.push(`Only app servers pick use cases, not ${c.name}`);
  }
  for (const [lane, count] of perLane) if (count > slots) problems.push(`The ${lane} lane holds ${slots} components`);

  // The scenario's fixed nodes stay.
  for (const fixed of scenario.start.board.nodes) {
    const r = roleOf(fixed, components, scenario);
    if ((r === 'users' || r === 'external') && !board.nodes.some((n) => n.id === fixed.id && n.component === fixed.component)) problems.push(`'${fixed.id}' is part of the scenario and stays on the board`);
  }

  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const [from, to] of board.edges) {
    const a = byId.get(from);
    const b = byId.get(to);
    if (!a || !b) {
      problems.push(`A wire ${from} → ${to} goes to a node that is not on the board`);
      continue;
    }
    if (from === to) problems.push(`'${from}' cannot call itself`);
    const key = `${from}>${to}`;
    if (seen.has(key)) problems.push(`Two wires ${from} → ${to}`);
    seen.add(key);
    const ra = roleOf(a, components, scenario);
    const rb = roleOf(b, components, scenario);
    if (ra && rb) {
      const w = canWire(ra, rb);
      if (!w.ok) problems.push(`${from} → ${to}: ${w.reason}`);
    }
  }

  if (limits.reservedFloor !== undefined) {
    const app = board.nodes.filter((n) => components.get(n.component)?.role === 'app').reduce((s, n) => s + n.replicas, 0);
    if (app < limits.reservedFloor) problems.push(`Reserved instances: keep at least ${limits.reservedFloor} app server replicas for now`);
  }
  return [...new Set(problems)];
}

/** A fresh id for a new node of `component`: `app`, `app2`, `app3`, … */
export function nextId(board: Board, component: string): string {
  const base = component.replace(/[^a-z0-9_]/g, '').slice(0, 12) || 'node';
  if (!board.nodes.some((n) => n.id === base)) return base;
  for (let i = 2; ; i++) if (!board.nodes.some((n) => n.id === `${base}${i}`)) return `${base}${i}`;
}

/** A deep copy, so the page can edit a plan without touching the deployed board. */
export const cloneBoard = (b: Board): Board => ({
  nodes: b.nodes.map((n) => ({ ...n, ...(n.handles ? { handles: [...n.handles] } : {}) })),
  edges: b.edges.map(([a, c]) => [a, c] as [string, string]),
});

/** A canonical form for comparing and hashing boards. */
export const boardKey = (b: Board): string =>
  JSON.stringify([
    b.nodes.map((n) => [n.id, n.component, n.replicas, n.tier ?? 0, n.shards ?? 1, n.handles ?? []]),
    b.edges,
  ]);
