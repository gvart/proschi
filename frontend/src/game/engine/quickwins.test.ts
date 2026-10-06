import { describe, expect, it } from 'vitest';
import { allUnlocks, playScript, type ScriptedRun } from './check';
import { readContent } from './content';
import { computeMods } from './mods';
import { DEMAND_SPREAD, LEAN_REFUND, ONCALL_ACTS, RATE_LIMIT_KEEP, SURPRISE_FROM_WAVE, TICKS } from './rules';
import { Game } from './run';
import type { RunSetup } from './types';

/** Uncertain forecasts, unannounced incidents and cascades, the on-call's menu, rule-bending cards and sets. */

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
const card = (id: string) => content.cards.find((c) => c.id === id)!;
const rpsOf = (r: { useCases: { key: string; rps: number }[] }, key: string) => r.useCases.find((u) => u.key === key)!.rps;

describe('uncertain forecasts', () => {
  it('give a range, and the wave runs its real demand inside it', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const g = new Game(content, setup({ seed }));
      const f = g.forecast();
      expect(f.spread).toBe(DEMAND_SPREAD);
      const peak = f.peak.find((p) => p.key === 'redirect')!;
      expect(peak.low).toBeLessThan(peak.rps);
      expect(peak.high).toBeGreaterThan(peak.rps);
      const demand = g.state.demand;
      expect(Math.abs(demand - 1)).toBeLessThanOrEqual(DEMAND_SPREAD);
      // A load test tests the forecast; the run is the real thing.
      const test = g.apply({ t: 'loadtest', board: g.state.board })!;
      expect(rpsOf(test, 'redirect')).toBeCloseTo(peak.rps, -1);
      g.apply({ t: 'deploy', board: g.state.board });
      const ticks = Array.from({ length: f.peakTick + 1 }, () => g.advance());
      expect(rpsOf(ticks[f.peakTick], 'redirect')).toBeCloseTo(rpsOf(test, 'redirect') * demand, 0);
    }
  });

  it('are exact in the design-first modes', () => {
    const g = new Game(content, setup({ scenario: 'pawprint' }));
    expect(g.forecast().spread).toBe(0);
    expect(g.state.demand).toBe(1);
  });
});

describe('unannounced incidents and cascades', () => {
  it('leave some pooled incidents off the forecast from wave 5, and say so', () => {
    let surprises = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const g = playScript(content, 'shortly', { ...reference('shortly'), seed });
      for (const h of g.state.history) {
        for (const e of h.events) if (e.surprise && !e.chained) {
          expect(h.wave + 1).toBeGreaterThanOrEqual(SURPRISE_FROM_WAVE);
          surprises++;
        }
      }
    }
    expect(surprises).toBeGreaterThan(0);
    const g = new Game(content, setup());
    g.state.events = [{ id: 'noisy-neighbor', from: 3, duration: 2, surprise: true }];
    expect(g.forecast().events).toEqual([]);
  });

  it('set off the next incident when one breaks something', () => {
    const g = new Game(content, setup());
    // A single database with no replica: its failover is an outage, so the retries come next.
    g.state.events = [{ id: 'db-failover', from: 2, duration: 2 }];
    g.apply({ t: 'deploy', board: g.state.board });
    while (g.state.phase === 'run') g.advance();
    const chained = g.state.history[0].events.find((e) => e.chained);
    expect(chained).toMatchObject({ id: 'write-surge', from: 4, surprise: true });
  });

  it('do not cascade when the first incident is handled', () => {
    const g = new Game(content, setup());
    const board = structuredClone(g.state.board);
    board.nodes.find((n) => n.id === 'db')!.replicas = 2;
    board.nodes.find((n) => n.id === 'api')!.replicas = 3;
    g.state.events = [{ id: 'db-failover', from: 2, duration: 2 }];
    g.apply({ t: 'deploy', board });
    while (g.state.phase === 'run') g.advance();
    const h = g.state.history[0];
    if (h.breaches.length === 0) expect(h.events.some((e) => e.chained)).toBe(false);
  });
});

