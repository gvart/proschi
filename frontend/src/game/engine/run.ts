import { boardKey, boardProblems, cloneBoard } from './board';
import { compile, type Compiled, type Situation } from './compile';
import { active, drawEvents, hotfix, multipliers } from './incidents';
import { computeMods, type Mods } from './mods';
import { blockedBy, migrationOf, MODES, ownerOf, type ModeRules } from './modes';
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
  LEAN_REFUND,
  LOADTEST_COST,
  MAX_TRUST,
  MAX_WAVES,
  OFFER_SIZE,
  ONCALL_PER_WAVE,
  RARITY_WEIGHTS,
  REROLL_COST,
  REROLL_STEP,
  SKIP_CARD_CASH,
  STREAK_STEP,
  SURPRISE_FROM_WAVE,
  TICKS,
  TRUST_BOSS,
  TRUST_CLEAN_WAVE,
} from './rules';
import { argmax, GameError, indexOf, mergeRequirements, type Breach, type Forecast, type Index, type MigrationState, type Outcome, type RunState, type TickResult, type WaveSummary } from './state';
import { evaluate } from './tick';
import * as twists from './twists';
import type { Action, Board, CardDef, CodeLevel, Curve, GameContent, MigrationDef, MutatorDef, Phase, RunSetup, ScenarioDef, UseCaseDef, WaveDef } from './types';

export * from './state';
export { mutatorsFor } from './twists';
export { backfillKey } from './modes';

/**
 * A run of Scale or Fail as a deterministic state machine: `new Game(content,
 * setup)`, then `apply(action)` for every decision and `advance()` for every
 * tick. The same setup and actions always give the same state, which is how
 * the Worker checks a submitted score (`replay`).
 *
 * This is the core every scenario shares: waves, the deploy, cards, scoring
 * and the end of a run. The scenario's mode (modes/) adds its mechanics, the
 * twists (twists.ts) what a run adds after a first clear, incidents.ts the
 * incidents and on-call, and tick.ts the simulation of one tick. Members
 * marked internal are for those modules, not the page.
 */
export class Game {
  readonly content: GameContent;
  readonly setup: RunSetup;
  readonly scenario: ScenarioDef;
  readonly state: RunState;
  /** The scenario's mode: its mechanics, and whether it drafts and plays the twists. */
  readonly mode: ModeRules;
  /** @internal */
  readonly index: Index;
  /** @internal */
  readonly rules: ReturnType<typeof ascensionRules>;
  private compiled = new Map<string, Compiled>();
  private effectiveCache?: { key: string; value: ReturnType<Game['effective']> };
  /** @internal The use cases, requirements and base traffic when the last wave began, to tell what is new. */
  briefed?: { useCases: string[]; requirements: string[]; traffic: number };

