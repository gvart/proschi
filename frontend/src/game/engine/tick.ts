import type { CapacityOverride, Diagram, Percentile, SourceLoc, TrafficEntry } from '../../dsl/types';
import { analyze, type Analysis } from '../../sim/analyze';
import { findScenario, findUseCase, pathNodes } from '../../sim/flow';
import { flowsOf } from '../../sim/overlay';
import { profileOf, type Profile } from '../../sim/profiles';
import { runTests } from '../../sim/tests';
import { BOTS, USERS, WAN, WAN_MS, type Compiled, type Situation } from './compile';
import { effects, type Effects } from './incidents';
import { targets, type Mods } from './mods';
import { MAX_REPLICAS, RATE_LIMIT_KEEP, STREAK_MAX, TICK_MINUTES, TICKS, TIERS, TRUST_PENALTY } from './rules';
import type { Game } from './run';
import { argmax, BREACH_LEARN, clamp, parseRequirements, type Breach, type BreachKind, type NodeTick, type TickResult, type UseCaseTick } from './state';
import type { Board } from './types';

/**
 * One tick of the simulation (docs/GAME.md, "How a tick is scored"): the
 * board compiled to a Proschi diagram with the tick's traffic, capacity and
 * requirements, analysed, then read back as what was served, the breaches,
 * the backlog, revenue, cost and points. The mode's mechanics add theirs
 * through their hooks (modes/mode.ts).
 */

const LOC: SourceLoc = { line: 0, col: 0, length: 0 };
const PROFILE_CACHE = new Map<string, Profile>();

function baseProfile(tech: string, make: () => Profile): Profile {
  let p = PROFILE_CACHE.get(tech);
  if (!p) {
    p = make();
    PROFILE_CACHE.set(tech, p);
  }
  return p;
}

