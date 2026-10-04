import { describe, expect, it } from 'vitest';
import { analyze, erlangC, hopLatency, hopModel, hopQuantile, mixtureQuantile, pathCdf, primaryAvailability, replicatedAvailability, type PathModel } from './analyze';
import { criticalPath } from './flow';
import { diagramOf } from './testDiagram';

const READ = `
client [Actor]
api [REST API]
db [PostgreSQL]
client -> api
api -> db
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  db --> api : row
  api --> client : 200
}
`;

const node = (analysis: ReturnType<typeof analyze>, id: string) => analysis.nodes.find((n) => n.id === id)!;

describe('load and utilisation', () => {
  it('adds R · m(s) to the target of every request step', () => {
    const a = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 1000 }] }));
    expect(node(a, 'client')).toMatchObject({ kind: 'client', loadRps: 0, capacityRps: Infinity, utilization: 0, saturated: false });
    expect(node(a, 'api')).toMatchObject({ kind: 'service', replicas: 1, loadRps: 1000, capacityRps: 2000, utilization: 0.5, saturated: false });
    // PostgreSQL serves 20k reads per replica (§7.2): 1k ÷ 20k = 5%.
    expect(node(a, 'db')).toMatchObject({ kind: 'database', loadRps: 1000, capacityRps: 20_000, utilization: 0.05, durable: true });
    expect(node(a, 'db')).toMatchObject({ readLoadRps: 1000, writeLoadRps: 0, readCapacityRps: 20_000, writeCapacityRps: 5000, readUtilization: 0.05, writeUtilization: 0 });
  });

  it('splits traffic over scenarios by mix and counts repeated, async and failed calls', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  api -> cache : GET
  alt "Hit" {
    cache --> api : v
  } alt "Miss" {
    cache --> api : nil
    api -> db : SELECT
    api ->> cache : SET
  } alt "DB down" {
    cache --> api : nil
    api -x db : SELECT
  }
  api --> client : 200
}`;
    const a = analyze(
      diagramOf(src, {
        replicas: { api: 10 },
        traffic: [{ useCase: 'Get', rps: 10_000, mix: [{ scenario: 'Hit', share: 0.8 }, { scenario: 'Miss', share: 0.15 }, { scenario: 'DB down', share: 0.05 }] }],
      }),
    );
    expect(node(a, 'api').loadRps).toBe(10_000);
    // Every scenario reads the cache; misses also write it back.
    expect(node(a, 'cache').loadRps).toBeCloseTo(10_000 + 1500);
    // Misses reach the database; a failed call does not (its target is down in that scenario).
    expect(node(a, 'db').loadRps).toBeCloseTo(1500);
    expect(a.warnings).toEqual([]);
  });

  it('sends all traffic to the first scenario without a mix', () => {
    const src = `
api [REST API]
db [PostgreSQL]
usecase "Get" {
  alt "A" {
    api -> db : one
  } alt "B" {
    api -> db : one
    api -> db : two
  }
}`;
    const a = analyze(diagramOf(src, { traffic: [{ useCase: 'Get', rps: 100 }] }));
    expect(node(a, 'db').loadRps).toBe(100);
    expect(a.useCases[0].scenarios.map((s) => s.share)).toEqual([1, 0]);
  });

  it('multiplies capacity by replicas and applies capacity overrides', () => {
    const a = analyze(
      diagramOf(READ, {
        replicas: { api: 4 },
        traffic: [{ useCase: 'Read', rps: 4000 }],
        capacity: [{ node: 'db', rps: 8000, latencyMs: 4, costUsd: 250 }],
      }),
    );
    expect(node(a, 'api')).toMatchObject({ replicas: 4, capacityRps: 8000, utilization: 0.5, costUsd: 400 });
    expect(node(a, 'db')).toMatchObject({ capacityRps: 8000, utilization: 0.5, latencyMs: 8, costUsd: 250 });
  });

  it('marks nodes at or above 100% as saturated and warns about them and hot nodes', () => {
    const a = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 3000 }] }));
    expect(node(a, 'api')).toMatchObject({ utilization: 1.5, saturated: true });
    expect(node(a, 'db')).toMatchObject({ utilization: 0.15, saturated: false });
    expect(a.warnings).toEqual(["'api' is saturated: 3k rps of 2k rps, 150%. Add replicas or take load off it."]);

    const exactly = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 2000 }] }));
    expect(node(exactly, 'api').saturated).toBe(true);

    const hot = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 1500 }] }));
    expect(hot.warnings).toEqual(["'api' runs hot: 1.5k rps of 2k rps, 75%."]);
  });

  it('warns about unknown use cases, scenarios, capacity nodes and mixes that do not add up', () => {
    const src = `
