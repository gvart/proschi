import { componentCatalog } from '../../catalog/componentCatalog';
import { kindOf } from '../../dsl/kinds';
import { parse } from '../../dsl/parser';
import { boardProblems, cloneBoard } from './board';
import { USERS } from './compile';
import { readContent, type ContentError } from './content';
import { isIconName } from './icons';
import { Game, GameError, LEARN_IDS, parseRequirements, type BreachKind, type Outcome } from './run';
import { MAX_ASCENSION, WAVES } from './rules';
import { LANES, ROLES, STORES, type Action, type Board, type BoardNode, type GameContent, type Loadout, type RunSetup, type ScenarioDef } from './types';

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
  oncall?: { tick: number; node: string }[];
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
}

export interface ScriptedRun {
  seed: string;
  ascension?: number;
  loadout?: Loadout;
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
  };
  const game = new Game(content, setup);
  const s = game.state;
  for (let w = 0; s.phase !== 'over' && w < maxWaves; w++) {
    if (s.phase === 'cleared') {
      game.apply({ t: 'retire' });
      break;
    }
    const play = run.plays[w] ?? {};
    for (const m of play.migrate ?? []) game.apply({ t: 'migrate', id: m.id, to: m.to });
    for (const key of play.sunset ?? []) game.apply({ t: 'sunset', useCase: key });
    const board = applyPlay(s.board, play);
    if (play.loadtest) game.apply({ t: 'loadtest', board });
    game.apply({ t: 'deploy', board });
    for (const o of play.oncall ?? []) {
      if (s.phase !== 'run') break;
      game.apply({ t: 'oncall', tick: o.tick, node: o.node });
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

export function checkGame(files: Record<string, string>, ctx: CheckContext): GameCheck {
  const { content, errors } = readContent(files);
  const violations: GameViolation[] = errors.map((e: ContentError) => ({ file: e.file, message: e.message.replace(/^[^:]*: /, ''), ...(e.line ? { line: e.line } : {}) }));
  const v = (file: string, message: string) => violations.push({ file, message });
  const runs: GameCheck['runs'] = [];

  // ids.lock: every id ever published stays.
  const lockText = files[LOCK_FILE];
  const ids = [
    ...content.components.map((c) => `component:${c.id}`),
    ...content.features.map((f) => `feature:${f.id}`),
    ...content.perks.map((p) => `perk:${p.id}`),
    ...content.cards.map((c) => `card:${c.id}`),
    ...content.events.map((e) => `event:${e.id}`),
    ...content.scenarios.map((s) => `scenario:${s.id}`),
  ];
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
          v(path, `Must clear all ${WAVES} waves, but ended in wave ${st.history.length} (${st.outcome}): ${last?.worst?.message ?? 'no breach'}`);
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