/** One tick of `board` at `tick` of the current wave, from backlog `lagIn`; changes nothing. */
export function evaluate(game: Game, board: Board, tick: number, lagIn: Record<string, number>, quick: boolean): TickResult {
  const s = game.state;
  const mods = game.mods;
  const active = game.active(tick);
  const multipliers = game.multipliers();
  const peakTick = argmax(multipliers);
  const comp = (id: string) => game.index.components.get(board.nodes.find((n) => n.id === id)?.component ?? '');

  // What the incidents, the on-call and caches gone live take down this tick.
  const fx = effects(game, board, tick, mods, active, comp);
  const { down, writesDown, partialWrites, replicas, botsMult, shed } = fx;
  // What the mode's mechanics lock (a migration done in one go).
  for (const mech of game.mode.mechanics) for (const id of mech.writesDown?.(game, board, tick, comp) ?? []) writesDown.add(id);

  const situation: Situation = {
    down: [...down].sort(),
    writesDown: [...writesDown].sort(),
    global: s.global > 0,
    bots: botsMult > 0,
  };
  const compiled = game.compileFor(board, situation);

  // Traffic, then capacity: sizes, cards, incidents.
  const eff = game.effective();
  const { rps, traffic, sharesOf, botsRps } = trafficOf(game, multipliers[tick], fx, compiled, mods);
  const capacity = capacityOf(game, board, compiled, fx, mods);

  const reqLines = s.requirements.filter((l) => {
    const named = /"([^"]*)"/.exec(l)?.[1];
    if (named && !Object.values(compiled.routes).some((r) => r.name === named)) return false;
    if (named && [...shed].some((key) => game.scenario.useCases[key]?.name === named)) return false;
    if (/^\s*survive/.test(l) && (tick !== peakTick || quick)) return false;
    return true;
  });
  const requirements = parseRequirements(reqLines);
  const diagram: Diagram = { ...compiled.diagram, traffic, capacity, requirements };

  const percentiles = [...new Set<Percentile>([99, ...requirements.flatMap((r) => (r.kind === 'latency' ? [r.percentile] : []))])];
  const analyzeOptions = { replicas, percentiles, ...(mods.timeoutMs !== undefined ? { timeoutMs: mods.timeoutMs } : {}) };
  let analysis: Analysis = analyze(diagram, analyzeOptions);
  if (mods.autoscale) {
    let changed = false;
    for (const n of analysis.nodes) {
      const role = comp(n.id)?.role;
      if (role !== 'app' && role !== 'worker') continue;
      const planned = board.nodes.find((b) => b.id === n.id)!.replicas;
      const want = Math.min(MAX_REPLICAS * 3, Math.max(Math.ceil(planned / 2), Math.ceil((n.replicas * n.utilization) / 0.6)));
      if (want !== n.replicas) {
        replicas.set(n.id, want);
        changed = true;
      }
    }
    if (changed) analysis = analyze(diagram, analyzeOptions);
  }
  const nodeById = new Map(analysis.nodes.map((n) => [n.id, n]));
  const util = (id: string) => (down.has(id) ? Infinity : (nodeById.get(id)?.utilization ?? 0));
  const tests = quick ? [] : runTests(diagram, analysis, analyzeOptions);

  // What got served.
  const useCases: UseCaseTick[] = [];
  const breaches: Breach[] = [];
  const learnOf = (id: string) => comp(id)?.learn ?? [];
  for (const key of s.useCases) {
    const uc = eff.useCases[key];
    const r = rps.get(key) ?? 0;
    const route = compiled.routes[key];
    // A use case the mode's mechanics hold back (sunset, or waiting for a migration) gets no answer.
    if (game.mode.mechanics.some((mech) => mech.blocks?.(game, { key, useCase: uc, rps: r, breaches }))) {
      useCases.push({ key, name: uc.name, rps: r, served: 0, p99: 0, availability: 0, routed: false });
      continue;
    }
    if (!route) {
      useCases.push({ key, name: uc.name, rps: r, served: 0, p99: 0, availability: 0, routed: false });
      if (r > 0) {
        breaches.push({
          kind: 'unroutable',
          message: compiled.broken[key] ?? `"${uc.name}" cannot be served`,
          useCase: key,
          trust: uc.optional ? TRUST_PENALTY.unroutableOptional : TRUST_PENALTY.unroutable,
          learn: active.flatMap((a) => a.def.learn),
        });
      }
      continue;
    }
    const du = findUseCase(diagram, route.name)!;
    let served = 0;
    for (const { name, share } of sharesOf.get(key) ?? []) {
      if (share <= 0) continue;
      const sc = du.scenarios.length === 1 ? du.scenarios[0] : findScenario(du, name);
      if (!sc) continue;
      const through = pathNodes(du, sc).filter((id) => id !== WAN && board.nodes.find((n) => n.id === id)?.component !== USERS);
      served += share * through.reduce((p, id) => p * Math.min(1, 1 / util(id)), 1);
    }
    for (const [db, share] of partialWrites) {
      if (uc.steps.some((st, i) => st.op === 'write' && !(st.async && route.background) && route.targets[i] === db)) served *= 1 - share;
    }
    const ua = analysis.useCases.find((u) => u.id === du.id);
    useCases.push({ key, name: uc.name, rps: r, served, p99: ua?.percentiles.p99 ?? 0, availability: ua?.availability ?? 0, routed: true });
    if (uc.strong) {
      const weak = route.targets.find((t, i) => uc.steps[i].op !== 'call' && comp(t)?.role === 'db' && nodeById.get(t)?.consistency === 'eventual');
      if (weak && r > 0) {
        breaches.push({
          kind: 'consistency',
          message: `"${uc.name}" must read its latest writes, but ${weak} is eventually consistent: two people can buy the same seat.`,
          hint: 'Keep this use case on a strongly consistent store (a SQL database), and shard it if writes are the limit.',
          useCase: key,
          node: weak,
          trust: TRUST_PENALTY.consistency,
          learn: BREACH_LEARN.consistency,
        });
      }
    }
  }
  for (const mech of game.mode.mechanics) mech.afterServe?.(game, { board, tick, rps, useCases: eff.useCases, breaches });
  const total = useCases.reduce((a, u) => a + u.rps, 0);
  const dropped = useCases.filter((u) => u.routed).reduce((a, u) => a + u.rps * (1 - u.served), 0);
  const dropShare = total > 0 ? dropped / total : 0;
  if (dropShare >= 0.005) {
    const hot = analysis.nodes.filter((n) => n.saturated).sort((a, b) => b.utilization - a.utilization)[0];
    breaches.push({
      kind: 'drop',
      message: `${Math.round(dropShare * 1000) / 10}% of requests were dropped${
        hot ? `: ${hot.id} got ${Math.round(hot.utilization * 100)}% of what it can take` : partialWrites.size ? `: one shard of ${[...partialWrites.keys()].join(', ')} was failing over` : ''
      }.`,
      ...(hot ? { hint: `Scale ${hot.id} out, give it a bigger size, or take load off it.`, node: hot.id } : {}),
      trust: Math.min(TRUST_PENALTY.dropMax, Math.max(1, Math.floor((dropShare * 100) / 2)) * TRUST_PENALTY.drop),
      learn: [...(hot ? learnOf(hot.id) : []), ...BREACH_LEARN.drop],
    });
  }
  for (const t of tests) {
    if (t.passed) continue;
    const kind = (t.category === 'flow' ? 'latency' : t.category) as BreachKind;
    const hot = analysis.nodes.find((n) => n.saturated && t.message.includes(`${n.id} is saturated`));
    breaches.push({
      kind,
      message: t.message,
      ...(t.hint ? { hint: t.hint } : {}),
      ...(hot ? { node: hot.id } : {}),
      trust: TRUST_PENALTY[kind as keyof typeof TRUST_PENALTY] as number,
      learn: [...(hot ? learnOf(hot.id) : []), ...BREACH_LEARN[kind]],
    });
  }

  // Background backlog.
  const lag = backlogOf(game, compiled, diagram, lagIn, util, learnOf, breaches);
  for (const b of breaches) if (!b.learn.length) b.learn = active.flatMap((a) => a.def.learn);
  for (const a of active) for (const b of breaches) for (const l of a.def.learn) if (!b.learn.includes(l)) b.learn.push(l);

  const revenue = useCases.reduce((a, u) => a + (eff.useCases[u.key].value * u.rps * u.served) / 1000, 0) * s.revenueMultiplier / TICKS;
  const cost = analysis.totalCostUsd / TICKS + game.upkeep() / TICKS;
  const severe = breaches.some((b) => ['availability', 'drop', 'unroutable', 'consistency', 'durability', 'resilience', 'compat', 'migration'].includes(b.kind));
  const quality = breaches.length === 0 ? 1 : severe ? 0.4 : 0.6;
  const streak = breaches.length === 0 ? s.streak + 1 : 0;
  const streakMult = Math.min(STREAK_MAX, 1 + mods.streakStep * streak);
  const points = Math.round(revenue * quality * streakMult * (game.mutatorDef?.score ?? 1) * mods.setBonus);
  const trustDelta = -breaches.reduce((a, b) => a + b.trust, 0);

  const nodes: NodeTick[] = board.nodes
    .filter((n) => game.index.components.has(n.component) || game.scenario.externals.some((e) => e.id === n.component))
    .map((n) => {
      const a = nodeById.get(n.id);
      return {
        id: n.id,
        utilization: down.has(n.id) ? 0 : (a?.utilization ?? 0),
        loadRps: a?.loadRps ?? 0,
        capacityRps: a?.capacityRps ?? 0,
        replicas: down.has(n.id) ? 0 : (a?.replicas ?? n.replicas),
        saturated: !!a?.saturated,
        latencyMs: a?.latencyMs ?? 0,
        costUsd: a?.costUsd ?? 0,
        down: down.has(n.id),
      };
    });

  return {
    wave: s.wave,
    tick,
    useCases,
    nodes,
    flows: flowsOf(diagram, traffic),
    breaches,
    revenue,
    cost,
    points,
    trustDelta,
    streak,
    lag,
    events: active.map((a) => a.def.id),
    ...(compiled.bots ? { bots: { rps: botsRps, ...(compiled.bots.stoppedBy ? { stoppedBy: compiled.bots.stoppedBy } : {}) } } : {}),
    tests,
    source: compiled.source,
  };
}