api [REST API]
usecase "Get" {
  alt "A" {
    api -> api : x
  } alt "B" {
    api -> api : y
  }
}`;
    const a = analyze(
      diagramOf(src, {
        traffic: [
          { useCase: 'Nope', rps: 1 },
          { useCase: 'Get', rps: 100, mix: [{ scenario: 'A', share: 0.3 }, { scenario: 'B', share: 0.3 }, { scenario: 'C', share: 0.1 }] },
        ],
        capacity: [{ node: 'ghost', rps: 1 }],
      }),
    );
    expect(a.warnings).toEqual([
      "Capacity for unknown node 'ghost' is ignored",
      'Traffic for unknown use case "Nope" is ignored',
      '"Get" has no scenario "C"; its traffic share is ignored',
      'Traffic mix of "Get" adds up to 60%; shares are scaled to 100%',
    ]);
    expect(a.useCases[0].scenarios.map((s) => s.share)).toEqual([0.5, 0.5]);
  });

  it('ignores groups and text nodes', () => {
    const src = `
group vpc "VPC" {
  api [REST API]
}
note [Sticky Note] "hello"
`;
    expect(analyze(diagramOf(src)).nodes.map((n) => n.id)).toEqual(['api']);
  });
});

/** `ln(1 / (1 − p))`, the p-quantile of an exponential with mean 1. */
const L = (p: number) => -Math.log(1 - p);

describe('queueing', () => {
  it('grows one server’s hop latency with utilisation as M/M/1, capped at 95%', () => {
    expect(hopLatency(10, 0)).toBe(10);
    expect(hopLatency(10, 0.5)).toBe(20);
    expect(hopLatency(10, 0.95)).toBeCloseTo(200);
    expect(hopLatency(10, 3)).toBeCloseTo(200);
  });

  it('computes the probability of waiting with Erlang C', () => {
    expect(erlangC(1, 0.5)).toBe(0.5);
    expect(erlangC(3, 0)).toBe(0);
    expect(erlangC(3, 1)).toBe(1);
    // c = 2, ρ = 0.5, a = 1: Erlang B is 1/5, so C = 0.2 / (1 − 0.5 × 0.8) = 1/3.
    expect(erlangC(2, 0.5)).toBeCloseTo(1 / 3, 12);
    // A big pool barely waits at the same utilisation.
    expect(erlangC(20, 0.5)).toBeLessThan(0.01);
  });

  it('lets a pool of replicas queue less than one server at the same utilisation (M/M/c)', () => {
    // Two servers at 50%: 10 + (1/3) × 10 / (2 × 0.5) = 13.33 ms instead of 20.
    expect(hopLatency(10, 0.5, 2)).toBeCloseTo(10 + 10 / 3, 10);
    const a = analyze(diagramOf(READ, { replicas: { api: 2 }, traffic: [{ useCase: 'Read', rps: 2000 }] }));
    expect(node(a, 'api')).toMatchObject({ utilization: 0.5, servers: 2 });
    expect(node(a, 'api').waitProbability).toBeCloseTo(1 / 3, 12);
    expect(node(a, 'api').latencyMs).toBeCloseTo(10 + 10 / 3, 10);
  });

  it('queues the writes of a write-bound single-primary store on its one primary', () => {
    const src = `
