import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { analyze } from './analyze';
import { runTests } from './tests';
import { findWhatIf, runWhatIf, runWhatIfs, sweep, whatIfOptions } from './whatif';

const DESIGN = `
client [Actor]
api [REST API] x8
cache [Redis]
db [PostgreSQL] x2

usecase "Read" {
  client -> api : GET /items
  alt "Hit" {
    api -> cache : GET item
    api --> client : 200
  } alt "Miss" {
    api -> cache : GET item
    api -> db : SELECT item
    api --> client : 200
  }
}

usecase "Write" {
  client -> api : POST /items
  api -> db : INSERT item
  api --> client : 201
}

traffic {
  "Read" 2k rps mix "Hit" 80%, "Miss" 20%
  "Write" 200 rps
}

requirements {
  p99 "Read" < 200ms
  availability "Read" >= 99%
  cost <= 5000 usd/month
}
`;

const WHATIFS = `
whatif "Triple" {
  traffic "Read" x3
}
whatif "Cache down" {
  fail cache
}
whatif "DB down" {
  fail db
}
whatif "Big db" {
  traffic "Write" 3k rps
  db x6
}
`;

const diagramOf = (source: string) => parse(source).diagram;

describe('what-ifs', () => {
  it('leaves the base analysis byte for byte as it was', () => {
    const base = diagramOf(DESIGN);
    const withWhatIfs = diagramOf(DESIGN + WHATIFS);
    expect(JSON.stringify(analyze(withWhatIfs))).toBe(JSON.stringify(analyze(base)));
    expect(JSON.stringify(runTests(withWhatIfs))).toBe(JSON.stringify(runTests(base)));
    // Empty what-if options are no options.
    expect(JSON.stringify(analyze(base, { trafficRps: new Map(), failed: new Set(), replicas: new Map() }))).toBe(JSON.stringify(analyze(base)));
  });

  it('multiplies or sets a use case rate', () => {
    const d = diagramOf(DESIGN + WHATIFS);
    const triple = runWhatIf(d, findWhatIf(d, 'Triple')!);
    expect(triple.analysis.useCases.find((u) => u.name === 'Read')!.rps).toBe(6000);
    expect(triple.analysis.useCases.find((u) => u.name === 'Write')!.rps).toBe(200);
    const big = runWhatIf(d, findWhatIf(d, 'Big db')!);
    expect(big.analysis.useCases.find((u) => u.name === 'Write')!.rps).toBe(3000);
    expect(big.analysis.nodes.find((n) => n.id === 'db')!.replicas).toBe(6);
    expect(big.options.replicas?.get('db')).toBe(6);
  });

  it('moves the traffic of a failed node to its fallback, or loses it', () => {
    const d = diagramOf(`
client [Actor]
api [REST API] x2
cache [Redis] x2
db [PostgreSQL] x2
usecase "Read" {
  client -> api : GET /items
  alt "Cached" {
    api -> cache : GET item
    api --> client : 200
  } alt "Cache down" {
    api -x cache : GET item
    api -> db : SELECT item
    api --> client : 200
  }
}
traffic {
  "Read" 1k rps mix "Cached" 100%, "Cache down" 0%
}
requirements {
  availability "Read" >= 99.9%
}
whatif "No cache" {
  fail cache
}
whatif "No db" {
  fail db
}
`);
    const base = analyze(d);
    expect(base.nodes.find((n) => n.id === 'db')!.loadRps).toBe(0);

    const noCache = runWhatIf(d, findWhatIf(d, 'No cache')!);
    const read = noCache.analysis.useCases[0];
    expect(read.scenarios.map((s) => s.share)).toEqual([0, 1]);
    expect(noCache.analysis.nodes.find((n) => n.id === 'db')!.loadRps).toBe(1000);
    expect(noCache.analysis.nodes.find((n) => n.id === 'cache')).toMatchObject({ failed: true, availability: 0, loadRps: 0 });
    // The fallback path's nodes (client, api, db), not the failed cache.
    expect(read.availability).toBeGreaterThan(0.99);
    // The failed call costs a timeout.
    expect(read.percentiles.p99).toBeGreaterThan(1000);
    expect(noCache.passed).toBe(true);

    // Only the fallback needs the db: the cache loses its fallback, the traffic stays where it was.
    const noDb = runWhatIf(d, findWhatIf(d, 'No db')!);
    expect(noDb.analysis.useCases[0].scenarios.map((s) => s.share)).toEqual([1, 0]);
    expect(noDb.analysis.useCases[0].availability).toBeLessThan(base.useCases[0].availability);
    expect(noDb.analysis.useCases[0].availability).toBeGreaterThan(0.999);
  });

  it('fails the requests of scenarios that need a failed node and have no fallback', () => {
    const d = diagramOf(DESIGN + WHATIFS);
    const dbDown = runWhatIf(d, findWhatIf(d, 'DB down')!);
    const read = dbDown.analysis.useCases.find((u) => u.name === 'Read')!;
    const write = dbDown.analysis.useCases.find((u) => u.name === 'Write')!;
    // The miss path (20%) needs the db.
    expect(read.availability).toBeLessThan(0.81);
    expect(read.availability).toBeGreaterThan(0.7);
    expect(write.availability).toBe(0);
    expect(dbDown.passed).toBe(false);
    const availability = dbDown.results.find((r) => r.name.startsWith('availability'))!;
    expect(availability.passed).toBe(false);

    const cacheDown = runWhatIf(d, findWhatIf(d, 'Cache down')!);
    expect(cacheDown.analysis.useCases.find((u) => u.name === 'Read')!.availability).toBe(0);
    expect(cacheDown.results.find((r) => r.name.startsWith('availability'))!.hint).toContain('is down in this what-if');
  });

  it('runs every what-if with pass or fail and headline numbers', () => {
    const d = diagramOf(DESIGN + WHATIFS);
    const results = runWhatIfs(d);
    expect(results.map((r) => [r.name, r.passed])).toEqual([
      ['Triple', true],
      ['Cache down', false],
      ['DB down', false],
      ['Big db', true],
    ]);
    const [triple] = results;
    expect(triple.headline.p99Ms).toBeGreaterThan(0);
    expect(triple.headline.availability).toBeGreaterThan(0.99);
    expect(triple.headline.costUsd).toBe(triple.analysis.totalCostUsd);
    expect(results[3].headline.costUsd).toBeGreaterThan(triple.headline.costUsd);
  });

  it('ignores changes that name unknown nodes or use cases, with a warning', () => {
    const d = diagramOf(`${DESIGN}whatif "Typos" {\n  traffic "Reed" x2\n  fail redis\n  dbx x3\n}\n`);
    const { options, warnings } = whatIfOptions(d, d.whatifs![0]);
    expect(options).toEqual({});
    expect(warnings).toHaveLength(3);
  });
});

