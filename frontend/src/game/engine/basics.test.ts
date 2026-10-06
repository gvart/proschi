import { describe, expect, it } from 'vitest';
import { allUnlocks, applyPlay, playScript, type ScriptedRun } from './check';
import { readContent } from './content';
import { emptyMeta, recordRun, runTwists, twistsAllowed, twistsOpen } from './meta';
import { Game, GameError } from './run';
import type { RunSetup } from './types';

/** First runs play the basic rules: the twists open with the first Scale or Fail clear (docs/GAME.md, "First runs"). */

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
const basic = (over: Partial<RunSetup> = {}) => new Game(content, setup({ twists: false, ...over }));
const cleared = (scenario: string) => recordRun(emptyMeta(), { scenario, ascension: 0, reached: 12, cleared: true, blueprints: 0, seen: [] });

describe('the basic rules', () => {
  it('offer no mutator and no bounty, and forecast the peak exactly', () => {
    for (const seed of ['a', 'b', 'c']) {
      const g = basic({ seed });
      expect(g.twists).toBe(false);
      expect(g.state.mutatorOffer).toEqual([]);
      expect(g.state.bountyOffer).toEqual([]);
      const f = g.forecast();
      expect(f.spread).toBe(0);
      expect(f.peak.every((p) => p.low === p.rps && p.high === p.rps)).toBe(true);
      expect(g.state.demand).toBe(1);
    }
    expect(() => basic().apply({ t: 'mutator', pick: 0 })).toThrow(GameError);
  });

  it('have the twists when the setup says so, or says nothing', () => {
    for (const g of [new Game(content, setup()), new Game(content, setup({ twists: true }))]) {
      expect(g.twists).toBe(true);
      expect(g.state.mutatorOffer).toHaveLength(3);
      expect(g.state.bountyOffer.length).toBeGreaterThan(0);
      expect(g.forecast().spread).toBeGreaterThan(0);
    }
    expect(() => new Game(content, { ...setup(), twists: 'no' as unknown as boolean })).toThrow(GameError);
  });

  it('have no live changes: the board deployed is the board of the whole wave', () => {
    const g = basic();
    g.apply({ t: 'deploy', board: g.state.board });
    expect(() => g.apply({ t: 'change', tick: 1, board: applyPlay(g.state.board, { set: { api: { replicas: 3 } } }) })).toThrow(/first clear/);
    // The hotfixes still work.
    g.apply({ t: 'oncall', tick: 1, node: 'api' });
    expect(g.state.board.nodes.find((n) => n.id === 'api')!.replicas).toBe(2);
  });

  it('have no unannounced or cascading incidents', () => {
    const g = basic();
    // A single database with no replica: with the twists, its failover sets off a storm of retries.
    g.state.events = [{ id: 'db-failover', from: 2, duration: 2 }];
    g.apply({ t: 'deploy', board: g.state.board });
    while (g.state.phase === 'run') g.advance();
    expect(g.state.history[0].events.some((e) => e.chained)).toBe(false);
    const late = basic();
    late.state.wave = 6;
    expect(late.surprises()).toBe(false);
  });

  it('count no card sets and offer no contracts', () => {
    const g = basic();
    g.state.hand = content.cards.filter((c) => c.topic === 'caching').slice(0, 3).map((c) => c.id);
    expect(g.mods.sets).toEqual([]);
    expect(g.mods.setBonus).toBe(1);
    const run = playScript(content, 'shortly', { ...reference('shortly'), twists: false }, 3);
    expect(run.state.contracts).toEqual([]);
    expect(run.state.log.some((a) => a.t === 'contract' || a.t === 'bounty' || a.t === 'change')).toBe(false);
  });

  it('let the reference clear Shortly, and replay to the same score', () => {
    const played = playScript(content, 'shortly', { ...reference('shortly'), twists: false });
    expect(played.state.cleared).toBe(true);
    const s = setup({ seed: reference('shortly').seed, loadout: reference('shortly').loadout!, twists: false });
    const replayed = Game.replay(content, s, JSON.parse(JSON.stringify(played.state.log)));
    expect(replayed.state.score).toBe(played.state.score);
    expect(replayed.state.outcome).toBe('retired');
    // The same actions under the full rules are another run: the gate is part of the setup.
    let other: number | undefined;
    try {
      other = Game.replay(content, { ...s, twists: true }, played.state.log).state.score;
    } catch (e) {
      expect(e).toBeInstanceOf(GameError);
    }
    expect(other).not.toBe(played.state.score);
  });
});

describe('the twists gate', () => {
  it('opens with the first clear of a Scale or Fail scenario', () => {
    expect(twistsOpen(content, emptyMeta())).toBe(false);
    const reachedOnly = recordRun(emptyMeta(), { scenario: 'shortly', ascension: 0, reached: 11, cleared: false, blueprints: 0, seen: [] });
    expect(twistsOpen(content, reachedOnly)).toBe(false);
    expect(twistsOpen(content, cleared('shortly'))).toBe(true);
    expect(twistsOpen(content, cleared('snapshots'))).toBe(true);
    // A design-first mode has no twists to learn: clearing one does not open them.
    expect(twistsOpen(content, cleared('pawprint'))).toBe(false);
  });

  it('starts every daily run with the twists, and a normal one once open', () => {
    expect(runTwists(content, emptyMeta(), 'daily')).toBe(true);
    expect(runTwists(content, emptyMeta(), 'normal')).toBe(false);
    expect(runTwists(content, cleared('shortly'), 'normal')).toBe(true);
  });

  it('allows the basic rules only before the milestone, and never in the daily run', () => {
    expect(twistsAllowed(content, emptyMeta(), { mode: 'normal', twists: false })).toBeUndefined();
    expect(twistsAllowed(content, cleared('shortly'), { mode: 'normal', twists: false })).toMatch(/first clear/);
    expect(twistsAllowed(content, emptyMeta(), { mode: 'daily', twists: false })).toMatch(/daily/);
    expect(twistsAllowed(content, emptyMeta(), { mode: 'normal', twists: true })).toBeUndefined();
    expect(twistsAllowed(content, emptyMeta(), { mode: 'normal' })).toBeUndefined();
    expect(twistsAllowed(content, emptyMeta(), { mode: 'normal', twists: 1 as unknown as boolean })).toMatch(/true or false/);
  });
});
