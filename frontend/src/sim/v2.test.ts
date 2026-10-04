import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import type { Diagram } from '../dsl/types';
import { analyze, hopLatency, hopModel, mixtureQuantile, pathQuantile, type PathModel } from './analyze';
import { selectNodes } from './flow';
import { runTests, type TestResult } from './tests';
import { diagramOf } from './testDiagram';

/**
 * The simulation side of docs/design/hld-and-practice.md §7, end to end:
 * real v2 syntax through the parser, hand-computed expectations for every
 * formula, and positive and negative cases for every rule and assertion.
 */

/** Parses a document that must have no errors. */
function doc(source: string): Diagram {
  const { diagram, diagnostics } = parse(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => `${e.line}: ${e.message}`).join('; '));
  return diagram;
}

/** 1-based line of the first line of `source` that contains `text`. */
const lineOf = (source: string, text: string) => source.split('\n').findIndex((l) => l.includes(text)) + 1;

const node = (a: ReturnType<typeof analyze>, id: string) => a.nodes.find((n) => n.id === id)!;
const byName = (results: TestResult[]) => Object.fromEntries(results.map((r) => [r.name, r]));

// ---------------------------------------------------------------- §7.2

const SHOP = (writes: string, extra = '') => `client [Actor]
api [REST API] x40
db [PostgreSQL] x3
client -> api
api -> db
usecase "Write" {
  client -> api : POST /items
  api -> db : INSERT item
  db --> api : ok
  api --> client : 201
}
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  db --> api : row
  api --> client : 200
}
traffic {
  "Write" ${writes}
  "Read"  30k rps
}
${extra}`;

