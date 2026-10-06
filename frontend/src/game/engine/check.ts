import { componentCatalog } from '../../catalog/componentCatalog';
import { kindOf } from '../../dsl/kinds';
import { parse } from '../../dsl/parser';
import { boardProblems, cloneBoard } from './board';
import { USERS, WAN_MS } from './compile';
import { readContent, type ContentError } from './content';
import { isIconName } from './icons';
import { BREACH_KINDS, Game, GameError, LEARN_IDS, mutatorsFor, parseRequirements, type BreachKind, type Outcome } from './run';
import { MAX_ASCENSION, MUTATOR_OFFER, WAVES } from './rules';
import { BOUNTY_KINDS, EVENT_EFFECTS, LANES, ROLES, STORES, type Action, type Board, type BoardNode, type GameContent, type Loadout, type OncallAct, type RunSetup, type ScenarioDef } from './types';

/**
 * `proschi game check`: everything a content change can get wrong, checked
 * before it ships (docs/GAME.md, "Checks"). The same function runs in the
 * frontend tests, so a broken scenario fails `npm test` too.
 */

export interface GameViolation {
  file: string;
  message: string;
  line?: number;
}

export interface GameCheck {
  content: GameContent;
  violations: GameViolation[];
  /** Per scenario: how the reference run and the wrong runs ended. */
  runs: { scenario: string; name: string; outcome?: Outcome; waves: number; score: number; ms: number }[];
}

export interface CheckContext {
  /** Review card ids (frontend/src/practice/cards). */
  cards: ReadonlySet<string>;
  /** Practice problem ids. */
  problems: ReadonlySet<string>;
  /** Topic tags of the review cards. */
  topics: ReadonlySet<string>;
}

export const LOCK_FILE = 'ids.lock';

/** A wave of a reference or wrong run, written by hand: a board change, then what to pick. */
export interface Play {
  /** Changes to the board deployed last wave (or the start board). */
  add?: BoardNode[];
  remove?: string[];
  set?: Record<string, Partial<Omit<BoardNode, 'id' | 'component'>>>;
  wire?: [string, string][];
  unwire?: [string, string][];
  /** Load test the plan first. */
  loadtest?: boolean;
  /** On-call actions during the run: `act` is replica (the default), reboot, warm, ratelimit or shed (with `useCase`). */
  oncall?: { tick: number; node?: string; act?: OncallAct; useCase?: string }[];
  /** Hold the line: board changes shipped during the run, at a tick (0-based), applied to the board as it stands. */
  live?: (Omit<Play, 'live' | 'oncall' | 'pick' | 'contract' | 'reroll' | 'loadtest' | 'migrate' | 'sunset' | 'diagnose' | 'bounty'> & { tick: number })[];
  /** A bounty id to take if it is on offer, before deploying; `first` takes the first on offer. */
  bounty?: string;
  /** Rerolls before picking. */
  reroll?: number;
  /** Card ids to take, in order of preference; the first one on offer is taken, else none. A new card in the pool changes the offers, so list a fallback. */
  pick?: string | string[] | null;
  /** A contract id to sign if offered, else none. */
  contract?: string | null;
  /** Migration steps before deploying, in order. */
  migrate?: { id: string; to: 'next' | 'rollback' | 'big-bang' }[];
  /** Legacy use cases to stop serving before deploying. */
  sunset?: string[];
  /** The diagnosis option to pick, on a wave that asks for one. */
  diagnose?: string;
}

export interface ScriptedRun {
  seed: string;
  ascension?: number;
  loadout?: Loadout;
  /** A mutator to play with (any of mutators.json, offered or not). */
  mutator?: string;
  /**
   * `false` plays the basic rules of a first run (`RunSetup.twists`): no
   * bounty or contract is offered, and `live` changes are made before the
   * deploy instead, since there are none during the run.
   */
  twists?: boolean;
  /** One per wave, from the first; waves past the list keep the board and skip every choice. */
  plays: Play[];
  /**
   * reference.json: `cleared`. wrong/*.json: `failsBy`, the last wave
   * (1-based) it may reach, and/or `shows`, breach kinds its history must
   * contain: the mistake it is about, even when the run survives it.
   */
  expect: { cleared: true } | { failsBy: number; shows?: BreachKind[] } | { shows: BreachKind[] };
  /** What the run shows a contributor, one line. */
  note?: string;
}

