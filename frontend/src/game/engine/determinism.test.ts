import { describe, expect, it } from 'vitest';
import { allUnlocks, applyPlay, type Play, type ScriptedRun } from './check';
import { readContent } from './content';
import { Game, GameError, mutatorsFor } from './run';
import { WAVES } from './rules';
import type { Action, Board, GameContent, RunSetup } from './types';

/**
 * Determinism guard: every scripted run (each scenario's reference and wrong
 * runs, the references with every mutator, under the basic rules, at higher
 * ascension, with perks and into Endless) replayed against a snapshot of what
 * the engine produced. The trace covers the scores and outcomes, every tick's
 * result, the forecasts, and the errors of a fixed set of illegal actions at
 * each step, so a refactor that changes any rule or validation fails here.
 * A deliberate rule change bumps GAME_VERSION and updates the snapshot
 * (`npx vitest run determinism -u`).
 */

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);

/** cyrb53: a fast 53-bit string hash, as hex. */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const EMPTY: Board = { nodes: [], edges: [] };

interface Trace {
  /** Everything observed, in order; hashed into the snapshot. */
  events: unknown[];
}

/** Applies an action that must be refused, and records the refusal. */
function probe(game: Game, trace: Trace, action: Action) {
  const before = JSON.stringify(game.state);
  try {
    game.apply(action);
    throw new Error(`probe ${JSON.stringify(action)} was accepted`);
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    trace.events.push(['refused', action.t, e.message]);
  }
  if (JSON.stringify(game.state) !== before) throw new Error(`probe ${action.t} changed the state`);
}

function probePlan(game: Game, trace: Trace) {
  const s = game.state;
  const migration = game.scenario.migrations[0]?.id ?? 'nope';
  const probes: Action[] = [
    { t: 'pick', card: 0 },
    { t: 'reroll' },
    { t: 'contract', pick: null },
    { t: 'endless' },
    { t: 'retire' },
    { t: 'oncall', tick: 0 },
    { t: 'change', tick: 0, board: s.board },
    { t: 'bounty', pick: 99 },
    { t: 'mutator', pick: 99 },
    { t: 'migrate', id: 'nope', to: 'next' },
    { t: 'migrate', id: migration, to: 'sideways' as 'next' },
    { t: 'diagnose', pick: 'nope' },
    { t: 'sunset', useCase: 'nope' },
    { t: 'deploy', board: EMPTY },
    { t: 'loadtest', board: EMPTY },
    { t: 'bogus' } as unknown as Action,
  ];
  // A legacy use case whose replacement is not live yet cannot be sunset.
  for (const [key, uc] of Object.entries(game.scenario.useCases)) {
    if (uc.legacy && (!s.useCases.includes(key) || !s.useCases.includes(uc.legacy.replacedBy) || s.sunset.includes(key))) probes.push({ t: 'sunset', useCase: key });
  }
  for (const p of probes) probe(game, trace, p);
}

function probeRun(game: Game, trace: Trace) {
  const s = game.state;
  const probes: Action[] = [
    { t: 'oncall', tick: -1 },
    { t: 'oncall', tick: s.tick, act: 'bogus' as 'replica' },
    { t: 'oncall', tick: s.tick, act: 'reboot', node: 'nope' },
    { t: 'oncall', tick: s.tick, act: 'shed', useCase: 'nope' },
    { t: 'oncall', tick: 99 },
    { t: 'change', tick: s.tick, board: s.rollout?.board ?? s.board },
    { t: 'change', tick: s.tick, board: EMPTY },
  ];
  for (const p of probes) probe(game, trace, p);
}

function probeDraft(game: Game, trace: Trace) {
  for (const p of [{ t: 'deploy', board: EMPTY }, { t: 'pick', card: 99 }, { t: 'contract', pick: null }, { t: 'migrate', id: 'nope', to: 'next' }] as Action[]) probe(game, trace, p);
}

function observePlan(game: Game, trace: Trace, board: Board) {
  trace.events.push(['forecast', game.forecast()]);
  trace.events.push(['plan', game.problems(board), game.monthlyCost(board), game.codeLevel(), game.upkeep(), game.rerollCost(), game.mods, game.spread(), game.surprises()]);
}

