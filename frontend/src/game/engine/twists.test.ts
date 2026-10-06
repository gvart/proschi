import { describe, expect, it } from 'vitest';
import { allUnlocks, playScript, type ScriptedRun } from './check';
import { readContent } from './content';
import { Game, GameError, mutatorsFor } from './run';
import type { RunSetup } from './types';

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
/** A new Shortly run whose offer is exactly `id`, taken. */
const withMutator = (id: string, over: Partial<RunSetup> = {}) => {
  const g = new Game(content, setup(over));
  g.state.mutatorOffer = [id];
  g.apply({ t: 'mutator', pick: 0 });
  return g;
};

describe('mutators', () => {
  it('offers three different ones at the start of a Scale or Fail run, the same for the same seed', () => {
    const a = new Game(content, setup()).state.mutatorOffer;
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(new Game(content, setup()).state.mutatorOffer).toEqual(a);
    const offers = new Set(['a', 'b', 'c', 'd', 'e'].map((seed) => new Game(content, setup({ seed })).state.mutatorOffer.join()));
    expect(offers.size).toBeGreaterThan(1);
  });

  it('offers none in the design-first modes, and never one a scenario excludes', () => {
    expect(new Game(content, setup({ scenario: 'pawprint' })).state.mutatorOffer).toEqual([]);
    expect(mutatorsFor(content, 'ping').map((m) => m.id)).not.toContain('viral-abroad');
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) expect(new Game(content, setup({ scenario: 'ping', seed })).state.mutatorOffer).not.toContain('viral-abroad');
  });

  it('is picked once, before the first deploy, or declined', () => {
    const g = new Game(content, setup());
    const offered = g.state.mutatorOffer[1];
    g.apply({ t: 'mutator', pick: 1 });
    expect(g.state.mutator).toBe(offered);
    expect(() => g.apply({ t: 'mutator', pick: 0 })).toThrow(GameError);

    const declined = new Game(content, setup());
    declined.apply({ t: 'mutator', pick: null });
    expect(declined.state.mutator).toBeUndefined();
    expect(declined.state.mutatorOffer).toEqual([]);

    // Deploying without a pick declines: the offer is gone.
    const deployed = new Game(content, setup());
    deployed.apply({ t: 'deploy', board: deployed.state.board });
    expect(deployed.state.mutatorOffer).toEqual([]);
    expect(() => deployed.apply({ t: 'mutator', pick: 0 })).toThrow(GameError);
  });

  it('changes the start: less cash, far users', () => {
    const plain = new Game(content, setup()).state.cash;
    expect(withMutator('lean-seed').state.cash).toBe(Math.round(plain * 0.6));
    expect(withMutator('lean-seed').mods.interestCap).toBe(new Game(content, setup()).mods.interestCap * 2);
    expect(withMutator('viral-abroad').forecast().global).toBe(0.6);
  });

  it('reshapes traffic by reads and writes', () => {
    const peak = (g: Game) => Object.fromEntries(g.forecast().peak.map((p) => [p.key, p.rps]));
    const plain = peak(new Game(content, setup()));
    const heavy = peak(withMutator('write-heavy'));
    expect(heavy.redirect).toBe(plain.redirect);
    expect(heavy.shorten).toBeCloseTo(plain.shorten * 3, -1);
  });

  it('raises the bill of its target, and scales every tick’s points', () => {
    const plain = new Game(content, setup());
    const audit = withMutator('licence-audit');
    expect(audit.monthlyCost(audit.state.board)).toBeGreaterThan(plain.monthlyCost(plain.state.board));
    for (const g of [plain, audit]) {
      g.apply({ t: 'deploy', board: g.state.board });
      g.advance();
    }
    const [a, b] = [plain.state.ticks[0], audit.state.ticks[0]];
    expect(b.revenue).toBe(a.revenue);
    // Points are rounded per tick.
    expect(Math.abs(b.points - a.points * 1.15)).toBeLessThanOrEqual(1);
  });

  it('adds its incidents on its waves', () => {
    const g = playScript(content, 'shortly', { ...reference('shortly'), mutator: 'flaky-zone' }, 2);
    expect(g.state.wave).toBe(2);
    expect(g.state.events.map((e) => e.id)).toContain('az-outage');
  });

  it('replays: the pick is an action like any other', () => {
    const g = new Game(content, setup({ seed: 'replay' }));
    g.apply({ t: 'mutator', pick: 2 });
    const id = g.state.mutator;
    g.apply({ t: 'deploy', board: g.state.board });
    while (g.state.phase === 'run') g.advance();
    expect(g.state.score).toBeGreaterThan(0);
    const again = Game.replay(content, g.setup, g.state.log);
    expect(again.state.mutator).toBe(id);
    expect(again.state.score).toBe(g.state.score);
    expect(again.state.cash).toBe(g.state.cash);
  });
});

