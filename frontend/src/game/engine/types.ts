/**
 * Scale or Fail: the types of the game's content (docs/GAME.md) and of a run.
 *
 * The engine is pure TypeScript with no browser or React dependency, like
 * src/learn: the Arcade page, the Worker (which replays every ranked run) and
 * the `proschi game` CLI all run the same code.
 */

import type { IconName } from './icons';

/** Where a component sits on the board, top to bottom on a phone. */
export const LANES = ['edge', 'compute', 'cache', 'data', 'async'] as const;
export type Lane = (typeof LANES)[number];

/** What a component is for the wiring rules and the use case router. */
export const ROLES = ['lb', 'waf', 'cdn', 'gateway', 'app', 'worker', 'cache', 'db', 'blob', 'search', 'warehouse', 'queue'] as const;
export type Role = (typeof ROLES)[number];

/** Store roles a use case step can read from or write to. */
export const STORES = ['db', 'blob', 'search', 'warehouse'] as const;
export type Store = (typeof STORES)[number];

/** A component players can place (components.json). */
export interface ComponentDef {
  id: string;
  name: string;
  /** The Proschi tech stack it compiles to: a generic catalog name, so the simulation's profile applies. */
  tech: string;
  role: Role;
  lane: Lane;
  /** Blueprints to unlock it; 0 means available from the first run. */
  unlock: number;
  /** Real products, shown in the tooltip ("e.g. Redis, Memcached"). */
  examples: string;
  /** One line: what it is for. */
  summary: string;
  /** What it costs you and how it fails, for the unlock intro. */
  tradeoff: string;
  /** Review cards about it (ids in frontend/src/practice/cards). */
  learn: string[];
  /** Ids of components that must be unlocked first. */
  requires?: string[];
}

/** A non-component unlock: instance sizes, shards, wider lanes (components.json `features`). */
export interface FeatureDef {
  id: 'tiers' | 'shards' | 'wide-lanes';
  name: string;
  unlock: number;
  summary: string;
  learn: string[];
}

/** A permanent perk bought with Blueprints (perks.json). Equipped perks are capped by slots. */
export interface PerkDef {
  id: string;
  name: string;
  /** A lucide icon name from GAME_ICONS, unique among perks. */
  icon: IconName;
  text: string;
  /** Blueprints for each level, in order. */
  costs: number[];
  effect: 'cash' | 'trust' | 'free-reroll' | 'starter-card' | 'loadtest' | 'oncall';
  /** Per level. */
  value: number;
}

/** `capacity { … }`-like numbers a card or event changes, as multipliers. */
export type Stat = 'rps' | 'reads' | 'writes';

export const CARD_EFFECTS = [
  'capacity',
  'latency',
  'cost',
  'cache-hit',
  'edge-hit',
  'timeout',
  'coalesce',
  'autoscale',
  'trust',
  'cash',
  'interest',
  'oncall',
  'loadtest',
  'write-batching',
  'payload',
  'hot-key',
  'failover',
  'reserved',
  'spot',
  'streak',
  'presigned',
] as const;
export type CardEffect = (typeof CARD_EFFECTS)[number];

export const RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** A tech card drafted between waves (cards/<id>.md). */
export interface CardDef {
  id: string;
  name: string;
  /** A lucide icon name from GAME_ICONS, unique among cards. */
  icon: IconName;
  rarity: Rarity;
  /** A tag from the review cards' tags.json. */
  topic: string;
  learn: string[];
  effect: CardEffect;
  /** A component id or role the effect applies to (`capacity`, `latency`, `cost`), else absent. */
  target?: string;
  stat?: Stat;
  value: number;
  /** Blueprints to add it to the draft pool; 0 means in the pool from the start. */
  unlock: number;
  /** Short rules text: what it does in the game. */
  text: string;
  /** Markdown: why this works in real systems. */
  why: string;
}

export const EVENT_EFFECTS = ['traffic', 'bots', 'az-down', 'node-down', 'failover', 'cache-cold', 'latency', 'hot-key', 'external-slow', 'write-surge'] as const;
export type EventEffect = (typeof EVENT_EFFECTS)[number];

/** An incident or a spike (events/<id>.md). */
export interface EventDef {
  id: string;
  title: string;
  /** A lucide icon name from GAME_ICONS, unique among events. */
  icon: IconName;
  category: 'incident' | 'spike';
  topic: string;
  learn: string[];
  effect: EventEffect;
  /** Component id, role or external id it hits, for the effects that need one. */
  target?: string;
  /** Multiplier (traffic, bots, latency, write-surge), share 0..1 (hot-key), latency in ms (external-slow). */
  value?: number;
  /** Per tick of the incident, for `cache-cold`: the share of the usual hit ratio. */
  values?: number[];
  /** Ticks it lasts. */
  duration: number;
  /** 1-based first tick; absent means the seed picks one. */
  from?: number;
  /** Shown in the forecast. */
  telegraph: string;
  /** Card ids that blunt it. */
  counters: string[];
  /** Component roles the board must have for the event to be drawn from a pool. */
  requires: Role[];
  minWave: number;
  whatHappened: string;
  why: string;
  senior: string;
}

