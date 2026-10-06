import { SIZES } from '../../sim/profiles';
import type { Role } from './types';

/**
 * The fixed rules of Scale or Fail (docs/GAME.md): numbers a scenario cannot
 * change. Changing any of them can change a score, so bump GAME_VERSION.
 */

/** Part of every leaderboard key: a new version starts new boards. */
export const GAME_VERSION = 3;

/** Samples of a wave (a month of traffic). */
export const TICKS = 8;
/** Waves of a run before Endless. */
export const WAVES = 12;
/** Endless stops here, so a replay always fits the Worker's CPU budget. */
export const MAX_WAVES = 24;
/** Endless traffic growth per wave after the last scripted wave. */
export const ENDLESS_GROWTH = 1.3;

export const MAX_REPLICAS = 12;
export const MAX_SHARDS = 8;
/** Components per lane; 6 with the `wide-lanes` unlock. */
export const SLOTS = 4;
export const WIDE_SLOTS = 6;
/** Externals, users and the components of every lane together. */
export const MAX_NODES = 40;

/** Instance sizes: S, M, L. A bigger box costs more per unit of capacity, and L is the ceiling (scale out after that). */
/** Instance sizes S, M, L: the language's `size` (sim/profiles.ts), in tier order. */
export const TIERS = (['S', 'M', 'L'] as const).map((name) => ({ name, ...SIZES[name] }));

/** A right diagnosis: Trust back (time to recover was short) and points. */
export const DIAGNOSIS_TRUST = 5;
export const DIAGNOSIS_POINTS = 400;

/** Trust (lives): a run ends at 0. */
export const MAX_TRUST = 100;
export const TRUST_PENALTY = {
  latency: 3,
  availability: 5,
  cost: 2,
  durability: 5,
  resilience: 5,
  /** Per 2% of requests dropped, at most `dropMax` a tick. */
  drop: 1,
  dropMax: 10,
  /** A use case with no route at all (a required one). */
  unroutable: 8,
  /** An optional use case (a contract) with no route. */
  unroutableOptional: 3,
  freshness: 2,
  consistency: 5,
  /** Clients of a version you no longer serve, or readers of a shape you dropped. */
  compat: 6,
  /** A migration that locked writes or lost rows. */
  migration: 6,
  /** Blaming the wrong cause: the fix goes the wrong way while users wait. */
  misdiagnosis: 10,
} as const;
export const TRUST_CLEAN_WAVE = 5;
export const TRUST_BOSS = 15;

/** Cash: interest on what you hold at the end of a wave, capped. */
export const INTEREST_RATE = 0.05;
export const INTEREST_CAP = 100;
/** Skipping a card pays this. */
export const SKIP_CARD_CASH = 100;
export const REROLL_COST = 150;
export const REROLL_STEP = 50;
export const LOADTEST_COST = 100;
/** Overtime for the on-call's extra replica. */
export const ONCALL_COST = 200;
/** On-call attention a wave: every on-call action spends some. */
export const ONCALL_PER_WAVE = 3;
/** What each on-call action costs: attention, cash, and Trust (users notice a rate limit or a feature switched off). */
export const ONCALL_ACTS = {
  replica: { attention: 1, cash: ONCALL_COST, trust: 0 },
  reboot: { attention: 1, cash: 100, trust: 0 },
  warm: { attention: 1, cash: 150, trust: 0 },
  ratelimit: { attention: 1, cash: 0, trust: 2 },
  shed: { attention: 1, cash: 0, trust: 3 },
} as const satisfies Record<string, { attention: number; cash: number; trust: number }>;
/** A rate limit keeps this share of real traffic and turns every bot away. */
export const RATE_LIMIT_KEEP = 0.85;

/**
 * Scale or Fail: a wave's real traffic is the forecast's within ± this share
 * (a boss's wider), drawn from the seed, so a load test at the forecast is a
 * guide and headroom is a choice.
 */
export const DEMAND_SPREAD = 0.12;
export const DEMAND_SPREAD_BOSS = 0.2;
/** Scale or Fail: from this wave, an incident drawn from the pool is unannounced with this chance. */
export const SURPRISE_FROM_WAVE = 5;
export const SURPRISE_CHANCE = 0.3;
/** A right-sized wave gets this share of its cloud bill back. */
export const LEAN_REFUND = 0.1;
/** Bounties on offer each wave (take one or none), and the share of a missed bounty's cash it costs. */
export const BOUNTY_OFFER = 3;
export const BOUNTY_FORFEIT = 0.25;
/** Cards of one topic that make a set, and the points each set adds (×1.1 for one). */
export const SET_SIZE = 3;
export const SET_BONUS = 0.1;
export const HAND_SIZE = 10;