describe('bounties', () => {
  /** The reference run, taking the first bounty on offer every wave. */
  const hunting = (id: string, seed?: string) => {
    const run = reference(id);
    return playScript(content, id, { ...run, ...(seed ? { seed } : {}), plays: Array.from({ length: 12 }, (_, i) => ({ ...run.plays[i], bounty: 'first' })) });
  };

  it('offers three a wave in Scale or Fail, never the one taken last wave, and none in the design-first modes', () => {
    const g = new Game(content, setup());
    expect(g.state.bountyOffer).toHaveLength(3);
    expect(new Set(g.state.bountyOffer).size).toBe(3);
    const h = hunting('shortly');
    const ids = h.state.history.map((x) => x.bounty?.id);
    expect(ids.every(Boolean)).toBe(true);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(playScript(content, 'pawprint', reference('pawprint')).state.bountyOffer).toEqual([]);
  });

  it('is taken once, before the deploy; a wave without one has none', () => {
    const g = new Game(content, setup());
    g.apply({ t: 'bounty', pick: 1 });
    expect(g.state.bounty).toBeDefined();
    expect(g.forecast().bountyOffer).toEqual([]);
    expect(() => g.apply({ t: 'bounty', pick: 0 })).toThrow(/already took/);
    expect(playScript(content, 'shortly', reference('shortly')).state.history.some((x) => x.bounty)).toBe(false);
  });

  it('pays cash and points (times the act) when met, and costs a quarter of its cash when missed', () => {
    const g = hunting('shortly');
    const met = g.state.history.filter((h) => h.bounty?.met);
    const missed = g.state.history.filter((h) => h.bounty && !h.bounty.met);
    expect(met.length).toBeGreaterThan(0);
    expect(missed.length).toBeGreaterThan(0);
    for (const h of missed) {
      const def = content.bounties.find((b) => b.id === h.bounty!.id)!;
      expect(h.bounty).toMatchObject({ cash: -Math.round(def.cash / 4), points: 0 });
    }
    for (const h of met) {
      const def = content.bounties.find((b) => b.id === h.bounty!.id)!;
      expect(h.bounty).toMatchObject({ cash: def.cash, points: def.points * Math.ceil((h.wave + 1) / 4) });
    }
  });

  it('offers a boss-only bounty only on a boss wave, and an incident bounty only with its announced incident', () => {
    for (const id of ['shortly', 'snapshots', 'ping', 'drop']) {
      for (const seed of ['a', 'b', 'c']) {
        const g = hunting(id, seed);
        for (const h of g.state.history) {
          const def = content.bounties.find((b) => b.id === h.bounty?.id);
          if (def?.boss) expect(h.boss || !h.survived).toBe(true);
          if (def?.event) expect(h.events.some((e) => !e.surprise && content.events.find((x) => x.id === e.id)?.effect === def.event)).toBe(true);
        }
      }
    }
  });

  it('shows in the forecast with what each pays this act', () => {
    const f = new Game(content, setup()).forecast();
    expect(f.bountyOffer).toHaveLength(3);
    for (const b of f.bountyOffer) expect(b.pays.points).toBe(b.points);
  });
});