describe('hotfixes', () => {
  const running = () => {
    const g = new Game(content, setup());
    g.apply({ t: 'deploy', board: g.state.board });
    return g;
  };

  it('rate-limits: less traffic, every bot turned away, a little Trust', () => {
    const g = running();
    const before = g.evaluate(g.state.board, 2, {}, true);
    const trust = g.state.trust;
    g.apply({ t: 'oncall', tick: 1, act: 'ratelimit' });
    expect(g.state.trust).toBe(trust - ONCALL_ACTS.ratelimit.trust);
    const after = g.evaluate(g.state.board, 2, {}, true);
    expect(rpsOf(after, 'redirect')).toBeCloseTo(rpsOf(before, 'redirect') * RATE_LIMIT_KEEP, 3);
    expect(() => g.apply({ t: 'oncall', tick: 1, act: 'ratelimit' })).toThrow(/already on/);
  });

  it('switches a feature off: no load, no revenue, and its limits are not checked', () => {
    const g = running();
    g.apply({ t: 'oncall', tick: 1, act: 'shed', useCase: 'redirect' });
    const r = g.evaluate(g.state.board, 2, {}, false);
    expect(rpsOf(r, 'redirect')).toBe(0);
    expect(r.breaches.some((b) => b.message.includes('Redirect'))).toBe(false);
    expect(() => g.apply({ t: 'oncall', tick: 1, act: 'shed', useCase: 'nope' })).toThrow(/No use case/);
  });

  it('brings a lost node back from the next tick', () => {
    const g = running();
    g.state.events = [{ id: 'db-failover', from: 2, duration: 3 }];
    expect(g.evaluate(g.state.board, 2, {}, true).nodes.find((n) => n.id === 'db')!.down).toBe(true);
    g.apply({ t: 'oncall', tick: 2, node: 'db', act: 'reboot' });
    expect(g.evaluate(g.state.board, 2, {}, true).nodes.find((n) => n.id === 'db')!.down).toBe(false);
  });

  it('spends attention, and refuses what does not apply', () => {
    const g = running();
    expect(() => g.apply({ t: 'oncall', tick: 0, act: 'warm' })).toThrow(/no cache/);
    for (let i = 0; i < 3; i++) g.apply({ t: 'oncall', tick: i, node: 'api' });
    expect(g.state.oncallLeft).toBe(0);
    expect(() => g.apply({ t: 'oncall', tick: 4, act: 'ratelimit' })).toThrow(/No hotfixes left/);
    while (g.state.phase === 'run') g.advance();
    expect(g.state.tick).toBe(TICKS);
  });
});

describe('rule-bending cards and sets', () => {
  it('apply a downside with the effect', () => {
    const m = computeMods([card('read-replicas')], [], { streakStep: 0.1, interestCap: 100 });
    expect(m.capacity).toEqual([{ target: 'db', stat: 'reads', mult: 1.6 }]);
    expect(m.cost).toEqual([{ target: 'db', mult: 1.35 }]);
  });

  it('cost Trust and its cap when the downside is Trust', () => {
    const g = new Game(content, setup());
    const { trust, maxTrust } = g.state;
    g.state.phase = 'draft';
    g.state.offer = ['long-ttls'];
    g.apply({ t: 'pick', card: 0 });
    expect(g.state.maxTrust).toBe(maxTrust - 10);
    expect(g.state.trust).toBe(Math.min(trust - 10, maxTrust - 10));
  });

  it('make a set of three cards of a topic: points ×1.1 a set', () => {
    const caching = content.cards.filter((c) => c.topic === 'caching').slice(0, 3);
    const m = computeMods(caching, [], { streakStep: 0.1, interestCap: 100 });
    expect(m.sets).toEqual(['caching']);
    expect(m.setBonus).toBeCloseTo(1.1);
    expect(computeMods(caching.slice(0, 2), [], { streakStep: 0.1, interestCap: 100 }).setBonus).toBe(1);
  });
});

describe('the right-sized refund', () => {
  it('gives back a tenth of the bill on a right-sized wave', () => {
    let lean = 0;
    for (const id of ['shortly', 'snapshots', 'ping', 'drop']) {
      for (const h of playScript(content, id, reference(id)).state.history) {
        if (h.leanBonus > 0) {
          lean++;
          expect(h.leanCash).toBe(Math.round(h.cost * LEAN_REFUND));
        } else expect(h.leanCash).toBeUndefined();
      }
    }
    expect(lean).toBeGreaterThan(0);
  });
});