interface Options {
  /** Keep going into Endless after clearing, for this many waves. */
  endless?: number;
  /** Take the bounty at this index on offer every wave. */
  bounty?: number;
  /** Load test, reroll, hotfix and ship a live change every wave, whether or not they are allowed. */
  busy?: boolean;
}

/** An action that may be refused: its outcome is recorded either way. */
function attempt(game: Game, trace: Trace, action: Action) {
  try {
    trace.events.push(['tried', action.t, game.apply(action) ?? null]);
  } catch (e) {
    if (!(e instanceof GameError)) throw e;
    trace.events.push(['tried', action.t, e.message]);
  }
}

/** The hotfixes and live changes of a busy wave, a different mix each wave. */
function busyRun(game: Game, trace: Trace) {
  const s = game.state;
  const app = s.board.nodes.find((n) => n.component === 'app' || n.component === 'worker')?.id ?? 'nope';
  const cache = s.board.nodes.find((n) => n.component === 'cache')?.id;
  const optional = s.useCases.find((k) => game.scenario.useCases[k]?.optional) ?? s.useCases[s.useCases.length - 1];
  const hotfixes: Action[] = [
    { t: 'oncall', tick: 2, node: app },
    { t: 'oncall', tick: 2, act: 'reboot', node: cache ?? app },
    { t: 'oncall', tick: 2, act: 'warm' },
    { t: 'oncall', tick: 2, act: 'ratelimit' },
    { t: 'oncall', tick: 2, act: 'shed', useCase: optional },
  ];
  const k = s.wave % hotfixes.length;
  const steps: Action[] = [
    { t: 'change', tick: 1, board: { ...s.board, nodes: s.board.nodes.map((n) => (n.id === app ? { ...n, replicas: n.replicas + 1 } : n)) } },
    hotfixes[k],
    { ...hotfixes[(k + 2) % hotfixes.length], tick: 3 } as Action,
    // A cache shipped mid-wave starts cold.
    cache
      ? { t: 'change', tick: 4, board: { ...s.board, nodes: s.board.nodes.map((n) => (n.id === app ? { ...n, tier: 1 } : n)) } }
      : { t: 'change', tick: 4, board: { nodes: [...s.board.nodes, { id: 'warmcache', component: 'cache', replicas: 1 }], edges: [...s.board.edges, [app, 'warmcache']] } },
    { ...hotfixes[(k + 4) % hotfixes.length], tick: 5 } as Action,
  ];
  for (const a of steps) if (s.phase === 'run') attempt(game, trace, a);
}