export function applyPlay(board: Board, play: Play): Board {
  const b = cloneBoard(board);
  for (const id of play.remove ?? []) {
    b.nodes = b.nodes.filter((n) => n.id !== id);
    b.edges = b.edges.filter(([a, c]) => a !== id && c !== id);
  }
  for (const n of play.add ?? []) b.nodes.push({ ...n });
  for (const [id, changes] of Object.entries(play.set ?? {})) {
    const n = b.nodes.find((x) => x.id === id);
    if (!n) throw new GameError(`set: no node '${id}'`);
    Object.assign(n, changes);
  }
  for (const [a, c] of play.unwire ?? []) b.edges = b.edges.filter(([x, y]) => !(x === a && y === c));
  for (const e of play.wire ?? []) b.edges.push([e[0], e[1]]);
  return b;
}

/** Plays a scripted run to its end and returns the game. Throws GameError on an illegal step. */
export function playScript(content: GameContent, scenario: string, run: ScriptedRun, maxWaves = WAVES): Game {
  const setup: RunSetup = {
    scenario,
    seed: run.seed,
    ascension: run.ascension ?? 0,
    mode: 'normal',
    loadout: run.loadout ?? { unlocked: allUnlocks(content), perks: {} },
    ...(run.twists === false ? { twists: false } : {}),
  };
  const game = new Game(content, setup);
  const s = game.state;
  if (run.mutator) {
    // A script names its mutator whatever the seed offers: put it on offer, then take it.
    s.mutatorOffer = [run.mutator];
    game.apply({ t: 'mutator', pick: 0 });
  }
  for (let w = 0; s.phase !== 'over' && w < maxWaves; w++) {
    if (s.phase === 'cleared') {
      game.apply({ t: 'retire' });
      break;
    }
    const play = run.plays[w] ?? {};
    for (const m of play.migrate ?? []) game.apply({ t: 'migrate', id: m.id, to: m.to });
    for (const key of play.sunset ?? []) game.apply({ t: 'sunset', useCase: key });
    if (game.waveDef().diagnosis) {
      game.apply({ t: 'diagnose', pick: play.diagnose ?? game.waveDef().diagnosis!.options[0].id });
      if ((s.phase as string) === 'over') break;
    }
    // The basic rules have no live changes: the same changes are planned up front.
    const board = (game.twists ? [] : (play.live ?? [])).reduce(applyPlay, applyPlay(s.board, play));
    const bounty = play.bounty === 'first' ? 0 : play.bounty ? s.bountyOffer.indexOf(play.bounty) : -1;
    if (bounty >= 0 && s.bountyOffer[bounty]) game.apply({ t: 'bounty', pick: bounty });
    if (play.loadtest) game.apply({ t: 'loadtest', board });
    game.apply({ t: 'deploy', board });
    type During = { tick: number; oncall?: NonNullable<Play['oncall']>[number]; live?: NonNullable<Play['live']>[number] };
    const during: During[] = [...(play.oncall ?? []).map((o) => ({ tick: o.tick, oncall: o })), ...(game.twists ? (play.live ?? []) : []).map((l) => ({ tick: l.tick, live: l }))].sort((a, b) => a.tick - b.tick);
    for (const d of during) {
      if (s.phase !== 'run') break;
      if (d.live) {
        game.apply({ t: 'change', tick: d.tick, board: applyPlay(s.rollout?.board ?? s.board, d.live) });
        continue;
      }
      const o = d.oncall!;
      game.apply({ t: 'oncall', tick: o.tick, ...(o.node ? { node: o.node } : {}), ...(o.act ? { act: o.act } : {}), ...(o.useCase ? { useCase: o.useCase } : {}) });
    }
    while (s.phase === 'run') game.advance();
    if (s.phase === 'draft') {
      for (let i = 0; i < (play.reroll ?? 0); i++) game.apply({ t: 'reroll' });
      const wanted = play.pick ? (Array.isArray(play.pick) ? play.pick : [play.pick]) : [];
      const at = wanted.map((id) => s.offer.indexOf(id)).find((i) => i >= 0) ?? -1;
      game.apply({ t: 'pick', card: at >= 0 ? at : null });
    }
    if (s.phase === 'contract') {
      const at = play.contract ? s.contractOffer.indexOf(play.contract) : -1;
      game.apply({ t: 'contract', pick: at >= 0 ? at : null });
    }
  }
  if (s.phase === 'cleared') game.apply({ t: 'retire' });
  return game;
}

/** The actions of a played script, for replaying elsewhere. */
export const actionsOf = (game: Game): Action[] => game.state.log;

