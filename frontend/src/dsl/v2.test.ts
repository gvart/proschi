import { describe, expect, it } from 'vitest';
import { WRITE_VERBS, accessOf, examples, parse, parseSize } from './index';
import { tokenizeLine } from './lexer';
import { parseQuantity } from './quantity';
import { format } from './format';

/**
 * The language side of docs/design/hld-and-practice.md §7: precise
 * assertions, selector unions and consistency selectors, label prefixes,
 * access classification, the new capacity keys and per-scenario latency.
 */

const arch = `client [Actor]
api [REST API] x2
worker [AWS Lambda]
cache [Redis]
db [PostgreSQL]
blobs [AWS S3]
jobs [AWS SQS]
client -> api
api -> cache
api -> db
api -> jobs
jobs -> worker
worker -> db
client -> blobs
usecase "Redirect" {
  client -> api : GET /x
  alt "Cache hit" {
    api -> cache : GET x
    api --> client : 301
  } alt "Cache miss" {
    api -> db : SELECT x
    api --> client : 301
  }
}
usecase "Shorten" {
  client -> api : POST /links
  api -> db : INSERT url
  api ->> jobs : ENQUEUE warm
  api --> client : 201
}
usecase "Warm" {
  jobs -> worker : warm
  worker -> db : UPDATE url
}
`;

const withoutLoc = <T extends { loc: unknown }>(value: T): Omit<T, 'loc'> => {
  const copy: Partial<T> = { ...value };
  delete copy.loc;
  return copy as Omit<T, 'loc'>;
};
const doc = (body: string) => parse(`${arch}${body}`);
const problems = (body: string) => doc(body).diagnostics.map((d) => [d.severity, d.message]);
const archLines = arch.split('\n').length - 1;