  constructor(content: GameContent, setup: RunSetup) {
    this.content = content;
    this.setup = setup;
    this.index = indexOf(content);
    const scenario = this.index.scenarios.get(setup.scenario);
    if (!scenario) throw new GameError(`Unknown scenario '${setup.scenario}'`);
    this.scenario = scenario;
    this.mode = MODES[scenario.mode];
    if (!Number.isInteger(setup.ascension) || setup.ascension < 0 || setup.ascension > 10) throw new GameError('Ascension is 0 to 10');
    if (setup.twists !== undefined && typeof setup.twists !== 'boolean') throw new GameError('twists is true or false');
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
      mutatorOffer: twists.mutatorOffer(content, scenario, setup, this.mode),
      paged: 0,
      tested: false,
      bountyOffer: [],
      demand: 1,
      mitigation: { reboot: {}, shed: {} },
      warming: {},
      changes: 0,
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

  /** Whether the run plays the advanced twists (`RunSetup.twists`); a player's first runs play the basic rules. */
  get twists(): boolean {
    return this.setup.twists !== false;
  }

  get mods(): Mods {
    const m = computeMods(
      this.state.hand.map((id) => this.index.cards.get(id)!),
      this.perks(),
      { streakStep: STREAK_STEP, interestCap: INTEREST_CAP },
    );
    return twists.twistMods(this, m);
  }

  /** The run's mutator, once picked. */
  get mutatorDef(): MutatorDef | undefined {
    return twists.mutatorDef(this);
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
    const spread = this.spread();
    const peak = this.state.useCases.map((key) => {
      const rps = this.baseRps(key) * multipliers[peakTick];
      return { key, name: this.scenario.useCases[key].name, rps: Math.round(rps), low: Math.round(rps * (1 - spread)), high: Math.round(rps * (1 + spread)) };
    });
    return {
      wave: this.state.wave,
      name: w.name,
      boss: !!w.boss,
      curve: w.curve ?? 'day',
      multipliers,
      peakTick,
      peak,
      spread,
      surprises: this.surprises(),
      requirements: this.state.requirements,
      freshness: this.state.freshness,
      events: this.state.events.filter((e) => !e.surprise).map((e) => {
        const def = this.index.events.get(e.id)!;
        return { id: e.id, title: def.title, telegraph: def.telegraph, ...(this.rules.hiddenTicks ? {} : { from: e.from }), duration: e.duration };
      }),
      global: this.state.global,
      contract: !!w.contract && this.twists && this.state.wave < this.scenario.waves.length - 1,
      ...(w.ticket ? { ticket: { ...w.ticket, text: this.scenario.sections[`Ticket: ${w.ticket.id}`] ?? '' } } : {}),
      news: this.state.news,
      ...(this.mutatorDef ? { mutator: this.mutatorDef } : {}),
      ...twists.bountyForecast(this),
    };
  }

  /** The share a Scale or Fail wave's real traffic may differ from the forecast by; 0 in the design-first modes and the basic rules. */
  spread(): number {
    return twists.spread(this);
  }

  /** Whether an incident may come unannounced this wave. */
  surprises(): boolean {
    return twists.surprises(this);
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

  /** A migration's state; one not started is at `none`. */
  migrationOf(id: string): MigrationState {
    return migrationOf(this, id);
  }

  /** The migration a use case waits for: it needs the new shape, and the cutover has not happened. */
  blockedBy(key: string): MigrationDef | undefined {
    return blockedBy(this, key);
  }

  /** Cash a wave the mode's mechanics cost (the legacy versions still served). */
  upkeep(): number {
    return this.mode.mechanics.reduce((a, m) => a + (m.upkeep?.(this) ?? 0), 0);
  }

  /** How many ticks a live change takes to provision: none when nothing changed. */
  provisioning(board: Board): number | undefined {
    return twists.provisioning(this, board);
  }

  // ---- Actions ----

  /** Applies one action; returns the load test's result for `loadtest`. */
  apply(action: Action): TickResult | undefined {
    const s = this.state;
    let result: TickResult | undefined;
    if (s.phase === 'run' && action.t !== 'oncall' && action.t !== 'change') while (s.phase === 'run') this.advance();
    switch (action.t) {
      case 'deploy': {
        this.expect('plan');
        for (const m of this.mode.mechanics) m.beforeDeploy?.(this);
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
      case 'oncall':
        this.reach(action.tick, 'Hotfixes happen during the run');
        hotfix(this, action);
        break;
      case 'change':
        this.reach(action.tick, 'Live changes happen during the run');
        twists.shipChange(this, action);
        break;
      case 'bounty':
        twists.takeBounty(this, action);
        break;
      case 'mutator':
        twists.pickMutator(this, action);
        break;
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
      case 'contract':
        twists.signContract(this, action);
        this.nextWave();
        break;
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
      default: {
        // The mode mechanics' actions (migrate, sunset, diagnose).
        const handler = ownerOf((action as Action).t) as ((game: Game, action: Action) => void) | undefined;
        if (!handler) throw new GameError('Unknown action');
        handler(this, action);
      }
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
    twists.land(this);
    const r = this.evaluate(s.board, s.tick, s.lag, false);
    s.lag = r.lag;
    s.cash += r.revenue - r.cost;
    s.trust = Math.min(s.maxTrust, s.trust + r.trustDelta);
    s.streak = r.streak;
    s.score += r.points;
    s.ticks.push(r);
    twists.cascade(this, r);
    s.tick++;
    if (s.trust <= 0) {
      s.trust = 0;
      this.summarize();
      this.end('churned');
    } else if (s.tick >= TICKS) this.endWave();
    return r;
  }

  /** During the run: runs the ticks up to `tick` (0-based) for an action taken then. */
  private reach(tick: number, refusal: string) {
    const s = this.state;
    this.expect('run');
    if (!Number.isInteger(tick) || tick < s.tick || tick >= TICKS) throw new GameError(refusal);
    while (s.tick < tick && s.phase === 'run') this.advance();
    this.expect('run');
  }

  // ---- Waves ----

  private startWave() {
    const s = this.state;
    const w = this.waveDef();
    s.phase = 'plan';
    s.tick = 0;
    s.ticks = [];
    s.rerolls = 0;
    for (const m of this.mode.mechanics) m.onWaveStart?.(this);
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
    s.events = drawEvents(this);
    delete s.bounty;
    s.bountyOffer = twists.drawBounties(this);
    s.mitigation = { reboot: {}, shed: {} };
    s.warming = {};
    s.changes = 0;
    s.demand = twists.demand(this);
    const traffic = s.useCases.reduce((a, key) => a + this.baseRps(key), 0);
    const prev = this.briefed;
    s.news = {
      useCases: s.useCases.filter((k) => !prev?.useCases.includes(k)),
      requirements: s.requirements.filter((l) => !prev?.requirements.includes(l)),
      ...(prev && prev.traffic > 0 ? { growth: traffic / prev.traffic } : {}),
      ...(this.surprises() && s.wave + 1 === SURPRISE_FROM_WAVE ? { surprises: true } : {}),
    };
    this.briefed = { useCases: [...s.useCases], requirements: [...s.requirements], traffic };
  }

  private endWave() {
    const s = this.state;
    // A change still provisioning is live by the next wave.
    twists.land(this, true);
    const summary = this.summarize();
    if (summary.clean) s.trust = Math.min(s.maxTrust, s.trust + TRUST_CLEAN_WAVE);
    if (summary.boss) s.trust = Math.min(s.maxTrust, s.trust + TRUST_BOSS);
    if (s.cash > 0) {
      const interest = Math.min(this.mods.interestCap, Math.floor(s.cash * INTEREST_RATE));
      summary.interest = interest;
      s.cash += interest;
    }
    s.score += summary.leanBonus + summary.bossBonus;
    if (summary.leanBonus > 0 && this.mode.leanRefund) {
      summary.leanCash = Math.round(summary.cost * LEAN_REFUND);
      s.cash += summary.leanCash;
    }
    twists.settleBounty(this, summary);
    if (s.cash < 0) return this.end('bankrupt');
    const last = s.wave + 1 >= (s.endless ? MAX_WAVES : this.scenario.waves.length);
    if (last) {
      if (s.endless) return this.end('max');
      s.cleared = true;
      s.phase = 'cleared';
      return;
    }
    if (!this.mode.draft) return this.afterDraft();
    s.phase = 'draft';
    s.offer = this.drawOffer();
    if (s.offer.length === 0) this.afterDraft();
  }

  /** @internal Closes the wave in the history. */
  summarize(): WaveSummary {
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
      ...(this.spread() ? { demand: s.demand } : {}),
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
    if (twists.offerContracts(this)) {
      this.state.phase = 'contract';
      return;
    }
    this.nextWave();
  }

  private nextWave() {
    this.state.wave++;
    this.startWave();
  }

  /** @internal Ends the run. */
  end(outcome: Outcome) {
    const s = this.state;
    s.outcome = outcome;
    s.phase = 'over';
    s.score += s.trust * END_TRUST_POINTS + Math.max(0, Math.floor(s.cash / END_CASH_DIVISOR));
  }

  // ---- Cards ----

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
    if (card.downside?.effect === 'trust') {
      s.maxTrust += card.downside.value;
      s.trust = Math.max(1, Math.min(s.maxTrust, s.trust + card.downside.value));
    }
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

  // ---- What a tick runs on ----

  /** @internal Base rps of a use case this wave, before the curve: the wave's traffic, or a contract's. */
  baseRps(key: string): number {
    const fixed = this.waveDef().traffic[key];
    const rps = fixed !== undefined ? fixed : twists.contractRps(this, key);
    return rps * this.rules.trafficMultiplier * twists.trafficMix(this, key);
  }

  /** @internal The incidents under way at a tick. */
  active(tick: number) {
    return active(this, tick);
  }

  /** @internal Traffic multiplier per tick: the curve, and spikes. */
  multipliers(): number[] {
    return multipliers(this);
  }

  /**
   * @internal The use cases as this wave runs them, as the mode's mechanics
   * shape them (a migration's writers and backfill), and those served.
   */
  effective(): { useCases: Record<string, UseCaseDef>; served: string[]; jobs: { key: string; rps: number }[] } {
    const s = this.state;
    const key = JSON.stringify([s.useCases, s.migrations, s.sunset]);
    if (this.effectiveCache?.key === key) return this.effectiveCache.value;
    const useCases: Record<string, UseCaseDef> = { ...this.scenario.useCases };
    const jobs: { key: string; rps: number }[] = [];
    for (const m of this.mode.mechanics) m.shapeUseCases?.(this, useCases, jobs);
    const served = [...s.useCases.filter((k) => this.mode.mechanics.every((m) => m.serves?.(this, k) ?? true)), ...jobs.map((j) => j.key)];
    const value = { useCases, served, jobs };
    this.effectiveCache = { key, value };
    return value;
  }

  /** @internal The board compiled to a diagram for a situation, cached. */
  compileFor(board: Board, situation: Situation): Compiled {
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
    return evaluate(this, board, tick, lagIn, quick);
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

  /** @internal A requirement line as the ascension tightens it. */
  harder(line: string): string {
    if (this.rules.latencyMultiplier === 1) return line;
    return line.replace(/^(\s*p[\d.]+\s+"[^"]*"\s*<\s*)(\d+(?:\.\d+)?)ms/, (_, head: string, ms: string) => `${head}${Math.max(1, Math.round(Number(ms) * this.rules.latencyMultiplier))}ms`);
  }

  /** @internal Throws unless the run is in `phase`. */
  expect(phase: Phase) {
    if (this.state.phase !== phase) throw new GameError(`Not now: the run is in its ${this.state.phase} phase`);
  }

  /** @internal Throws the first problem of a plan. */
  checkBoard(board: Board) {
    const problems = this.problems(board);
    if (problems.length) throw new GameError(problems[0]);
  }
}

function structuredCloneAction(a: Action): Action {
  return JSON.parse(JSON.stringify(a)) as Action;
}