describe('§7.2 reads, writes and single-primary stores', () => {
  it('splits load into reads and writes; relational writes go to one primary', () => {
    const a = analyze(doc(SHOP('4k rps')));
    // api shares its replicas: (30k + 4k) / (40 × 2k) = 42.5%
    expect(node(a, 'api')).toMatchObject({ readLoadRps: 30_000, writeLoadRps: 4000, loadRps: 34_000, capacityRps: 80_000 });
    expect(node(a, 'api').utilization).toBeCloseTo(0.425);
    // db: reads 30k on 3 × 20k = 50%, writes 4k on one 5k primary = 80%; the busier side counts.
    expect(node(a, 'db')).toMatchObject({
      readLoadRps: 30_000,
      writeLoadRps: 4000,
      readCapacityRps: 60_000,
      writeCapacityRps: 5000,
      readUtilization: 0.5,
      writeUtilization: 0.8,
      utilization: 0.8,
      saturated: false,
      writeScaling: 'shards',
      shards: 1,
      costUsd: 1200,
    });
    expect(node(a, 'db').capacityRps).toBeCloseTo(34_000 / 0.8);
    expect(node(a, 'db').latencyMs).toBeCloseTo(5 / (1 - 0.8));
    expect(a.warnings).toEqual(["'db' runs hot: reads 30k rps of 60k rps, 50%; writes 4k rps of 5k rps, 80%."]);
  });

  it('saturates on writes alone, and points at shards rather than replicas', () => {
    const d = doc(SHOP('6k rps', 'requirements {\n  p99 "Write" < 1000ms\n}'));
    const a = analyze(d);
    expect(node(a, 'db')).toMatchObject({ readUtilization: 0.5, writeUtilization: 1.2, utilization: 1.2, saturated: true });
    expect(a.warnings).toEqual(["'db' is saturated: reads 30k rps of 60k rps, 50%; writes 6k rps of 5k rps, 120%. Add shards for writes or take load off it."]);
    const [latency] = runTests(d, a);
    expect(latency.message).toBe('p99 of Write: db is saturated (reads 30k rps of 60k rps, 50%; writes 6k rps of 5k rps, 120%) (limit 1000 ms)');
    // ceil(6k / (5k × 70%)) = 2 shards
    expect(latency.hint).toContain('capacity { db shards 2 }');
    expect(latency.hint).toContain('read replicas do not add write capacity');

    // More replicas add reads only.
    const more = analyze(doc(SHOP('6k rps').replace('db [PostgreSQL] x3', 'db [PostgreSQL] x6')));
    expect(node(more, 'db')).toMatchObject({ readCapacityRps: 120_000, writeCapacityRps: 5000, saturated: true });
  });

  it('scales writes with shards, and every shard costs its replicas', () => {
    const a = analyze(doc(SHOP('6k rps', 'capacity {\n  db shards 2\n}')));
    // reads 30k on 3 × 2 × 20k = 25%; writes 6k on 2 × 5k = 60%; 6 instances × $400
    expect(node(a, 'db')).toMatchObject({ shards: 2, readCapacityRps: 120_000, writeCapacityRps: 10_000, readUtilization: 0.25, writeUtilization: 0.6, utilization: 0.6, saturated: false, costUsd: 2400 });
  });

  it('takes reads and writes overrides', () => {
    const a = analyze(doc(SHOP('6k rps', 'capacity {\n  db reads 30k rps writes 8k rps\n}')));
    expect(node(a, 'db')).toMatchObject({ readCapacityRps: 90_000, writeCapacityRps: 8000, writeUtilization: 0.75, saturated: false });
    // `rps` alone sets both.
    const both = analyze(doc(SHOP('6k rps', 'capacity {\n  db 10k rps\n}')));
    expect(node(both, 'db')).toMatchObject({ readCapacityRps: 30_000, writeCapacityRps: 10_000 });
  });

  it('adds the read and write shares of a partitioned store', () => {
    const a = analyze(doc(SHOP('6k rps').replace('db [PostgreSQL] x3', 'db [DynamoDB] x3')));
    // (30k + 6k) / (3 × 20k) = 60%
    expect(node(a, 'db')).toMatchObject({ writeScaling: 'replicas', readCapacityRps: 60_000, writeCapacityRps: 60_000, capacityRps: 60_000 });
    expect(node(a, 'db').utilization).toBeCloseTo(0.6);
  });

  it('loses read capacity, not write capacity, when a relational replica fails', () => {
    const d = doc(SHOP('4k rps').replace('"Read"  30k rps', '"Read"  50k rps') + 'requirements {\n  survive failure of db\n}');
    const [survive] = runTests(d);
    // Two replicas left: reads 50k on 40k = 125%
    expect(survive).toMatchObject({ passed: false, message: 'Losing one of 3 db replicas leaves 43.2k rps for 54k rps (125%)' });
    expect(survive.hint).toBe('Add a replica to db (PostgreSQL) (x4) so the rest carry the load');
    expect(runTests(doc(SHOP('4k rps') + 'requirements {\n  survive failure of db\n}'))[0].passed).toBe(true);
  });

  it('counts only writes as durable, and every request to a queue as a write', () => {
    const src = `client [Actor]
api [REST API] x2
db [PostgreSQL] x2
q [AWS SQS] x2
usecase "Lookup" {
  client -> api : POST /lookups
  api -> db : SELECT row
  db --> api : row
  api --> client : 200
}
usecase "Enqueue" {
  client -> api : POST /orders
  api -> q : OrderPlaced
  q --> api : ok
  api --> client : 202
}
traffic {
  "Enqueue" 100 rps
}
requirements {
  durable "Lookup"
  durable "Enqueue"
}`;
    const d = doc(src);
    // The parser classifies `OrderPlaced` as a read; a queue stores it all the same.
    expect(d.useCases[1].steps[1].access).toBe('read');
    expect(node(analyze(d), 'q')).toMatchObject({ writeLoadRps: 100, readLoadRps: 0 });
    const [lookup, enqueue] = runTests(d);
    expect(lookup).toMatchObject({
      passed: false,
      message: `"Lookup" only reads from a durable store before responding: api -> db : SELECT row at line ${lineOf(src, 'SELECT row')} is a read`,
    });
    expect(lookup.hint).toContain('start the label with a write verb');
    expect(enqueue).toMatchObject({ passed: true, message: '"Enqueue" writes to a durable store before responding' });
  });

  it('classifies steps without a parser access by the same rules', () => {
    const d = doc(SHOP('4k rps'));
    const stripped: Diagram = {
      ...d,
      useCases: d.useCases.map((u) => ({ ...u, scenarios: u.scenarios.map((s) => ({ ...s, steps: s.steps.map((step) => ({ ...step, access: undefined })) })) })),
    };
    expect(stripped.useCases[0].scenarios[0].steps[1].access).toBeUndefined();
    expect(node(analyze(stripped), 'db')).toMatchObject({ readLoadRps: 30_000, writeLoadRps: 4000 });
  });
});

// ---------------------------------------------------------------- §7.3

