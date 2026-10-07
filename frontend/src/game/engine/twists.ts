import { cloneBoard } from './board';
import type { Mods } from './mods';
import type { ModeRules } from './modes';
import { shuffled, stream, weighted } from './rng';
import {
  BOUNTY_FITTED_WEIGHT,
  BOUNTY_FORFEIT,
  BOUNTY_OFFER,
  COLD_START,
  DEMAND_SPREAD,
  DEMAND_SPREAD_BOSS,
  LIVE_BUILD_TICKS,
  LIVE_CHANGES_PER_WAVE,
  LIVE_SCALE_TICKS,
  MUTATOR_OFFER,
  SURPRISE_FROM_WAVE,
  TICKS,
} from './rules';
import type { Game } from './run';
import { argmax, GameError, mergeRequirements, type EventInstance, type TickResult, type WaveSummary } from './state';
import type { ActionOf } from './modes/mode';
import type { Board, BountyDef, EventDef, GameContent, MutatorDef, RunSetup, ScenarioDef } from './types';

/**
 * The twists of Scale or Fail (docs/GAME.md, "Twists"): what a run adds once
 * the player has cleared a scenario (`RunSetup.twists`). Mutators, the
 * forecast range and unannounced incidents, bounties, contracts, cascades,
 * card sets and live changes, each a few functions the core (run.ts) calls.
 */

// ---- Mutators ----

/** The mutators a Scale or Fail run of `scenario` can be offered. */
export const mutatorsFor = (content: GameContent, scenario: string): MutatorDef[] => content.mutators.filter((m) => !m.excludes?.includes(scenario));

/** The mutators offered before the first deploy: none outside Scale or Fail or under the basic rules. */
export function mutatorOffer(content: GameContent, scenario: ScenarioDef, setup: RunSetup, mode: ModeRules): string[] {
  return mode.twists && setup.twists !== false ? shuffled(stream(setup.seed, 'mutators'), mutatorsFor(content, scenario.id)).slice(0, MUTATOR_OFFER).map((m) => m.id) : [];
}

/** The run's mutator, once picked. */
export function mutatorDef(game: Game): MutatorDef | undefined {
  return game.state.mutator ? game.content.mutators.find((m) => m.id === game.state.mutator) : undefined;
}

export function pickMutator(game: Game, action: ActionOf<'mutator'>) {
  const s = game.state;
  game.expect('plan');
  if (!s.mutatorOffer.length) throw new GameError('No mutator on offer: one is picked before the first deploy');
  if (action.pick !== null) {
    const def = game.content.mutators.find((m) => m.id === s.mutatorOffer[action.pick!]);
    if (!def) throw new GameError('No such mutator on offer');
    s.mutator = def.id;
    if (def.cash) s.cash = Math.round(s.cash * def.cash);
    if (def.global) s.global = Math.max(s.global, def.global);
    // The briefing compares next wave's traffic with this one's as the mutator shapes it.
    if (game.briefed) game.briefed.traffic = s.useCases.reduce((t, key) => t + game.baseRps(key), 0);
  }
  s.mutatorOffer = [];
}

/** The twists' part of the run's modifiers: card sets (none under the basic rules) and the mutator's costs and interest. */
export function twistMods(game: Game, m: Mods): Mods {
  if (!game.twists) {
    m.sets = [];
    m.setBonus = 1;
  }
  const mu = mutatorDef(game);
  if (mu) {
    for (const c of mu.cost ?? []) m.cost.push({ target: c.target, mult: c.mult });
    if (mu.interest) m.interestCap = Math.round(m.interestCap * mu.interest);
  }
  return m;
}

/** Adds the mutator's own incidents on wave `n` (1-based) that the roles on the board allow. */
export function mutatorEvents(game: Game, n: number, roles: Set<unknown>, out: EventInstance[], place: (def: EventDef) => EventInstance) {
  for (const e of mutatorDef(game)?.events ?? []) {
    const def = game.index.events.get(e.id);
    if (def && e.waves.includes(n) && !out.some((x) => x.id === def.id) && def.requires.every((r) => roles.has(r))) out.push(place(def));
  }
}

/** The mutator's read or write traffic multiplier for a use case. */
export function trafficMix(game: Game, key: string): number {
  const t = mutatorDef(game)?.traffic;
  return t ? ((game.scenario.useCases[key]?.method === 'GET' ? t.read : t.write) ?? 1) : 1;
}

// ---- The forecast range and unannounced incidents ----

/** The share a Scale or Fail wave's real traffic may differ from the forecast by; 0 in the design-first modes and the basic rules. */
export function spread(game: Game): number {
  if (!game.mode.twists || !game.twists) return 0;
  return game.waveDef().boss ? DEMAND_SPREAD_BOSS : DEMAND_SPREAD;
}

/** Whether an incident may come unannounced this wave. */
export function surprises(game: Game): boolean {
  return game.mode.twists && game.twists && game.state.wave + 1 >= SURPRISE_FROM_WAVE;
}