/** playScript (check.ts) with every step observed and probed. */
function play(content: GameContent, setup: RunSetup, run: ScriptedRun, opts: Options = {}) {
  const trace: Trace = { events: [] };
  const game = new Game(content, setup);
  const s = game.state;
  const tick = (r: unknown) => trace.events.push(['tick', r]);
  // Every tick run, including those apply() runs to reach an on-call's tick.
  const advance = game.advance.bind(game);
  game.advance = () => {
    const r = advance();
    tick(r);
    return r;
  };
  if (run.mutator) {
    s.mutatorOffer = [run.mutator];
    game.apply({ t: 'mutator', pick: 0 });
  }
  let endless = 0;
  for (let w = 0; s.phase !== 'over' && w < WAVES + (opts.endless ?? 0); w++) {
    if (s.phase === 'cleared') {
      probe(game, trace, { t: 'deploy', board: s.board });
      if (endless < (opts.endless ?? 0)) game.apply({ t: 'endless' });
      else {
        game.apply({ t: 'retire' });
        break;
      }
    }
    if (s.endless) endless++;
    const play: Play = run.plays[w] ?? {};
    probePlan(game, trace);
    for (const m of play.migrate ?? []) {
      game.apply({ t: 'migrate', id: m.id, to: m.to });
      probe(game, trace, { t: 'migrate', id: m.id, to: 'next' });
    }
    for (const key of play.sunset ?? []) {
      game.apply({ t: 'sunset', useCase: key });
      probe(game, trace, { t: 'sunset', useCase: key });
    }
    if (game.waveDef().diagnosis) {
      game.apply({ t: 'diagnose', pick: play.diagnose ?? game.waveDef().diagnosis!.options[0].id });
      if ((s.phase as string) === 'over') break;
      probe(game, trace, { t: 'diagnose', pick: game.waveDef().diagnosis!.options[0].id });
    }
    const board = (game.twists ? [] : (play.live ?? [])).reduce(applyPlay, applyPlay(s.board, play));
    observePlan(game, trace, board);
    const bounty = opts.bounty ?? (play.bounty === 'first' ? 0 : play.bounty ? s.bountyOffer.indexOf(play.bounty) : -1);
    if (bounty >= 0 && s.bountyOffer[bounty]) {
      game.apply({ t: 'bounty', pick: bounty });
      probe(game, trace, { t: 'bounty', pick: 0 });
    }
    if (play.loadtest || opts.busy) attempt(game, trace, { t: 'loadtest', board });
    if (opts.busy) attempt(game, trace, { t: 'loadtest', board });
    game.apply({ t: 'deploy', board });
    probeRun(game, trace);
    if (opts.busy) busyRun(game, trace);
    type During = { tick: number; oncall?: NonNullable<Play['oncall']>[number]; live?: NonNullable<Play['live']>[number] };
    const during: During[] = [...(play.oncall ?? []).map((o) => ({ tick: o.tick, oncall: o })), ...(game.twists ? (play.live ?? []) : []).map((l) => ({ tick: l.tick, live: l }))].sort((a, b) => a.tick - b.tick);
    for (const d of during) {
      if (s.phase !== 'run') break;
      if (d.live) {
        game.apply({ t: 'change', tick: d.tick, board: applyPlay(s.rollout?.board ?? s.board, d.live) });
        probeRun(game, trace);
        continue;
      }
      const o = d.oncall!;
      game.apply({ t: 'oncall', tick: o.tick, ...(o.node ? { node: o.node } : {}), ...(o.act ? { act: o.act } : {}), ...(o.useCase ? { useCase: o.useCase } : {}) });
      if (s.phase === 'run') probeRun(game, trace);
    }
    while (s.phase === 'run') game.advance();
    trace.events.push(['wave', s.history[s.history.length - 1], s.cash, s.trust, s.score, s.phase]);
    if (s.phase === 'draft') {
      probeDraft(game, trace);
      for (let i = 0; i < (play.reroll ?? 0); i++) game.apply({ t: 'reroll' });
      if (opts.busy) attempt(game, trace, { t: 'reroll' });
      trace.events.push(['offer', [...s.offer], game.rerollCost(), game.pool().map((c) => c.id)]);
      const wanted = play.pick ? (Array.isArray(play.pick) ? play.pick : [play.pick]) : [];
      const at = wanted.map((id) => s.offer.indexOf(id)).find((i) => i >= 0) ?? -1;
      game.apply({ t: 'pick', card: at >= 0 ? at : null });
    }
    if (s.phase === 'contract') {
      trace.events.push(['contracts', [...s.contractOffer]]);
      const at = play.contract ? s.contractOffer.indexOf(play.contract) : -1;
      game.apply({ t: 'contract', pick: at >= 0 ? at : null });
    }
  }
  if (s.phase === 'cleared') game.apply({ t: 'retire' });
  trace.events.push(['end', game.blueprints(true), game.blueprints(false), game.seen()]);
  return { game, trace };
}

