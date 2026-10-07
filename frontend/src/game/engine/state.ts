import { parse } from '../../dsl/parser';
import type { Requirement } from '../../dsl/types';
import type { TestResult } from '../../sim/tests';
import type { BountyDef, CardDef, ComponentDef, Curve, EventDef, Freshness, GameContent, MigrationPhase, MutatorDef, Phase, Action, Board, ScenarioDef, TicketDef } from './types';

/**
 * The state of a run of Scale or Fail and what it reports: the types the
 * engine, the page and the Worker share, and the helpers every module of the
 * engine uses (docs/GAME.md, "The engine").
 */

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

export const BREACH_KINDS = ['latency', 'availability', 'cost', 'durability', 'resilience', 'drop', 'unroutable', 'freshness', 'consistency', 'compat', 'migration'] as const;
export type BreachKind = (typeof BREACH_KINDS)[number];

export interface Breach {
  kind: BreachKind;
  message: string;
  hint?: string;
  useCase?: string;
  /** The node at fault, when one is. */
  node?: string;
  trust: number;
  /** Review card ids that explain it. */
  learn: string[];
}

export interface NodeTick {
  id: string;
  utilization: number;
  loadRps: number;
  capacityRps: number;
  replicas: number;
  saturated: boolean;
  latencyMs: number;
  costUsd: number;
  down: boolean;
}

export interface FlowTick {
  from: string;
  to: string;
  rps: number;
  async: boolean;
}

export interface UseCaseTick {
  key: string;
  name: string;
  rps: number;
  /** Share of requests that got an answer, 0..1. */
  served: number;
  p99: number;
  availability: number;
  routed: boolean;
}

export interface TickResult {
  wave: number;
  tick: number;
  useCases: UseCaseTick[];
  nodes: NodeTick[];
  flows: FlowTick[];
  breaches: Breach[];
  revenue: number;
  cost: number;
  points: number;
  trustDelta: number;
  streak: number;
  /** Minutes of backlog per use case with background work. */
  lag: Record<string, number>;
  /** Active event ids. */
  events: string[];
  bots?: { rps: number; stoppedBy?: string };
  /** The test results of this tick, for the debrief. */
  tests: TestResult[];
  /** Proschi source of the board as it ran (without traffic and capacity). */
  source: string;
}

export interface EventInstance {
  id: string;
  /** 1-based first tick. */
  from: number;
  duration: number;
  /** Not on the forecast: it strikes unannounced. */
  surprise?: boolean;
  /** Set off by another incident that broke something (a cascade). */
  chained?: boolean;
}

/** What the on-call did this wave, each from a tick (0-based) on. */
export interface Mitigation {
  /** Nodes brought back: incidents no longer take them down. */
  reboot: Record<string, number>;
  /** The cache warmed: no cold cache. */
  warm?: number;
  /** A rate limit at the edge. */
  ratelimit?: number;
  /** Use cases switched off. */
  shed: Record<string, number>;
}

export interface WaveSummary {
  wave: number;
  name?: string;
  boss: boolean;
  revenue: number;
  cost: number;
  interest: number;
  points: number;
  leanBonus: number;
  bossBonus: number;
  trustDelta: number;
  clean: boolean;
  /** Trust was left at the end of the wave. */
  survived: boolean;
  breaches: Breach[];
  /** The bottleneck of the wave: the most frequent breach, with its hint. */
  worst?: Breach;
  events: EventInstance[];
  debrief?: string;
  /** On-call: the root cause picked, and whether it was right. */
  diagnosis?: { pick: string; correct: boolean };
  /** The wave's bounty, whether it was met, and what it paid (a missed one costs cash). */
  bounty?: { id: string; met: boolean; cash: number; points: number };
  /** Cash back for a right-sized wave. */
  leanCash?: number;
  /** The real traffic over the forecast's (Scale or Fail): 1.1 is 10% more. */
  demand?: number;
}

export type Outcome = 'cleared' | 'retired' | 'churned' | 'bankrupt' | 'max';

export interface RunState {
  phase: Phase;
  /** 0-based. */
  wave: number;
  /** Ticks run this wave. */
  tick: number;
  cash: number;
  trust: number;
  maxTrust: number;
  score: number;
  streak: number;
  board: Board;
  hand: string[];
  offer: string[];
  rerolls: number;
  contractOffer: string[];
  contracts: string[];
  /** Active use case keys, and the wave a contract's started. */
  useCases: string[];
  contractStart: Record<string, number>;
  requirements: string[];
  freshness: Freshness[];
  global: number;
  revenueMultiplier: number;
  events: EventInstance[];
  lag: Record<string, number>;
  oncallLeft: number;
  loadtestsFree: number;
  reserved?: { floor: number; untilWave: number };
  ticks: TickResult[];
  history: WaveSummary[];
  endless: boolean;
  /** Got through every scripted wave. */
  cleared: boolean;
  outcome?: Outcome;
  /** Every action applied, in order: with the setup, the whole run. */
  log: Action[];
  /** Migrations by id (absent: not started). */
  migrations: Record<string, MigrationState>;
  /** Legacy use cases no longer served. */
  sunset: string[];
  /** Migrations done in one go this wave: the store's writes lock for two ticks. */
  bigBang: string[];
  /** On-call: the root cause picked this wave. */
  diagnosis?: { pick: string; correct: boolean };
  /** What changed since the last wave began, for the briefing. */
  news: WaveNews;
  /** Scale or Fail: the mutators offered before the first deploy (empty once one is picked, declined or the run deployed). */
  mutatorOffer: string[];
  /** The run's mutator. */
  mutator?: string;
  /** This wave's bounty, once taken. */
  bounty?: string;
  /** The bounties on offer this wave (Scale or Fail): take one before deploying, or none. */
  bountyOffer: string[];
  /** This wave's real traffic over the forecast's, hidden until it runs. */
  demand: number;
  /** The on-call's actions this wave. */
  mitigation: Mitigation;
  /** Hold the line: a change shipped during the run, and the tick (0-based) it goes live. */
  rollout?: { board: Board; at: number };
  /** Caches that went live during this wave's run, and the tick they did: they start cold. */
  warming: Record<string, number>;
  /** Changes shipped during this wave's run. */
  changes: number;
  /** On-call pages and load tests this wave, for the bounties that forbid them. */
  paged: number;
  tested: boolean;
}