/** This wave's real traffic over the forecast's, drawn from the seed. */
export function demand(game: Game): number {
  const sp = spread(game);
  return sp ? 1 + sp * (2 * stream(game.setup.seed, `demand:${game.state.wave}`)() - 1) : 1;
}

// ---- Bounties ----

/** A bounty's pay on the current wave: its cash, and its points times the act. */
export function pays(game: Game, b: BountyDef): { cash: number; points: number } {
  return { cash: b.cash, points: b.points * Math.min(3, Math.ceil((game.state.wave + 1) / 4)) };
}

const bountyOf = (game: Game, id: string | undefined) => (id ? game.content.bounties.find((b) => b.id === id) : undefined);

/** The forecast's bounties: the one taken, or those on offer. */
export function bountyForecast(game: Game) {
  const s = game.state;
  const b = bountyOf(game, s.bounty);
  return {
    ...(b ? { bounty: { ...b, pays: pays(game, b) } } : {}),
    bountyOffer: s.bounty ? [] : s.bountyOffer.map((id) => game.content.bounties.find((x) => x.id === id)!).filter(Boolean).map((x) => ({ ...x, pays: pays(game, x) })),
  };
}

/** Scale or Fail: the wave's bounties on offer, drawn from those that fit it (its announced incidents, its boss), never the last wave's. */
export function drawBounties(game: Game): string[] {
  const s = game.state;
  if (!game.mode.twists || !game.twists) return [];
  const w = game.waveDef();
  const effects = new Set(s.events.filter((e) => !e.surprise).map((e) => game.index.events.get(e.id)?.effect));
  const last = s.history[s.history.length - 1]?.bounty?.id;
  let eligible = game.content.bounties.filter((b) => b.id !== last && (!b.boss || !!w.boss) && (!b.event || effects.has(b.event)));
  const next = stream(game.setup.seed, `bounty:${s.wave}`);
  const out: string[] = [];
  while (out.length < BOUNTY_OFFER) {
    // A bounty made for this wave is the likelier draw.
    const at = weighted(next, eligible.map((b) => (b.event || b.boss ? BOUNTY_FITTED_WEIGHT : 1)));
    if (at < 0) break;
    out.push(eligible[at].id);
    eligible = eligible.filter((_, i) => i !== at);
  }
  return out;
}

export function takeBounty(game: Game, action: ActionOf<'bounty'>) {
  const s = game.state;
  game.expect('plan');
  if (s.bounty) throw new GameError('You already took a bounty this wave');
  const id = s.bountyOffer[action.pick];
  if (id === undefined) throw new GameError('No such bounty on offer');
  s.bounty = id;
  s.bountyOffer = [];
}

/** Whether the wave just run met its bounty. */
function bountyMet(game: Game, b: BountyDef, summary: WaveSummary): boolean {
  const s = game.state;
  if (!summary.survived) return false;
  switch (b.kind) {
    case 'max-utilization': {
      const peak = s.ticks[argmax(game.multipliers())];
      const of = peak?.nodes.filter((n) => {
        const node = s.board.nodes.find((x) => x.id === n.id);
        return node && game.index.components.get(node.component)?.role === b.role;
      });
      return !!of?.length && of.every((n) => !n.down && n.utilization <= (b.value ?? 1));
    }
    case 'budget':
      return summary.revenue > 0 && summary.cost <= (b.value ?? 0) * summary.revenue;
    case 'clean':
      return summary.clean;
    case 'no-breach':
      return !summary.breaches.some((x) => x.kind === b.breach);
    case 'right-sized':
      return summary.leanBonus > 0;
    case 'no-oncall':
      return summary.clean && s.paged === 0;
    case 'no-loadtest':
      return summary.clean && !s.tested;
  }
}

/** Pays the wave's bounty if it was met; a bounty taken and missed costs part of what it would have paid. */
export function settleBounty(game: Game, summary: WaveSummary) {
  const s = game.state;
  const bounty = bountyOf(game, s.bounty);
  if (!bounty) return;
  const met = bountyMet(game, bounty, summary);
  const pay = met ? pays(game, bounty) : { cash: -Math.round(bounty.cash * BOUNTY_FORFEIT), points: 0 };
  summary.bounty = { id: bounty.id, met, ...pay };
  s.cash += pay.cash;
  s.score += pay.points;
}

// ---- Contracts ----

/** After the draft of a contract wave: three contracts not signed yet; false when there is none to offer. */
export function offerContracts(game: Game): boolean {
  const s = game.state;
  const w = game.waveDef();
  if (!w.contract || s.endless || !game.twists) return false;
  const open = game.scenario.contracts.filter((c) => !s.contracts.includes(c.id));
  s.contractOffer = shuffled(stream(game.setup.seed, `contracts:${s.wave}`), open)
    .slice(0, 3)
    .map((c) => c.id);
  return s.contractOffer.length > 0;
}