describe('sweep', () => {
  it('finds where each node saturates and the highest rate that still passes', () => {
    const d = diagramOf(DESIGN);
    const result = sweep(d, 'Read', 1000, 200_000, { steps: 5 });
    expect(result.steps.map((s) => s.rps)).toEqual([1000, 50_750, 100_500, 150_250, 200_000]);
    expect(result.steps[0]).toMatchObject({ passed: true, saturated: [], failing: [] });
    expect(result.steps[4].passed).toBe(false);
    expect(result.saturation.length).toBeGreaterThan(0);
    const max = result.maxPassingRps!;
    expect(max).toBeGreaterThan(1000);
    expect(max).toBeLessThan(200_000);
    // Just under the limit passes, just over it fails.
    const tolerance = (200_000 - 1000) / 1000;
    const at = (rps: number) => sweep(d, 'Read', rps, rps + 1, { steps: 2 }).steps[0].passed;
    expect(at(max)).toBe(true);
    expect(at(max + 2 * tolerance)).toBe(false);
    // The first node to saturate is at the rate the bisection found.
    const first = result.saturation[0];
    const usage = (rps: number) => analyze(d, { trafficRps: new Map([['read', rps]]) }).nodes.find((n) => n.id === first.node)!;
    expect(usage(first.rps).saturated).toBe(false);
    expect(usage(first.rps + 2 * tolerance).saturated).toBe(true);
  });

  it('reports a range that passes throughout, or fails from the start', () => {
    const d = diagramOf(DESIGN);
    expect(sweep(d, 'Read', 10, 100, { steps: 3 })).toMatchObject({ maxPassingRps: 100, saturation: [] });
    const over = sweep(d, 'Read', 500_000, 600_000, { steps: 2 });
    expect(over.maxPassingRps).toBeUndefined();
    expect(over.saturation.every((s) => s.atStart)).toBe(true);
  });

  it('throws for an unknown use case or a range that does not go up', () => {
    const d = diagramOf(DESIGN);
    expect(() => sweep(d, 'Nope', 1, 2)).toThrow('No use case named "Nope"');
    expect(() => sweep(d, 'Read', 2, 1)).toThrow('must go up');
  });
});