interface Case {
  name: string;
  scenario: string;
  setup: Partial<RunSetup>;
  run: ScriptedRun;
  opts?: Options;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const s of content.scenarios) {
    const dir = `scenarios/${s.id}`;
    const reference = JSON.parse(files[`${dir}/reference.json`]) as ScriptedRun;
    out.push({ name: `${s.id}/reference`, scenario: s.id, setup: {}, run: reference });
    for (const path of Object.keys(files).filter((p) => p.startsWith(`${dir}/wrong/`) && p.endsWith('.json')).sort()) {
      out.push({ name: `${s.id}/${path.slice(dir.length + 1)}`, scenario: s.id, setup: {}, run: JSON.parse(files[path]) as ScriptedRun });
    }
    out.push({ name: `${s.id}/reference, busy`, scenario: s.id, setup: {}, run: reference, opts: { busy: true } });
    if (s.mode !== 'scale') continue;
    for (const b of [0, 1, 2]) out.push({ name: `${s.id}/reference, bounty ${b}`, scenario: s.id, setup: {}, run: reference, opts: { bounty: b } });
    out.push({ name: `${s.id}/reference, busy, basic rules`, scenario: s.id, setup: {}, run: { ...reference, twists: false }, opts: { busy: true } });
    out.push({ name: `${s.id}/reference, basic rules`, scenario: s.id, setup: {}, run: { ...reference, twists: false } });
    out.push({ name: `${s.id}/reference, endless`, scenario: s.id, setup: {}, run: reference, opts: { endless: 2 } });
    out.push({ name: `${s.id}/reference, ascension 4`, scenario: s.id, setup: { ascension: 4 }, run: reference });
    out.push({ name: `${s.id}/reference, ascension 10`, scenario: s.id, setup: { ascension: 10 }, run: reference });
    for (const m of mutatorsFor(content, s.id)) out.push({ name: `${s.id}/reference + ${m.id}`, scenario: s.id, setup: {}, run: { ...reference, mutator: m.id } });
  }
  const shortly = JSON.parse(files['scenarios/shortly/reference.json']) as ScriptedRun;
  out.push({
    name: 'shortly/reference, perks',
    scenario: 'shortly',
    setup: { loadout: { unlocked: allUnlocks(content), perks: Object.fromEntries(content.perks.slice(0, 3).map((p) => [p.id, 1])) }, ascension: 0 },
    run: shortly,
  });
  out.push({ name: 'shortly/reference, starter card', scenario: 'shortly', setup: { loadout: { unlocked: allUnlocks(content), perks: { 'starter-card': 1, 'second-pager': 1, 'load-lab': 1 } }, ascension: 0 }, run: shortly });
  out.push({ name: 'shortly/reference, another seed', scenario: 'shortly', setup: { seed: 'determinism' }, run: shortly });
  return out;
}

describe('determinism', () => {
  it('every scripted run replays exactly as it did before', async () => {
    const snapshot: Record<string, unknown> = {};
    for (const c of cases()) {
      const setup: RunSetup = {
        scenario: c.scenario,
        seed: c.run.seed,
        ascension: c.run.ascension ?? 0,
        mode: 'normal',
        loadout: c.run.loadout ?? { unlocked: allUnlocks(content), perks: {} },
        ...(c.run.twists === false ? { twists: false } : {}),
        ...c.setup,
      };
      let entry: Record<string, unknown>;
      try {
        const { game, trace } = play(content, setup, c.run, c.opts);
        const s = game.state;
        // The Worker's replay of the log gives the same run.
        if (!c.run.mutator) {
          const replayed = Game.replay(content, setup, s.log);
          expect(JSON.stringify(replayed.state), `${c.name}: replay`).toBe(JSON.stringify(s));
        }
        entry = {
          outcome: s.outcome ?? s.phase,
          waves: s.history.length,
          score: s.score,
          cash: s.cash,
          trust: s.trust,
          perWave: s.history.map((h) => `${h.points}/${h.leanBonus}/${h.bossBonus}/${h.trustDelta}/${h.clean ? 'c' : '-'}${h.bounty ? `/${h.bounty.id}:${h.bounty.met}` : ''}`),
          tried: trace.events.filter((e) => Array.isArray(e) && e[0] === 'tried').length,
          actions: s.log.length,
          refusals: trace.events.filter((e) => Array.isArray(e) && e[0] === 'refused').length,
          state: hash(JSON.stringify(s)),
          trace: hash(JSON.stringify(trace.events)),
        };
      } catch (e) {
        entry = { error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
      }
      snapshot[c.name] = entry;
    }
    await expect(JSON.stringify(snapshot, null, 1) + '\n').toMatchFileSnapshot('./__snapshots__/determinism.json');
  }, 120_000); // 93 full runs: well past the 5 s default on a CI runner.
});