/** Signs the contract picked (or none). */
export function signContract(game: Game, action: ActionOf<'contract'>) {
  const s = game.state;
  game.expect('contract');
  if (action.pick !== null) {
    const id = s.contractOffer[action.pick];
    const def = game.scenario.contracts.find((c) => c.id === id);
    if (!def) throw new GameError('No such contract on offer');
    s.contracts.push(def.id);
    if (def.cash) s.cash += def.cash;
    if (def.revenue) s.revenueMultiplier *= def.revenue;
    if (def.useCase && !s.useCases.includes(def.useCase)) {
      s.useCases.push(def.useCase);
      s.contractStart[def.useCase] = s.wave + 1;
    }
    if (def.requirements) s.requirements = mergeRequirements(s.requirements, def.requirements.map((l) => game.harder(l)));
    for (const f of def.freshness ?? []) s.freshness = [...s.freshness.filter((x) => x.useCase !== f.useCase), f];
  }
  s.contractOffer = [];
}

/** Base rps of a use case a contract added, growing each wave since it was signed. */
export function contractRps(game: Game, key: string): number {
  const c = game.scenario.contracts.find((x) => x.useCase === key);
  const start = game.state.contractStart[key] ?? game.state.wave;
  return c?.rps ? c.rps * (c.growth ?? 1.4) ** Math.max(0, game.state.wave - start) : 0;
}

// ---- Cascades ----

/** Breaches bad enough to set off an incident's `then`. */
const CASCADE_BREACHES: readonly string[] = ['drop', 'availability', 'unroutable', 'resilience'];

/** An incident that broke something badly and has a `then` sets that one off the tick after it ends, unannounced. */
export function cascade(game: Game, r: TickResult) {
  const s = game.state;
  // Only what users felt hard (a dropped or failed request), and one cascade a wave.
  if (!game.twists || !r.breaches.some((b) => CASCADE_BREACHES.includes(b.kind)) || s.events.some((e) => e.chained)) return;
  for (const { def, i } of game.active(s.tick)) {
    const inst = s.events.find((e) => e.id === def.id);
    if (!def.then || !inst || i !== inst.duration - 1) continue;
    const next = game.index.events.get(def.then);
    const from = s.tick + 2;
    if (!next || from > TICKS || s.events.some((e) => e.id === next.id)) continue;
    const roles = new Set(s.board.nodes.map((n) => game.index.components.get(n.component)?.role));
    if (!next.requires.every((x) => roles.has(x))) continue;
    s.events.push({ id: next.id, from, duration: Math.min(next.duration, TICKS - from + 1), surprise: true, chained: true });
  }
}

// ---- Live changes (hold the line) ----

export function shipChange(game: Game, action: ActionOf<'change'>) {
  const s = game.state;
  if (!game.twists) throw new GameError('Live changes open after your first clear: deploy the board for the whole wave');
  if (s.changes >= LIVE_CHANGES_PER_WAVE) throw new GameError(`At most ${LIVE_CHANGES_PER_WAVE} live changes a wave`);
  game.checkBoard(action.board);
  const delay = provisioning(game, action.board);
  if (delay === undefined) throw new GameError('Nothing to ship: the board is the same');
  s.rollout = { board: cloneBoard(action.board), at: s.tick + delay };
  s.changes++;
}

/**
 * How many ticks a live change takes to provision: none when nothing
 * changed, longer when it adds components or wires than when it scales.
 */
export function provisioning(game: Game, board: Board): number | undefined {
  const s = game.state;
  const now = s.rollout?.board ?? s.board;
  const key = (n: { id: string; component: string }) => `${n.id}:${n.component}`;
  const before = new Map(now.nodes.map((n) => [key(n), n]));
  const wires = (b: Board) => b.edges.map((e) => e.join('>')).sort().join(',');
  const added = board.nodes.some((n) => !before.has(key(n)));
  if (added || wires(board) !== wires(now)) return LIVE_BUILD_TICKS;
  const removed = now.nodes.length !== board.nodes.length;
  const scaled = board.nodes.some((n) => {
    const b = before.get(key(n))!;
    return n.replicas !== b.replicas || (n.tier ?? 0) !== (b.tier ?? 0) || (n.shards ?? 1) !== (b.shards ?? 1) || (n.handles ?? []).join() !== (b.handles ?? []).join();
  });
  return removed || scaled ? LIVE_SCALE_TICKS : undefined;
}

/** A live change whose tick has come replaces the board; the caches it adds start cold. */
export function land(game: Game, force = false) {
  const s = game.state;
  const r = s.rollout;
  if (!r || (!force && s.tick < r.at)) return;
  for (const n of r.board.nodes) {
    const fresh = !s.board.nodes.some((b) => b.id === n.id && b.component === n.component);
    if (fresh && game.index.components.get(n.component)?.role === 'cache') s.warming[n.id] = s.tick;
  }
  s.board = r.board;
  delete s.rollout;
}

/** `coldFactor` with the caches that went live mid-wave, which start empty. */
export function coldStart(game: Game, board: Board, tick: number, coldFactor: number): number {
  for (const [id, t] of Object.entries(game.state.warming)) {
    const i = tick - t;
    if (i >= 0 && i < COLD_START.length && board.nodes.some((n) => n.id === id)) coldFactor *= COLD_START[i];
  }
  return coldFactor;
}
