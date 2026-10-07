import { targets, type Mods } from './mods';
import { stream, weighted } from './rng';
import { MAX_REPLICAS, ONCALL_ACTS, POOL_FROM_WAVE, SURPRISE_CHANCE, TICKS } from './rules';
import type { Game } from './run';
import { GameError, type EventInstance } from './state';
import { coldStart, mutatorEvents, surprises } from './twists';
import type { ActionOf } from './modes/mode';
import { CURVES, type Board, type ComponentDef, type EventDef } from './types';

/**
 * Incidents and the on-call (docs/GAME.md, "Incidents" and "On-call"): the
 * wave's incidents drawn from the seed, what they do to a tick, and the
 * hotfixes that answer them.
 */

/** The wave's incidents: its scripted ones, the mutator's, and draws from the scenario's pool. */
export function drawEvents(game: Game): EventInstance[] {
  const s = game.state;
  const w = game.waveDef();
  const n = s.wave + 1;
  const next = stream(game.setup.seed, `events:${s.wave}`);
  const out: EventInstance[] = [];
  const place = (def: EventDef): EventInstance => {
    const duration = Math.max(1, Math.min(TICKS, def.duration));
    const from = def.from ?? 2 + Math.floor(next() * Math.max(1, TICKS - duration));
    return { id: def.id, from: Math.min(from, TICKS - duration + 1), duration };
  };
  for (const id of w.events ?? []) {
    const def = game.index.events.get(id);
    if (def) out.push(place(def));
  }
  const roles = new Set(s.board.nodes.map((node) => game.index.components.get(node.component)?.role).filter(Boolean));
  mutatorEvents(game, n, roles, out, place);
  let extra = n >= POOL_FROM_WAVE ? 1 : 0;
  if (s.wave >= game.scenario.waves.length) extra++;
  if (game.rules.extraActIncident && (n === 3 || n === 7 || n === 11)) extra++;
  if (game.rules.bossIncident && w.boss) extra++;
  const previous = new Set(s.history[s.history.length - 1]?.events.map((e) => e.id) ?? []);
  for (let i = 0; i < extra; i++) {
    const eligible = game.scenario.eventPool.filter((p) => {
      const def = game.index.events.get(p.id);
      return (
        def &&
        def.minWave <= n &&
        def.requires.every((r) => roles.has(r)) &&
        (def.effect !== 'external-slow' || game.scenario.externals.length > 0) &&
        !previous.has(p.id) &&
        !(w.boss && def.category === 'spike') &&
        !out.some((e) => e.id === p.id)
      );
    });
    const at = weighted(next, eligible.map((p) => p.weight));
    if (at < 0) break;
    const inst = place(game.index.events.get(eligible[at].id)!);
    if (surprises(game) && stream(game.setup.seed, `surprise:${s.wave}:${i}`)() < SURPRISE_CHANCE) inst.surprise = true;
    out.push(inst);
  }
  return out;
}

/** The incidents under way at a tick (0-based), with how far into each it is. */
export function active(game: Game, tick: number): { def: EventDef; i: number }[] {
  return game.state.events
    .filter((e) => tick + 1 >= e.from && tick + 1 < e.from + e.duration)
    .map((e) => ({ def: game.index.events.get(e.id)!, i: tick + 1 - e.from }));
}

/** Traffic multiplier per tick: the curve, and spikes. */
export function multipliers(game: Game): number[] {
  const curve = CURVES[game.waveDef().curve ?? 'day'];
  return curve.map((m, t) => active(game, t).reduce<number>((x, { def }) => (def.effect === 'traffic' && !def.target ? x * (def.value ?? 1) : x), m));
}

/** A hotfix during the run, at the tick the core has reached. */
export function hotfix(game: Game, action: ActionOf<'oncall'>) {
  const s = game.state;
  const act = action.act ?? 'replica';
  const price = ONCALL_ACTS[act];
  if (!price) throw new GameError(`No hotfix '${act}'`);
  if (s.oncallLeft < price.attention) throw new GameError('No hotfixes left this wave');
  if (s.cash < price.cash) throw new GameError('Not enough cash for that hotfix');
  const m = s.mitigation;
  const nodeOf = () => {
    const node = s.board.nodes.find((n) => n.id === action.node);
    const c = node && game.index.components.get(node.component);
    if (!node || !c) throw new GameError(`No component '${action.node ?? ''}' on the board`);
    return { node, c };
  };
  switch (act) {
    case 'replica': {
      const { node } = nodeOf();
      if (node.replicas >= MAX_REPLICAS) throw new GameError(`'${node.id}' is at ${MAX_REPLICAS} replicas`);
      node.replicas++;
      // A change still provisioning keeps the replica the on-call added.
      const coming = s.rollout?.board.nodes.find((n) => n.id === node.id && n.component === node.component);
      if (coming && coming.replicas < MAX_REPLICAS) coming.replicas++;
      break;
    }
    case 'reboot': {
      const { node } = nodeOf();
      if (m.reboot[node.id] !== undefined) throw new GameError(`'${node.id}' was already brought back this wave`);
      m.reboot[node.id] = s.tick;
      break;
    }
    case 'warm':
      if (!s.board.nodes.some((n) => game.index.components.get(n.component)?.role === 'cache')) throw new GameError('There is no cache to warm');
      if (m.warm !== undefined) throw new GameError('The cache is already warm');
      m.warm = s.tick;
      break;
    case 'ratelimit':
      if (m.ratelimit !== undefined) throw new GameError('The rate limit is already on');
      m.ratelimit = s.tick;
      break;
    case 'shed': {
      const key = action.useCase ?? '';
      if (!s.useCases.includes(key) || s.sunset.includes(key)) throw new GameError(`No use case '${key}' to switch off`);
      if (m.shed[key] !== undefined) throw new GameError(`"${game.scenario.useCases[key].name}" is already off`);
      m.shed[key] = s.tick;
      break;
    }
  }
  s.cash -= price.cash;
  s.oncallLeft -= price.attention;
  s.trust = Math.max(0, s.trust - price.trust);
  s.paged++;
  if (s.trust <= 0) {
    game.summarize();
    game.end('churned');
  }
}

