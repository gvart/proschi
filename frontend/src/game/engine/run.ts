import { parse } from '../../dsl/parser';
import type { CapacityOverride, Diagram, Percentile, Requirement, SourceLoc, TrafficEntry } from '../../dsl/types';
import { analyze, type Analysis } from '../../sim/analyze';
import { findScenario, findUseCase, pathNodes } from '../../sim/flow';
import { flowsOf } from '../../sim/overlay';
import { profileOf, type Profile } from '../../sim/profiles';
import { runTests, type TestResult } from '../../sim/tests';
import { boardKey, boardProblems, cloneBoard } from './board';
import { BACKFILL_PREFIX, BOTS, compile, USERS, WAN, WAN_MS, type Compiled, type Situation } from './compile';
import { computeMods, targets, type Mods } from './mods';
import { shuffled, stream, weighted } from './rng';
import {
  ascensionRules,
  BLUEPRINTS,
  BOSS_BONUS,
  END_CASH_DIVISOR,
  END_TRUST_POINTS,
  ENDLESS_GROWTH,
  HAND_SIZE,
  INTEREST_CAP,
  INTEREST_RATE,
  LEAN_BONUS,
  LEAN_MAX,
  LEAN_MIN,
  LOADTEST_COST,
  MAX_REPLICAS,
  MAX_TRUST,
  MAX_WAVES,
  OFFER_SIZE,
  ONCALL_COST,
  ONCALL_PER_WAVE,
  POOL_FROM_WAVE,
  RARITY_WEIGHTS,
  REROLL_COST,
  REROLL_STEP,
  SKIP_CARD_CASH,
  STREAK_MAX,
  STREAK_STEP,
  TICK_MINUTES,
  TICKS,
  TIERS,
  TRUST_BOSS,
  TRUST_CLEAN_WAVE,
  TRUST_PENALTY,
  DIAGNOSIS_POINTS,
  DIAGNOSIS_TRUST,
  MUTATOR_OFFER,
  BOUNTY_FITTED_WEIGHT,
} from './rules';
import {
  CURVES,
  MIGRATION_PHASES,
  type Action,
  type BountyDef,
  type MutatorDef,
  type MigrationDef,
  type MigrationPhase,
  type TicketDef,
  type UseCaseDef,
  type Board,
  type CardDef,
  type CodeLevel,
  type ComponentDef,
  type ContractDef,
  type Curve,
  type EventDef,
  type Freshness,
  type GameContent,
  type Phase,
  type RunSetup,
  type ScenarioDef,
  type WaveDef,
} from './types';

/**
 * A run of Scale or Fail as a deterministic state machine: `new Game(content,
 * setup)`, then `apply(action)` for every decision and `advance()` for every
 * tick. The same setup and actions always give the same state, which is how
 * the Worker checks a submitted score (`replay`).
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
  /** The wave's bounty, whether it was met, and what it paid. */
  bounty?: { id: string; met: boolean; cash: number; points: number };
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
  /** This wave's bounty. */
  bounty?: string;
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
}

/** The mutators a Scale or Fail run of `scenario` can be offered. */
export const mutatorsFor = (content: GameContent, scenario: string): MutatorDef[] => content.mutators.filter((m) => !m.excludes?.includes(scenario));

/** What the forecast panel shows before planning. */
export interface Forecast {
  wave: number;
  name?: string;
  boss: boolean;
  curve: Curve;
  /** Per tick, the traffic multiplier (curve and spikes). */
  multipliers: number[];
  peakTick: number;
  /** Peak rps per active use case. */
  peak: { key: string; name: string; rps: number }[];
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
  /** This wave's bounty, with the points it pays this act. */
  bounty?: BountyDef & { pays: { cash: number; points: number } };
}

const LOC: SourceLoc = { line: 0, col: 0, length: 0 };
const PROFILE_CACHE = new Map<string, Profile>();