client [Actor]
db [PostgreSQL]
usecase "Write" {
  client -> db : INSERT row
}`;
    // 2.5k writes on one 5k primary: ρ = 0.5 on one server, whatever the replicas.
    const a = analyze(diagramOf(src, { replicas: { db: 3 }, traffic: [{ useCase: 'Write', rps: 2500 }] }));
    expect(node(a, 'db')).toMatchObject({ servers: 1, utilization: 0.5 });
    expect(node(a, 'db').latencyMs).toBeCloseTo(10, 10);
  });

  it('gives a hop half a fixed service time and an exponential tail for the rest of its mean', () => {
    // Idle: fixed 5, tail 5; p50 = 5 + 5 ln 2, p99 = 5 + 5 ln 100 = 2.8× the mean.
    const idle = hopModel(10, 0);
    expect(idle).toMatchObject({ fixedMs: 5, tailMs: 5, waitProbability: 0 });
    expect(hopQuantile(idle, 0.5)).toBeCloseTo(5 + 5 * Math.LN2, 10);
    expect(hopQuantile(idle, 0.99)).toBeCloseTo(5 + 5 * L(0.99), 10);
    // At 50% on one server the mean doubles to 20 and all of the growth is tail, so p99 ÷ mean grows too.
    const busy = hopModel(10, 0.5);
    expect(busy).toMatchObject({ fixedMs: 5, tailMs: 15 });
    expect(hopQuantile(busy, 0.99) / 20).toBeGreaterThan(hopQuantile(idle, 0.99) / 10);
  });
});

describe('latency', () => {
  it('sums hop latencies on the synchronous path; the tail grows only on service and queueing time', () => {
    const a = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 1000 }] }));
    // api: one server at 50%, mean 10 / (1 − 0.5) = 20, fixed 5, tail 15;
    // db: 1k of 20k reads, mean 5 / 0.95 = 5.2632, fixed 2.5, tail 2.7632.
    const fixed = 5 + 2.5;
    const tail = 15 + (5 / 0.95 - 2.5);
    const [read] = a.useCases;
    expect(read.rps).toBe(1000);
    expect(read.scenarios[0].meanMs).toBeCloseTo(fixed + tail, 10);
    expect(read.percentiles.p50).toBeCloseTo(fixed + tail * L(0.5), 10);
    expect(read.percentiles.p90).toBeCloseTo(fixed + tail * L(0.9), 10);
    expect(read.percentiles.p95).toBeCloseTo(fixed + tail * L(0.95), 10);
    expect(read.percentiles.p99).toBeCloseTo(fixed + tail * L(0.99), 10);
    expect(read.percentiles.p999).toBeCloseTo(fixed + tail * L(0.999), 10);
    expect(read.percentiles).toEqual(read.scenarios[0].percentiles);
  });

  it('computes latencies for use cases without traffic too', () => {
    const a = analyze(diagramOf(READ));
    expect(a.useCases[0]).toMatchObject({ rps: 0 });
    expect(a.useCases[0].scenarios[0].meanMs).toBe(15);
  });

  it('counts the slowest member of a par group', () => {
    const src = `
client [Actor]
api [REST API]
a [REST API]
b [AWS Lambda]
usecase "Page" {
  client -> api : GET
  par {
    api -> a : one
    api -> b : two
  }
  api --> client : 200
}`;
    expect(analyze(diagramOf(src)).useCases[0].scenarios[0].meanMs).toBe(10 + 25);
  });

  it('counts only the send hop of async calls and nothing after the entry response', () => {
    const src = `