/** What the incidents, the on-call and the caches gone live mid-wave do to one tick of a board. */
export interface Effects {
  down: Set<string>;
  writesDown: Set<string>;
  /** Share of a sharded store's writes that fail (one shard failing over). */
  partialWrites: Map<string, number>;
  /** Replicas left where incidents took some. */
  replicas: Map<string, number>;
  latencyMult: Map<string, number>;
  coldFactor: number;
  hotShare: number;
  botsMult: number;
  externalLatency: Map<string, number>;
  surge: Map<string, number>;
  targetMult: Map<string, number>;
  /** The rate limit is on. */
  limited: boolean;
  /** Use cases switched off. */
  shed: Set<string>;
}

export function effects(game: Game, board: Board, tick: number, mods: Mods, incidents: { def: EventDef; i: number }[], comp: (id: string) => ComponentDef | undefined): Effects {
  const components = game.index.components;
  const down = new Set<string>();
  const writesDown = new Set<string>();
  const partialWrites = new Map<string, number>();
  const lost = new Map<string, number>();
  const latencyMult = new Map<string, number>();
  let coldFactor = 1;
  let hotShare = 0;
  let botsMult = 0;
  const externalLatency = new Map<string, number>();
  const surge = new Map<string, number>();
  const targetMult = new Map<string, number>();
  for (const { def, i } of incidents) {
    const matching = board.nodes.filter((n) => targets(def.target, n, components.get(n.component)) && components.has(n.component));
    switch (def.effect) {
      case 'traffic':
        if (def.target) targetMult.set(def.target, (targetMult.get(def.target) ?? 1) * (def.value ?? 1));
        break;
      case 'write-surge': {
        const t = def.target ?? 'write';
        surge.set(t, (surge.get(t) ?? 1) * (def.value ?? 1));
        break;
      }
      case 'bots':
        botsMult += def.value ?? 1;
        break;
      case 'az-down':
        for (const n of board.nodes) if (components.has(n.component)) lost.set(n.id, (lost.get(n.id) ?? 0) + Math.ceil(n.replicas / 3));
        break;
      case 'node-down':
        if (matching[0]) down.add(matching[0].id);
        break;
      case 'failover': {
        // Only a single-primary store has a primary to lose; a partitioned NoSQL store rides it out.
        const db = matching.find((n) => comp(n.id)?.role === 'db' && comp(n.id)?.tech !== 'NoSQL Database');
        if (!db) break;
        const shards = db.shards ?? 1;
        if (shards > 1) {
          // One shard's primary fails: only its share of the writes stops, and only while it fails over.
          if ((i === 0 && !mods.failover) || db.replicas < 2) partialWrites.set(db.id, Math.max(partialWrites.get(db.id) ?? 0, 1 / shards));
        } else if (db.replicas >= 2) {
          if (i === 0 && !mods.failover) writesDown.add(db.id);
          lost.set(db.id, (lost.get(db.id) ?? 0) + 1);
        } else down.add(db.id);
        break;
      }
      case 'cache-cold':
        if (!mods.coalesce) coldFactor *= def.values?.[Math.min(i, (def.values?.length ?? 1) - 1)] ?? 0;
        break;
      case 'latency':
        for (const n of matching) latencyMult.set(n.id, (latencyMult.get(n.id) ?? 1) * (def.value ?? 1));
        break;
      case 'hot-key':
        hotShare = Math.max(hotShare, (def.value ?? 0) * mods.hotKey);
        break;
      case 'external-slow':
        for (const e of game.scenario.externals) if (!def.target || def.target === e.id || def.target === 'any') externalLatency.set(e.id, def.value ?? 1000);
        break;
    }
  }
  if (mods.spot && incidents.length) for (const n of board.nodes) if (comp(n.id)?.role === 'worker') lost.set(n.id, (lost.get(n.id) ?? 0) + 1);
  // The on-call's actions, each from its tick on.
  const m = game.state.mitigation;
  const since = (t: number | undefined) => t !== undefined && tick >= t;
  for (const [id, t] of Object.entries(m.reboot)) {
    if (!since(t)) continue;
    down.delete(id);
    writesDown.delete(id);
    partialWrites.delete(id);
    lost.delete(id);
  }
  coldFactor = coldStart(game, board, tick, coldFactor);
  if (since(m.warm)) coldFactor = 1;
  const limited = since(m.ratelimit);
  if (limited) botsMult = 0;
  const shed = new Set(Object.entries(m.shed).filter(([, t]) => since(t)).map(([key]) => key));
  const replicas = new Map<string, number>();
  for (const n of board.nodes) {
    if (!components.has(n.component)) continue;
    const left = n.replicas - (lost.get(n.id) ?? 0);
    if (left <= 0) down.add(n.id);
    else if (left !== n.replicas) replicas.set(n.id, left);
  }
  return { down, writesDown, partialWrites, replicas, latencyMult, coldFactor, hotShare, botsMult, externalLatency, surge, targetMult, limited, shed };
}