describe('§7.3 fan-out', () => {
  const src = `client [Actor]
api [REST API] x2
feeds [Redis]
usecase "Post" {
  client -> api : POST /posts
  api -> feeds : x200 LPUSH feed:{follower}
  feeds --> api : ok
  api --> client : 201
}
traffic {
  "Post" 10 rps
}`;

  it('counts N calls in load and the step once in latency', () => {
    const a = analyze(doc(src));
    // 10 rps × 200 writes
    expect(node(a, 'feeds')).toMatchObject({ writeLoadRps: 2000, readLoadRps: 0 });
    expect(node(a, 'feeds').utilization).toBeCloseTo(0.02);
    // api: two replicas (M/M/2) at 0.25%; feeds: one Redis at 2%.
    const api = hopLatency(10, 10 / 4000, 2);
    const feeds = 1 / (1 - 0.02);
    expect(a.useCases[0].scenarios[0].meanMs).toBeCloseTo(api + feeds, 10);
  });
});

describe('§7.3 transfer time', () => {
  const src = `client [Actor]
api [REST API]
blobs [AWS S3]
usecase "Upload" {
  client -> api : ~2MB POST /upload
  api -> blobs : ~5MB PUT /objects/1
  blobs --> api : ok
  api --> client : 201
}
`;

  it('adds size ÷ the slower bandwidth of the two ends to the hop', () => {
    const d = doc(src);
    expect(d.useCases[0].steps.map((s) => s.sizeBytes)).toEqual([2e6, 5e6]);
    // client → api: 2 MB at 10 MB/s = 200 ms, plus 10 ms; api → blobs: 5 MB at 100 MB/s = 50 ms, plus 30 ms
    expect(analyze(d).useCases[0].scenarios[0].meanMs).toBeCloseTo(210 + 80);
    // bandwidth 500 MB/s on blobs: api's 200 MB/s is now the slower end, 25 ms
    expect(analyze(doc(`${src}capacity {\n  blobs bandwidth 500 MB/s\n}`)).useCases[0].scenarios[0].meanMs).toBeCloseTo(210 + 55);
  });

  it('names the payload in the latency hint, and charges no egress for an upload', () => {
    const d = doc(`${src}requirements {\n  p50 "Upload" < 100ms\n}`);
    const a = analyze(d);
    const [p50] = runTests(d, a);
    // Transfer (250 ms) and the fixed halves of api and blobs (5 + 15) add once; their tails (5 + 15) at ln 2.
    expect(p50.message).toBe(`p50 of Upload is ${Math.round(250 + 20 + 20 * Math.LN2)} ms with no traffic (limit 100 ms)`);
    expect(p50.hint).toContain(`Payloads add transfer time too (client -> api : POST /upload at line ${lineOf(src, '~2MB')})`);
    expect(a.totalEgressUsd).toBe(0);
  });
});

describe('§7.3 bandwidth', () => {
  const src = (replicas: number) => `client [Actor]
api [REST API] x${replicas}
blobs [AWS S3]
usecase "Upload" {
  client -> api : ~1MB PUT /files/1
  api -> blobs : ~1MB PUT file
  api --> client : 201
}
traffic {
  "Upload" 100 rps
}
`;

  it('saturates a node you run whose payloads exceed its bandwidth; storage scales out', () => {
    // 100 MB/s in from clients and 100 MB/s out to storage: 200 MB/s on one 200 MB/s replica.
    const one = analyze(doc(src(1)));
    expect(node(one, 'api')).toMatchObject({ bandwidthLoadMBps: 200, bandwidthCapacityMBps: 200, bandwidthUtilization: 1, saturated: true });
    expect(node(one, 'api').requestUtilization).toBeCloseTo(0.05);
    expect(node(one, 'api').utilization).toBe(1);
    expect(one.warnings).toContain("'api' is saturated: bandwidth 200 MB/s of 200 MB/s, 100%. Add replicas or take load off it.");
    // Object storage and clients have no bandwidth limit.
    expect(node(one, 'blobs')).toMatchObject({ bandwidthUtilization: 0, saturated: false });
    expect(node(one, 'client').bandwidthUtilization).toBe(0);
    const four = analyze(doc(src(4)));
    expect(node(four, 'api')).toMatchObject({ bandwidthUtilization: 0.25, utilization: 0.25, saturated: false });
  });

  it('names the bandwidth in the latency failure and the hint', () => {
    const [p99] = runTests(doc(`${src(1)}requirements {\n  p99 "Upload" < 1s\n}`));
    expect(p99.message).toBe('p99 of Upload: api is saturated (bandwidth 200 MB/s of 200 MB/s, 100%) (limit 1000 ms)');
    expect(p99.hint).toContain('Send the bytes around it');
    expect(p99.hint).toContain('x2 keeps its bandwidth under 70%');
  });
});