/** The tick's traffic per use case (`rps`), as the diagram's traffic entries with each route's cache and edge mix. */
function trafficOf(game: Game, multiplier: number, fx: Effects, compiled: Compiled, mods: Mods) {
  const s = game.state;
  const { surge, limited, shed, targetMult, coldFactor, botsMult } = fx;
  const rps = new Map<string, number>();
  const surgeOf = (key: string) => {
    const uc = game.scenario.useCases[key];
    let m = surge.get(key) ?? 1;
    if (surge.has('write') && uc.steps.some((st) => st.op === 'write')) m *= surge.get('write')!;
    if (surge.has('async') && uc.steps.some((st) => st.async)) m *= surge.get('async')!;
    return m;
  };
  // The forecast is a guess: the wave as it runs has its real demand.
  const demand = s.phase === 'run' ? s.demand : 1;
  const keep = limited ? RATE_LIMIT_KEEP : 1;
  for (const key of s.useCases) rps.set(key, shed.has(key) ? 0 : game.baseRps(key) * multiplier * demand * keep * surgeOf(key) * (targetMult.get(key) ?? 1));
  const eff = game.effective();
  for (const j of eff.jobs) rps.set(j.key, j.rps);
  const legit = [...rps.values()].reduce((a, b) => a + b, 0);
  const traffic: TrafficEntry[] = [];
  const sharesOf = new Map<string, { name: string; share: number }[]>();
  for (const [key, route] of Object.entries(compiled.routes)) {
    const uc = eff.useCases[key];
    const hit = clamp((uc.cache ?? 0) + mods.cacheHit - game.rules.hitPenalty, 0, 0.98) * coldFactor;
    const edge = route.cdn ? clamp((uc.edge ?? 0) + mods.edgeHit - game.rules.hitPenalty, 0, 0.98) : 0;
    const far = s.global;
    const mix = route.scenarios.map((p) => {
      if (p.edge === 'hit') return { name: p.name, share: edge };
      const region = s.global > 0 ? (p.far ? far : 1 - far) : 1;
      const onlyDown = route.scenarios.every((q) => q.cache === 'down' || q.edge === 'hit');
      const cache = p.cache === 'none' ? 1 : p.cache === 'hit' ? hit : p.cache === 'miss' ? 1 - hit : onlyDown ? 1 : 0;
      return { name: p.name, share: (1 - edge) * region * cache };
    });
    sharesOf.set(key, mix);
    const r = rps.get(key) ?? 0;
    traffic.push({ useCase: route.name, rps: r, ...(mix.length > 1 ? { mix: mix.map((m) => ({ scenario: m.name, share: m.share })) } : {}), loc: LOC });
    if (route.background) {
      const bgRps = r * (1 - edge);
      const bgMix = route.background.scenarios.map((x) => ({ scenario: x.name, share: x.writes ? mods.writeShare : 1 - mods.writeShare }));
      traffic.push({ useCase: route.background.name, rps: bgRps, ...(bgMix.length > 1 ? { mix: bgMix } : {}), loc: LOC });
    }
  }
  const botsRps = botsMult * legit;
  if (compiled.bots) traffic.push({ useCase: BOTS, rps: botsRps, loc: LOC });

  return { rps, traffic, sharesOf, botsRps };
}

