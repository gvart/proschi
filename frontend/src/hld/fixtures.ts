import { parse } from '../dsl/parser';
import type { Diagram, SourceLoc } from '../dsl/types';
import type { Analysis, NodeAnalysis, TestResult } from './engine';

/**
 * A URL shortener with every HLD input, for tests. The structure is parsed;
 * the scale and requirement statements (docs/design/hld-and-practice.md §1)
 * are attached by hand until the parser reads them.
 */

export const shortenerSource = `title "URL Shortener"

group edge "Edge" {
  lb "Load Balancer" [AWS Load Balancer]
}
visitor "Visitor"       [Actor]
api     "Shortener API" [REST API] @links "Creates codes and serves redirects"
cache   "Code Cache"    [Redis]    @links
db      "Links DB"      [DynamoDB] @links

visitor -> lb
lb  -> api
api -> cache
api -> db

usecase "Shorten" "Create a short code" {
  visitor -> lb : POST /links json {"target": "https://example.com"}
  lb  -> api : POST /links
  api -> db  : PutItem
  db --> api : ok
  api --> lb : 201
  lb --> visitor : 201 {"code": "aZ3"}
}

usecase "Redirect" {
  visitor -> lb : GET /r/1001
  lb -> api : GET /r/1001
  api -> cache : GET code
  alt "Cache hit" {
    cache --> api : target
    api --> lb : 302
    lb --> visitor : 302
  } alt "Cache miss" when "the code is not cached" {
    cache --> api : nil
    api -> db : GetItem
    api --> lb : 302
    lb --> visitor : 302
  }
}

usecase "Redirect again" {
  visitor -> lb : GET /r/1002
  lb --> visitor : 302
}
`;

const at = (line: number): SourceLoc => ({ line, col: 1, length: 1 });

export function shortenerDiagram(): Diagram {
  const { diagram } = parse(shortenerSource);
  for (const n of diagram.nodes) if (n.id === 'api') n.replicas = 3;
  return {
    ...diagram,
    summary: 'Turns long URLs into short codes',
    traffic: [
      { useCase: 'Redirect', rps: 100_000, mix: [{ scenario: 'Cache hit', share: 0.9 }, { scenario: 'Cache miss', share: 0.1 }], loc: at(100) },
      { useCase: 'Shorten', rps: 1_000, loc: at(101) },
    ],
    requirements: [
      { kind: 'latency', percentile: 99, useCase: 'Redirect', maxMs: 50, loc: at(110) },
      { kind: 'availability', minPercent: 99.9, loc: at(111) },
      { kind: 'durable', useCase: 'Shorten', loc: at(112) },
      { kind: 'survive', target: 'any', loc: at(113) },
      { kind: 'cost', maxUsdPerMonth: 3000, loc: at(114) },
    ],
    capacity: [{ node: 'cache', rps: 150_000, loc: at(120) }],
    entities: [
      {
        name: 'Url',
        store: 'db',
        description: 'One short code and where it points',
        fields: [
          { name: 'code', type: 'string', flags: ['key'] },
          { name: 'target', type: 'string', flags: [] },
          { name: 'createdAt', type: 'time', flags: ['index'] },
        ],
        loc: at(130),
      },
    ],
    decisions: [
      { title: 'Cache redirects in Redis', because: 'Reads outnumber writes 100:1', rejected: [{ option: 'Memcached', reason: 'no replication' }], loc: at(140) },
    ],
    tests: [
      {
        name: 'Redirect is served from the cache',
        assertions: [
          { kind: 'before', useCase: 'Redirect', first: { kind: 'cache' }, then: { kind: 'database' }, loc: at(151) },
          { kind: 'calls', useCase: 'Redirect', scenario: 'Cache hit', target: { kind: 'database' }, quantifier: 'never', loc: at(152) },
        ],
        loc: at(150),
      },
      { name: 'No direct path', assertions: [{ kind: 'noPath', from: { node: 'visitor' }, to: { tech: 'DynamoDB' }, loc: at(161) }], loc: at(160) },
    ],
  };
}

const percentiles = (mean: number) => ({ p50: mean, p90: mean * 1.6, p95: mean * 2, p99: mean * 3, p999: mean * 5 });