/** Indexes of the content, built once per content object. */
interface Index {
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

const BREACH_LEARN: Record<BreachKind, string[]> = {
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

const phaseIndex = (p: MigrationPhase) => MIGRATION_PHASES.indexOf(p);
/** The background job's use case key while a migration backfills. */
export const backfillKey = (id: string) => `${BACKFILL_PREFIX}${id}`;
export const LEARN_IDS: readonly string[] = [...new Set(Object.values(BREACH_LEARN).flat())];

export class Game {
  readonly content: GameContent;
  readonly setup: RunSetup;
  readonly scenario: ScenarioDef;
  readonly state: RunState;
  private readonly index: Index;
  private readonly rules: ReturnType<typeof ascensionRules>;
  private compiled = new Map<string, Compiled>();
  private effectiveCache?: { key: string; value: ReturnType<Game['effective']> };
  /** The use cases, requirements and base traffic when the last wave began, to tell what is new. */
  private briefed?: { useCases: string[]; requirements: string[]; traffic: number };

  constructor(content: GameContent, setup: RunSetup) {
    this.content = content;
    this.setup = setup;
    this.index = indexOf(content);
    const scenario = this.index.scenarios.get(setup.scenario);
    if (!scenario) throw new GameError(`Unknown scenario '${setup.scenario}'`);
    this.scenario = scenario;
    if (!Number.isInteger(setup.ascension) || setup.ascension < 0 || setup.ascension > 10) throw new GameError('Ascension is 0 to 10');
    this.rules = ascensionRules(setup.ascension);
    const perks = this.perks();
    if (perks.length > this.rules.perkSlots) throw new GameError(`At most ${this.rules.perkSlots} perks`);
    const perkValue = (effect: string) => perks.filter((p) => p.def.effect === effect).reduce((s, p) => s + p.def.value * p.level, 0);
    const trust = (this.rules.startTrust ?? scenario.start.trust) + perkValue('trust');
    this.state = {
      phase: 'plan',
      wave: 0,
      tick: 0,
      cash: Math.round(scenario.start.cash * this.rules.cashMultiplier) + perkValue('cash'),
      trust,
      maxTrust: MAX_TRUST + perkValue('trust'),
      score: 0,
      streak: 0,
      board: cloneBoard(scenario.start.board),
      hand: [],
      offer: [],
      rerolls: 0,
      contractOffer: [],
      contracts: [],
      useCases: Object.keys(scenario.waves[0].traffic),
      contractStart: {},
      requirements: [],
      freshness: [],
      global: 0,
      revenueMultiplier: 1,
      events: [],
      lag: {},
      oncallLeft: 0,
      loadtestsFree: 0,
      ticks: [],
      history: [],
      endless: false,
      cleared: false,
      log: [],
      migrations: {},
      sunset: [],
      bigBang: [],
      news: { useCases: [], requirements: [] },
      mutatorOffer: scenario.mode === 'scale' ? shuffled(stream(setup.seed, 'mutators'), mutatorsFor(content, scenario.id)).slice(0, MUTATOR_OFFER).map((m) => m.id) : [],
      paged: 0,
      tested: false,
    };
    if (perks.some((p) => p.def.effect === 'starter-card')) {
      const commons = this.pool().filter((c) => c.rarity === 'common');
      if (commons.length) this.state.hand.push(shuffled(stream(setup.seed, 'starter'), commons)[0].id);
    }
    this.startWave();
  }

  /** Replays a run: the setup, then every action, then any ticks still to run. */
  static replay(content: GameContent, setup: RunSetup, actions: readonly Action[]): Game {
    const game = new Game(content, setup);
    for (const a of actions) game.apply(a);
    while (game.state.phase === 'run') game.advance();
    return game;
  }

  // ---- What the page reads ----

  get mods(): Mods {
    const m = computeMods(
      this.state.hand.map((id) => this.index.cards.get(id)!),
      this.perks(),
      { streakStep: STREAK_STEP, interestCap: INTEREST_CAP },
    );
    const mu = this.mutatorDef;
    if (mu) {
      for (const c of mu.cost ?? []) m.cost.push({ target: c.target, mult: c.mult });
      if (mu.interest) m.interestCap = Math.round(m.interestCap * mu.interest);
    }
    return m;
  }

  /** The run's mutator, once picked. */
  get mutatorDef(): MutatorDef | undefined {
    return this.state.mutator ? this.content.mutators.find((m) => m.id === this.state.mutator) : undefined;
  }

  /** A bounty's pay on the current wave: its cash, and its points times the act. */
  private pays(b: BountyDef): { cash: number; points: number } {
    return { cash: b.cash, points: b.points * Math.min(3, Math.ceil((this.state.wave + 1) / 4)) };
  }

  waveDef(w = this.state.wave): WaveDef {
    const waves = this.scenario.waves;
    if (w < waves.length) return waves[w];
    const last = waves[waves.length - 1];
    const k = w - waves.length + 1;
    const curves: Curve[] = ['day', 'ramp', 'spike', 'double-peak'];
    const curve = curves[Math.floor(stream(this.setup.seed, `endless:${w}`)() * curves.length)];
    return {
      name: `Endless ${k}`,
      boss: (w + 1) % 4 === 0,
      traffic: Object.fromEntries(Object.entries(last.traffic).map(([key, rps]) => [key, Math.round(rps * ENDLESS_GROWTH ** k)])),
      curve,
    };
  }

  forecast(): Forecast {
    const w = this.waveDef();
    const multipliers = this.multipliers();
    const peakTick = argmax(multipliers);
    const peak = this.state.useCases.map((key) => ({ key, name: this.scenario.useCases[key].name, rps: Math.round(this.baseRps(key) * multipliers[peakTick]) }));
    return {
      wave: this.state.wave,
      name: w.name,
      boss: !!w.boss,
      curve: w.curve ?? 'day',
      multipliers,
      peakTick,
      peak,
      requirements: this.state.requirements,
      freshness: this.state.freshness,
      events: this.state.events.map((e) => {
        const def = this.index.events.get(e.id)!;
        return { id: e.id, title: def.title, telegraph: def.telegraph, ...(this.rules.hiddenTicks ? {} : { from: e.from }), duration: e.duration };
      }),
      global: this.state.global,
      contract: !!w.contract && this.state.wave < this.scenario.waves.length - 1,
      ...(w.ticket ? { ticket: { ...w.ticket, text: this.scenario.sections[`Ticket: ${w.ticket.id}`] ?? '' } } : {}),
      news: this.state.news,
      ...(this.mutatorDef ? { mutator: this.mutatorDef } : {}),
      ...(() => {
        const b = this.state.bounty ? this.content.bounties.find((x) => x.id === this.state.bounty) : undefined;
        return b ? { bounty: { ...b, pays: this.pays(b) } } : {};
      })(),
    };
  }

  /** How the code pane teaches on a wave (0-based; this wave by default): watch, edit or only. */
  codeLevel(w = this.state.wave): CodeLevel {
    const { edit, only } = this.scenario.code;
    if (only !== undefined && w + 1 >= only) return 'only';
    return w + 1 >= edit ? 'edit' : 'watch';
  }

  /** Problems with a plan; empty when it can be deployed. */
  problems(board: Board): string[] {
    const r = this.state.reserved;
    return boardProblems(board, this.scenario, this.index.components, {
      unlocked: new Set([...this.setup.loadout.unlocked, ...this.scenario.grants]),
      ...(r && this.state.wave <= r.untilWave ? { reservedFloor: r.floor } : {}),
    });
  }

  /** Monthly cost of a plan at the forecast peak, without running anything. */
  monthlyCost(board: Board): number {
    return this.evaluate(board, this.forecast().peakTick, this.state.lag, true).cost * TICKS;
  }

  /** Blueprints this run has earned so far (all of them once it is over); `firstClear` when the player had never cleared this scenario. */
  blueprints(firstClear: boolean): number {
    const survived = this.state.history.filter((h) => h.survived);
    const fromScore = Math.min(BLUEPRINTS.scoreMax, Math.floor(this.state.score / BLUEPRINTS.scoreStep));
    return (
      survived.length * BLUEPRINTS.perWave +
      survived.filter((h) => h.boss).length * BLUEPRINTS.perBoss +
      fromScore +
      (firstClear && this.state.cleared ? BLUEPRINTS.firstClear : 0)
    );
  }

  /** Ids the run showed the player, for the codex: components placed, cards held, events met. */
  seen(): string[] {
    const ids = new Set<string>();
    for (const n of this.state.board.nodes) if (this.index.components.has(n.component)) ids.add(n.component);
    for (const id of this.state.hand) ids.add(id);
    for (const h of this.state.history) for (const e of h.events) ids.add(e.id);
    return [...ids].sort();
  }

  // ---- Actions ----

  /** Applies one action; returns the load test's result for `loadtest`. */
  apply(action: Action): TickResult | undefined {
    const s = this.state;
    let result: TickResult | undefined;
    if (s.phase === 'run' && action.t !== 'oncall') while (s.phase === 'run') this.advance();
    switch (action.t) {
      case 'deploy': {
        this.expect('plan');
        if (this.waveDef().diagnosis && !s.diagnosis) throw new GameError('Name the root cause first: the fix depends on it');
        this.checkBoard(action.board);
        s.mutatorOffer = [];
        s.board = cloneBoard(action.board);
        s.phase = 'run';
        s.tick = 0;
        s.ticks = [];
        break;
      }
      case 'loadtest': {
        this.expect('plan');
        this.checkBoard(action.board);
        if (s.loadtestsFree > 0) s.loadtestsFree--;
        else {
          if (s.cash < LOADTEST_COST) throw new GameError('Not enough cash for a load test');
          s.cash -= LOADTEST_COST;
        }
        result = this.evaluate(action.board, this.forecast().peakTick, s.lag, false);
        s.tested = true;
        break;
      }
      case 'oncall': {
        this.expect('run');
        if (!Number.isInteger(action.tick) || action.tick < s.tick || action.tick >= TICKS) throw new GameError('On-call actions happen during the run');
        while (s.tick < action.tick && s.phase === 'run') this.advance();
        this.expect('run');
        if (s.oncallLeft <= 0) throw new GameError('No on-call actions left this wave');
        const node = s.board.nodes.find((n) => n.id === action.node);
        const c = node && this.index.components.get(node.component);
        if (!node || !c) throw new GameError(`No component '${action.node}' to scale`);
        if (node.replicas >= MAX_REPLICAS) throw new GameError(`'${node.id}' is at ${MAX_REPLICAS} replicas`);
        if (s.cash < ONCALL_COST) throw new GameError('Not enough cash to page the on-call');
        s.cash -= ONCALL_COST;
        s.oncallLeft--;
        s.paged++;
        node.replicas++;
        break;
      }
      case 'mutator': {
        this.expect('plan');
        if (!s.mutatorOffer.length) throw new GameError('No mutator on offer: one is picked before the first deploy');
        if (action.pick !== null) {
          const def = this.content.mutators.find((m) => m.id === s.mutatorOffer[action.pick!]);
          if (!def) throw new GameError('No such mutator on offer');
          s.mutator = def.id;
          if (def.cash) s.cash = Math.round(s.cash * def.cash);
          if (def.global) s.global = Math.max(s.global, def.global);
          // The briefing compares next wave's traffic with this one's as the mutator shapes it.
          if (this.briefed) this.briefed.traffic = s.useCases.reduce((t, key) => t + this.baseRps(key), 0);
        }
        s.mutatorOffer = [];
        break;
      }
      case 'pick': {
        this.expect('draft');
        if (action.card === null) s.cash += SKIP_CARD_CASH;
        else {
          const id = s.offer[action.card];
          if (id === undefined) throw new GameError('No such card on offer');
          if (s.hand.length >= HAND_SIZE) throw new GameError(`You hold ${HAND_SIZE} cards at most`);
          this.take(id);
        }
        s.offer = [];
        this.afterDraft();
        break;
      }
      case 'reroll': {
        this.expect('draft');
        const cost = this.rerollCost();
        if (s.cash < cost) throw new GameError('Not enough cash to reroll');
        s.cash -= cost;
        s.rerolls++;
        s.offer = this.drawOffer();
        break;
      }
      case 'contract': {
        this.expect('contract');
        if (action.pick !== null) {
          const id = s.contractOffer[action.pick];
          const def = this.scenario.contracts.find((c) => c.id === id);
          if (!def) throw new GameError('No such contract on offer');
          this.sign(def);
        }
        s.contractOffer = [];
        this.nextWave();
        break;
      }
      case 'migrate': {
        this.expect('plan');
        const def = this.scenario.migrations.find((m) => m.id === action.id);
        if (!def) throw new GameError(`No migration '${action.id}'`);
        const st = this.migrationOf(def.id);
        if (st.wave === s.wave) throw new GameError(`${def.name}: one step a wave; each step is its own deploy`);
        const at = phaseIndex(st.phase);
        const done = phaseIndex('contract');
        if (action.to === 'next') {
          if (at >= done) throw new GameError(`${def.name} is done`);
          s.migrations[def.id] = { phase: MIGRATION_PHASES[at + 1], wave: s.wave };
        } else if (action.to === 'rollback') {
          if (at <= 0) throw new GameError(`${def.name} has not started`);
          if (at >= done) throw new GameError(`${def.name} dropped the old shape; there is nothing to roll back to`);
          s.migrations[def.id] = { phase: MIGRATION_PHASES[at - 1], wave: s.wave };
        } else if (action.to === 'big-bang') {
          if (at >= phaseIndex('cutover')) throw new GameError(`${def.name} is already cut over`);
          s.migrations[def.id] = { phase: 'contract', wave: s.wave };
          s.bigBang.push(def.id);
        } else throw new GameError('A migration moves next, rolls back, or goes all at once');
        break;
      }
      case 'diagnose': {
        this.expect('plan');
        const d = this.waveDef().diagnosis;
        if (!d) throw new GameError('There is nothing to diagnose this wave');
        if (s.diagnosis) throw new GameError('You already named a root cause this wave');
        const option = d.options.find((o) => o.id === action.pick);
        if (!option) throw new GameError(`No such diagnosis '${action.pick}'`);
        const correct = !!option.correct;
        s.diagnosis = { pick: option.id, correct };
        if (correct) {
          s.trust = Math.min(s.maxTrust, s.trust + DIAGNOSIS_TRUST);
          s.score += DIAGNOSIS_POINTS;
        } else {
          s.trust = Math.max(0, s.trust - TRUST_PENALTY.misdiagnosis);
          if (s.trust <= 0) this.end('churned');
        }
        break;
      }
      case 'sunset': {
        this.expect('plan');
        const uc = this.scenario.useCases[action.useCase];
        if (!uc?.legacy || !s.useCases.includes(action.useCase)) throw new GameError(`"${uc?.name ?? action.useCase}" is not a legacy version you serve`);
        if (!s.useCases.includes(uc.legacy.replacedBy)) throw new GameError(`"${uc.name}" has no replacement yet: ship ${this.scenario.useCases[uc.legacy.replacedBy]?.name ?? uc.legacy.replacedBy} first`);
        if (s.sunset.includes(action.useCase)) throw new GameError(`"${uc.name}" is already sunset`);
        s.sunset.push(action.useCase);
        break;
      }
      case 'endless': {
        this.expect('cleared');
        s.endless = true;
        this.nextWave();
        break;
      }
      case 'retire': {
        this.expect('cleared');
        this.end('retired');
        break;
      }
      default:
        throw new GameError('Unknown action');
    }
    s.log.push(structuredCloneAction(action));
    return result;
  }

  /** Reroll price now. */
  rerollCost(): number {
    if (this.state.rerolls === 0 && this.mods.freeReroll) return 0;
    return REROLL_COST + REROLL_STEP * this.state.rerolls;
  }

  /** Runs the next tick of the wave. */
  advance(): TickResult {
    const s = this.state;
    this.expect('run');
    const r = this.evaluate(s.board, s.tick, s.lag, false);
    s.lag = r.lag;
    s.cash += r.revenue - r.cost;
    s.trust = Math.min(s.maxTrust, s.trust + r.trustDelta);
    s.streak = r.streak;
    s.score += r.points;
    s.ticks.push(r);
    s.tick++;
    if (s.trust <= 0) {
      s.trust = 0;
      this.summarize();
      this.end('churned');
    } else if (s.tick >= TICKS) this.endWave();
    return r;
  }

  // ---- Waves ----

  private startWave() {
    const s = this.state;
    const w = this.waveDef();
    s.phase = 'plan';
    s.tick = 0;
    s.ticks = [];
    s.rerolls = 0;
    s.bigBang = [];
    delete s.diagnosis;
    for (const key of Object.keys(w.traffic)) if (!s.useCases.includes(key)) s.useCases.push(key);
    const lines = (w.requirements ?? []).map((l) => this.harder(l));
    s.requirements = mergeRequirements(s.requirements, lines);
    for (const f of w.freshness ?? []) s.freshness = [...s.freshness.filter((x) => x.useCase !== f.useCase), f];
    if (w.global !== undefined) s.global = w.global;
    if (this.mutatorDef?.global) s.global = Math.max(s.global, this.mutatorDef.global);
    s.paged = 0;
    s.tested = false;
    const mods = this.mods;
    s.oncallLeft = ONCALL_PER_WAVE + mods.oncall;
    s.loadtestsFree = mods.loadtests;
    s.events = this.drawEvents();
    s.bounty = this.drawBounty();
    const traffic = s.useCases.reduce((a, key) => a + this.baseRps(key), 0);
    const prev = this.briefed;
    s.news = {
      useCases: s.useCases.filter((k) => !prev?.useCases.includes(k)),
      requirements: s.requirements.filter((l) => !prev?.requirements.includes(l)),
      ...(prev && prev.traffic > 0 ? { growth: traffic / prev.traffic } : {}),
    };
    this.briefed = { useCases: [...s.useCases], requirements: [...s.requirements], traffic };
  }

  private drawEvents(): EventInstance[] {
    const s = this.state;
    const w = this.waveDef();
    const n = s.wave + 1;
    const next = stream(this.setup.seed, `events:${s.wave}`);
    const out: EventInstance[] = [];
    const place = (def: EventDef): EventInstance => {
      const duration = Math.max(1, Math.min(TICKS, def.duration));
      const from = def.from ?? 2 + Math.floor(next() * Math.max(1, TICKS - duration));
      return { id: def.id, from: Math.min(from, TICKS - duration + 1), duration };
    };
    for (const id of w.events ?? []) {
      const def = this.index.events.get(id);
      if (def) out.push(place(def));
    }
    const roles = new Set(s.board.nodes.map((node) => this.index.components.get(node.component)?.role).filter(Boolean));
    for (const e of this.mutatorDef?.events ?? []) {
      const def = this.index.events.get(e.id);
      if (def && e.waves.includes(n) && !out.some((x) => x.id === def.id) && def.requires.every((r) => roles.has(r))) out.push(place(def));
    }
    let extra = n >= POOL_FROM_WAVE ? 1 : 0;
    if (s.wave >= this.scenario.waves.length) extra++;
    if (this.rules.extraActIncident && (n === 3 || n === 7 || n === 11)) extra++;
    if (this.rules.bossIncident && w.boss) extra++;
    const previous = new Set(s.history[s.history.length - 1]?.events.map((e) => e.id) ?? []);
    for (let i = 0; i < extra; i++) {
      const eligible = this.scenario.eventPool.filter((p) => {
        const def = this.index.events.get(p.id);
        return (
          def &&
          def.minWave <= n &&
          def.requires.every((r) => roles.has(r)) &&
          (def.effect !== 'external-slow' || this.scenario.externals.length > 0) &&
          !previous.has(p.id) &&
          !(w.boss && def.category === 'spike') &&
          !out.some((e) => e.id === p.id)
        );
      });
      const at = weighted(next, eligible.map((p) => p.weight));
      if (at < 0) break;
      out.push(place(this.index.events.get(eligible[at].id)!));
    }
    return out;
  }

  /** Scale or Fail: one bounty a wave, drawn from those that fit it, never the last wave's. */
  private drawBounty(): string | undefined {
    const s = this.state;
    if (this.scenario.mode !== 'scale') return undefined;
    const w = this.waveDef();
    const effects = new Set(s.events.map((e) => this.index.events.get(e.id)?.effect));
    const last = s.history[s.history.length - 1]?.bounty?.id;
    const eligible = this.content.bounties.filter((b) => b.id !== last && (!b.boss || !!w.boss) && (!b.event || effects.has(b.event)));
    // A bounty made for this wave (its incident, its boss) is the likelier draw.
    const at = weighted(stream(this.setup.seed, `bounty:${s.wave}`), eligible.map((b) => (b.event || b.boss ? BOUNTY_FITTED_WEIGHT : 1)));
    return at < 0 ? undefined : eligible[at].id;
  }

  /** Whether the wave just run met its bounty. */
  private bountyMet(b: BountyDef, summary: WaveSummary): boolean {
    const s = this.state;
    if (!summary.survived) return false;
    switch (b.kind) {
      case 'max-utilization': {
        const peak = s.ticks[argmax(this.multipliers())];
        const of = peak?.nodes.filter((n) => {
          const node = s.board.nodes.find((x) => x.id === n.id);
          return node && this.index.components.get(node.component)?.role === b.role;
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

  private endWave() {
    const s = this.state;
    const summary = this.summarize();
    if (summary.clean) s.trust = Math.min(s.maxTrust, s.trust + TRUST_CLEAN_WAVE);
    if (summary.boss) s.trust = Math.min(s.maxTrust, s.trust + TRUST_BOSS);
    if (s.cash > 0) {
      const interest = Math.min(this.mods.interestCap, Math.floor(s.cash * INTEREST_RATE));
      summary.interest = interest;
      s.cash += interest;
    }
    s.score += summary.leanBonus + summary.bossBonus;
    const bounty = s.bounty ? this.content.bounties.find((b) => b.id === s.bounty) : undefined;
    if (bounty) {
      const met = this.bountyMet(bounty, summary);
      const pay = met ? this.pays(bounty) : { cash: 0, points: 0 };
      summary.bounty = { id: bounty.id, met, ...pay };
      s.cash += pay.cash;
      s.score += pay.points;
    }
    if (s.cash < 0) return this.end('bankrupt');
    const last = s.wave + 1 >= (s.endless ? MAX_WAVES : this.scenario.waves.length);
    if (last) {
      if (s.endless) return this.end('max');
      s.cleared = true;
      s.phase = 'cleared';
      return;
    }
    if (this.scenario.mode !== 'scale') return this.afterDraft();
    s.phase = 'draft';
    s.offer = this.drawOffer();
    if (s.offer.length === 0) this.afterDraft();
  }

  private summarize(): WaveSummary {
    const s = this.state;
    const w = this.waveDef();
    const breaches = s.ticks.flatMap((t) => t.breaches);
    const points = s.ticks.reduce((a, t) => a + t.points, 0);
    const peak = s.ticks[argmax(this.multipliers())] ?? s.ticks[s.ticks.length - 1];
    const lean = !!peak && s.ticks.length === TICKS && this.isLean(peak);
    const survived = s.trust > 0;
    const counts = new Map<string, { b: Breach; n: number }>();
    for (const b of breaches) {
      const key = `${b.kind}:${b.node ?? b.useCase ?? ''}`;
      const c = counts.get(key);
      if (c) c.n++;
      else counts.set(key, { b, n: 1 });
    }
    const worst = [...counts.values()].sort((a, b) => b.n * b.b.trust - a.n * a.b.trust)[0]?.b;
    const summary: WaveSummary = {
      wave: s.wave,
      ...(w.name ? { name: w.name } : {}),
      boss: !!w.boss && survived && s.ticks.length === TICKS,
      revenue: Math.round(s.ticks.reduce((a, t) => a + t.revenue, 0)),
      cost: Math.round(s.ticks.reduce((a, t) => a + t.cost, 0)),
      interest: 0,
      points,
      leanBonus: lean ? Math.round(points * LEAN_BONUS) : 0,
      bossBonus: w.boss && survived && s.ticks.length === TICKS ? BOSS_BONUS * Math.ceil((s.wave + 1) / 4) : 0,
      trustDelta: s.ticks.reduce((a, t) => a + t.trustDelta, 0),
      clean: breaches.length === 0 && s.ticks.length === TICKS,
      survived: survived && s.ticks.length === TICKS,
      breaches,
      ...(worst ? { worst } : {}),
      events: s.events,
      ...(w.debrief ? { debrief: w.debrief } : {}),
      ...(s.diagnosis ? { diagnosis: s.diagnosis } : {}),
    };
    s.history.push(summary);
    return summary;
  }

  /** Right-sized: nothing over LEAN_MAX at the peak, and no scaled-out compute or store that could lose a replica and stay under it. */
  private isLean(peak: TickResult): boolean {
    let any = false;
    for (const n of peak.nodes) {
      const node = this.state.board.nodes.find((b) => b.id === n.id);
      const role = node && this.index.components.get(node.component)?.role;
      if (!role || ['lb', 'waf', 'cdn', 'gateway', 'queue', 'blob'].includes(role)) continue;
      if (n.down) return false;
      if (n.utilization > LEAN_MAX) return false;
      if (n.replicas >= 3 && (n.utilization * n.replicas) / (n.replicas - 1) <= LEAN_MAX) return false;
      if (n.utilization >= LEAN_MIN) any = true;
    }
    return any;
  }

  private afterDraft() {
    const s = this.state;
    const w = this.waveDef();
    if (w.contract && !s.endless) {
      const open = this.scenario.contracts.filter((c) => !s.contracts.includes(c.id));
      s.contractOffer = shuffled(stream(this.setup.seed, `contracts:${s.wave}`), open)
        .slice(0, 3)
        .map((c) => c.id);
      if (s.contractOffer.length) {
        s.phase = 'contract';
        return;
      }
    }
    this.nextWave();
  }

  private nextWave() {
    this.state.wave++;
    this.startWave();
  }

  private end(outcome: Outcome) {
    const s = this.state;
    s.outcome = outcome;
    s.phase = 'over';
    s.score += s.trust * END_TRUST_POINTS + Math.max(0, Math.floor(s.cash / END_CASH_DIVISOR));
  }

  // ---- Migrations and versions ----

  /** A migration's state; one not started is at `none`. */
  migrationOf(id: string): MigrationState {
    return this.state.migrations[id] ?? { phase: 'none', wave: -1 };
  }

  /** The migration a use case waits for: it needs the new shape, and the cutover has not happened. */
  blockedBy(key: string): MigrationDef | undefined {
    return this.scenario.migrations.find((m) => m.needs.includes(key) && phaseIndex(this.migrationOf(m.id).phase) < phaseIndex('cutover'));
  }

  /** A use case still served that reads the old shape of a migration that dropped it. */
  private readsDroppedShape(key: string): boolean {
    return !this.state.sunset.includes(key) && this.scenario.migrations.some((m) => m.oldReaders.includes(key) && this.migrationOf(m.id).phase === 'contract');
  }

  /** Cash a wave for the legacy versions still served. */
  upkeep(): number {
    const s = this.state;
    return s.useCases.reduce((a, k) => {
      const legacy = this.scenario.useCases[k]?.legacy;
      return a + (legacy && !s.sunset.includes(k) && s.useCases.includes(legacy.replacedBy) ? legacy.upkeep : 0);
    }, 0);
  }

  /**
   * The use cases as this wave runs them: writers write both shapes from the
   * dual-write to the contract, a backfill adds its background job, and only
   * the use cases neither sunset nor waiting for a migration are served.
   */
  private effective(): { useCases: Record<string, UseCaseDef>; served: string[]; jobs: { key: string; rps: number }[] } {
    const s = this.state;
    const key = JSON.stringify([s.useCases, s.migrations, s.sunset]);
    if (this.effectiveCache?.key === key) return this.effectiveCache.value;
    const useCases: Record<string, UseCaseDef> = { ...this.scenario.useCases };
    const jobs: { key: string; rps: number }[] = [];
    for (const m of this.scenario.migrations) {
      const at = phaseIndex(this.migrationOf(m.id).phase);
      if (at >= phaseIndex('dual-write') && at < phaseIndex('contract')) {
        for (const w of m.writers) {
          const uc = useCases[w];
          if (uc) useCases[w] = { ...uc, steps: uc.steps.map((st) => (st.op === 'write' && st.to === m.store ? { ...st, x: (st.x ?? 1) * 2 } : st)) };
        }
      }
      if (at === phaseIndex('backfill')) {
        const job = backfillKey(m.id);
        useCases[job] = {
          name: `Backfill ${m.entity}`,
          method: 'POST',
          path: `/jobs/backfill-${m.id}`,
          status: 200,
          value: 0,
          steps: [
            { op: 'read', to: m.store, entity: m.entity },
            { op: 'write', to: m.store, entity: m.entity },
          ],
          optional: true,
        };
        jobs.push({ key: job, rps: m.backfillRps });
      }
    }
    const served = [...s.useCases.filter((k) => !s.sunset.includes(k) && !this.blockedBy(k)), ...jobs.map((j) => j.key)];
    const value = { useCases, served, jobs };
    this.effectiveCache = { key, value };
    return value;
  }

  // ---- Cards and contracts ----

  /** Cards that can be drafted: unlocked, not held. */
  pool(): CardDef[] {
    const unlocked = new Set(this.setup.loadout.unlocked);
    return this.content.cards.filter((c) => (c.unlock === 0 || unlocked.has(c.id)) && !this.state.hand.includes(c.id));
  }

  private drawOffer(): string[] {
    const s = this.state;
    const next = stream(this.setup.seed, `draft:${s.wave}:${s.rerolls}`);
    const pool = this.pool();
    const offer: string[] = [];
    while (offer.length < OFFER_SIZE) {
      const left = pool.filter((c) => !offer.includes(c.id));
      if (!left.length) break;
      const at = weighted(next, left.map((c) => RARITY_WEIGHTS[c.rarity]));
      offer.push(left[at].id);
    }
    return offer;
  }

  private take(id: string) {
    const s = this.state;
    const card = this.index.cards.get(id)!;
    s.hand.push(id);
    if (card.effect === 'trust') {
      s.maxTrust += card.value;
      s.trust += card.value;
    } else if (card.effect === 'cash') s.cash += card.value;
    else if (card.effect === 'reserved') {
      const floor = s.board.nodes.filter((n) => this.index.components.get(n.component)?.role === 'app').reduce((a, n) => a + n.replicas, 0);
      s.reserved = { floor, untilWave: s.wave + 3 };
    }
    s.oncallLeft = ONCALL_PER_WAVE + this.mods.oncall;
  }

  private sign(def: ContractDef) {
    const s = this.state;
    s.contracts.push(def.id);
    if (def.cash) s.cash += def.cash;
    if (def.revenue) s.revenueMultiplier *= def.revenue;
    if (def.useCase && !s.useCases.includes(def.useCase)) {
      s.useCases.push(def.useCase);
      s.contractStart[def.useCase] = s.wave + 1;
    }
    if (def.requirements) s.requirements = mergeRequirements(s.requirements, def.requirements.map((l) => this.harder(l)));
    for (const f of def.freshness ?? []) s.freshness = [...s.freshness.filter((x) => x.useCase !== f.useCase), f];
  }

  // ---- The simulation of one tick ----

  /** Base rps of a use case this wave, before the curve. */
  private baseRps(key: string): number {
    const w = this.waveDef();
    const fixed = w.traffic[key];
    let rps: number;
    if (fixed !== undefined) rps = fixed;
    else {
      const c = this.scenario.contracts.find((x) => x.useCase === key);
      const start = this.state.contractStart[key] ?? this.state.wave;
      rps = c?.rps ? c.rps * (c.growth ?? 1.4) ** Math.max(0, this.state.wave - start) : 0;
    }
    const t = this.mutatorDef?.traffic;
    const mix = t ? ((this.scenario.useCases[key]?.method === 'GET' ? t.read : t.write) ?? 1) : 1;
    return rps * this.rules.trafficMultiplier * mix;
  }

  private active(tick: number): { def: EventDef; i: number }[] {
    return this.state.events
      .filter((e) => tick + 1 >= e.from && tick + 1 < e.from + e.duration)
      .map((e) => ({ def: this.index.events.get(e.id)!, i: tick + 1 - e.from }));
  }

  /** Traffic multiplier per tick: the curve, and spikes. */
  private multipliers(): number[] {
    const curve = CURVES[this.waveDef().curve ?? 'day'];
    return curve.map((m, t) => this.active(t).reduce<number>((x, { def }) => (def.effect === 'traffic' && !def.target ? x * (def.value ?? 1) : x), m));
  }

  private compileFor(board: Board, situation: Situation): Compiled {
    const mods = this.mods;
    const eff = this.effective();
    const key = `${boardKey(board)}|${JSON.stringify(situation)}|${this.effectiveCache!.key}|${mods.payload}|${mods.writeShare}|${mods.presigned}`;
    let c = this.compiled.get(key);
    if (!c) {
      c = compile({ ...this.scenario, useCases: eff.useCases }, board, this.index.components, eff.served, situation, { payload: mods.payload, writeShare: mods.writeShare, presigned: mods.presigned });
      if (this.compiled.size > 64) this.compiled.clear();
      this.compiled.set(key, c);
    }
    return c;
  }

  /** One tick of `board` at `tick` of the current wave, from backlog `lagIn`; changes nothing. */
  evaluate(board: Board, tick: number, lagIn: Record<string, number>, quick: boolean): TickResult {
    const s = this.state;
    const mods = this.mods;
    const active = this.active(tick);
    const multipliers = this.multipliers();
    const peakTick = argmax(multipliers);
    const comp = (id: string) => this.index.components.get(board.nodes.find((n) => n.id === id)?.component ?? '');

    // What the incidents take down this tick.
    const down = new Set<string>();
    const writesDown = new Set<string>();
    /** Share of a sharded store's writes that fail (one shard failing over). */
    const partialWrites = new Map<string, number>();
    const lost = new Map<string, number>();
    const latencyMult = new Map<string, number>();
    let coldFactor = 1;
    let hotShare = 0;
    let botsMult = 0;
    const externalLatency = new Map<string, number>();
    const surge = new Map<string, number>();
    const targetMult = new Map<string, number>();
    for (const { def, i } of active) {
      const matching = board.nodes.filter((n) => targets(def.target, n, this.index.components.get(n.component)) && this.index.components.has(n.component));
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
          for (const n of board.nodes) if (this.index.components.has(n.component)) lost.set(n.id, (lost.get(n.id) ?? 0) + Math.ceil(n.replicas / 3));
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
          for (const e of this.scenario.externals) if (!def.target || def.target === e.id || def.target === 'any') externalLatency.set(e.id, def.value ?? 1000);
          break;
      }
    }
    if (mods.spot && active.length) for (const n of board.nodes) if (comp(n.id)?.role === 'worker') lost.set(n.id, (lost.get(n.id) ?? 0) + 1);
    const replicas = new Map<string, number>();
    for (const n of board.nodes) {
      if (!this.index.components.has(n.component)) continue;
      const left = n.replicas - (lost.get(n.id) ?? 0);
      if (left <= 0) down.add(n.id);
      else if (left !== n.replicas) replicas.set(n.id, left);
    }

    // A migration done in one go: the ALTER holds the table's write lock for the first two ticks.
    const bigBang = s.bigBang.map((id) => this.scenario.migrations.find((m) => m.id === id)!).filter(Boolean);
    if (tick < 2) for (const m of bigBang) for (const n of board.nodes) if (comp(n.id)?.role === m.store) writesDown.add(n.id);

    const situation: Situation = {
      down: [...down].sort(),
      writesDown: [...writesDown].sort(),
      global: s.global > 0,
      bots: botsMult > 0,
    };
    const compiled = this.compileFor(board, situation);

    // Traffic.
    const multiplier = multipliers[tick];
    const rps = new Map<string, number>();
    const surgeOf = (key: string) => {
      const uc = this.scenario.useCases[key];
      let m = surge.get(key) ?? 1;
      if (surge.has('write') && uc.steps.some((st) => st.op === 'write')) m *= surge.get('write')!;
      if (surge.has('async') && uc.steps.some((st) => st.async)) m *= surge.get('async')!;
      return m;
    };
    for (const key of s.useCases) rps.set(key, this.baseRps(key) * multiplier * surgeOf(key) * (targetMult.get(key) ?? 1));
    const eff = this.effective();
    for (const j of eff.jobs) rps.set(j.key, j.rps);
    const legit = [...rps.values()].reduce((a, b) => a + b, 0);
    const traffic: TrafficEntry[] = [];
    const sharesOf = new Map<string, { name: string; share: number }[]>();
    for (const [key, route] of Object.entries(compiled.routes)) {
      const uc = eff.useCases[key];
      const hit = clamp((uc.cache ?? 0) + mods.cacheHit - this.rules.hitPenalty, 0, 0.98) * coldFactor;
      const edge = route.cdn ? clamp((uc.edge ?? 0) + mods.edgeHit - this.rules.hitPenalty, 0, 0.98) : 0;
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

    // Capacity: sizes, cards, incidents.
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
      const external = this.scenario.externals.find((e) => e.id === node.component);
      if (external) {
        const lat = externalLatency.get(external.id) ?? external.latencyMs;
        if (external.rps !== undefined || lat !== undefined) capacity.push({ node: dn.id, ...(external.rps !== undefined ? { rps: external.rps } : {}), ...(lat !== undefined ? { latencyMs: lat } : {}), loc: LOC });
        continue;
      }
      const c = this.index.components.get(node.component);
      const tier = TIERS[node.tier ?? 0] ?? TIERS[0];
      let reads = base.readRps * tier.capacity;
      let writes = base.writeRps * tier.capacity;
      let latency = base.latencyMs * (latencyMult.get(node.id) ?? 1);
      let cost = base.costUsd * tier.cost * this.rules.costMultiplier;
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

    const reqLines = s.requirements.filter((l) => {
      const named = /"([^"]*)"/.exec(l)?.[1];
      if (named && !Object.values(compiled.routes).some((r) => r.name === named)) return false;
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
      if (s.sunset.includes(key)) {
        useCases.push({ key, name: uc.name, rps: r, served: 0, p99: 0, availability: 0, routed: false });
        if (r > 0) {
          breaches.push({
            kind: 'compat',
            message: `${Math.round(r)} rps of clients still call "${uc.name}", which you sunset: they get 410 Gone.`,
            hint: 'Sunset a version only once its traffic is gone: watch it fall, and give its clients a deadline first.',
            useCase: key,
            trust: TRUST_PENALTY.compat,
            learn: BREACH_LEARN.compat,
          });
        }
        continue;
      }
      if (this.readsDroppedShape(key)) {
        // Its requests error out; the compat breach below says why.
        useCases.push({ key, name: uc.name, rps: r, served: 0, p99: 0, availability: 0, routed: false });
        continue;
      }
      const waiting = this.blockedBy(key);
      if (waiting) {
        useCases.push({ key, name: uc.name, rps: r, served: 0, p99: 0, availability: 0, routed: false });
        if (r > 0) {
          breaches.push({
            kind: 'unroutable',
            message: `"${uc.name}" needs the new ${waiting.entity} shape: take ${waiting.name} to its cutover first.`,
            hint: 'Expand, dual-write, backfill, then cut over: one step a wave.',
            useCase: key,
            trust: uc.optional ? TRUST_PENALTY.unroutableOptional : TRUST_PENALTY.unroutable,
            learn: BREACH_LEARN.migration,
          });
        }
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
    if (tick === 0) {
      for (const m of bigBang) {
        breaches.push({
          kind: 'migration',
          message: `${m.name} ran as one big change: ${m.entity} writes were locked for two ticks while it rewrote every row.`,
          hint: 'Expand and contract: add the new shape, write both, backfill in batches, cut over, and only then drop the old one.',
          trust: TRUST_PENALTY.migration,
          learn: BREACH_LEARN.migration,
        });
      }
    }
    for (const m of this.scenario.migrations) {
      if (this.migrationOf(m.id).phase !== 'contract') continue;
      for (const key of m.oldReaders) {
        const r = rps.get(key) ?? 0;
        if (!s.useCases.includes(key) || s.sunset.includes(key) || r <= 0) continue;
        breaches.push({
          kind: 'compat',
          message: `"${eff.useCases[key].name}" still reads the old ${m.entity} shape, which ${m.name} dropped: ${Math.round(r)} rps of errors.`,
          hint: 'Contract only once nothing reads the old shape: move or sunset its last readers first.',
          useCase: key,
          trust: TRUST_PENALTY.compat,
          learn: BREACH_LEARN.compat,
        });
      }
    }
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
    for (const b of breaches) if (!b.learn.length) b.learn = active.flatMap((a) => a.def.learn);
    for (const a of active) for (const b of breaches) for (const l of a.def.learn) if (!b.learn.includes(l)) b.learn.push(l);

    const revenue = useCases.reduce((a, u) => a + (eff.useCases[u.key].value * u.rps * u.served) / 1000, 0) * s.revenueMultiplier / TICKS;
    const cost = analysis.totalCostUsd / TICKS + this.upkeep() / TICKS;
    const severe = breaches.some((b) => ['availability', 'drop', 'unroutable', 'consistency', 'durability', 'resilience', 'compat', 'migration'].includes(b.kind));
    const quality = breaches.length === 0 ? 1 : severe ? 0.4 : 0.6;
    const streak = breaches.length === 0 ? s.streak + 1 : 0;
    const streakMult = Math.min(STREAK_MAX, 1 + mods.streakStep * streak);
    const points = Math.round(revenue * quality * streakMult * (this.mutatorDef?.score ?? 1));
    const trustDelta = -breaches.reduce((a, b) => a + b.trust, 0);

    const nodes: NodeTick[] = board.nodes
      .filter((n) => this.index.components.has(n.component) || this.scenario.externals.some((e) => e.id === n.component))
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

  // ---- Helpers ----

  private perks() {
    const defs = new Map(this.content.perks.map((p) => [p.id, p]));
    return Object.entries(this.setup.loadout.perks).map(([id, level]) => {
      const def = defs.get(id);
      if (!def) throw new GameError(`Unknown perk '${id}'`);
      if (!Number.isInteger(level) || level < 1 || level > def.costs.length) throw new GameError(`Perk '${id}' has levels 1 to ${def.costs.length}`);
      return { def, level };
    });
  }

  private harder(line: string): string {
    if (this.rules.latencyMultiplier === 1) return line;
    return line.replace(/^(\s*p[\d.]+\s+"[^"]*"\s*<\s*)(\d+(?:\.\d+)?)ms/, (_, head: string, ms: string) => `${head}${Math.max(1, Math.round(Number(ms) * this.rules.latencyMultiplier))}ms`);
  }

  private expect(phase: Phase) {
    if (this.state.phase !== phase) throw new GameError(`Not now: the run is in its ${this.state.phase} phase`);
  }

  private checkBoard(board: Board) {
    const problems = this.problems(board);
    if (problems.length) throw new GameError(problems[0]);
  }
}

/** Requests per second on each wire, for the particles. */

function baseProfile(tech: string, make: () => Profile): Profile {
  let p = PROFILE_CACHE.get(tech);
  if (!p) {
    p = make();
    PROFILE_CACHE.set(tech, p);
  }
  return p;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function argmax(xs: readonly number[]): number {
  let best = 0;
  xs.forEach((x, i) => {
    if (x > xs[best]) best = i;
  });
  return best;
}

function structuredCloneAction(a: Action): Action {
  return JSON.parse(JSON.stringify(a)) as Action;
}