describe('§7.1 assertions', () => {
  const body = `test "Precise" {
  "Redirect" never waits for any queue
  "Shorten" scenario "Shorten" never waits for jobs
  "Shorten" calls jobs after db
  "Redirect" scenario "Cache miss" calls db after api
  api calls db
  in "Shorten" api calls jobs
  any service never calls blobs
  in "Redirect" api never calls any queue
  "Warm" starts at any queue
  "Shorten" never calls any cache or any queue or blobs
  "Shorten" writes any strong store before responding
  "Redirect" scenario "Cache hit" never calls any eventual store
  api or worker has replicas >= 1
  no path from client to db or cache
}`;

  it('reads every new form, unions and consistency selectors', () => {
    const { diagram, diagnostics } = doc(body);
    expect(diagnostics).toEqual([]);
    expect(diagram.tests![0].assertions.map(withoutLoc)).toEqual([
      { kind: 'neverWaits', useCase: 'Redirect', target: { kind: 'queue' } },
      { kind: 'neverWaits', useCase: 'Shorten', scenario: 'Shorten', target: { node: 'jobs' } },
      { kind: 'after', useCase: 'Shorten', target: { node: 'jobs' }, after: { node: 'db' } },
      { kind: 'after', useCase: 'Redirect', scenario: 'Cache miss', target: { node: 'db' }, after: { node: 'api' } },
      { kind: 'senderCalls', from: { node: 'api' }, to: { node: 'db' }, quantifier: 'some' },
      { kind: 'senderCalls', useCase: 'Shorten', from: { node: 'api' }, to: { node: 'jobs' }, quantifier: 'some' },
      { kind: 'senderCalls', from: { kind: 'service' }, to: { node: 'blobs' }, quantifier: 'never' },
      { kind: 'senderCalls', useCase: 'Redirect', from: { node: 'api' }, to: { kind: 'queue' }, quantifier: 'never' },
      { kind: 'startsAt', useCase: 'Warm', target: { kind: 'queue' } },
      { kind: 'calls', useCase: 'Shorten', target: { anyOf: [{ kind: 'cache' }, { kind: 'queue' }, { node: 'blobs' }] }, quantifier: 'never' },
      { kind: 'writesBeforeResponding', useCase: 'Shorten', target: { consistency: 'strong' } },
      { kind: 'calls', useCase: 'Redirect', scenario: 'Cache hit', target: { consistency: 'eventual' }, quantifier: 'never' },
      { kind: 'replicas', target: { anyOf: [{ node: 'api' }, { node: 'worker' }] }, min: 1 },
      { kind: 'noPath', from: { node: 'client' }, to: { anyOf: [{ node: 'db' }, { node: 'cache' }] } },
    ]);
  });

  it('keeps the use case forms apart from the sender forms', () => {
    const { diagram } = doc('test "T" {\n  "Shorten" calls db\n  "Shorten" never calls cache\n  api calls db\n  api never calls cache\n}');
    expect(diagram.tests![0].assertions.map((a) => a.kind)).toEqual(['calls', 'calls', 'senderCalls', 'senderCalls']);
  });

  it('reads `in` as a node id when no use case name follows', () => {
    const { diagram, diagnostics } = parse('in [REST API]\ndb [PostgreSQL]\ntest "T" {\n  in calls db\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.tests![0].assertions.map(withoutLoc)).toEqual([{ kind: 'senderCalls', from: { node: 'in' }, to: { node: 'db' }, quantifier: 'some' }]);
  });

  it('warns about unknown use cases, scenarios and nodes, also inside unions', () => {
    expect(
      problems(
        'test "T" {\n  "Nope" never waits for db\n  "Redirect" scenario "Nope" calls db after api\n  in "Ghost" api calls db\n  "Warm" starts at ghost\n  api never calls cache or phantom\n}',
      ),
    ).toEqual([
      ['warning', "Unknown use case 'Nope'"],
      ['warning', "Use case 'Redirect' has no scenario 'Nope'; its scenarios are 'Cache hit', 'Cache miss'"],
      ['warning', "Unknown use case 'Ghost'"],
      ['warning', "Unknown node 'ghost'"],
      ['warning', "Unknown node 'phantom'"],
    ]);
    expect(problems('test "T" {\n  "Warm" starts at [Nope] or worker\n}')).toEqual([['warning', "Unknown tech stack 'Nope'"]]);
  });

  it('locates a union problem at the alternative', () => {
    const { diagnostics } = doc('test "T" {\n  api calls cache or ghost\n}');
    expect(diagnostics).toEqual([expect.objectContaining({ message: "Unknown node 'ghost'", line: archLines + 2, col: 22, length: 5 })]);
  });
});

describe('§7.3 label prefixes', () => {
  const steps = (label: string, arrow = '->') => {
    const result = parse(`usecase "U" {\n  a ${arrow} b : ${label}\n}`);
    return { step: result.diagram.useCases[0].steps[0], diagnostics: result.diagnostics };
  };

  it.each([
    ['x200 LPUSH feed:{follower}', { multiplier: 200 }, 'LPUSH feed:{follower}'],
    ['~2MB PUT /files/1', { sizeBytes: 2_000_000 }, 'PUT /files/1'],
    ['x3 ~1.5KB GET /items', { multiplier: 3, sizeBytes: 1500 }, 'GET /items'],
    ['~500KB   x10 SEND chunk', { multiplier: 10, sizeBytes: 500_000 }, 'SEND chunk'],
    ['~4GB', { sizeBytes: 4e9 }, 'a → b'],
    ['~10B ping', { sizeBytes: 10 }, 'ping'],
    ['~1TB GET /dump', { sizeBytes: 1e12 }, 'GET /dump'],
  ])('reads %s', (label, fields, name) => {
    const { step, diagnostics } = steps(label);
    expect(diagnostics).toEqual([]);
    expect(step).toMatchObject({ ...fields, stepName: name });
  });

  it('strips the prefixes before reading the HTTP method and payload', () => {
    const { step } = steps('x2 ~3MB POST /upload json {"a": 1}');
    expect(step).toMatchObject({ httpMethod: 'POST', endpoint: '/upload', requestFormat: 'JSON', requestBody: '{"a": 1}', multiplier: 2, sizeBytes: 3e6, access: 'write' });
  });

  it.each(['xml payload', 'x-request-id header', 'x2y GET /', 'X2 GET /', 'xy', 'GET /x200 ~2MB'])('leaves %s alone', (label) => {
    const { step, diagnostics } = steps(label);
    expect(diagnostics).toEqual([]);
    expect(step).not.toHaveProperty('multiplier');
    expect(step).not.toHaveProperty('sizeBytes');
  });

  it('leaves steps without prefixes as before, and does not read them on responses or connections', () => {
    const { diagram, diagnostics } = parse('a -> b : x2 sync\nusecase "U" {\n  a -> b : GET /\n  b --> a : ~2MB body\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.edges[0].label).toBe('x2 sync');
    expect(diagram.useCases[0].steps[0]).not.toHaveProperty('multiplier');
    expect(diagram.useCases[0].steps[0]).not.toHaveProperty('sizeBytes');
    expect(diagram.useCases[0].steps[0].responseBody).toBe('~2MB body');
  });

  it.each([
    ['x0 GET /', 'A fan-out needs at least one call per request: x1, x2, …', 0, 2],
    ['x2 x3 GET /', 'The fan-out is given twice; write one x<N>', 3, 2],
    ['~2MB ~3MB GET /', 'The payload size is given twice; write one ~<size>', 5, 4],
    ['~2mb GET /', "Unknown size unit 'mb' in '~2mb'; use B, KB, MB, GB or TB", 0, 4],
    ['~2 GET /', "'~2' needs a unit: B, KB, MB, GB or TB", 0, 2],
    ['~MB GET /', "Expected a payload size after ~, e.g. ~2MB, ~500KB or ~1.5GB, not '~MB'", 0, 3],
    ['~ GET /', 'Expected a payload size after ~, e.g. ~2MB, ~500KB or ~1.5GB', 0, 1],
    ['~0KB GET /', "A payload size must be more than 0, not '~0KB'", 0, 4],
  ])('reports %s at the prefix', (label, message, index, length) => {
    const { diagnostics } = parse(`usecase "U" {\n  a ->   b :  ${label}\n}`);
    // ':' is in column 12 and the label starts two spaces later.
    expect(diagnostics).toEqual([{ severity: 'error', message, line: 2, col: 15 + index, length }]);
  });

  it('reports a prefix once even when the step is in several scenarios', () => {
    const { diagnostics } = parse('usecase "U" {\n  alt "A" {\n    a -> b : x\n  } alt "B" {\n    a -> b : y\n  }\n  a -> c : x0 z\n}');
    expect(diagnostics.map((d) => d.message)).toEqual(['A fan-out needs at least one call per request: x1, x2, …']);
  });

  it('parses sizes in decimal units', () => {
    expect(parseSize('2MB')).toEqual({ value: 2e6 });
    expect(parseSize('1.5GB')).toEqual({ value: 1.5e9 });
    expect(parseSize('2kb')).toEqual({ error: expect.stringContaining("Unknown size unit 'kb'") });
  });
});

describe('§7.2 access', () => {
  const accessOfLabel = (label: string, arrow = '->') => parse(`usecase "U" {\n  a ${arrow} b : ${label}\n}`).diagram.useCases[0].steps[0].access;

  it.each([
    ['POST /orders', 'write'],
    ['PUT /orders/1', 'write'],
    ['PATCH /orders/1', 'write'],
    ['DELETE /orders/1', 'write'],
    ['GET /orders', 'read'],
    ['HEAD /orders', 'read'],
    ['OPTIONS /orders', 'read'],
  ])('classifies the HTTP method of %s', (label, access) => {
    expect(accessOfLabel(label)).toBe(access);
  });

  it.each(WRITE_VERBS.map((v) => [v]))('classifies %s as a write, in any case', (verb) => {
    expect(accessOfLabel(`${verb} thing`)).toBe('write');
    expect(accessOfLabel(`${verb.toLowerCase()} thing`)).toBe('write');
  });

  it.each(['SELECT * FROM urls', 'GET url:{code}', 'QUERY', 'SCAN users', 'FETCH page', 'LOOKUP code', 'GEOSEARCH drivers', 'OrderPlaced', 'warm', ''])(
    'classifies %s as a read',
    (label) => {
      expect(accessOfLabel(label)).toBe('read');
    },
  );

  it('classifies the storing words authors write as writes, and their look-alikes as reads', () => {
    for (const label of ['PutItem Url', 'UpdateItem Seat', 'DeleteItem Hold', 'BatchWriteItem feeds', 'INCRBY rate:42 1', 'HINCRBY stats views 1', 'SADD online 42', 'XADD events *', 'MSET a 1 b 2']) {
      expect(accessOfLabel(label)).toBe('write');
    }
    for (const label of ['save draft', 'Store body', 'upload chunk 3', 'COMMIT txn', 'record payment', 'mark paid', 'reserve seat 12A', 'hold seat 12A', 'book ride', 'emit OrderShipped', 'notify bob "New message"']) {
      expect(accessOfLabel(label)).toBe('write');
    }
    for (const label of ['GetItem Url', 'MGET post:1 post:2', 'Stored', 'Recorded', 'Marker', 'Booking lookup', 'Notification sent', 'holding page']) {
      expect(accessOfLabel(label)).toBe('read');
    }
  });

  it('uses the first word after the prefixes, and only the first word', () => {
    expect(accessOfLabel('x200 LPUSH feed')).toBe('write');
    expect(accessOfLabel('~2MB x3 SET k')).toBe('write');
    expect(accessOfLabel('read then INSERT')).toBe('read');
    expect(accessOfLabel('"charge card"')).toBe('write');
    expect(accessOfLabel('SET:counter')).toBe('write');
    expect(accessOfLabel('SETTINGS')).toBe('read');
    expect(accessOfLabel('Created json {"a": 1}')).toBe('read');
  });

  it('classifies async and failed steps too', () => {
    expect(accessOfLabel('PUBLISH OrderPlaced', '->>')).toBe('write');
    expect(accessOfLabel('CHARGE card', '-x')).toBe('write');
  });

  it('puts an access on every request step of every bundled example', () => {
    for (const example of examples) {
      for (const u of parse(example.source).diagram.useCases)
        for (const s of u.scenarios) for (const step of s.steps) expect(['read', 'write']).toContain(step.access);
    }
  });

  it('decides by the HTTP method before the label', () => {
    expect(accessOf('GET', 'INSERT')).toBe('read');
    expect(accessOf('delete', '')).toBe('write');
    expect(accessOf(undefined, '  upsert x')).toBe('write');
    expect(accessOf('', 'read')).toBe('read');
  });
});

describe('§7.2–§7.4 capacity keys', () => {
  it('reads reads, writes, shards, consistency, bandwidth and egress', () => {
    const { diagram, diagnostics } = doc(
      'capacity {\n  db reads 30k rps writes 8k rps shards 4 consistency strong\n  cache consistency eventual\n  blobs bandwidth 500 MB/s egress 0.05 usd/GB\n  api bandwidth 1.5GB/s\n  worker egress 0usd/GB\n}',
    );
    expect(diagnostics).toEqual([]);
    expect(diagram.capacity!.map(withoutLoc)).toEqual([
      { node: 'db', readRps: 30_000, writeRps: 8_000, shards: 4, consistency: 'strong' },
      { node: 'cache', consistency: 'eventual' },
      { node: 'blobs', bandwidthMBps: 500, egressUsdPerGb: 0.05 },
      { node: 'api', bandwidthMBps: 1500 },
      { node: 'worker', egressUsdPerGb: 0 },
    ]);
  });

  it.each([
    ['db 10k rps reads 5k rps', "A rate sets both reads and writes; give either a rate or reads and writes for 'db'"],
    ['db writes 5k rps 10k rps', "A rate sets both reads and writes; give either a rate or reads and writes for 'db'"],
    ['db reads 1k rps reads 2k rps', "Reads is given twice for 'db'"],
    ['db reads', 'Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd'],
    ['db writes 5ms', "Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd, not '5ms'"],
    ['db shards 0', 'Expected a whole number of shards, at least 1, e.g. shards 4'],
    ['db shards 2.5', 'Expected a whole number of shards, at least 1, e.g. shards 4'],
    ['db shards', 'Expected a whole number of shards, at least 1, e.g. shards 4'],
    ['db consistency', 'Expected strong or eventual after consistency'],
    ['db consistency weak', "Expected strong or eventual after consistency, not 'weak'"],
    ['db consistency strong consistency eventual', "Consistency is given twice for 'db'"],
    ['blobs bandwidth 500', "'500' needs a unit: expected a bandwidth, e.g. 500 MB/s or 1 GB/s"],
    ['blobs bandwidth 500 rps', "Expected a bandwidth, e.g. 500 MB/s or 1 GB/s, not '500 rps'"],
    ['blobs bandwidth 0 MB/s', 'Bandwidth must be more than 0'],
    ['blobs bandwidth 5Mb/s', "Unknown unit 'Mb/s' in '5Mb/s'; use rps, rpm, rpd, ms, s, %, usd/month, MB/s, GB/s or usd/GB (with k, m or b for thousands, millions, billions)"],
    ['blobs egress 0.05', "'0.05' needs a unit: expected a price per gigabyte, e.g. 0.05 usd/GB"],
    ['blobs egress 5 usd/month', "Expected a price per gigabyte, e.g. 0.05 usd/GB, not '5 usd/month'"],
  ])('reports %s', (line, message) => {
    expect(problems(`capacity {\n  ${line}\n}`)).toEqual([['error', message]]);
  });

  it('warns about shards or consistency on a node that holds no data', () => {
    expect(problems('capacity {\n  api shards 2 consistency strong\n  db shards 2\n}')).toEqual([
      ['warning', "'api' is not a data store (cache, database, search, analytics, queue, storage); shards and consistency only apply to data stores"],
    ]);
  });

  it('lexes the new units as one quantity, attached or one space away', () => {
    const kinds = (line: string) => tokenizeLine(line, 1).tokens.map((t) => [t.kind, t.value]);
    expect(kinds('500 MB/s 1GB/s 0.05 usd/GB')).toEqual([
      ['quantity', '500MB/s'],
      ['quantity', '1GB/s'],
      ['quantity', '0.05usd/GB'],
    ]);
    expect(parseQuantity('500 MB/s')).toEqual({ value: 500, unit: 'MBps' });
    expect(parseQuantity('2GB/s')).toEqual({ value: 2000, unit: 'MBps' });
    expect(parseQuantity('0.09 usd/GB')).toEqual({ value: 0.09, unit: 'usd/GB' });
  });
});

describe('§7.6 per-scenario latency', () => {
  it('reads the scenario of a latency requirement', () => {
    const { diagram, diagnostics } = doc('requirements {\n  p99 "Redirect" scenario "Cache hit" < 20ms\n  p95 "Shorten" < 100ms\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.requirements!.map(withoutLoc)).toEqual([
      { kind: 'latency', percentile: 99, useCase: 'Redirect', scenario: 'Cache hit', maxMs: 20 },
      { kind: 'latency', percentile: 95, useCase: 'Shorten', maxMs: 100 },
    ]);
  });

  it('warns about an unknown scenario or use case', () => {
    expect(problems('requirements {\n  p99 "Redirect" scenario "Nope" < 20ms\n  p99 "Ghost" scenario "Nope" < 20ms\n}')).toEqual([
      ['warning', "Use case 'Redirect' has no scenario 'Nope'; its scenarios are 'Cache hit', 'Cache miss'"],
      ['warning', "Unknown use case 'Ghost'"],
    ]);
  });

  it.each([
    ['p99 scenario "Cache hit" < 20ms', 'A scenario belongs to a use case; write p99 "Use case" scenario "Scenario" < 100ms'],
    ['p99 "Redirect" scenario < 20ms', 'Expected a scenario name in quotes after scenario'],
    ['p99 "Redirect" scenario "Cache hit" 20ms', 'Expected < here, e.g. p99 "Use case" < 50ms'],
  ])('reports %s', (line, message) => {
    expect(problems(`requirements {\n  ${line}\n}`)).toEqual([['error', message]]);
  });
});

describe('formatting the v2 forms', () => {
  const source = `${arch}usecase "Fan out" {
  worker  ->   db :   x200   ~2MB INSERT feed
  worker ->> jobs : ~1.5KB x3 PUBLISH done
}
capacity {
  db reads 30k rps   writes 8k rps shards 4 consistency strong
  blobs  bandwidth 500   MB/s egress 0.05 usd/GB
}
requirements {
  p99   "Redirect" scenario "Cache hit"  < 20ms
}
test "T" {
    "Redirect"   never waits for any queue or   any eventual store
  in "Shorten"  api calls jobs
  "Shorten" calls jobs after db
  "Warm" starts   at any queue
}
`;

  it('lays them out, keeps label prefixes verbatim and is idempotent', () => {
    const once = format(source);
    expect(format(once)).toBe(once);
    expect(once).toContain('  worker  -> db   : x200   ~2MB INSERT feed\n  worker ->> jobs : ~1.5KB x3 PUBLISH done\n');
    expect(once).toContain('  db    reads 30k rps writes 8k rps shards 4 consistency strong\n  blobs bandwidth 500 MB/s egress 0.05 usd/GB\n');
    expect(once).toContain('  "Redirect" never waits for any queue or any eventual store\n  in "Shorten" api calls jobs\n');
    expect(once).toContain('  p99 "Redirect" scenario "Cache hit" < 20ms\n');
    expect(parse(once).diagnostics).toEqual(parse(source).diagnostics.map((d) => ({ ...d, col: expect.any(Number), length: expect.any(Number) })));
    const strip = (r: ReturnType<typeof parse>) => JSON.stringify(r.diagram, (k, v) => (k === 'loc' || k === 'responseLoc' ? undefined : v));
    expect(strip(parse(once))).toBe(strip(parse(source)));
  });
});