/** Capacity overrides of the diagram's nodes: sizes, cards, incidents. */
function capacityOf(game: Game, board: Board, compiled: Compiled, fx: Effects, mods: Mods): CapacityOverride[] {
  const { externalLatency, latencyMult, hotShare } = fx;
  const capacity: CapacityOverride[] = [];
  for (const dn of compiled.diagram.nodes) {
    if (dn.kind !== 'component') continue;
    if (dn.id === WAN) {
      capacity.push({ node: WAN, rps: 1e9, latencyMs: 0, availability: 100, costUsd: 0, timeoutMs: WAN_MS, loc: LOC });
      continue;
    }
    const node = board.nodes.find((n) => n.id === dn.id);
    if (!node || node.component === USERS) continue;
    const base = baseProfile(dn.techStack, () => profileOf(dn));
    const external = game.scenario.externals.find((e) => e.id === node.component);
    if (external) {
      const lat = externalLatency.get(external.id) ?? external.latencyMs;
      if (external.rps !== undefined || lat !== undefined) capacity.push({ node: dn.id, ...(external.rps !== undefined ? { rps: external.rps } : {}), ...(lat !== undefined ? { latencyMs: lat } : {}), loc: LOC });
      continue;
    }
    const c = game.index.components.get(node.component);
    const tier = TIERS[node.tier ?? 0] ?? TIERS[0];
    let reads = base.readRps * tier.capacity;
    let writes = base.writeRps * tier.capacity;
    let latency = base.latencyMs * (latencyMult.get(node.id) ?? 1);
    let cost = base.costUsd * tier.cost * game.rules.costMultiplier;
    for (const m of mods.capacity) {
      if (!targets(m.target, node, c)) continue;
      if (m.stat !== 'writes') reads *= m.mult;
      if (m.stat !== 'reads') writes *= m.mult;
    }
    for (const m of mods.latency) if (targets(m.target, node, c)) latency *= m.mult;
    for (const m of mods.cost) if (targets(m.target, node, c)) cost *= m.mult;
    if (hotShare > 0 && (c?.role === 'cache' || c?.role === 'db')) reads *= Math.max(0.2, 1 - hotShare);
    const shards = node.shards ?? 1;
    const changed = reads !== base.readRps || writes !== base.writeRps || latency !== base.latencyMs || cost !== base.costUsd || shards !== 1;
    if (changed) {
      capacity.push({
        node: dn.id,
        ...(base.readRps === base.writeRps && reads === writes ? { rps: reads } : { readRps: reads, writeRps: writes }),
        latencyMs: latency,
        costUsd: cost,
        ...(shards !== 1 ? { shards } : {}),
        loc: LOC,
      });
    }
  }

  return capacity;
}