client [Actor]
api [REST API]
q [Kafka]
worker [REST API]
db [PostgreSQL]
search [Elasticsearch]
usecase "Order" {
  client -> api : POST /orders
  api ->> q : OrderPlaced
  api --> client : 202
  q ->> worker : OrderPlaced
  worker -> db : INSERT order
  worker -> search : index
}`;
    const d = diagramOf(src);
    // api 10 + kafka send 5; the worker's database and search writes are off the path.
    expect(analyze(d).useCases[0].scenarios[0].meanMs).toBe(15);
    const [u] = d.useCases;
    expect(criticalPath(u, u.scenarios[0]).flat().map((h) => h.target)).toEqual(['api', 'q']);
  });

  it('does not count steps written after the entry response line', () => {
    const src = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "Accept" {
  client -> api : POST
  api --> client : 202
  api -> db : INSERT
}`;
    expect(analyze(diagramOf(src)).useCases[0].scenarios[0].meanMs).toBe(10);
  });

  it('does not count the work behind an async request/response', () => {
    const src = `
client [Actor]
api [REST API]
svc [REST API]
db [PostgreSQL]
usecase "Report" {
  client -> api : POST /reports
  api ->> svc : build
  svc -> db : SELECT
  db --> svc : rows
  svc --> api : done
  api --> client : 200
}`;
    expect(analyze(diagramOf(src)).useCases[0].scenarios[0].meanMs).toBe(10 + 10);
  });

  it('counts the work of nested synchronous calls when no responses are written', () => {
    const src = `
client [Actor]
api [REST API]
svc [REST API]
db [PostgreSQL]
usecase "Chain" {
  client -> api : GET
  api -> svc : GET
  svc -> db : SELECT
}`;
    expect(analyze(diagramOf(src)).useCases[0].scenarios[0].meanMs).toBe(25);
  });

  it('charges a timeout for failed calls', () => {
    const src = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  api -x db : SELECT
  api --> client : 503
}`;
    expect(analyze(diagramOf(src)).useCases[0].scenarios[0].meanMs).toBe(1010);
    expect(analyze(diagramOf(src), { timeoutMs: 300 }).useCases[0].scenarios[0].meanMs).toBe(310);
  });

  it('adds a timeout once, not scaled by the tail, and takes a per-node timeout', () => {
    const src = `
client [Actor]
api [REST API]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  api -x db : SELECT
  api --> client : 503
}`;
    // The idle api's p99 is 5 + 5 ln 100 = 28 ms; the 1 000 ms timeout adds once: 1 028 ms, not 3 030.
    expect(analyze(diagramOf(src)).useCases[0].percentiles.p99).toBeCloseTo(1000 + 5 + 5 * L(0.99), 10);
    // capacity { db timeout 200ms } sets what a failed call to db costs, over the analysis default.
    const withTimeout = diagramOf(src, { capacity: [{ node: 'db', timeoutMs: 200 }] });
    expect(analyze(withTimeout).useCases[0].scenarios[0].meanMs).toBe(210);
    expect(analyze(withTimeout, { timeoutMs: 300 }).useCases[0].scenarios[0].meanMs).toBe(210);
  });

  it('adds transfer time once, and N payloads for a fan-out of N', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
usecase "Get" {
  client -> api : GET
  api -> cache : GET
  api --> client : 200
}`;
    // 1 MB between api (200 MB/s) and cache (100 MB/s) moves at 100 MB/s: 10 ms, fixed.
    const once = analyze(diagramOf(src, { steps: { 'Get:1': { sizeBytes: 1e6 } } })).useCases[0];
    expect(once.scenarios[0].meanMs).toBeCloseTo(10 + 1 + 10, 10);
    expect(once.percentiles.p99).toBeCloseTo(10 + 5.5 + 5.5 * L(0.99), 10);
    // x5: five payloads cross the link, batched or in parallel: 50 ms.
    const five = analyze(diagramOf(src, { steps: { 'Get:1': { sizeBytes: 1e6, multiplier: 5 } } })).useCases[0];
    expect(five.scenarios[0].meanMs).toBeCloseTo(10 + 1 + 50, 10);
  });
});