/** One step a use case's handler performs, in order. */
export interface UseCaseStep {
  /** `read`, `write` (a store) or `call` (an external). */
  op: 'read' | 'write' | 'call';
  /** A store role for read and write, an external id for call. */
  to: string;
  /** Entity name for labels: "SELECT Url". */
  entity?: string;
  /** Can run after the response, through a queue and a worker. */
  async?: boolean;
  /** Fan-out: times per request. */
  x?: number;
  /** Payload, e.g. "2MB": transfer time and egress. */
  size?: string;
}

export interface UseCaseDef {
  name: string;
  method: string;
  path: string;
  status: number;
  /** Revenue per wave for every 1 000 rps that succeed. */
  value: number;
  /**
   * Payload of the request (POST, PUT) or the response (GET) between the user
   * and your edge, e.g. "2MB": it fills app server bandwidth, and a response
   * sent to users is billed as egress (cheaper from a CDN).
   */
  size?: string;
  steps: UseCaseStep[];
  /** Share of reads a cache answers when the handler is wired to one (0..1); absent means not cacheable. */
  cache?: number;
  /** Share a CDN in front answers (0..1); absent means not cacheable at the edge. */
  edge?: number;
  /** Reads must see the latest write: no cache, and only strongly consistent stores. */
  strong?: boolean;
  /** Not required: contracts and extras; its failure costs less Trust. */
  optional?: boolean;
  /**
   * An old API version that clients still call: once the version that
   * replaces it is live, it costs `upkeep` cash a wave until you sunset it,
   * and sunsetting it while it still has traffic breaks those clients.
   */
  legacy?: { upkeep: number; replacedBy: string };
}