/** Minutes of backlog per use case with background work, with a freshness breach where it is over its limit. */
function backlogOf(game: Game, compiled: Compiled, diagram: Diagram, lagIn: Record<string, number>, util: (id: string) => number, learnOf: (id: string) => string[], breaches: Breach[]): Record<string, number> {
  const s = game.state;
  const lag: Record<string, number> = {};
  for (const [key, route] of Object.entries(compiled.routes)) {
    if (!route.background) continue;
    const bg = route.background;
    const du = findUseCase(diagram, bg.name);
    const nodesOnPath = du ? [...new Set(du.scenarios.flatMap((sc) => sc.steps.map((st) => st.toServiceId)))] : [bg.worker];
    const u = bg.stalled ? Infinity : Math.max(0, ...nodesOnPath.map(util));
    const before = lagIn[key] ?? 0;
    lag[key] = Number.isFinite(u) ? Math.max(0, before + TICK_MINUTES * (u - 1)) : before + TICK_MINUTES;
    const f = s.freshness.find((x) => x.useCase === key);
    if (f && lag[key] > f.maxMinutes) {
      const worst = nodesOnPath.sort((a, b) => util(b) - util(a))[0];
      breaches.push({
        kind: 'freshness',
        message: `"${route.name}" work is ${Math.round(lag[key])} minutes behind (limit ${f.maxMinutes})${bg.stalled ? ': the worker cannot finish its jobs' : worst ? `: ${worst} is at ${Math.round(util(worst) * 100)}%` : ''}.`,
        hint: bg.stalled ? 'Keep the worker and what it writes to up: two replicas, or a store with a replica.' : `Add workers (or capacity to ${worst}) until it is under 100%, with room to drain the backlog.`,
        useCase: key,
        ...(worst ? { node: worst } : {}),
        trust: TRUST_PENALTY.freshness,
        learn: [...(worst ? learnOf(worst) : []), ...BREACH_LEARN.freshness],
      });
    }
  }
  return lag;
}
