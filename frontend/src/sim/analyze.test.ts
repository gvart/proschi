import { describe, expect, it } from 'vitest';
import { analyze, hopLatency, replicatedAvailability, useCasePercentile } from './analyze';
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
    // Misses and failed calls both reach the database.
    expect(node(a, 'db').loadRps).toBeCloseTo(1500 + 500);
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

describe('latency', () => {
  it('grows hop latency with utilisation, capped at 95%', () => {
    expect(hopLatency(10, 0)).toBe(10);
    expect(hopLatency(10, 0.5)).toBe(20);
    expect(hopLatency(10, 0.95)).toBeCloseTo(200);
    expect(hopLatency(10, 3)).toBeCloseTo(200);
  });

  it('sums hop latencies on the synchronous path and scales percentiles', () => {
    const a = analyze(diagramOf(READ, { traffic: [{ useCase: 'Read', rps: 1000 }] }));
    // api: 10 / (1 − 0.5) = 20; db: 5 / (1 − 0.05) = 5.2632; mean 25.2632
    const [read] = a.useCases;
    expect(read.rps).toBe(1000);
    expect(read.scenarios[0].meanMs).toBeCloseTo(25.2632, 3);
    expect(read.percentiles.p50).toBeCloseTo(25.2632, 3);
    expect(read.percentiles.p90).toBeCloseTo(40.4211, 3);
    expect(read.percentiles.p95).toBeCloseTo(50.5263, 3);
    expect(read.percentiles.p99).toBeCloseTo(75.7895, 3);
    expect(read.percentiles.p999).toBeCloseTo(126.3158, 3);
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
});

describe('use case percentile rule', () => {
  const scenarios = (hitShare: number) => [
    { share: hitShare, value: 10 },
    { share: 1 - hitShare, value: 100 },
  ];

  it('lets a scenario above the tail share dominate', () => {
    expect(useCasePercentile(scenarios(0.9), 99)).toBe(100);
    expect(useCasePercentile(scenarios(0.9), 90)).toBe(100);
    expect(useCasePercentile(scenarios(0.9), 50)).toBe(10);
  });

  it('ignores a scenario below the tail share', () => {
    expect(useCasePercentile(scenarios(0.995), 99)).toBe(10);
    expect(useCasePercentile(scenarios(0.995), 99.9)).toBe(100);
  });

  it('counts a scenario exactly at the tail share', () => {
    expect(useCasePercentile(scenarios(0.99), 99)).toBe(100);
  });

  it('falls back to the slowest scenarios covering the tail when none carries it alone', () => {
    const three = [
      { share: 1 / 3, value: 10 },
      { share: 1 / 3, value: 20 },
      { share: 1 / 3, value: 30 },
    ];
    expect(useCasePercentile(three, 50)).toBe(20);
  });

  it('applies the rule to cache hits and misses end to end', () => {
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
    // At (nearly) no load: hit = 10 + 1 = 11 ms, miss = 11 + 5 = 16 ms.
    expect(run(0.1).percentiles.p99).toBeCloseTo(16 * 3, 2);
    expect(run(0.005).percentiles.p99).toBeCloseTo(11 * 3, 2);
    expect(run(0.005).percentiles.p999).toBeCloseTo(16 * 5, 2);
  });
});

describe('availability', () => {
  it('raises node availability with replicas', () => {
    expect(replicatedAvailability(0.995, 1)).toBeCloseTo(0.995, 10);
    expect(replicatedAvailability(0.995, 2)).toBeCloseTo(0.999975, 10);
    expect(replicatedAvailability(0.99, 3)).toBeCloseTo(0.999999, 10);
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