type NodeFixture = Omit<
  NodeAnalysis,
  | 'shards'
  | 'readLoadRps'
  | 'writeLoadRps'
  | 'readCapacityRps'
  | 'writeCapacityRps'
  | 'readUtilization'
  | 'writeUtilization'
  | 'writeScaling'
  | 'egressGbPerMonth'
  | 'egressUsd'
  | 'servers'
  | 'waitProbability'
  | 'writeAvailability'
  | 'bandwidthUtilization'
  | 'bandwidthLoadMBps'
  | 'bandwidthCapacityMBps'
  | 'requestUtilization'
>;

/** A node with all of its load counted as reads and no egress. */
const node = (n: NodeFixture): NodeAnalysis => ({
  shards: 1,
  readLoadRps: n.loadRps,
  writeLoadRps: 0,
  readCapacityRps: n.capacityRps,
  writeCapacityRps: n.capacityRps,
  readUtilization: n.utilization,
  writeUtilization: 0,
  writeScaling: 'replicas',
  egressGbPerMonth: 0,
  egressUsd: 0,
  servers: n.replicas,
  waitProbability: 0,
  writeAvailability: n.availability,
  bandwidthUtilization: 0,
  bandwidthLoadMBps: 0,
  bandwidthCapacityMBps: 0,
  requestUtilization: n.utilization,
  ...n,
});

export const shortenerAnalysis: Analysis = {
  nodes: [
    node({ id: 'visitor', kind: 'client', replicas: 1, loadRps: 0, capacityRps: Infinity, utilization: 0, saturated: false, latencyMs: 0, availability: 1, costUsd: 0, durable: false }),
    node({ id: 'lb', kind: 'edge', replicas: 1, loadRps: 101_000, capacityRps: 100_000, utilization: 1.01, saturated: true, latencyMs: 40, availability: 0.9999, costUsd: 50, durable: false }),
    node({ id: 'api', kind: 'service', replicas: 3, loadRps: 4_500, capacityRps: 6_000, utilization: 0.75, saturated: false, latencyMs: 40, availability: 0.99999, costUsd: 300, durable: false }),
    node({ id: 'cache', kind: 'cache', replicas: 1, loadRps: 100_000, capacityRps: 150_000, utilization: 0.67, saturated: false, latencyMs: 3, availability: 0.999, costUsd: 150, durable: false }),
    node({ id: 'db', kind: 'database', replicas: 1, loadRps: 11_000, capacityRps: 20_000, utilization: 0.55, saturated: false, latencyMs: 11, availability: 0.9999, costUsd: 500, durable: true }),
  ],
  useCases: [
    {
      id: 'redirect',
      name: 'Redirect',
      rps: 100_000,
      scenarios: [
        { id: 'cache-hit', name: 'Cache hit', share: 0.9, meanMs: 14, percentiles: percentiles(14) },
        { id: 'cache-miss', name: 'Cache miss', share: 0.1, meanMs: 25, percentiles: percentiles(25) },
      ],
      percentiles: percentiles(25),
      tailScenario: { p50: 0, p90: 1, p95: 1, p99: 1, p999: 1 },
      availability: 0.9989,
    },
  ],
  totalCostUsd: 1000,
  totalEgressUsd: 0,
  singlePointsOfFailure: ['cache'],
  warnings: ['Shares of Redirect sum to 100%'],
};

export const shortenerTests: TestResult[] = [
  { id: 'req:0', name: 'p99 of Redirect < 50 ms', category: 'latency', passed: false, message: 'p99 of Redirect is 75 ms (limit 50 ms)', hint: 'Add replicas to Load Balancer', loc: at(110) },
  { id: 'req:1', name: 'availability of every use case ≥ 99.9%', category: 'availability', passed: true, message: 'Redirect is 99.95%', loc: at(111) },
  // Matched by name: no position.
  { id: 'req:4', name: 'cost ≤ $3,000/month', category: 'cost', passed: true, message: 'Cost is $1,000 (limit $3,000)' },
  { id: 'test:Redirect is served from the cache', name: 'Redirect is served from the cache', category: 'flow', passed: true, message: 'All 2 assertions hold', loc: at(150) },
  { id: 'test:No direct path', name: 'No direct path', category: 'flow', passed: false, message: 'visitor → lb → api → db', hint: 'Remove the connection', loc: at(160) },
];