describe('§7.3 egress', () => {
  const src = `client [Actor]
cdn [AWS CloudFront]
blobs [AWS S3]
usecase "Watch" {
  client -> cdn : ~1MB GET /video
  alt "Hit" {
    cdn --> client : bytes
  } alt "Miss" {
    cdn -> blobs : ~1MB GET /video
    blobs --> cdn : bytes
    cdn --> client : bytes
  }
}
traffic {
  "Watch" 100 rps mix "Hit" 90%, "Miss" 10%
}
`;

  it('charges data sent to clients: rps × share × size × 2 592 000 s × price; the origin fetch is internal', () => {
    const a = analyze(doc(src));
    // cdn: 100 rps × 1 MB × 2 592 000 s = 259 200 GB × $0.02 = $5 184
    expect(node(a, 'cdn').egressGbPerMonth).toBeCloseTo(259_200);
    expect(node(a, 'cdn').egressUsd).toBeCloseTo(5184);
    expect(node(a, 'cdn').costUsd).toBeCloseTo(100 + 5184);
    // blobs only answers the CDN, inside the system: no egress.
    expect(node(a, 'blobs')).toMatchObject({ egressGbPerMonth: 0, egressUsd: 0, costUsd: 50 });
    expect(node(a, 'client').egressUsd).toBe(0);
    expect(a.totalEgressUsd).toBeCloseTo(5184);
    expect(a.totalCostUsd).toBeCloseTo(150 + 5184);
  });

  it('charges a service that answers clients the internet rate, and nothing for storage to that service', () => {
    const a = analyze(
      doc(`client [Actor]
api [REST API] x2
blobs [AWS S3]
usecase "Get" {
  client -> api : ~1MB GET /files/1
  api -> blobs : ~1MB GET file
  api --> client : 200
}
traffic {
  "Get" 10 rps
}
`),
    );
    // api: 10 rps × 1 MB × 2 592 000 s = 25 920 GB × $0.09 = $2 332.80
    expect(node(a, 'api').egressGbPerMonth).toBeCloseTo(25_920);
    expect(node(a, 'api').egressUsd).toBeCloseTo(2332.8);
    expect(node(a, 'blobs').egressUsd).toBe(0);
  });

  it('takes an egress price override', () => {
    const a = analyze(doc(`${src}capacity {\n  cdn egress 0.01 usd/GB\n}`));
    expect(node(a, 'cdn').egressUsd).toBeCloseTo(259_200 * 0.01);
  });

  it('counts the transfer to the client at the client bandwidth', () => {
    const a = analyze(doc(src));
    const cdn = 5 / (1 - 100 / 200_000);
    const blobs = 30 / (1 - 10 / 5000);
    // 1 MB at 10 MB/s = 100 ms to the client; 1 MB at 100 MB/s = 10 ms from storage
    expect(a.useCases[0].scenarios[0].meanMs).toBeCloseTo(100 + cdn);
    expect(a.useCases[0].scenarios[1].meanMs).toBeCloseTo(100 + cdn + 10 + blobs);
  });

  it('reports egress in the cost check', () => {
    const d = doc(`${src}requirements {\n  cost <= 1000 usd/month\n}`);
    const [cost] = runTests(d);
    expect(cost.message).toBe('Total cost is $5,334/month, $5,184/month of it egress (limit $1,000/month)');
    expect(cost.hint).toContain('cdn $5,284/month ($5,184 of it egress)');
    expect(cost.hint).toContain('Most of it is egress: serve repeated downloads from a CDN');
  });
});

// ---------------------------------------------------------------- §7.4

