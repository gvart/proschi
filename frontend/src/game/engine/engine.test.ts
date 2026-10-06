import { describe, expect, it } from 'vitest';
import { checkGame, playScript, allUnlocks, type ScriptedRun } from './check';
import { compile } from './compile';
import { readContent } from './content';
import { buy, emptyMeta, equip, loadoutAllowed, loadoutFor, maxAscension, MetaError, recordRun, scenarioOpen, shop } from './meta';
import { Game, GameError, mergeRequirements } from './run';
import { MAX_WAVES, ONCALL_COST, TICKS, WAVES } from './rules';
import type { Board, RunSetup } from './types';

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const cardFiles = import.meta.glob('../../practice/cards/*/*.md', { query: '?raw', import: 'default', eager: true });
const tags = import.meta.glob('../../practice/cards/tags.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const problemFiles = import.meta.glob('../../practice/problems/*/problem.md', { query: '?raw', import: 'default', eager: true });

const ctx = {
  cards: new Set(Object.keys(cardFiles).map((p) => p.replace(/^.*\//, '').replace(/\.md$/, ''))),
  topics: new Set((JSON.parse(Object.values(tags)[0]) as { id: string }[]).map((t) => t.id)),
  problems: new Set(Object.keys(problemFiles).map((p) => p.split('/').slice(-2)[0])),
};
const { content, errors } = readContent(files);
const reference = (id: string) => JSON.parse(files[`scenarios/${id}/reference.json`]) as ScriptedRun;
const setup = (over: Partial<RunSetup> = {}): RunSetup => ({
  scenario: 'shortly',
  seed: 'test',
  ascension: 0,
  mode: 'normal',
  loadout: { unlocked: allUnlocks(content), perks: {} },
  ...over,
});

describe('game content', () => {
  it('reads without errors', () => {
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(content.scenarios.map((s) => s.id)).toEqual(['shortly', 'snapshots', 'ping', 'drop', 'pawprint', 'dinnerbell', 'monolith', 'runway']);
  });

  it('passes every check: ids, references, requirements, and the scripted runs', () => {
    const check = checkGame(files, ctx);
    expect(check.violations).toEqual([]);
    expect(check.runs.find((r) => r.scenario === 'shortly' && r.name === 'reference, basic rules')?.outcome).toBe('retired');
    expect(check.runs.filter((r) => r.name === 'reference.json').every((r) => r.outcome === 'retired' && r.waves === content.scenarios.find((s) => s.id === r.scenario)!.waves.length)).toBe(true);
  }, 30_000);

  it('finds what a contributor gets wrong', () => {
    const broken: Record<string, string> = { ...files, 'scenarios/shortly/scenario.json': files['scenarios/shortly/scenario.json'].replace('p99 \\"Redirect\\" < 200ms', 'p99 \\"Redirects\\" < 200ms').replace('"brief": "We\'re on the front page', '"brief": "   ", "x": "') };
    delete broken['events/ddos.md'];
    const messages = checkGame(broken, ctx).violations.map((v) => v.message);
    expect(messages).toContain('Wave 1: "p99 \\"Redirects\\" < 200ms" names no use case of this scenario'.replace(/\\"/g, '"'));
    expect(messages.some((m) => m.includes("unknown event 'ddos'"))).toBe(true);
    expect(messages.some((m) => m.includes("'event:ddos' was published and is gone"))).toBe(true);
    expect(messages).toContain("Wave 4's brief should be one or two sentences (at most 240 characters)");
  }, 30_000);
});

describe('a run', () => {
  it('replays to the same state from its setup and actions', () => {
    const played = playScript(content, 'shortly', reference('shortly'));
    const s = setup({ seed: reference('shortly').seed, loadout: reference('shortly').loadout! });
    const log = JSON.parse(JSON.stringify(played.state.log));
    const replayed = Game.replay(content, s, log);
    expect(replayed.state.score).toBe(played.state.score);
    expect(replayed.state.cash).toBe(played.state.cash);
    expect(replayed.state.outcome).toBe('retired');
    expect(replayed.state.history.map((h) => h.points)).toEqual(played.state.history.map((h) => h.points));
  });

  it('replays a full run well inside the Worker CPU budget', () => {
    const run = reference('ping');
    playScript(content, 'ping', run); // warm up
    const started = performance.now();
    playScript(content, 'ping', run);
    expect(performance.now() - started).toBeLessThan(600);
  });

  it('gives different events for different seeds and the same for the same seed', () => {
    const events = (seed: string) => {
      const g = playScript(content, 'shortly', { seed, plays: reference('shortly').plays, expect: { cleared: true } });
      return g.state.history.flatMap((h) => h.events.map((e) => `${e.id}@${e.from}`)).join(',');
    };
    expect(events('a')).toBe(events('a'));
    expect(events('a')).not.toBe(events('b'));
  });

  it('rejects boards the page would not allow', () => {
    const g = new Game(content, setup({ loadout: { unlocked: [], perks: {} } }));
    const board = g.state.board;
    const with_ = (b: Partial<Board>): Board => ({ nodes: [...board.nodes, ...(b.nodes ?? [])], edges: [...board.edges, ...(b.edges ?? [])] });
    expect(() => g.apply({ t: 'deploy', board: with_({ nodes: [{ id: 'cache', component: 'cache', replicas: 1 }] }) })).toThrow(/not unlocked/);
    expect(() => g.apply({ t: 'deploy', board: with_({ edges: [['users', 'db']] }) })).toThrow(/Clients don't call data stores/);
    expect(() => g.apply({ t: 'deploy', board: with_({ nodes: [{ id: 'api', component: 'app', replicas: 1 }] }) })).toThrow(/Two nodes/);
    expect(() => g.apply({ t: 'deploy', board: { ...board, nodes: board.nodes.map((n) => (n.id === 'api' ? { ...n, replicas: 99 } : n)) } })).toThrow(/replicas/);
    expect(() => g.apply({ t: 'deploy', board: { ...board, nodes: board.nodes.filter((n) => n.id !== 'users'), edges: [['api', 'db']] } })).toThrow(/stays on the board/);
    expect(() => g.apply({ t: 'pick', card: 0 })).toThrow(/Not now/);
  });

  it('runs eight ticks a wave, then drafts', () => {
    const g = new Game(content, setup());
    g.apply({ t: 'deploy', board: g.state.board });
    for (let i = 0; i < TICKS; i++) expect(g.advance().tick).toBe(i);
    expect(g.state.phase).toBe('draft');
    expect(g.state.offer).toHaveLength(3);
    expect(() => g.advance()).toThrow(GameError);
  });

  it('hotfixes: one more replica now, for a fee', () => {
    const g = new Game(content, setup());
    g.apply({ t: 'deploy', board: g.state.board });
    const cash = g.state.cash;
    g.apply({ t: 'oncall', tick: 3, node: 'api' });
    expect(g.state.tick).toBe(3);
    expect(g.state.board.nodes.find((n) => n.id === 'api')!.replicas).toBe(2);
    expect(g.state.cash).toBeLessThan(cash - ONCALL_COST + 1);
    // Attention runs out: three actions a wave.
    g.apply({ t: 'oncall', tick: 3, node: 'api' });
    g.apply({ t: 'oncall', tick: 4, node: 'api' });
    expect(() => g.apply({ t: 'oncall', tick: 4, node: 'api' })).toThrow(/No hotfixes left/);
  });

  it('applies ascension rules', () => {
    const base = new Game(content, setup());
    const hard = new Game(content, setup({ ascension: 8 }));
    expect(hard.state.cash).toBe(Math.round(base.state.cash * 0.75));
    expect(hard.state.trust).toBe(70);
    // A4: latency limits are 20% tighter.
    expect(hard.state.requirements).toEqual(['p99 "Redirect" < 160ms']);
    expect(hard.forecast().events.every((e) => e.from === undefined)).toBe(true);
    expect(() => new Game(content, setup({ ascension: 11 }))).toThrow();
  });

  it('applies perks: cash, Trust and a starting card', () => {
    const g = new Game(content, setup({ loadout: { unlocked: [], perks: { 'seed-round': 2, 'loyal-users': 1, 'starter-card': 1 } } }));
    expect(g.state.cash).toBe(3000 + 500);
    expect(g.state.trust).toBe(110);
    expect(g.state.hand).toHaveLength(1);
    expect(() => new Game(content, setup({ loadout: { unlocked: [], perks: { 'seed-round': 9 } } }))).toThrow(/levels/);
  });

  it('goes on into Endless after the last wave, and stops', () => {
    const run = reference('shortly');
    const g = playScript(content, 'shortly', run, WAVES - 1);
    // Play the last wave by hand, then continue.
    g.apply({ t: 'deploy', board: g.state.board });
    while (g.state.phase === 'run') g.advance();
    expect(g.state.phase).toBe('cleared');
    expect(g.state.cleared).toBe(true);
    g.apply({ t: 'endless' });
    expect(g.state.wave).toBe(WAVES);
    expect(g.waveDef().name).toBe('Endless 1');
    let guard = 0;
    const phase = () => g.state.phase as string;
    while (phase() !== 'over' && guard++ < 100) {
      if (phase() === 'plan') g.apply({ t: 'deploy', board: g.state.board });
      else if (phase() === 'run') g.advance();
      else if (phase() === 'draft') g.apply({ t: 'pick', card: null });
    }
    expect(g.state.phase).toBe('over');
    expect(g.state.history.length).toBeLessThanOrEqual(MAX_WAVES);
  });

  it('merges requirement lines by use case and measure', () => {
    expect(mergeRequirements(['p99 "A" < 200ms', 'availability "A" >= 99%'], ['p99 "A" < 50ms', 'p90 "A" < 20ms'])).toEqual([
      'p99 "A" < 50ms',
      'availability "A" >= 99%',
      'p90 "A" < 20ms',
    ]);
  });
});

describe('the compiler', () => {
  const shortly = content.scenarios.find((s) => s.id === 'shortly')!;
  const components = new Map(content.components.map((c) => [c.id, c]));
  const board: Board = {
    nodes: [
      { id: 'users', component: 'users', replicas: 1 },
      { id: 'cdn', component: 'cdn', replicas: 2 },
      { id: 'lb', component: 'lb', replicas: 2 },
      { id: 'api', component: 'app', replicas: 3 },
      { id: 'cache', component: 'cache', replicas: 2 },
      { id: 'db', component: 'sql', replicas: 2 },
      { id: 'q', component: 'queue', replicas: 2 },
      { id: 'w', component: 'worker', replicas: 2 },
    ],
    edges: [
      ['users', 'cdn'],
      ['cdn', 'lb'],
      ['lb', 'api'],
      ['api', 'cache'],
      ['api', 'db'],
      ['api', 'q'],
      ['q', 'w'],
      ['w', 'db'],
    ],
  };

  it('routes use cases through the wiring as cache-aside, edge hits and background work', () => {
    const c = compile(shortly, board, components, ['redirect', 'shorten', 'clicks']);
    expect(c.routes.redirect.chain).toEqual(['users', 'cdn', 'lb', 'api']);
    expect(c.routes.redirect.scenarios.map((p) => p.name)).toEqual(['Edge hit', 'Cache hit', 'Cache miss', 'Cache down']);
    expect(c.routes.clicks.background?.name).toBe('Record click (background)');
    expect(c.diagram.useCases.map((u) => u.name)).toEqual(['Redirect', 'Shorten', 'Record click', 'Record click (background)']);
    expect(c.source).toContain('api -x cache : GET Url');
  });

  it('says why a use case has no route', () => {
    const noDb: Board = { nodes: board.nodes.filter((n) => n.id !== 'db'), edges: board.edges.filter(([a, b]) => a !== 'db' && b !== 'db') };
    const c = compile(shortly, noDb, components, ['shorten']);
    expect(c.broken.shorten).toBe('"Shorten" needs a database wired to App Server (api).');
    const down = compile(shortly, board, components, ['shorten'], { down: ['lb'], writesDown: [], global: false, bots: false });
    expect(down.broken.shorten).toMatch(/has no way in/);
  });

  it('stops bots at a firewall', () => {
    const waf: Board = {
      nodes: [...board.nodes, { id: 'waf', component: 'waf', replicas: 2 }],
      edges: [['users', 'waf'], ['waf', 'cdn'], ...board.edges.filter(([a]) => a !== 'users')],
    };
    const c = compile(shortly, waf, components, ['redirect'], { down: [], writesDown: [], global: false, bots: true });
    expect(c.bots).toEqual({ stoppedBy: 'waf', chain: ['users', 'waf'] });
  });
});

describe('progress between runs', () => {
  it('buys unlocks and perk levels with Blueprints', () => {
    let m = { ...emptyMeta(), blueprints: 20 };
    m = buy(content, m, 'cache');
    expect(m.unlocked).toEqual(['cache']);
    expect(m.blueprints).toBe(15);
    expect(() => buy(content, m, 'cache')).toThrow(MetaError);
    expect(() => buy(content, m, 'worker')).toThrow(/Queue first/);
    m = buy(content, m, 'seed-round');
    expect(m.perks['seed-round']).toBe(1);
    expect(shop(content, m).find((i) => i.id === 'seed-round')?.cost).toBe(10);
    expect(() => buy(content, m, 'seed-round')).toThrow(/costs 10/);
  });

  it('describes every shop item, and gives each component its board role', () => {
    const items = shop(content, emptyMeta());
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['component', 'feature', 'card', 'perk']));
    for (const i of items) expect(i.text.length, i.id).toBeGreaterThan(10);
    for (const i of items.filter((x) => x.kind === 'component')) expect(i.role, i.id).toBe(content.components.find((c) => c.id === i.id)?.role);
  });

  it('equips owned perks and builds a loadout the server accepts', () => {
    let m = { ...emptyMeta(), blueprints: 100 };
    m = buy(content, buy(content, m, 'seed-round'), 'loyal-users');
    expect(() => equip(content, m, ['free-reroll'])).toThrow(/do not own/);
    m = equip(content, m, ['seed-round', 'loyal-users']);
    const loadout = loadoutFor(m, 0);
    expect(loadout.perks).toEqual({ 'seed-round': 1, 'loyal-users': 1 });
    expect(loadoutAllowed(m, loadout, 0)).toBeUndefined();
    expect(loadoutAllowed(m, { ...loadout, unlocked: ['cache'] }, 0)).toMatch(/not unlocked/);
    expect(loadoutAllowed(m, { unlocked: [], perks: { 'seed-round': 3 } }, 0)).toMatch(/not owned/);
  });

  it('opens scenarios and ascensions as players progress', () => {
    const snapshots = content.scenarios.find((s) => s.id === 'snapshots')!;
    let m = emptyMeta();
    expect(scenarioOpen(snapshots, m).open).toBe(false);
    expect(maxAscension(m, 'shortly')).toBe(0);
    m = recordRun(m, { scenario: 'shortly', ascension: 0, reached: 12, cleared: true, blueprints: 30, seen: ['cache'] });
    expect(scenarioOpen(snapshots, m).open).toBe(true);
    expect(maxAscension(m, 'shortly')).toBe(1);
    expect(m.blueprints).toBe(30);
    m = recordRun(m, { scenario: 'shortly', ascension: 0, reached: 3, cleared: false, blueprints: 3, seen: [] });
    expect(m.scenarios.shortly).toEqual({ reached: 12, cleared: 0 });
  });

  it('pays Blueprints for waves, bosses, score and a first clear', () => {
    const g = playScript(content, 'shortly', reference('shortly'));
    expect(g.blueprints(true) - g.blueprints(false)).toBe(5);
    expect(g.blueprints(false)).toBeGreaterThanOrEqual(12 + 3 * 3);
  });
});