/** Every unlockable id: what a scripted run has unless it says otherwise. */
export function allUnlocks(content: GameContent): string[] {
  return [...content.components.map((c) => c.id), ...content.features.map((f) => f.id), ...content.cards.map((c) => c.id)];
}

/** The ids content publishes, as ids.lock lists them (`kind:id`). */
/** Waves in act 1: a mutator must leave the reference standing through them. */
const ACT_ONE = 4;
/** The scenario a new player learns on: its reference must clear under the basic rules too. */
export const FIRST_SCENARIO = 'shortly';

export function publishedIds(content: GameContent): string[] {
  return [
    ...content.components.map((c) => `component:${c.id}`),
    ...content.features.map((f) => `feature:${f.id}`),
    ...content.perks.map((p) => `perk:${p.id}`),
    ...content.mutators.map((m) => `mutator:${m.id}`),
    ...content.bounties.map((b) => `bounty:${b.id}`),
    ...content.cards.map((c) => `card:${c.id}`),
    ...content.events.map((e) => `event:${e.id}`),
    ...content.scenarios.map((s) => `scenario:${s.id}`),
  ];
}

export function checkGame(files: Record<string, string>, ctx: CheckContext): GameCheck {
  const { content, errors } = readContent(files);
  const violations: GameViolation[] = errors.map((e: ContentError) => ({ file: e.file, message: e.message.replace(/^[^:]*: /, ''), ...(e.line ? { line: e.line } : {}) }));
  const v = (file: string, message: string) => violations.push({ file, message });
  const runs: GameCheck['runs'] = [];

  // ids.lock: every id ever published stays.
  const lockText = files[LOCK_FILE];
  const ids = publishedIds(content);
  if (lockText === undefined) v(LOCK_FILE, 'Missing: run `proschi game lock`');
  else {
    const locked = new Set(lockText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
    for (const id of ids) if (!locked.has(id)) v(LOCK_FILE, `'${id}' is not in ids.lock: run \`proschi game lock\``);
    for (const id of locked) if (!ids.includes(id)) v(LOCK_FILE, `'${id}' was published and is gone: ids are never deleted (progress and replays refer to them)`);
  }

  const learn = (file: string, list: readonly string[]) => {
    for (const id of list) if (!ctx.cards.has(id)) v(file, `Review card '${id}' does not exist`);
  };
  for (const id of LEARN_IDS) if (!ctx.cards.has(id)) v('engine/run.ts', `Review card '${id}' does not exist`);

  // Components.
  const techs = new Set<string>(componentCatalog.map((c) => c.techStack));
  const componentIds = new Set<string>();
  for (const c of content.components) {
    const f = 'components.json';
    if (componentIds.has(c.id)) v(f, `Duplicate component '${c.id}'`);
    componentIds.add(c.id);
    if (!/^[a-z][a-z0-9]*$/.test(c.id) || c.id === USERS) v(f, `Component id '${c.id}' must be lowercase letters and digits, and not 'users'`);
    if (!ROLES.includes(c.role)) v(f, `'${c.id}': unknown role '${c.role}'`);
    if (!LANES.includes(c.lane)) v(f, `'${c.id}': unknown lane '${c.lane}'`);
    if (!techs.has(c.tech)) v(f, `'${c.id}': '${c.tech}' is not a catalog tech stack`);
    for (const k of ['name', 'examples', 'summary', 'tradeoff'] as const) if (!c[k]) v(f, `'${c.id}' needs "${k}"`);
    if (!(c.unlock >= 0)) v(f, `'${c.id}': unlock is a number of Blueprints`);
    learn(f, c.learn ?? []);
  }
  for (const c of content.components) for (const r of c.requires ?? []) if (!componentIds.has(r)) v('components.json', `'${c.id}' requires unknown '${r}'`);
  for (const f of content.features) learn('components.json', f.learn);
  for (const p of content.perks) if (!p.costs.length || p.costs.some((x) => !(x > 0))) v('perks.json', `'${p.id}' needs positive costs`);
  // Icons: each one known, and unique within its category (perks, cards, events).
  const icons = (items: readonly { id: string; icon?: string }[], file: (id: string) => string, kind: string) => {
    const seen = new Map<string, string>();
    for (const it of items) {
      const f = file(it.id);
      if (typeof it.icon !== 'string' || !it.icon) v(f, `'${it.id}' needs an "icon" (a name from engine/icons.ts)`);
      else if (!isIconName(it.icon)) v(f, `'${it.id}': unknown icon '${it.icon}'; add it to engine/icons.ts and ui/gameIcons.tsx, or pick one listed there`);
      else if (seen.has(it.icon)) v(f, `'${it.id}': icon '${it.icon}' is already used by the ${kind} '${seen.get(it.icon)}'; each ${kind} has its own`);
      else seen.set(it.icon, it.id);
    }
  };
  icons(content.perks, () => 'perks.json', 'perk');
  icons(content.mutators, () => 'mutators.json', 'mutator');
  icons(content.bounties, () => 'bounties.json', 'bounty');
  icons(content.cards, (id) => `cards/${id}.md`, 'card');
  icons(content.events, (id) => `events/${id}.md`, 'event');
  const startUnlocked = content.components.filter((c) => c.unlock === 0).map((c) => c.role);
  for (const r of ['lb', 'app', 'db'] as const) if (!startUnlocked.includes(r)) v('components.json', `A first run needs a ${r} that is unlocked from the start`);

  const targetOk = (t: string | undefined) => !t || t === 'any' || componentIds.has(t) || (ROLES as readonly string[]).includes(t);
  for (const c of content.cards) {
    const f = `cards/${c.id}.md`;
    learn(f, c.learn);
    if (!ctx.topics.has(c.topic)) v(f, `Unknown topic '${c.topic}'`);
    if (!targetOk(c.target)) v(f, `Unknown target '${c.target}'`);
    if (['capacity', 'latency', 'cost', 'payload', 'hot-key', 'reserved', 'spot'].includes(c.effect) && !(c.value > 0)) v(f, `A ${c.effect} card needs a positive multiplier in "value:"`);
    const d = c.downside;
    if (d) {
      if (!targetOk(d.target)) v(f, `Unknown downside target '${d.target}'`);
      const worse = ['capacity', 'cache-hit', 'edge-hit'].includes(d.effect) ? d.value < (d.effect === 'capacity' ? 1 : 0) : d.effect === 'trust' || d.effect === 'interest' ? d.value < 0 : d.value > 1;
      if (!worse || (d.effect === 'capacity' && !(d.value > 0))) v(f, `A downside works against you: "downside-value: ${d.value}" helps (${d.effect})`);
      if (!/downside|but|costs|cost /i.test(c.text)) v(f, 'Say the downside in "## Text"');
    }
  }
  for (const e of content.events) {
    const f = `events/${e.id}.md`;
    learn(f, e.learn);
    if (!ctx.topics.has(e.topic)) v(f, `Unknown topic '${e.topic}'`);
    if (e.effect !== 'write-surge' && e.effect !== 'traffic' && e.effect !== 'external-slow' && !targetOk(e.target)) v(f, `Unknown target '${e.target}'`);
    if (e.effect === 'cache-cold' && !e.values?.length) v(f, 'A cache-cold event needs "values:" per tick');
    if (['traffic', 'bots', 'latency', 'hot-key', 'external-slow', 'write-surge'].includes(e.effect) && !(e.value !== undefined && e.value > 0)) v(f, `A ${e.effect} event needs a positive "value:"`);
    if (!(e.duration >= 1 && e.duration <= 8)) v(f, 'duration is 1 to 8 ticks');
    for (const c of e.counters) if (!content.cards.some((x) => x.id === c)) v(f, `Counter '${c}' is not a card`);
    if (e.then !== undefined && (e.then === e.id || !content.events.some((x) => x.id === e.then))) v(f, `"then: ${e.then}" names another event`);
  }

  // Mutators and bounties.
  const unique = (items: readonly { id: string }[], file: string, kind: string) => {
    const seen = new Set<string>();
    for (const it of items) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(it.id)) v(file, `${kind} id '${it.id}' must be lowercase words joined by "-"`);
      if (seen.has(it.id)) v(file, `Duplicate ${kind} '${it.id}'`);
      seen.add(it.id);
    }
  };
  unique(content.mutators, 'mutators.json', 'mutator');
  unique(content.bounties, 'bounties.json', 'bounty');
  if (content.mutators.length < MUTATOR_OFFER) v('mutators.json', `A run offers ${MUTATOR_OFFER} mutators: add at least that many`);
  for (const m of content.mutators) {
    const f = 'mutators.json';
    for (const k of ['name', 'text', 'why'] as const) if (!m[k]) v(f, `'${m.id}' needs "${k}"`);
    learn(f, m.learn ?? []);
    if (!(m.score > 1 && m.score <= 2)) v(f, `'${m.id}': score is a multiplier above 1, at most 2`);
    for (const c of m.cost ?? []) if (!targetOk(c.target) || !(c.mult > 0)) v(f, `'${m.id}': a cost needs a known target and a positive multiplier`);
    for (const x of [m.traffic?.read, m.traffic?.write, m.cash, m.interest]) if (x !== undefined && !(x > 0)) v(f, `'${m.id}': multipliers are positive`);
    if (m.global !== undefined && !(m.global > 0 && m.global < 1)) v(f, `'${m.id}': global is a share 0.01 to 0.99`);
    for (const e of m.events ?? []) {
      if (!content.events.some((x) => x.id === e.id)) v(f, `'${m.id}': unknown event '${e.id}'`);
      if (!e.waves.length || e.waves.some((w) => !Number.isInteger(w) || w < 2 || w > WAVES)) v(f, `'${m.id}': event waves are 2 to ${WAVES} (the first wave's incidents are drawn before the pick)`);
    }
    if (!m.cost && !m.traffic && m.global === undefined && !m.cash && !m.interest && !m.events) v(f, `'${m.id}' changes nothing`);
    for (const id of m.excludes ?? []) if (!content.scenarios.some((x) => x.id === id)) v(f, `'${m.id}' excludes unknown scenario '${id}'`);
  }
  const breachKinds: readonly string[] = BREACH_KINDS;
  for (const b of content.bounties) {
    const f = 'bounties.json';
    for (const k of ['name', 'text'] as const) if (!b[k]) v(f, `'${b.id}' needs "${k}"`);
    if (!(BOUNTY_KINDS as readonly string[]).includes(b.kind)) v(f, `'${b.id}': unknown kind '${b.kind}'`);
    if (!(b.cash >= 0) || !(b.points > 0)) v(f, `'${b.id}' pays cash (0 or more) and points (more than 0)`);
    if (b.kind === 'max-utilization' && (!b.role || !(ROLES as readonly string[]).includes(b.role) || !(b.value! > 0 && b.value! < 1))) v(f, `'${b.id}': max-utilization needs a "role" and a "value" between 0 and 1`);
    if (b.kind === 'budget' && !(b.value! > 0 && b.value! < 1)) v(f, `'${b.id}': budget needs a "value", the bill's share of revenue (0 to 1)`);
    if (b.kind === 'no-breach' && !breachKinds.includes(b.breach ?? '')) v(f, `'${b.id}': no-breach needs a "breach" kind (${breachKinds.join(', ')})`);
    if (b.event && !(EVENT_EFFECTS as readonly string[]).includes(b.event)) v(f, `'${b.id}': unknown event effect '${b.event}'`);
  }

  for (const s of content.scenarios) checkScenario(s);

  function checkScenario(s: ScenarioDef) {
    const dir = `scenarios/${s.id}`;
    const jf = `${dir}/scenario.json`;
    const mf = `${dir}/scenario.md`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.id)) v(dir, 'The folder name must be lowercase words joined by "-"');
    for (const name of ['Briefing', 'Interview translation']) if (!s.sections[name]) v(mf, `Needs a "## ${name}" section`);
    learn(mf, s.cards);
    for (const p of s.related) if (!ctx.problems.has(p)) v(mf, `Practice problem '${p}' does not exist`);
    if (s.mode === 'scale') {
      if (s.waves.length !== WAVES) v(jf, `A scenario has ${WAVES} waves, not ${s.waves.length}`);
      for (const b of [3, 7, 11]) if (s.waves[b] && !s.waves[b].boss) v(jf, `Wave ${b + 1} ends an act: make it a boss ("boss": true)`);
    } else {
      if (s.waves.length < 4 || s.waves.length > WAVES) v(jf, `A ${s.mode} scenario has 4 to ${WAVES} waves, not ${s.waves.length}`);
      const ticketIds = new Set<string>();
      s.waves.forEach((w, i) => {
        if (!w.ticket) v(jf, `Wave ${i + 1}: a ${s.mode} scenario gives every wave a ticket`);
        else if (ticketIds.has(w.ticket.id)) v(jf, `Wave ${i + 1}: ticket '${w.ticket.id}' is used twice`);
        else ticketIds.add(w.ticket.id);
      });
    }
    const migrationIds = new Set<string>();
    for (const m of s.migrations) {
      if (migrationIds.has(m.id)) v(jf, `Two migrations are called '${m.id}'`);
      migrationIds.add(m.id);
      if (!(STORES as readonly string[]).includes(m.store)) v(jf, `Migration '${m.id}': store '${m.store}'? Stores are ${STORES.join(', ')}`);
      for (const key of [...m.needs, ...m.writers, ...m.oldReaders]) if (!s.useCases[key]) v(jf, `Migration '${m.id}' names unknown use case '${key}'`);
      for (const key of m.writers) if (s.useCases[key] && !s.useCases[key].steps.some((st) => st.op === 'write' && st.to === m.store)) v(jf, `Migration '${m.id}': '${key}' does not write ${m.store}`);
    }
    for (const [key, uc] of Object.entries(s.useCases)) {
      if (!uc.legacy) continue;
      if (!(uc.legacy.upkeep > 0)) v(jf, `Use case '${key}': a legacy version needs a positive "upkeep"`);
      if (!s.useCases[uc.legacy.replacedBy] || uc.legacy.replacedBy === key) v(jf, `Use case '${key}': "replacedBy" names the use case of the new version`);
    }
    if (s.unlock && !content.scenarios.some((x) => x.id === s.unlock!.scenario)) v(jf, `Unlocks after unknown scenario '${s.unlock.scenario}'`);

    const names = new Set<string>();
    for (const [key, uc] of Object.entries(s.useCases)) {
      if (!/^[a-z][a-z0-9-]*$/.test(key)) v(jf, `Use case key '${key}' must be lowercase`);
      if (!uc.name || /["()]/.test(uc.name)) v(jf, `Use case '${key}' needs a name without quotes or brackets`);
      if (names.has(uc.name)) v(jf, `Two use cases are called "${uc.name}"`);
      names.add(uc.name);
      if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(uc.method) || !uc.path?.startsWith('/')) v(jf, `Use case '${key}' needs a method and a /path`);
      if (!(uc.value >= 0)) v(jf, `Use case '${key}' needs a value`);
      if (!uc.steps?.length) v(jf, `Use case '${key}' needs steps`);
      for (const st of uc.steps ?? []) {
        if (st.op === 'call') {
          if (!s.externals.some((e) => e.id === st.to)) v(jf, `Use case '${key}' calls unknown external '${st.to}'`);
        } else if (st.op === 'read' || st.op === 'write') {
          if (!(STORES as readonly string[]).includes(st.to)) v(jf, `Use case '${key}': ${st.op} ${st.to}? Stores are ${STORES.join(', ')}`);
        } else v(jf, `Use case '${key}': step op is read, write or call`);
        if (st.entity && !/^[A-Za-z][A-Za-z0-9]*$/.test(st.entity)) v(jf, `Use case '${key}': entity '${st.entity}' must be one word`);
      }
      for (const r of [uc.cache, uc.edge]) if (r !== undefined && !(r >= 0 && r < 1)) v(jf, `Use case '${key}': hit ratios are 0 to 0.99`);
    }
    for (const e of s.externals) {
      const tech = componentCatalog.find((c) => c.techStack === e.tech);
      if (!tech || kindOf({ kind: 'component', type: tech.type, techStack: tech.techStack }) !== 'external') v(jf, `External '${e.id}': '${e.tech}' is not an external catalog tech`);
    }
    const lines: string[] = [];
    const checkLines = (where: string, ls: readonly string[]) => {
      for (const l of ls) {
        try {
          const [r] = parseRequirements([l]);
          if (!r) v(jf, `${where}: "${l}" is not a requirement`);
          else if ((r.kind === 'latency' || r.kind === 'availability') && !r.useCase) v(jf, `${where}: "${l}" must name a use case`);
          else if ('useCase' in r && r.useCase && !names.has(r.useCase)) v(jf, `${where}: "${l}" names no use case of this scenario`);
        } catch (e) {
          v(jf, `${where}: ${(e as Error).message}`);
        }
        lines.push(l);
      }
    };
    const seenKeys = new Set<string>();
    s.waves.forEach((w, i) => {
      for (const key of Object.keys(w.traffic)) {
        if (!s.useCases[key]) v(jf, `Wave ${i + 1}: traffic for unknown use case '${key}'`);
        seenKeys.add(key);
      }
      for (const key of seenKeys) if (i < s.waves.length && w.traffic[key] === undefined) v(jf, `Wave ${i + 1}: no traffic for '${key}' (once a use case starts, every wave gives its rps)`);
      checkLines(`Wave ${i + 1}`, w.requirements ?? []);
      for (const id of w.events ?? []) if (!content.events.some((e) => e.id === id)) v(jf, `Wave ${i + 1}: unknown event '${id}'`);
      for (const f of w.freshness ?? []) if (!s.useCases[f.useCase]?.steps.some((st) => st.async)) v(jf, `Wave ${i + 1}: freshness for '${f.useCase}', which has no async step`);
      if (w.debrief && !s.sections[`Debrief: ${w.debrief}`]) v(mf, `Wave ${i + 1} uses "## Debrief: ${w.debrief}", which is missing`);
      if (w.brief !== undefined && (typeof w.brief !== 'string' || !w.brief.trim() || w.brief.length > 240)) v(jf, `Wave ${i + 1}'s brief should be one or two sentences (at most 240 characters)`);
      if (w.global !== undefined && !(w.global >= 0 && w.global < 1)) v(jf, `Wave ${i + 1}: global is a share 0 to 0.99`);
    });
    for (const p of s.eventPool) if (!content.events.some((e) => e.id === p.id)) v(jf, `Event pool: unknown event '${p.id}'`);
    const contractIds = new Set<string>();
    for (const c of s.contracts) {
      if (contractIds.has(c.id)) v(jf, `Two contracts are called '${c.id}'`);
      contractIds.add(c.id);
      if (!c.name || !c.text) v(jf, `Contract '${c.id}' needs a name and text`);
      if (c.useCase && !s.useCases[c.useCase]) v(jf, `Contract '${c.id}' adds unknown use case '${c.useCase}'`);
      if (c.useCase && !(c.rps! > 0)) v(jf, `Contract '${c.id}' needs rps for its use case`);
      if (c.useCase && seenKeys.has(c.useCase)) v(jf, `Contract '${c.id}' adds '${c.useCase}', which the waves already add`);
      checkLines(`Contract ${c.id}`, c.requirements ?? []);
    }
    if (s.waves.some((w) => w.contract) && s.contracts.length < 3) v(jf, 'Offer at least 3 contracts');

    const components = new Map(content.components.map((c) => [c.id, c]));
    if (!s.start.board.nodes.some((n) => n.component === USERS)) v(jf, 'The start board needs a "users" node');
    for (const e of s.externals) if (!s.start.board.nodes.some((n) => n.component === e.id)) v(jf, `External '${e.id}' must be on the start board`);
    for (const p of boardProblems(s.start.board, s, components, { unlocked: new Set(components.keys()) })) v(jf, `Start board: ${p}`);
    for (const g of s.grants) if (!components.has(g)) v(jf, `Grants unknown component '${g}'`);
    for (const n of s.start.board.nodes) {
      const c = components.get(n.component);
      if (c && c.unlock > 0 && !s.grants.includes(c.id)) v(jf, `Start board: ${c.name} is not unlocked on a first run (grant it, or leave it out)`);
    }

    const plan = parse(`requirements {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`);
    if (plan.diagnostics.some((d) => d.severity === 'error')) return;

    // The reference with each mutator: a twist must leave the scenario winnable.
    if (s.mode === 'scale' && files[`${dir}/reference.json`]) {
      let reference: ScriptedRun | undefined;
      try {
        reference = JSON.parse(files[`${dir}/reference.json`]!) as ScriptedRun;
      } catch {
        reference = undefined;
      }
      for (const m of reference ? mutatorsFor(content, s.id) : []) {
        // Far users pay the ocean on every request an edge cannot answer: a latency limit under it can never be met.
        if (m.global) {
          for (const line of [...s.waves.flatMap((w) => w.requirements ?? []), ...s.contracts.flatMap((c) => c.requirements ?? [])]) {
            const [r] = parseRequirements([line]);
            const uc = r?.kind === 'latency' ? Object.values(s.useCases).find((u) => u.name === r.useCase) : undefined;
            if (r?.kind === 'latency' && uc && !uc.edge && r.maxMs <= WAN_MS) v('mutators.json', `'${m.id}' puts users an ocean (${WAN_MS} ms) away, so "${line}" in ${s.id} can never hold: add '${s.id}' to its excludes`);
          }
        }
        const started = performance.now();
        try {
          // Act 1 and the first wave after it are enough to tell: play no further, the check stays fast.
          const st = playScript(content, s.id, { ...reference!, mutator: m.id }, ACT_ONE + 1).state;
          runs.push({ scenario: s.id, name: `reference + ${m.id}`, outcome: st.outcome, waves: st.history.length, score: st.score, ms: performance.now() - started });
          if (st.outcome && st.history.length <= ACT_ONE) v(`${dir}/reference.json`, `With the mutator '${m.id}' the reference falls in act 1 (${st.outcome} in wave ${st.history.length}): a twist may force a new design later, not end a sound one at once. Soften it, or add '${s.id}' to its excludes`);
        } catch (e) {
          v(`${dir}/reference.json`, `With the mutator '${m.id}': ${e instanceof GameError ? e.message : String(e)}`);
        }
      }
    }

    // The basic rules of a first run (no twists): the reference must clear in the scenario players learn on, and survive act 1 in the rest.
    if (s.mode === 'scale' && files[`${dir}/reference.json`]) {
      const started = performance.now();
      try {
        const reference = JSON.parse(files[`${dir}/reference.json`]!) as ScriptedRun;
        const first = s.id === FIRST_SCENARIO;
        const st = playScript(content, s.id, { ...reference, twists: false }, first ? WAVES : ACT_ONE + 1).state;
        runs.push({ scenario: s.id, name: 'reference, basic rules', outcome: st.outcome, waves: st.history.length, score: st.score, ms: performance.now() - started });
        if (first && !st.cleared) v(`${dir}/reference.json`, `Under the basic rules of a first run the reference does not clear (${st.outcome ?? 'stopped'} in wave ${st.history.length}): the scenario new players learn on must be winnable without the twists`);
        else if (!first && st.outcome && st.history.length <= ACT_ONE) v(`${dir}/reference.json`, `Under the basic rules of a first run the reference falls in act 1 (${st.outcome} in wave ${st.history.length})`);
      } catch (e) {
        v(`${dir}/reference.json`, `Under the basic rules: ${e instanceof GameError ? e.message : e instanceof SyntaxError ? 'not JSON' : String(e)}`);
      }
    }

    // The runs: the reference clears, every wrong run fails in time, and doing nothing loses.
    const scripted: [string, string | undefined][] = [[`${dir}/reference.json`, files[`${dir}/reference.json`]]];
    for (const path of Object.keys(files).filter((p) => p.startsWith(`${dir}/wrong/`) && p.endsWith('.json')).sort()) scripted.push([path, files[path]]);
    if (!scripted[0][1]) v(`${dir}/reference.json`, 'Missing: a run that clears every wave (docs/GAME.md, "Reference runs")');
    if (scripted.length < 2) v(`${dir}/wrong`, 'Add at least one wrong run: a plausible design that must fail');
    scripted.push([`${dir}/do nothing`, JSON.stringify({ seed: 'idle', plays: [], expect: { failsBy: Math.min(8, s.waves.length - 1) } })]);
    for (const [path, text] of scripted) {
      if (!text) continue;
      let run: ScriptedRun;
      try {
        run = JSON.parse(text) as ScriptedRun;
      } catch (e) {
        v(path, `Not valid JSON: ${(e as Error).message}`);
        continue;
      }
      if (!run || typeof run.seed !== 'string' || !Array.isArray(run.plays) || !run.expect) {
        v(path, 'A scripted run has "seed", "plays" and "expect"');
        continue;
      }
      if (run.ascension !== undefined && !(run.ascension >= 0 && run.ascension <= MAX_ASCENSION)) v(path, `ascension is 0 to ${MAX_ASCENSION}`);
      const started = performance.now();
      let game: Game;
      try {
        game = playScript(content, s.id, run);
      } catch (e) {
        v(path, e instanceof GameError ? e.message : String(e));
        continue;
      }
      const ms = performance.now() - started;
      const st = game.state;
      runs.push({ scenario: s.id, name: path.replace(`${dir}/`, ''), outcome: st.outcome, waves: st.history.length, score: st.score, ms });
      if ('cleared' in run.expect) {
        if (!st.cleared) {
          const last = st.history[st.history.length - 1];
          v(path, `Must clear all ${s.waves.length} waves, but ended in wave ${st.history.length} (${st.outcome}): ${last?.worst?.message ?? 'no breach'}`);
        }
      } else {
        if ('failsBy' in run.expect) {
          const by = run.expect.failsBy;
          if (st.cleared || st.history.length > by) v(path, `Must fail by wave ${by}, but ${st.cleared ? 'cleared the scenario' : `reached wave ${st.history.length}`}`);
        }
        const kinds = new Set(st.history.flatMap((h) => h.breaches.map((b) => b.kind)));
        for (const k of run.expect.shows ?? []) if (!kinds.has(k)) v(path, `Must show a '${k}' breach, but it never happened`);
        if (!('failsBy' in run.expect) && !run.expect.shows?.length) v(path, 'A wrong run expects "failsBy", "shows", or both');
      }
    }
  }

  return { content, violations, runs };
}
