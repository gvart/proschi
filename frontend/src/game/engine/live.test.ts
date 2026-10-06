import { describe, expect, it } from 'vitest';
import { allUnlocks, applyPlay, playScript, type ScriptedRun } from './check';
import { readContent } from './content';
import { COLD_START, LIVE_BUILD_TICKS, LIVE_CHANGES_PER_WAVE, LIVE_SCALE_TICKS } from './rules';
import { Game } from './run';
import type { RunSetup } from './types';

/** Hold the line: changes shipped during the run go live once provisioned, and new caches start cold. */

const raw = import.meta.glob('../content/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.fromEntries(Object.entries(raw).map(([p, t]) => [p.replace(/^\.\.\/content\//, ''), t]));
const { content } = readContent(files);
const reference = (id: string) => JSON.parse(files[`scenarios/${id}/reference.json`]) as ScriptedRun;
const setup = (over: Partial<RunSetup> = {}): RunSetup => ({
  scenario: 'shortly',
  seed: 'test',
  ascension: 0,
  mode: 'normal',
  loadout: { unlocked: allUnlocks(content), perks: {} },
  ...over,
});
const running = () => {
  const g = new Game(content, setup());
  g.apply({ t: 'deploy', board: g.state.board });
  return g;
};
const replicas = (g: Game, id: string) => g.state.board.nodes.find((n) => n.id === id)!.replicas;

describe('live changes', () => {
  it('scale after a tick of provisioning', () => {
    const g = running();
    g.apply({ t: 'change', tick: 2, board: applyPlay(g.state.board, { set: { api: { replicas: 3 } } }) });
    expect(g.state.rollout!.at).toBe(2 + LIVE_SCALE_TICKS);
    expect(replicas(g, 'api')).toBe(1);
    g.advance();
    g.advance();
    expect(g.state.ticks[2].nodes.find((n) => n.id === 'api')!.replicas).toBe(1);
    expect(g.state.ticks[3].nodes.find((n) => n.id === 'api')!.replicas).toBe(3);
    expect(g.state.rollout).toBeUndefined();
  });

  it('take longer to build, and a new cache starts cold', () => {
    const g = running();
    const board = applyPlay(g.state.board, { add: [{ id: 'cache', component: 'cache', replicas: 1 }], wire: [['api', 'cache']] });
    g.apply({ t: 'change', tick: 1, board });
    expect(g.state.rollout!.at).toBe(1 + LIVE_BUILD_TICKS);
    while (g.state.tick <= 1 + LIVE_BUILD_TICKS) g.advance();
    expect(g.state.warming).toEqual({ cache: 1 + LIVE_BUILD_TICKS });
    // The same board, warm, against the tick it went live.
    const live = g.state.ticks[1 + LIVE_BUILD_TICKS];
    const warm = new Game(content, setup());
    warm.apply({ t: 'deploy', board });
    const cold = (r: typeof live) => r.nodes.find((n) => n.id === 'db')!.loadRps;
    expect(cold(live)).toBeGreaterThan(cold(warm.evaluate(board, 1 + LIVE_BUILD_TICKS, {}, true)));
    expect(COLD_START[0]).toBeLessThan(1);
  });

  it('are refused when nothing changed, past the limit, or when the board breaks the rules', () => {
    const g = running();
    expect(() => g.apply({ t: 'change', tick: 0, board: g.state.board })).toThrow(/Nothing to ship/);
    for (let i = 0; i < LIVE_CHANGES_PER_WAVE; i++) g.apply({ t: 'change', tick: i, board: applyPlay(g.state.rollout?.board ?? g.state.board, { set: { api: { replicas: 2 + i } } }) });
    expect(() => g.apply({ t: 'change', tick: 4, board: applyPlay(g.state.board, { set: { api: { replicas: 9 } } }) })).toThrow(/At most/);
    const h = running();
    expect(() => h.apply({ t: 'change', tick: 0, board: applyPlay(h.state.board, { wire: [['users', 'db']] }) })).toThrow();
  });

  it('still provisioning at the end of the wave are live for the next', () => {
    const g = running();
    g.apply({ t: 'change', tick: 7, board: applyPlay(g.state.board, { set: { api: { replicas: 4 } } }) });
    while (g.state.phase === 'run') g.advance();
    expect(replicas(g, 'api')).toBe(4);
  });

  it('keep a replica the on-call added while they provision', () => {
    const g = running();
    g.apply({ t: 'change', tick: 1, board: applyPlay(g.state.board, { set: { api: { replicas: 2 } } }) });
    g.apply({ t: 'oncall', tick: 1, node: 'api' });
    g.advance();
    g.advance();
    expect(replicas(g, 'api')).toBe(3);
  });

  it('replay: a scripted run with live changes gives the same game', () => {
    const run = reference('shortly');
    const plays = run.plays.map((p, i) => (i === 3 ? { ...p, live: [{ tick: 2, set: { api: { replicas: 6 } } }] } : p));
    const g = playScript(content, 'shortly', { ...run, plays });
    const again = Game.replay(content, g.setup, g.state.log);
    expect(again.state.score).toBe(g.state.score);
    expect(g.state.log.some((a) => a.t === 'change')).toBe(true);
  });
});