/** How a scenario plays (docs/GAME.md). `scale` is Scale or Fail; the others are design-first, with tickets and no card draft. */
export const GAME_MODES = ['scale', 'startup', 'incident', 'legacy', 'cost'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const TICKET_SENDERS = ['pm', 'cto', 'customer', 'legal', 'finance', 'sre', 'marketing'] as const;
export type TicketSender = (typeof TICKET_SENDERS)[number];
export const TICKET_KINDS = ['feature', 'scale', 'compliance', 'mobile', 'region', 'api-version', 'schema', 'data-move', 'deprecation', 'security', 'cost', 'incident', 'reliability', 'analytics', 'performance'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

/** What lands in the inbox at the start of a wave: who asks for what; the text is `## Ticket: <id>` in scenario.md. */
export interface TicketDef {
  id: string;
  from: TicketSender;
  kind: TicketKind;
  title: string;
}

/**
 * A schema change done as expand and contract, one phase per wave: `expand`
 * (new columns, nullable), `dual-write` (writers write both shapes),
 * `backfill` (a background job rewrites the old rows), `cutover` (reads use
 * the new shape: the use cases that need it can be served) and `contract`
 * (the old shape is dropped). A `big-bang` jumps straight to the end and
 * locks the store's writes for two ticks.
 */
export const MIGRATION_PHASES = ['none', 'expand', 'dual-write', 'backfill', 'cutover', 'contract'] as const;
export type MigrationPhase = (typeof MIGRATION_PHASES)[number];

export interface MigrationDef {
  id: string;
  name: string;
  /** The table or entity, for messages: "Booking". */
  entity: string;
  /** The store role it changes (`db`). */
  store: string;
  /** Use cases that cannot be served until the cutover: they need the new shape. */
  needs: string[];
  /** Use cases that write the entity: from dual-write until the contract, their writes go to both shapes. */
  writers: string[];
  /** Use cases that read the old shape: once it is dropped, they break unless sunset. */
  oldReaders: string[];
  /** Writes a second of the backfill job while it runs (one wave). */
  backfillRps: number;
}

/** A traffic shape over a wave's 8 ticks. */
export const CURVES = {
  flat: [1, 1, 1, 1, 1, 1, 1, 1],
  day: [0.6, 0.8, 1, 1.2, 1.3, 1, 0.9, 0.8],
  ramp: [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4],
  spike: [1, 1, 1, 4, 4, 1.5, 1, 1],
  'double-peak': [0.8, 1.3, 0.9, 0.7, 0.9, 1.3, 1, 0.8],
} as const satisfies Record<string, readonly number[]>;
export type Curve = keyof typeof CURVES;

export interface Freshness {
  /** Use case key. */
  useCase: string;
  /** Background work may lag at most this many minutes. */
  maxMinutes: number;
}

/** On-call: what the player must work out before acting, from the ticket's alert and logs. */
export interface DiagnosisDef {
  question: string;
  options: { id: string; text: string; correct?: boolean; why: string }[];
}

export interface WaveDef {
  name?: string;
  /** What the mascot says first when the wave begins (a boss's intro); the rest of its briefing comes from the wave. */
  brief?: string;
  /** The ticket of this wave (design-first modes). */
  ticket?: TicketDef;
  /** A root cause to pick before deploying (on-call). */
  diagnosis?: DiagnosisDef;
  boss?: boolean;
  /** Base rps per use case key; the curve multiplies it. */
  traffic: Record<string, number>;
  curve?: Curve;
  /** Proschi requirement lines, e.g. `p99 "Redirect" < 50ms`; a line for the same use case and measure replaces an earlier one. */
  requirements?: string[];
  freshness?: Freshness[];
  /** Event ids that happen this wave, telegraphed. */
  events?: string[];
  /** After this wave, choose one of three contracts. */
  contract?: boolean;
  /** Share of users far from your region from this wave on (0..1). */
  global?: number;
  /** `## Debrief: <id>` section of scenario.md shown after the wave. */
  debrief?: string;
}

/** An optional use case offered between waves. */
export interface ContractDef {
  id: string;
  name: string;
  text: string;
  /** A use case key it adds, with its rps when accepted, growing each wave. */
  useCase?: string;
  rps?: number;
  growth?: number;
  requirements?: string[];
  freshness?: Freshness[];
  /** Cash paid at once (the "take the money" contract). */
  cash?: number;
  /** Revenue multiplier on every use case for the rest of the run, with the requirements as the price. */
  revenue?: number;
}

/** An external system the scenario gives you (an email provider): placed, wired, never removed. */
export interface ExternalDef {
  id: string;
  name: string;
  /** A catalog tech whose kind is `external`, e.g. SendGrid. */
  tech: string;
  rps?: number;
  latencyMs?: number;
}

export interface ScenarioDef {
  id: string;
  title: string;
  summary: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  /** Practice problem ids. */
  related: string[];
  /** Review card ids for the end-of-run report. */
  cards: string[];
  order: number;
  /** Bump when a change can change a score: it starts a new leaderboard season. */
  version: number;
  /** Prose sections of scenario.md by heading ("Briefing", "Act 1", "Debrief: db-read-ceiling", "Interview translation"). */
  sections: Record<string, string>;
  start: { cash: number; trust: number; board: Board };
  externals: ExternalDef[];
  useCases: Record<string, UseCaseDef>;
  waves: WaveDef[];
  eventPool: { id: string; weight: number }[];
  contracts: ContractDef[];
  /** How to unlock it; absent means available from the start. */
  unlock?: { scenario: string; wave: number };
  /** Components this scenario lends for its runs, unlocked or not: the ones its lesson is about. */
  grants: string[];
  /** How it plays; `scale` when absent. */
  mode: GameMode;
  migrations: MigrationDef[];
}

export interface GameContent {
  components: ComponentDef[];
  features: FeatureDef[];
  perks: PerkDef[];
  cards: CardDef[];
  events: EventDef[];
  scenarios: ScenarioDef[];
}

// ---- The board ----

export interface BoardNode {
  /** A Proschi id: lowercase letters, digits and `_`, starting with a letter. */
  id: string;
  /** A component id, `users`, or an external's id (for the scenario's fixed nodes). */
  component: string;
  replicas: number;
  /** Instance size: 0 = S, 1 = M (2× capacity), 2 = L (4×); needs the `tiers` unlock. */
  tier?: number;
  /** Partitions of a database; needs the `shards` unlock. */
  shards?: number;
  /** Use case keys an app server handles; absent or empty means all. */
  handles?: string[];
}

export interface Board {
  nodes: BoardNode[];
  /** `[from, to]` node ids. */
  edges: [string, string][];
}

// ---- A run ----

export type Mode = 'normal' | 'daily';

/** What a run starts from: replaying the same setup and actions gives the same score. */
export interface RunSetup {
  scenario: string;
  seed: string;
  ascension: number;
  mode: Mode;
  /** Unlocked components, features and cards; perks with their levels. Buffs count on the leaderboard. */
  loadout: Loadout;
}

export interface Loadout {
  unlocked: string[];
  /** Equipped perks and their levels. */
  perks: Record<string, number>;
}

/** What a player does; a run is its setup and the list of these. */
export type Action =
  | { t: 'deploy'; board: Board }
  /** Analyse a plan at the forecast peak before deploying it; costs cash unless free. */
  | { t: 'loadtest'; board: Board }
  /** During the run: one more replica on a node from tick `tick` on (0-based, the ticks already run). */
  | { t: 'oncall'; tick: number; node: string }
  /** Take one of the offered cards (index), or none for cash. */
  | { t: 'pick'; card: number | null }
  | { t: 'reroll' }
  /** Take one of the offered contracts (index), or none. */
  | { t: 'contract'; pick: number | null }
  /** Planning: move a migration one phase on, back, or all the way at once. */
  | { t: 'migrate'; id: string; to: 'next' | 'rollback' | 'big-bang' }
  /** Planning: name the root cause of the wave's incident (one of the diagnosis options). */
  | { t: 'diagnose'; pick: string }
  /** Planning: stop serving a legacy use case (an old API version). */
  | { t: 'sunset'; useCase: string }
  /** After the last wave: keep going (Endless) or bank the score. */
  | { t: 'endless' }
  | { t: 'retire' };

export type Phase = 'plan' | 'run' | 'draft' | 'contract' | 'cleared' | 'over';