describe('§7.4 consistency', () => {
  const src = (extra = '') => `client [Actor]
api [REST API] x2
cache [Redis] x2
db [PostgreSQL] x2
usecase "Hold seat" {
  client -> api : POST /holds
  api -> cache : GET seat:1
  cache --> api : free
  api -> db : UPDATE seat
  db --> api : ok
  api --> client : 201
}
test "Strong writes" {
  "Hold seat" writes any strong store before responding
}
test "No stale reads" {
  "Hold seat" never calls any eventual store
}
test "Unions" {
  "Hold seat" never calls any search or any queue
  "Hold seat" calls any cache or any search
}
${extra}`;

  it('matches data stores by consistency, and only data stores', () => {
    const d = doc(src());
    expect(selectNodes(d, { consistency: 'strong' }).map((n) => n.id)).toEqual(['db']);
    expect(selectNodes(d, { consistency: 'eventual' }).map((n) => n.id)).toEqual(['cache']);
    const r = byName(runTests(d));
    expect(r['Strong writes']).toMatchObject({ passed: true, message: '"Hold seat" writes to any strong store before responding' });
    expect(r['No stale reads']).toMatchObject({
      passed: false,
      message: `"Hold seat" calls cache (Redis): api -> cache : GET seat:1 at line ${lineOf(src(), 'GET seat:1')}`,
    });
    expect(r.Unions).toMatchObject({ passed: true });
  });

  it('takes a consistency override', () => {
    const d = doc(src('capacity {\n  cache consistency strong\n}'));
    expect(byName(runTests(d))['No stale reads']).toMatchObject({ passed: true, message: '"Hold seat" never calls any eventual store' });
  });
});

// ---------------------------------------------------------------- §7.5

describe('§7.5 edge sub-kinds', () => {
  const src = `client [Actor]
dns [AWS Route53]
lb [AWS Load Balancer] x2
gw [AWS API Gateway] x2
api [REST API] x2
usecase "Get" {
  client -> lb : GET /x
  lb -> gw : GET /x
  gw -> api : GET /x
  api -> dns : resolve db.internal
  dns --> api : 10.0.0.2
  api --> gw : 200
  gw --> lb : 200
  lb --> client : 200
}
requirements {
  survive any node failure
  availability "Get" >= 99.9%
}
test "Edges" {
  "Get" calls any edge before any service
  "Get" calls any loadbalancer before any gateway
}`;

  it('has sub-kind profiles; any edge matches all four; dns is off the request path', () => {
    const d = doc(src);
    const a = analyze(d);
    expect(a.nodes.map((n) => n.kind)).toEqual(['client', 'dns', 'loadbalancer', 'gateway', 'service']);
    expect(selectNodes(d, { kind: 'edge' }).map((n) => n.id)).toEqual(['dns', 'lb', 'gw']);
    // lb 2 ms + gateway 10 ms + api 10 ms; dns adds nothing
    expect(a.useCases[0].scenarios[0].meanMs).toBeCloseTo(22);
    expect(node(a, 'dns')).toMatchObject({ availability: 1, latencyMs: 0, costUsd: 0 });
    // A single dns instance is neither a single point of failure nor a failure to survive.
    expect(a.singlePointsOfFailure).toEqual([]);
    expect(runTests(d, a).filter((r) => !r.passed)).toEqual([]);
  });
});

// ---------------------------------------------------------------- §7.1

const CHECKOUT = `client [Actor]
api [REST API] x2
gateway [Payment Gateway]
ledger [PostgreSQL] x2
jobs [Kafka] x2
worker [AWS Lambda] x2
usecase "Checkout" {
  client -> api : POST /checkout
  api -> ledger : SELECT balance
  ledger --> api : 100
  api -> gateway : CHARGE card
  gateway --> api : ok
  api -> ledger : INSERT entry
  ledger --> api : ok
  api ->> jobs : OrderPlaced
  api --> client : 201
  jobs ->> worker : OrderPlaced
  worker -> ledger : UPDATE stats
}
usecase "Retry charge" {
  jobs ->> worker : RetryCharge
  worker -> gateway : CHARGE card
}
`;

/** Runs one test block with the given assertion lines against CHECKOUT. */
function check(...lines: string[]): TestResult {
  const d = doc(`${CHECKOUT}test "t" {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`);
  return runTests(d)[0];
}
const at = (text: string) => lineOf(CHECKOUT, text);