/** What a wave brings since the one before: the mascot's briefing reads it. */
export interface WaveNews {
  /** Use cases live from this wave (from the traffic or a signed contract). */
  useCases: string[];
  /** Requirement lines added or tightened, as they apply (ascension included). */
  requirements: string[];
  /** Base traffic over the last wave's (1.6: 60% more); absent on the first wave. */
  growth?: number;
  /** Unannounced incidents begin this wave. */
  surprises?: boolean;
}

/** What the forecast panel shows before planning. */
export interface Forecast {
  wave: number;
  name?: string;
  boss: boolean;
  curve: Curve;
  /** Per tick, the traffic multiplier (curve and spikes). */
  multipliers: number[];
  peakTick: number;
  /** Peak rps per active use case, with the range the real peak falls in. */
  peak: { key: string; name: string; rps: number; low: number; high: number }[];
  /** The share the real traffic may differ by, either way (0 when the forecast is exact). */
  spread: number;
  /** Incidents may strike unannounced this wave. */
  surprises: boolean;
  requirements: string[];
  freshness: Freshness[];
  events: { id: string; title: string; telegraph: string; from?: number; duration: number }[];
  global: number;
  contract: boolean;
  /** The wave's ticket, with its text. */
  ticket?: TicketDef & { text: string };
  news: WaveNews;
  /** The run's mutator, once picked. */
  mutator?: MutatorDef;
  /** This wave's bounty, once taken, with the points it pays this act. */
  bounty?: BountyDef & { pays: { cash: number; points: number } };
  /** The bounties on offer, until one is taken. */
  bountyOffer: (BountyDef & { pays: { cash: number; points: number } })[];
}

/** Indexes of the content, built once per content object. */
export interface Index {
  components: Map<string, ComponentDef>;
  cards: Map<string, CardDef>;
  events: Map<string, EventDef>;
  scenarios: Map<string, ScenarioDef>;
}
const INDEXES = new WeakMap<GameContent, Index>();
export function indexOf(content: GameContent): Index {
  let i = INDEXES.get(content);
  if (!i) {
    i = {
      components: new Map(content.components.map((c) => [c.id, c])),
      cards: new Map(content.cards.map((c) => [c.id, c])),
      events: new Map(content.events.map((e) => [e.id, e])),
      scenarios: new Map(content.scenarios.map((s) => [s.id, s])),
    };
    INDEXES.set(content, i);
  }
  return i;
}

/** Requirement lines in force: a later line for the same use case and measure replaces an earlier one. */
export function mergeRequirements(current: readonly string[], added: readonly string[]): string[] {
  const out = [...current];
  for (const line of added) {
    const key = requirementKey(line);
    const at = out.findIndex((l) => requirementKey(l) === key);
    if (at >= 0) out[at] = line;
    else out.push(line);
  }
  return out;
}

function requirementKey(line: string): string {
  const t = line.trim();
  const uc = /"([^"]*)"/.exec(t)?.[1] ?? '';
  const head = /^(p\d+(?:\.\d+)?|availability|durable|survive|cost)/.exec(t)?.[1] ?? t;
  return `${head}:${uc}`;
}

const REQUIREMENTS_CACHE = new Map<string, Requirement[]>();
/** Parses requirement lines as Proschi; throws on a line the parser rejects. */
export function parseRequirements(lines: readonly string[]): Requirement[] {
  const key = lines.join('\n');
  const cached = REQUIREMENTS_CACHE.get(key);
  if (cached) return cached;
  const { diagram, diagnostics } = parse(`requirements {\n${lines.map((l) => `  ${l}`).join('\n')}\n}\n`);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new GameError(`Requirement does not parse: ${errors.map((e) => `${lines[e.line - 2] ?? ''}: ${e.message}`).join('; ')}`);
  const reqs = diagram.requirements ?? [];
  if (REQUIREMENTS_CACHE.size > 500) REQUIREMENTS_CACHE.clear();
  REQUIREMENTS_CACHE.set(key, reqs);
  return reqs;
}

export const BREACH_LEARN: Record<BreachKind, string[]> = {
  latency: ['servers-for-peak-load', 'littles-law-concurrency'],
  availability: ['availability-in-series', 'error-budget'],
  cost: ['egress-bill', 'storage-classes'],
  durability: ['durability-is-not-backup'],
  resilience: ['surviving-a-zone', 'correlated-failures'],
  drop: ['load-shedding', 'backpressure'],
  unroutable: [],
  freshness: ['backlog-drain-time', 'workers-needed'],
  consistency: ['when-eventual-is-fine', 'read-your-writes'],
  compat: ['breaking-change', 'evolving-mobile-apis'],
  migration: ['expand-contract-migration', 'online-backfill'],
};

/** How far each migration is, and the wave of its last step. */
export interface MigrationState {
  phase: MigrationPhase;
  wave: number;
}

export const LEARN_IDS: readonly string[] = [...new Set(Object.values(BREACH_LEARN).flat())];

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function argmax(xs: readonly number[]): number {
  let best = 0;
  xs.forEach((x, i) => {
    if (x > xs[best]) best = i;
  });
  return best;
}