describe('use case percentiles: the mixture of the scenarios', () => {
  const constant = (ms: number): PathModel => ({ parts: [[{ fixedMs: ms, tailMs: 0 }]] });
  const exponential = (mean: number): PathModel => ({ parts: [[{ fixedMs: 0, tailMs: mean }]] });

  it('steps between constant scenarios at their shares', () => {
    const paths = [
      { share: 0.9, path: constant(10) },
      { share: 0.1, path: constant(100) },
    ];
    expect(mixtureQuantile(paths, 0.5)).toBeCloseTo(10, 6);
    expect(mixtureQuantile(paths, 0.9)).toBeCloseTo(10, 6);
    expect(mixtureQuantile(paths, 0.99)).toBeCloseTo(100, 6);
  });

  it('solves Σ share × P(scenario ≤ t) = q', () => {
    // Half the requests take Exp(10), half Exp(100). At t ≈ 391 the fast half is all done,
    // so 0.5 + 0.5 (1 − e^(−t/100)) = 0.99 gives t = 100 ln 50: below the slow scenario's own p99 (100 ln 100).
    const paths = [
      { share: 0.5, path: exponential(10) },
      { share: 0.5, path: exponential(100) },
    ];
    const p99 = mixtureQuantile(paths, 0.99);
    expect(p99).toBeCloseTo(100 * Math.log(50), 4);
    expect(0.5 * pathCdf(paths[0].path, p99) + 0.5 * pathCdf(paths[1].path, p99)).toBeCloseTo(0.99, 8);
    expect(p99).toBeLessThan(100 * L(0.99));
  });

  it('is one scenario’s own quantile when it carries all the traffic', () => {
    expect(
      mixtureQuantile(
        [
          { share: 1, path: exponential(10) },
          { share: 0, path: constant(1000) },
        ],
        0.99,
      ),
    ).toBeCloseTo(10 * L(0.99), 10);
    expect(mixtureQuantile([], 0.99)).toBe(0);
  });

  it('moves smoothly as a scenario’s share crosses the tail', () => {
    const p99 = (miss: number) =>
      mixtureQuantile(
        [
          { share: 1 - miss, path: exponential(10) },
          { share: miss, path: exponential(100) },
        ],
        0.99,
      );
    expect(Math.abs(p99(0.0101) - p99(0.0099))).toBeLessThan(2);
    expect(p99(0.005)).toBeLessThan(p99(0.0099));
    expect(p99(0.0101)).toBeLessThan(p99(0.02));
  });

  it('applies to cache hits and misses end to end, and names the scenario in the tail', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  alt "Hit" {
    api -> cache : GET
    cache --> api : v
  } alt "Miss" {
    api -> cache : GET
    cache --> api : nil
    api -> db : SELECT
    db --> api : v
  }
  api --> client : 200
}`;
    const run = (miss: number) =>
      analyze(diagramOf(src, { traffic: [{ useCase: 'Get', rps: 0.0001, mix: [{ scenario: 'Hit', share: 1 - miss }, { scenario: 'Miss', share: miss }] }] }))
        .useCases[0];
    // At (nearly) no load: hit = 10 + 1 = 11 ms (fixed 5.5, tail 5.5), miss = 16 ms (fixed 8, tail 8).
    const [hit, miss] = run(0.1).scenarios;
    expect(hit.percentiles.p99).toBeCloseTo(5.5 + 5.5 * L(0.99), 4);
    expect(miss.percentiles.p99).toBeCloseTo(8 + 8 * L(0.99), 4);
    // With 10% misses, p99 is near the miss path's p90, below its p99.
    const p99 = run(0.1).percentiles.p99;
    expect(p99).toBeGreaterThan(miss.percentiles.p90);
    expect(p99).toBeLessThan(miss.percentiles.p99);
    expect(run(0.2).tailScenario.p99).toBe(1);
    expect(run(0.2).tailScenario.p50).toBe(0);
    // With 0.5% misses p99 is close to the hit path's, and p999 is still pulled up by the misses.
    expect(run(0.005).percentiles.p99).toBeLessThan(hit.percentiles.p99 + 2);
    expect(run(0.005).percentiles.p999).toBeGreaterThan(hit.percentiles.p999);
  });
});

describe('availability', () => {
  it('raises node availability with replicas', () => {
    expect(replicatedAvailability(0.995, 1)).toBeCloseTo(0.995, 10);
    expect(replicatedAvailability(0.995, 2)).toBeCloseTo(0.999975, 10);
    expect(replicatedAvailability(0.99, 3)).toBeCloseTo(0.999999, 10);
  });

  it('makes a single-primary store’s writes depend on its primary, with failover when there is a replica', () => {
    expect(primaryAvailability(0.9995, 1)).toBe(0.9995);
    // A replica takes over, but a tenth of each outage is lost to failover: 1 − 0.0005 × 0.1.
    expect(primaryAvailability(0.9995, 3)).toBeCloseTo(0.99995, 12);
    const src = `
client [Actor]
db [PostgreSQL]
usecase "Write" {
  client -> db : INSERT row
}
usecase "Read" {
  client -> db : SELECT row
}`;
    const a = analyze(diagramOf(src, { replicas: { db: 3 } }));
    expect(node(a, 'db').availability).toBeCloseTo(1 - 0.0005 ** 3, 15);
    expect(node(a, 'db').writeAvailability).toBeCloseTo(0.99995, 12);
    expect(a.useCases.find((u) => u.name === 'Write')!.availability).toBeCloseTo(0.99995, 12);
    expect(a.useCases.find((u) => u.name === 'Read')!.availability).toBeCloseTo(1 - 0.0005 ** 3, 15);
    // A partitioned store takes writes on every replica.
    const dynamo = analyze(diagramOf(src.replace('[PostgreSQL]', '[DynamoDB]'), { replicas: { db: 3 } }));
    expect(node(dynamo, 'db').writeAvailability).toBe(node(dynamo, 'db').availability);
  });

  it('multiplies node availabilities on the main path', () => {
    const a = analyze(diagramOf(READ));
    expect(a.useCases[0].availability).toBeCloseTo(0.995 * 0.9995, 10);
    const replicated = analyze(diagramOf(READ, { replicas: { api: 2, db: 2 } }));
    expect(replicated.useCases[0].availability).toBeCloseTo((1 - 0.005 ** 2) * (1 - 0.0005 ** 2), 10);
    expect(node(replicated, 'api').availability).toBeCloseTo(0.999975, 10);
  });

  it('uses the scenario with the largest share as the main path', () => {
    const src = `
client [Actor]
api [REST API]
ext [Third Party API]
usecase "Get" {
  client -> api : GET
  alt "Plain" {
    api --> client : 200
  } alt "Enriched" {
    api -> ext : lookup
    api --> client : 200
  }
}`;
    const run = (enriched: number) =>
      analyze(diagramOf(src, { traffic: [{ useCase: 'Get', rps: 1, mix: [{ scenario: 'Plain', share: 1 - enriched }, { scenario: 'Enriched', share: enriched }] }] }))
        .useCases[0].availability;
    expect(run(0.2)).toBeCloseTo(0.995, 10);
    expect(run(0.8)).toBeCloseTo(0.995 * 0.999, 10);
  });

  it('credits a fallback scenario that completes without the node', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  alt "Hit" {
    api -> cache : GET
    cache --> api : v
  } alt "Cache down" {
    api -x cache : GET
    api -> db : SELECT
    db --> api : v
  }
  api --> client : 200
}`;
    const a = analyze(diagramOf(src));
    // cache: 1 − (1 − 0.999)(1 − 0.9995), with the database as the fallback path.
    expect(a.useCases[0].availability).toBeCloseTo(0.995 * (1 - 0.001 * 0.0005), 12);
  });

  it('gives no credit for an error scenario or one that still needs the node', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
usecase "Get" {
  client -> api : GET
  alt "Hit" {
    api -> cache : GET
    cache --> api : v
    api --> client : 200
  } alt "Cache down" {
    api -x cache : GET
    api --> client : 503
  } alt "Retry" {
    api -x cache : GET
    api -> cache : GET
    cache --> api : v
    api --> client : 200
  }
}`;
    expect(analyze(diagramOf(src)).useCases[0].availability).toBeCloseTo(0.995 * 0.999, 10);
  });
});

describe('single points of failure and cost', () => {
  it('lists single-replica nodes that a use case cannot do without', () => {
    expect(analyze(diagramOf(READ)).singlePointsOfFailure).toEqual(['api', 'db']);
    expect(analyze(diagramOf(READ, { replicas: { api: 2 } })).singlePointsOfFailure).toEqual(['db']);
  });

  it('leaves out nodes with a fallback, clients and external systems', () => {
    const src = `
client [Actor]
api [REST API]
cache [Redis]
pay [Payment Gateway]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET
  api -> pay : charge
  alt "Hit" {
    api -> cache : GET
    cache --> api : v
  } alt "Cache down" {
    api -x cache : GET
  }
  api --> client : 200
}`;
    expect(analyze(diagramOf(src)).singlePointsOfFailure).toEqual(['api']);
  });

  it('sums replicas × cost', () => {
    const a = analyze(diagramOf(READ, { replicas: { api: 3, db: 2 } }));
    expect(a.totalCostUsd).toBe(3 * 100 + 2 * 400);
  });
});