describe('§7.1 never waits for', () => {
  it('holds for async sends and work after the response', () => {
    expect(check('"Checkout" never waits for jobs')).toMatchObject({ passed: true, message: '"Checkout" never waits for jobs' });
    expect(check('"Checkout" never waits for worker').passed).toBe(true);
    expect(check('"Checkout" never waits for any queue or worker').passed).toBe(true);
    expect(check('"Retry charge" never waits for ledger')).toMatchObject({ passed: true, message: '"Retry charge" never waits for ledger (it never calls ledger)' });
  });

  it('fails for a synchronous call before the response, naming the step and line', () => {
    const r = check('"Checkout" never waits for gateway');
    expect(r).toMatchObject({
      passed: false,
      message: `"Checkout" waits for gateway (Payment Gateway) before responding: api -> gateway : CHARGE card at line ${at('CHARGE card')} is synchronous`,
    });
    expect(r.hint).toContain('->>');
  });

  it('counts a failed call as waiting for its timeout', () => {
    const src = CHECKOUT.replace('api -> gateway : CHARGE card\n  gateway --> api : ok', 'api -x gateway : CHARGE card');
    const r = runTests(doc(`${src}test "t" {\n  "Checkout" never waits for gateway\n}`))[0];
    expect(r.passed).toBe(false);
    expect(r.message).toContain('api -x gateway : CHARGE card');
    expect(r.message).toContain('times out on the request path');
  });
});

describe('§7.1 calls … after', () => {
  it('compares the last call to Y with the first call to X', () => {
    // The ledger is read before the gateway, but written after it.
    expect(check('"Checkout" calls ledger after gateway')).toMatchObject({ passed: true, message: '"Checkout" calls ledger after gateway' });
    expect(check('"Checkout" calls gateway after ledger').passed).toBe(true);
  });

  it('fails when the last call to Y comes first, naming both steps', () => {
    expect(check('"Checkout" calls gateway after jobs')).toMatchObject({
      passed: false,
      message: `In "Checkout", the last call to gateway (api -> gateway : CHARGE card at line ${at('CHARGE card')}) comes before the first call to jobs (api ->> jobs : OrderPlaced at line ${at('api ->> jobs')})`,
    });
  });

  it('fails when no scenario calls both', () => {
    expect(check('"Retry charge" calls ledger after gateway')).toMatchObject({ passed: false, message: '"Retry charge" never calls ledger' });
    expect(check('"Retry charge" calls ledger after api')).toMatchObject({ passed: false, message: '"Retry charge" calls neither api nor ledger' });
  });
});

describe('§7.1 X calls Y', () => {
  it('looks at the sender of each step', () => {
    expect(check('api calls gateway')).toMatchObject({ passed: true, message: `api calls gateway: api -> gateway : CHARGE card at line ${at('CHARGE card')} in "Checkout"` });
    expect(check('worker calls gateway').passed).toBe(true);
    expect(check('in "Retry charge" api calls gateway')).toMatchObject({ passed: false, message: 'No step is sent by api to gateway in "Retry charge"' });
    expect(check('in "Retry charge" worker calls gateway').passed).toBe(true);
  });

  it('never: names the offending step', () => {
    expect(check('any service never calls jobs')).toMatchObject({
      passed: false,
      message: `any service calls jobs: api ->> jobs : OrderPlaced at line ${at('api ->> jobs')} in "Checkout"`,
    });
    expect(check('client never calls ledger')).toMatchObject({ passed: true, message: 'client never calls ledger' });
    expect(check('in "Retry charge" any service never calls jobs').passed).toBe(true);
  });
});

describe('§7.1 starts at', () => {
  it('checks the sender of the entry request', () => {
    expect(check('"Retry charge" starts at any queue')).toMatchObject({ passed: true, message: '"Retry charge" starts at jobs (Kafka)' });
    expect(check('"Checkout" starts at any queue')).toMatchObject({
      passed: false,
      message: `"Checkout" starts at client (Actor), not any queue: client -> api : POST /checkout at line ${at('POST /checkout')}`,
    });
  });
});

describe('§7.1 messages', () => {
  it('reports a missing use case or scenario once per test', () => {
    const r = check('"Nope" never waits for gateway', '"Nope" calls ledger after gateway', '"Nope" starts at client', '"Checkout" scenario "Ghost" calls api', '"Checkout" scenario "Ghost" never calls api');
    expect(r.passed).toBe(false);
    expect(r.assertions!.every((a) => !a.passed)).toBe(true);
    expect(r.message).toBe('No use case named "Nope"; "Checkout" has no scenario "Ghost"; it has "Checkout"');
  });
});

// ---------------------------------------------------------------- §7.6

