import { describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { runTests } from './tests';
import { diagramOf, type Extras } from './testDiagram';

/**
 * The URL shortener from docs/design/hld-and-practice.md, end to end: the
 * same traffic, requirements and tests against a naive design and an improved
 * one (load balancer, cache with a fallback, replicas, synchronous writes).
 */

const PROBLEM: Extras = {
  traffic: [
    { useCase: 'Redirect', rps: 10_000, mix: [{ scenario: 'Cache hit', share: 0.9 }, { scenario: 'Cache miss', share: 0.1 }] },
    { useCase: 'Shorten', rps: 100 },
  ],
  requirements: [
    { kind: 'latency', percentile: 99, useCase: 'Redirect', maxMs: 100 },
    { kind: 'latency', percentile: 95, maxMs: 300 },
    { kind: 'availability', useCase: 'Redirect', minPercent: 99.95 },
    { kind: 'durable', useCase: 'Shorten' },
    { kind: 'survive', target: 'any' },
    { kind: 'cost', maxUsdPerMonth: 3000 },
  ],
  tests: [
    {
      name: 'Redirect is served from the cache',
      assertions: [
        { kind: 'calls', useCase: 'Redirect', target: { kind: 'cache' }, quantifier: 'some' },
        { kind: 'before', useCase: 'Redirect', first: { kind: 'cache' }, then: { kind: 'database' } },
        { kind: 'calls', useCase: 'Redirect', scenario: 'Cache hit', target: { kind: 'database' }, quantifier: 'never' },
      ],
    },
    { name: 'Shortening is durable', assertions: [{ kind: 'writesBeforeResponding', useCase: 'Shorten', target: { node: 'db' } }] },
    {
      name: 'Redirects survive a cache outage',
      assertions: [
        { kind: 'hasScenario', useCase: 'Redirect', scenario: 'Cache down' },
        { kind: 'handlesFailure', useCase: 'Redirect', target: { kind: 'cache' } },
      ],
    },
    {
      name: 'Shorten answers 201',
      assertions: [{ kind: 'responds', useCase: 'Shorten', status: '201' }],
    },
    { name: 'The cache never reaches the database', assertions: [{ kind: 'noPath', from: { kind: 'cache' }, to: { kind: 'database' } }] },
    { name: 'The API is replicated', assertions: [{ kind: 'replicas', target: { node: 'api' }, min: 2 }] },
  ],
};

const NAIVE = `
title "URL Shortener"
client "Visitor" [Actor]
api "Shortener API" [REST API]
db "URLs" [PostgreSQL]
client -> api
api -> db

usecase "Redirect" {
  client -> api : GET /{code}
  alt "Cache hit" {
    api -> db : SELECT url
    db --> api : url
  } alt "Cache miss" {
    api -> db : SELECT url
    db --> api : url
  }
  api --> client : 302
}

usecase "Shorten" {
  client -> api : POST /urls
  api ->> db : INSERT url
  api --> client : 201
}
`;

const IMPROVED = `
title "URL Shortener"
client "Visitor" [Actor]
lb "Load Balancer" [AWS Load Balancer]
api "Shortener API" [REST API]
cache "Codes" [Redis]
db "URLs" [PostgreSQL]
client -> lb
lb -> api
api -> cache
api -> db

usecase "Redirect" {
  client -> lb : GET /{code}
  lb -> api : GET /{code}
  alt "Cache hit" {
    api -> cache : GET code
    cache --> api : url
  } alt "Cache miss" {
    api -> cache : GET code
    cache --> api : nil
    api -> db : SELECT url
    db --> api : url
    api ->> cache : SET code
  } alt "Cache down" {
    api -x cache : GET code
    api -> db : SELECT url
    db --> api : url
  }
  api --> lb : 302
  lb --> client : 302
}

usecase "Shorten" {
  client -> lb : POST /urls
  lb -> api : POST /urls
  api -> db : INSERT url
  db --> api : ok
  api --> lb : 201
  lb --> client : 201
}
`;

const byName = (results: ReturnType<typeof runTests>) => Object.fromEntries(results.map((r) => [r.name, r]));

describe('URL shortener', () => {
  it('fails the naive design on the specific problems', () => {
    const diagram = diagramOf(NAIVE, PROBLEM);
    const analysis = analyze(diagram);
    expect(analysis.nodes.filter((n) => n.saturated).map((n) => n.id)).toEqual(['api', 'db']);
    expect(analysis.singlePointsOfFailure).toEqual(['api', 'db']);

    const results = byName(runTests(diagram, analysis));
    expect(Object.values(results).filter((r) => r.passed).map((r) => r.name)).toEqual([
      'cost ≤ $3,000/month',
      'Shorten answers 201',
      'The cache never reaches the database',
    ]);
    expect(results['p99 of Redirect < 100 ms'].message).toBe('p99 of Redirect: api is saturated (10.1k rps of 2k rps, 505%) (limit 100 ms)');
    expect(results['p95 of every use case < 300 ms'].message).toContain('api is saturated');
    expect(results['availability of Redirect ≥ 99.95%'].message).toBe('availability of Redirect is 99.45% (limit 99.95%)');
    expect(results['Shorten is durable'].message).toBe('"Shorten" writes only asynchronously (->>) to a durable store before responding');
    expect(results['survive any node failure'].message).toBe('Losing api (REST API) breaks "Redirect" (and 3 more)');
    expect(results['Redirect is served from the cache'].message).toBe('No node matches any cache; No node matches any cache; "Redirect" scenario "Cache hit" calls db (PostgreSQL)');
    expect(results['Redirects survive a cache outage'].message).toContain('"Redirect" has no scenario "Cache down"');
    expect(results['The API is replicated'].message).toBe('api has 1 replica (minimum 2)');
  });

  it('passes every requirement and test with the improved design', () => {
    const diagram = diagramOf(IMPROVED, { ...PROBLEM, replicas: { lb: 2, api: 16, cache: 2, db: 2 } });
    const analysis = analyze(diagram);
    const results = runTests(diagram, analysis);
    expect(results.filter((r) => !r.passed)).toEqual([]);
    expect(results).toHaveLength(12);
    expect(analysis.singlePointsOfFailure).toEqual([]);
    expect(analysis.warnings).toEqual([]);

    // Hand-computed: loads, hop latencies and the percentile rule.
    const node = (id: string) => analysis.nodes.find((n) => n.id === id)!;
    expect(node('lb').loadRps).toBe(10_100);
    expect(node('api').utilization).toBeCloseTo(10_100 / 32_000);
    expect(node('cache').loadRps).toBeCloseTo(9000 + 1000 + 1000);
    expect(node('db').loadRps).toBeCloseTo(1000 + 100);
    const lb = 2 / (1 - 10_100 / 200_000);
    const api = 10 / (1 - 10_100 / 32_000);
    const cache = 1 / (1 - 11_000 / 200_000);
    const db = 5 / (1 - 1_100 / 10_000);
    const redirect = analysis.useCases.find((u) => u.name === 'Redirect')!;
    expect(redirect.scenarios[0].meanMs).toBeCloseTo(lb + api + cache);
    expect(redirect.scenarios[1].meanMs).toBeCloseTo(lb + api + cache + db + cache);
    expect(redirect.scenarios[2]).toMatchObject({ name: 'Cache down', share: 0 });
    // 10% misses carry more than the 1% tail, so the miss path sets p99.
    expect(redirect.percentiles.p99).toBeCloseTo(3 * (lb + api + cache + db + cache));
    expect(redirect.percentiles.p50).toBeCloseTo(lb + api + cache);
    expect(analysis.totalCostUsd).toBe(2 * 50 + 16 * 100 + 2 * 150 + 2 * 400);

    expect(byName(results)['p99 of Redirect < 100 ms'].message).toBe('p99 of Redirect is 73.4 ms (limit 100 ms)');
  });

  it('flags the cache as a single point of failure without its fallback scenario', () => {
    const withoutFallback = IMPROVED.replace(/ \} alt "Cache down" \{[\s\S]*?db --> api : url\n {2}\}/, ' }');
    const diagram = diagramOf(withoutFallback, { ...PROBLEM, replicas: { lb: 2, api: 16, db: 2 } });
    expect(analyze(diagram).singlePointsOfFailure).toEqual(['cache']);
    const failed = runTests(diagram).filter((r) => !r.passed).map((r) => r.name);
    // A lone cache at 99.9% also caps availability below 99.95%.
    expect(failed).toEqual(['availability of Redirect ≥ 99.95%', 'survive any node failure', 'Redirects survive a cache outage']);
  });
});