/** Score: the uptime streak grows per clean tick and resets on any breach. */
export const STREAK_STEP = 0.1;
export const STREAK_MAX = 3;
/** Every deployed node between these utilisations at the wave's peak: the lean bonus. */
export const LEAN_MIN = 0.4;
export const LEAN_MAX = 0.75;
export const LEAN_BONUS = 0.15;
export const BOSS_BONUS = 500;
export const END_TRUST_POINTS = 10;
export const END_CASH_DIVISOR = 10;

/** Draft odds by rarity. */
export const RARITY_WEIGHTS = { common: 60, uncommon: 30, rare: 9, legendary: 1 } as const;
export const OFFER_SIZE = 3;
/** Mutators offered at the start of a Scale or Fail run. */
export const MUTATOR_OFFER = 3;
/** How much likelier a bounty made for the wave (its incident, its boss) is drawn than any other. */
export const BOUNTY_FITTED_WEIGHT = 4;

/** A seeded incident from the scenario's pool every wave from this one on. */
export const POOL_FROM_WAVE = 3;

/** Minutes of backlog a tick adds per unit of overload: a tick samples an hour at that load. */
export const TICK_MINUTES = 60;

/** Who may call whom: the wiring rules, by role (`users` and `external` are the scenario's fixed nodes). */
export const WIRES: Record<Role | 'users' | 'external', readonly (Role | 'external')[]> = {
  users: ['lb', 'waf', 'cdn', 'gateway', 'app'],
  lb: ['lb', 'waf', 'cdn', 'gateway', 'app'],
  waf: ['lb', 'waf', 'cdn', 'gateway', 'app'],
  cdn: ['lb', 'waf', 'gateway', 'app'],
  gateway: ['lb', 'waf', 'app'],
  app: ['cache', 'db', 'blob', 'search', 'warehouse', 'queue', 'external'],
  queue: ['worker'],
  worker: ['cache', 'db', 'blob', 'search', 'warehouse', 'external'],
  cache: [],
  db: [],
  blob: [],
  search: [],
  warehouse: [],
  external: [],
};

/** Why a wire is not allowed, for the board's explanation. */
export function wireAdvice(from: Role | 'users' | 'external', to: Role | 'external' | 'users'): string {
  if (to === 'users') return 'Users start requests; nothing calls them.';
  if (from === 'users' && ['db', 'cache', 'blob', 'search', 'warehouse', 'queue'].includes(to)) {
    return "Clients don't call data stores directly: there would be no auth, no API to change behind, and every client would hold a connection.";
  }
  if (from === 'users' && to === 'worker') return 'Workers take jobs from a queue, not requests from users.';
  if (to === 'worker') return 'A worker takes its jobs from a queue: wire a queue to it.';
  if (from === 'queue') return 'A queue only hands messages to workers.';
  if (['cache', 'db', 'blob', 'search', 'warehouse'].includes(from)) return 'Stores answer requests; they do not make them.';
  if (from === 'external') return 'An external system is called by your services, not the other way round.';
  if (['lb', 'waf', 'cdn', 'gateway'].includes(from)) return 'Edge components pass requests on to other edge components or app servers.';
  return 'App servers call caches, stores, queues and external systems.';
}

export interface AscensionLevel {
  level: number;
  text: string;
}

/** Difficulty levels: each adds its rule to every level below it. */
export const ASCENSIONS: AscensionLevel[] = [
  { level: 1, text: 'Incidents are announced without their exact tick.' },
  { level: 2, text: 'Traffic is 20% higher.' },
  { level: 3, text: 'You start with 25% less cash.' },
  { level: 4, text: 'Latency limits are 20% tighter.' },
  { level: 5, text: 'One more incident in each act.' },
  { level: 6, text: 'One perk slot fewer.' },
  { level: 7, text: 'Caches and CDNs hit 5 points less often.' },
  { level: 8, text: 'Trust starts at 70.' },
  { level: 9, text: 'Cloud prices are 20% higher.' },
  { level: 10, text: 'Bosses bring one more incident.' },
];
export const MAX_ASCENSION = ASCENSIONS.length;

/** The rules in force at `level`. */
export function ascensionRules(level: number) {
  const at = (n: number) => level >= n;
  return {
    hiddenTicks: at(1),
    trafficMultiplier: at(2) ? 1.2 : 1,
    cashMultiplier: at(3) ? 0.75 : 1,
    latencyMultiplier: at(4) ? 0.8 : 1,
    extraActIncident: at(5),
    perkSlots: at(6) ? 2 : 3,
    hitPenalty: at(7) ? 0.05 : 0,
    startTrust: at(8) ? 70 : undefined,
    costMultiplier: at(9) ? 1.2 : 1,
    bossIncident: at(10),
  };
}

/** Perk slots at A0. */
export const PERK_SLOTS = 3;

/** Blueprints a run earns. */
export const BLUEPRINTS = {
  perWave: 1,
  perBoss: 3,
  firstClear: 5,
  /** One per this many points, up to `scoreMax`. */
  scoreStep: 2500,
  scoreMax: 10,
} as const;