describe('§7.6 per-scenario latency', () => {
  const src = `client [Actor]
api [REST API]
cache [Redis]
db [PostgreSQL]
usecase "Get" {
  client -> api : GET /x
  api -> cache : GET x
  alt "Hit" {
    cache --> api : v
  } alt "Miss" {
    cache --> api : nil
    api -> db : SELECT x
    db --> api : v
  }
  api --> client : 200
}
traffic {
  "Get" 100 rps mix "Hit" 99.5%, "Miss" 0.5%
}
requirements {
  p99 "Get" < 50ms
  p99 "Get" scenario "Miss" < 40ms
  p99 "Get" scenario "Miss" < 60ms
  p99 "Get" scenario "Ghost" < 60ms
}`;

  it('measures the scenario itself, whatever its share', () => {
    const results = runTests(doc(src));
    const item = (h: { fixedMs: number; tailMs: number }) => [{ fixedMs: h.fixedMs, tailMs: h.tailMs }];
    const api = hopModel(10, 100 / 2000);
    const cache = hopModel(1, 100 / 100_000);
    const db = hopModel(5, 0.5 / 20_000);
    const hit: PathModel = { parts: [item(api), item(cache)] };
    const miss: PathModel = { parts: [item(api), item(cache), item(db)] };
    const missP99 = pathQuantile(miss, 0.99);
    // The use case p99 is the mixture's: 0.5% misses pull it a little above the hit path's own.
    const p99 = mixtureQuantile(
      [
        { share: 0.995, path: hit },
        { share: 0.005, path: miss },
      ],
      0.99,
    );
    expect(p99).toBeGreaterThan(pathQuantile(hit, 0.99));
    expect(results[0]).toMatchObject({ passed: true, message: `p99 of Get is ${(Math.round(p99 * 10) / 10).toFixed(1)} ms (limit 50 ms)` });
    expect(results[1]).toMatchObject({ name: 'p99 of Get scenario Miss < 40 ms', passed: false, message: `p99 of "Get" scenario "Miss" is ${(Math.round(missP99 * 10) / 10).toFixed(1)} ms (limit 40 ms)` });
    expect(results[1].hint).toContain('slowest hop is api (REST API)');
    expect(results[2].passed).toBe(true);
    expect(results[3]).toMatchObject({ passed: false, message: '"Get" has no scenario "Ghost"; it has "Hit", "Miss"' });
  });
});

describe('§7.6 fallbacks', () => {
  const src = (fallback: string) => `client [Actor]
api [REST API] x2
cache [Redis]
db [PostgreSQL] x2
usecase "Get" {
  client -> api : GET /x
  alt "Hit" {
    api -> cache : GET x
    cache --> api : v
    api --> client : 200
  } alt "Cache down" {
${fallback}
  }
}
requirements {
  survive failure of cache
}`;

  it('keeps a fallback whose retry runs after the response', () => {
    const d = doc(src('    api -x cache : GET x\n    api -> db : SELECT x\n    db --> api : v\n    api --> client : 200\n    api -> cache : SET x'));
    const a = analyze(d);
    expect(a.singlePointsOfFailure).toEqual([]);
    expect(runTests(d, a)[0]).toMatchObject({ passed: true });
    // Availability: 1 − (1 − A(cache)) · (1 − A(db x2)) for the cache, times api and db on the main path... the fallback adds db.
    const api = 1 - 0.005 ** 2;
    const dbA = 1 - 0.0005 ** 2;
    expect(a.useCases[0].availability).toBeCloseTo(api * (1 - 0.001 * (1 - dbA)), 9);
  });

  it('is no fallback when the node answered before the response', () => {
    const d = doc(src('    api -> cache : GET x\n    cache --> api : v\n    api -x cache : SET x\n    api --> client : 200'));
    expect(analyze(d).singlePointsOfFailure).toEqual(['cache']);
    expect(runTests(d)[0]).toMatchObject({ passed: false, message: 'Losing cache (Redis) breaks "Get"' });
  });
});

// ---------------------------------------------------------------- helper

describe('testDiagram', () => {
  it('attaches step fields by hand, for diagrams built without the parser', () => {
    const d = diagramOf('a\nb\nusecase "U" {\n  a -> b : PUSH x\n}', { steps: { 'U:0': { multiplier: 5, access: 'write' } }, traffic: [{ useCase: 'U', rps: 2 }] });
    expect(node(analyze(d), 'b')).toMatchObject({ writeLoadRps: 10, readLoadRps: 0 });
  });
});
