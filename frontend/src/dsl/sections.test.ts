import { describe, expect, it } from 'vitest';
import { KINDS, ecommerceExample, examples, mapResolver, parse } from './index';

/**
 * The HLD statements of docs/design/hld-and-practice.md §1: title summary,
 * replicas, traffic, requirements, capacity, entity, decision and test.
 */

const arch = `client [Actor]
api [REST API] x2
cache [Redis]
db [PostgreSQL]
client -> api
api -> cache
api -> db
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
  api --> client : 201
}
`;

const withoutLoc = <T extends { loc: unknown }>(value: T): Omit<T, 'loc'> => {
  const copy: Partial<T> = { ...value };
  delete copy.loc;
  return copy as Omit<T, 'loc'>;
};
const doc = (body: string) => parse(`${arch}${body}`);
/** Diagnostics of a document, as [severity, message] pairs. */
const problems = (source: string) => parse(source).diagnostics.map((d) => [d.severity, d.message]);
const bodyProblems = (body: string) => problems(`${arch}${body}`);

describe('title summary', () => {
  it('reads the second string as the summary', () => {
    const { diagram, diagnostics } = parse('title "URL Shortener" "Turns long URLs into short codes"');
    expect(diagnostics).toEqual([]);
    expect(diagram).toMatchObject({ title: 'URL Shortener', summary: 'Turns long URLs into short codes' });
  });

  it('leaves the summary out when there is none, and rejects a third string', () => {
    expect(parse('title "T"').diagram).not.toHaveProperty('summary');
    expect(problems('title "T" "S" "X"')).toEqual([['error', 'Unexpected string "X"']]);
  });

  it('ignores the summary of an imported file', () => {
    const files = { 'a.proschi': 'title "A"\nimport "b.proschi"', 'b.proschi': 'title "B" "Summary of B"' };
    expect(parse(files['a.proschi'], { path: 'a.proschi', resolve: mapResolver(files) }).diagram).not.toHaveProperty('summary');
  });
});

describe('replicas', () => {
  it('reads x<n> anywhere after the id', () => {
    const { diagram, diagnostics } = parse('api "API" [REST API] x3 @links "Serves redirects"\ndb x2 [PostgreSQL]\ncache [Redis]');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => [n.id, n.replicas])).toEqual([
      ['api', 3],
      ['db', 2],
      ['cache', undefined],
    ]);
    expect(diagram.nodes[0]).toMatchObject({ name: 'API', description: 'Serves redirects', ownerTeam: 'links' });
  });

  it('needs at least one replica', () => {
    expect(problems('api [REST API] x0')).toEqual([['error', 'A node needs at least one replica: x1, x2, …']]);
  });

  it('is not read out of other words', () => {
    expect(problems('api x3y')).toEqual([['error', "Unexpected 'x3y' in node declaration"]]);
    expect(parse('x3 [Redis]').diagram.nodes[0]).toMatchObject({ id: 'x3' });
  });
});

describe('older documents', () => {
  it('parse exactly as before: no new fields', () => {
    const { diagram } = parse(ecommerceExample);
    for (const key of ['summary', 'traffic', 'requirements', 'capacity', 'entities', 'decisions', 'tests']) expect(diagram).not.toHaveProperty(key);
    expect(diagram.nodes.every((n) => !('replicas' in n))).toBe(true);
  });

  it('may still use the new keywords as node ids', () => {
    const { diagram, diagnostics } = parse(
      'traffic [REST API]\ntest "Test runner"\nentity pos 10,20\ndecision "Decision Engine" [REST API] x2\nrequirements x2\ncapacity "C"\ntraffic -> test',
    );
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['traffic', 'test', 'entity', 'decision', 'requirements', 'capacity']);
    expect(diagram.edges).toHaveLength(1);
  });
});

describe('traffic', () => {
  it('reads rates per use case, normalised to requests per second', () => {
    const { diagram, diagnostics } = doc('traffic {\n  "Redirect" 6m rpm\n  "Shorten" 86.4k rpd\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.traffic).toEqual([
      { useCase: 'Redirect', rps: 100_000, loc: expect.objectContaining({ col: 3 }) },
      { useCase: 'Shorten', rps: 1, loc: expect.anything() },
    ]);
  });

  it('reads the mix as fractions of the use case traffic', () => {
    const { diagram, diagnostics } = doc('traffic {\n  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.traffic![0].mix).toEqual([
      { scenario: 'Cache hit', share: 0.9 },
      { scenario: 'Cache miss', share: 0.1 },
    ]);
  });

  it('scales shares that do not add up to 100%, with a warning', () => {
    const { diagram, diagnostics } = doc('traffic {\n  "Redirect" 100 rps mix "Cache hit" 60%, "Cache miss" 20%\n}');
    expect(diagnostics.map((d) => [d.severity, d.message, d.col])).toEqual([['warning', 'Mix shares add up to 80%, not 100%; they are scaled to fit', 22]]);
    expect(diagram.traffic![0].mix).toEqual([
      { scenario: 'Cache hit', share: 0.75 },
      { scenario: 'Cache miss', share: 0.25 },
    ]);
  });

  it('warns about unknown use cases and scenarios, listing the scenarios there are', () => {
    expect(bodyProblems('traffic {\n  "Redirekt" 1 rps\n  "Redirect" 1 rps mix "Hit" 100%\n}')).toEqual([
      ['warning', "Unknown use case 'Redirekt'"],
      ['warning', "Use case 'Redirect' has no scenario 'Hit'; its scenarios are 'Cache hit', 'Cache miss'"],
    ]);
    // A use case without alt has one scenario, named like the use case.
    expect(bodyProblems('traffic {\n  "Shorten" 1 rps mix "Shorten" 100%\n}')).toEqual([]);
  });

  it('checks names after every file is read, wherever traffic and use cases are', () => {
    const files = {
      'main.proschi': 'traffic {\n  "Place order" 10 rps\n}\nimport "flows.proschi"',
      'flows.proschi': 'usecase "Place order" {\n  a -> b\n}\ntraffic {\n  "Missing" 1 rps\n}',
    };
    const { diagram, diagnostics } = parse(files['main.proschi'], { path: 'main.proschi', resolve: mapResolver(files) });
    expect(diagram.traffic!.map((t) => t.useCase)).toEqual(['Place order', 'Missing']);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'warning', message: "Unknown use case 'Missing'", file: 'flows.proschi', line: 5 })]);
  });

  it('reports duplicate use case lines and rates without a rate unit', () => {
    expect(bodyProblems('traffic {\n  "Shorten" 1 rps\n  "Shorten" 2 rps\n}')).toEqual([['error', "Duplicate traffic for 'Shorten' (first on line 24)"]]);
    expect(bodyProblems('traffic {\n  "Shorten" 100k\n}')).toEqual([['error', "'100k' needs a unit: expected a rate, e.g. 100k rps, 6k rpm or 1m rpd"]]);
    expect(bodyProblems('traffic {\n  "Shorten" 50 ms\n}')).toEqual([['error', "Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd, not '50 ms'"]]);
    expect(bodyProblems('traffic {\n  "Shorten" 50ms\n}')).toEqual([['error', "Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd, not '50ms'"]]);
    expect(bodyProblems('traffic {\n  "Shorten"\n}')).toEqual([['error', 'Expected a rate, e.g. 100k rps, 6k rpm or 1m rpd']]);
    expect(bodyProblems('traffic {\n  "Shorten" 5 qps\n}')).toEqual([['error', "'5' needs a unit: expected a rate, e.g. 100k rps, 6k rpm or 1m rpd"]]);
  });

  it('reports malformed lines and mixes', () => {
    expect(bodyProblems('traffic {\n  Shorten 1 rps\n}')).toEqual([['error', 'Expected a use case name in quotes and a rate, e.g. "Redirect" 100k rps']]);
    expect(bodyProblems('traffic {\n  "Shorten" 1 rps split\n}')).toEqual([['error', `Unexpected 'split'; expected mix "Scenario" 90%, "Other" 10%`]]);
    expect(bodyProblems('traffic {\n  "Redirect" 1 rps mix\n}')).toEqual([['error', 'Expected a scenario name in quotes and its share, e.g. "Cache hit" 90%']]);
    expect(bodyProblems('traffic {\n  "Redirect" 1 rps mix "Cache hit" 0.9\n}')).toEqual([["error", "'0.9' needs a unit: expected a percentage, e.g. 99.9%"]]);
    expect(bodyProblems('traffic {\n  "Redirect" 1 rps mix "Cache hit" 50% "Cache miss" 50%\n}')).toEqual([['error', 'Expected , between mix shares, not string "Cache miss"']]);
    expect(bodyProblems('traffic {\n  "Redirect" 1 rps mix "Cache hit" 50%, "Cache hit" 50%\n}')).toEqual([['error', "Scenario 'Cache hit' is in the mix twice"]]);
    expect(bodyProblems('traffic {\n  "Redirect" 1 rps mix "Cache hit" 0%\n}')).toEqual([['error', 'Mix shares must add up to more than 0%']]);
  });

  it('keeps reading after a bad line', () => {
    const { diagram, diagnostics } = doc('traffic {\n  nonsense here\n  -> x\n  "Shorten" 1 rps\n}\nextra [Redis]');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(2);
    expect(diagram.traffic).toHaveLength(1);
    expect(diagram.nodes.map((n) => n.id)).toContain('extra');
  });
});

describe('requirements', () => {
  const body = `requirements {
  p99 "Redirect" < 50ms
  p95 < 0.3s # every use case
  p50 <= 10 ms
  p999 "Shorten" < 1s
  availability "Redirect" >= 99.95%
  availability >= 99.9 %
  durable "Shorten"
  survive any node failure
  survive failure of cache
  survive failure of [postgresql]
  survive failure of any queue
  cost <= 3000 usd/month
}`;

  it('reads every kind of requirement', () => {
    const { diagram, diagnostics } = doc(body);
    expect(diagnostics).toEqual([]);
    expect(diagram.requirements!.map(withoutLoc)).toEqual([
      { kind: 'latency', percentile: 99, useCase: 'Redirect', maxMs: 50 },
      { kind: 'latency', percentile: 95, maxMs: 300 },
      { kind: 'latency', percentile: 50, maxMs: 10 },
      { kind: 'latency', percentile: 99.9, useCase: 'Shorten', maxMs: 1000 },
      { kind: 'availability', useCase: 'Redirect', minPercent: 99.95 },
      { kind: 'availability', minPercent: 99.9 },
      { kind: 'durable', useCase: 'Shorten' },
      { kind: 'survive', target: 'any' },
      { kind: 'survive', target: { node: 'cache' } },
      { kind: 'survive', target: { tech: 'PostgreSQL' } },
      { kind: 'survive', target: { kind: 'queue' } },
      { kind: 'cost', maxUsdPerMonth: 3000 },
    ]);
  });

  it('locates each requirement at its whole line', () => {
    const { diagram } = doc(body);
    expect(diagram.requirements![1].loc).toEqual({ line: arch.split('\n').length + 2, col: 3, length: 'p95 < 0.3s'.length });
  });

  it('warns about unknown use cases, nodes and tech stacks', () => {
    expect(bodyProblems('requirements {\n  p99 "Nope" < 5ms\n  durable "Nope2"\n  survive failure of ghost\n  survive failure of [Nope]\n}')).toEqual([
      ['warning', "Unknown use case 'Nope'"],
      ['warning', "Unknown use case 'Nope2'"],
      ['warning', "Unknown node 'ghost'"],
      ['warning', "Unknown tech stack 'Nope'. Did you mean 'Node.js'?"],
    ]);
  });

  it.each([
    ['p75 < 5ms', "Unknown percentile 'p75'; use p50, p90, p95, p99 or p999"],
    ['p99 "Redirect" 50ms', 'Expected < here, e.g. p99 "Use case" < 50ms'],
    ['p99 > 50ms', 'Expected < here, e.g. p99 "Use case" < 50ms'],
    ['p99 < 50', "'50' needs a unit: expected a duration, e.g. 50ms or 1.5s"],
    ['p99 < 50%', "Expected a duration, e.g. 50ms or 1.5s, not '50%'"],
    ['p99 < 50ms extra', "Unexpected 'extra'"],
    ['availability <= 99%', 'Expected >= here, e.g. availability "Use case" >= 99.9%'],
    ['availability >= 101%', 'Availability cannot be more than 100%'],
    ['availability >= 99.9', "'99.9' needs a unit: expected a percentage, e.g. 99.9%"],
    ['durable', 'Expected a use case name in quotes, e.g. durable "Shorten"'],
    ['durable Shorten', 'Expected a use case name in quotes, e.g. durable "Shorten"'],
    ['survive', 'Expected survive any node failure, or survive failure of <node | [Tech] | any kind>'],
    ['survive any node', 'Expected survive any node failure, or survive failure of <node | [Tech] | any kind>'],
    ['survive failure of', 'Expected a node id, [Tech] or any <kind>'],
    ['survive failure of any thing', `Expected a kind after any: ${KINDS.join(', ')}, or strong store / eventual store`],
    ['cost <= 3000', "'3000' needs a unit: expected a monthly cost, e.g. 400 usd/month"],
    ['cost 3000 usd/month', 'Expected <= here, e.g. cost <= 3000 usd/month'],
    ['"Redirect" < 5ms', 'Expected a requirement: p99 "Use case" < 50ms, availability >= 99.9%, durable "Use case", survive any node failure, cost <= 3000 usd/month'],
    ['speed < 5ms', "Unknown requirement 'speed'. Expected a requirement: p99 \"Use case\" < 50ms, availability >= 99.9%, durable \"Use case\", survive any node failure, cost <= 3000 usd/month"],
  ])('reports %s', (line, message) => {
    const { diagram, diagnostics } = doc(`requirements {\n  ${line}\n}`);
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([['error', message]]);
    expect(diagram).not.toHaveProperty('requirements');
  });
});

describe('capacity', () => {
  it('reads overrides in any order', () => {
    const { diagram, diagnostics } = doc('capacity {\n  db 20k rps latency 4ms availability 99.95% cost 400 usd/month durable\n  cache volatile 150k rps\n  api latency 0.5s\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.capacity!.map(withoutLoc)).toEqual([
      { node: 'db', rps: 20_000, latencyMs: 4, availability: 99.95, costUsd: 400, durable: true },
      { node: 'cache', durable: false, rps: 150_000 },
      { node: 'api', latencyMs: 500 },
    ]);
  });

  it('warns about unknown nodes, also when they are declared in no file', () => {
    expect(bodyProblems('capacity {\n  ghost 1k rps\n}')).toEqual([['warning', "Unknown node 'ghost' in capacity"]]);
    // A node declared after the capacity block is known.
    expect(bodyProblems('capacity {\n  late 1k rps\n}\nlate [Redis]')).toEqual([]);
  });

  it.each([
    ['db 1k rps 2k rps', "Rate is given twice for 'db'"],
    ['db durable volatile', "Durable or volatile is given twice for 'db'"],
    ['db latency', 'Expected a duration, e.g. 50ms or 1.5s'],
    ['db latency 4', "'4' needs a unit: expected a duration, e.g. 50ms or 1.5s"],
    ['db cost 4ms', "Expected a monthly cost, e.g. 400 usd/month, not '4ms'"],
    ['db fast', "Unexpected 'fast'; expected a rate, reads, writes, shards, latency, availability, cost, durable or volatile, consistency, bandwidth, egress or timeout"],
    ['"db" 1k rps', 'Expected a node id and its overrides, e.g. db 20k rps latency 4ms'],
  ])('reports %s', (line, message) => {
    expect(bodyProblems(`capacity {\n  ${line}\n}`)).toEqual([['error', message]]);
  });

  it('reports duplicate lines and lines that override nothing', () => {
    expect(bodyProblems('capacity {\n  db 1k rps\n  db latency 2ms\n}')).toEqual([['error', "Duplicate capacity for 'db' (first on line 24)"]]);
    expect(bodyProblems('capacity {\n  db\n}')).toEqual([
      ['warning', "Capacity line for 'db' overrides nothing; add a rate, reads, writes, shards, latency, availability, cost, durable or volatile, consistency, bandwidth, egress or timeout"],
    ]);
  });
});

describe('entity', () => {
  it('reads the header and fields', () => {
    const { diagram, diagnostics } = doc('entity Url in db "One short code" {\n  code string key unique\n  target string\n  createdAt time index optional\n}\nentity Session {\n}');
    expect(diagnostics).toEqual([]);
    expect(diagram.entities).toEqual([
      {
        name: 'Url',
        store: 'db',
        description: 'One short code',
        fields: [
          { name: 'code', type: 'string', flags: ['key', 'unique'] },
          { name: 'target', type: 'string', flags: [] },
          { name: 'createdAt', type: 'time', flags: ['index', 'optional'] },
        ],
        loc: expect.objectContaining({ col: 8, length: 3 }),
      },
      { name: 'Session', fields: [], loc: expect.anything() },
    ]);
  });

  it('warns when the store is not a data store or does not exist', () => {
    expect(bodyProblems('entity A in api {\n}\nentity B in ghost {\n}\nentity C in cache {\n}')).toEqual([
      ['warning', "'api' is not a data store (cache, database, search, analytics, queue, storage); entity 'A' is placed in a service"],
      ['warning', "Unknown node 'ghost'"],
    ]);
  });

  it.each([
    ['code', "Expected a type after 'code', e.g. code string"],
    ['code "string"', "Expected a type after 'code', e.g. code string"],
    ['code string primary', "Unknown field flag 'primary'; use key, index, unique or optional"],
    ['code string key key', "Flag 'key' is given twice"],
    ['"code" string', 'Expected a field: name type [key] [index] [unique] [optional], e.g. code string key'],
  ])('reports the field %s', (line, message) => {
    expect(bodyProblems(`entity Url {\n  ${line}\n}`)).toEqual([['error', message]]);
  });

  it('reports duplicate fields and entities', () => {
    expect(bodyProblems('entity Url {\n  a int\n  a string\n}')).toEqual([['error', "Duplicate field 'a' in entity 'Url'"]]);
    expect(bodyProblems('entity Url {\n}\nentity Url {\n  x y\n}')).toEqual([['error', "Duplicate entity 'Url' (first on line 23)"]]);
  });

  it('skips the block of a broken header instead of reading it as nodes', () => {
    expect(bodyProblems('entity Url in {\n  code string\n}')).toEqual([['error', 'Expected the id of the node that stores the entity after in, e.g. entity Url in db {']]);
    expect(bodyProblems('entity Url "d" [Redis] {\n  code string\n}')).toEqual([['error', 'Expected { after the entity header, e.g. entity Url in db "Short codes" {']]);
    expect(problems('entity Url in db')).toEqual([['error', 'Expected { after the entity header, e.g. entity Url in db "Short codes" {']]);
  });
});

describe('decision', () => {
  it('reads the block and the one-line form', () => {
    const { diagram, diagnostics } = doc(`decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1"
  rejected "Read replicas only" "~5 ms per read"
  rejected "Memcached" "no replication"
}
decision "Base62 codes" because "Short and unique"`);
    expect(diagnostics).toEqual([]);
    expect(diagram.decisions!.map(withoutLoc)).toEqual([
      {
        title: 'Cache redirects in Redis',
        because: 'Reads outnumber writes 100:1',
        rejected: [
          { option: 'Read replicas only', reason: '~5 ms per read' },
          { option: 'Memcached', reason: 'no replication' },
        ],
      },
      { title: 'Base62 codes', rejected: [], because: 'Short and unique' },
    ]);
  });

  it.each([
    ['because "a"\n  because "b"', 'A decision has one because; list the other options with rejected "option" "reason"'],
    ['because', 'Expected the reason in quotes after because'],
    ['rejected "Memcached"', 'Expected rejected "option" "reason"'],
    ['rejected Memcached "x"', 'Expected rejected "option" "reason"'],
    ['rejected "a" "b" "c"', 'Unexpected string "c"'],
    ['chosen "x"', 'Expected because "reason" or rejected "option" "reason"'],
  ])('reports %s', (lines, message) => {
    expect(bodyProblems(`decision "D" {\n  ${lines}\n}`)).toEqual([['error', message]]);
  });

  it('reports a broken one-line form', () => {
    expect(problems('decision "D" because')).toEqual([['error', 'Expected the reason in quotes after because']]);
    expect(problems('decision "D" because "x" "y"')).toEqual([['error', 'Unexpected string "y"']]);
    expect(problems('decision "D" since "x"')).toEqual([['error', `Expected because "reason" or { after the decision title, not 'since'`]]);
  });
});

describe('test', () => {
  const body = `test "Everything" {
  "Redirect" calls any cache
  "Redirect" calls cache before [PostgreSQL]
  "Redirect" scenario "Cache hit" never calls any database
  "Redirect" every scenario calls api
  "Shorten" writes db before responding
  "Shorten" scenario "Shorten" responds 201
  "Redirect" responds 3xx
  "Redirect" has scenario "Cache down"
  "Redirect" handles failure of cache
  no path from client to any database
  api has replicas >= 2
  [redis] has replicas >= 1
  any service has replicas >= 2
}`;

  it('reads every assertion form and selector', () => {
    const { diagram, diagnostics } = doc(body);
    expect(diagnostics).toEqual([]);
    expect(diagram.tests).toHaveLength(1);
    expect(diagram.tests![0]).toMatchObject({ name: 'Everything', loc: { col: 6 } });
    expect(diagram.tests![0].assertions.map(withoutLoc)).toEqual([
      { kind: 'calls', useCase: 'Redirect', target: { kind: 'cache' }, quantifier: 'some' },
      { kind: 'before', useCase: 'Redirect', first: { node: 'cache' }, then: { tech: 'PostgreSQL' } },
      { kind: 'calls', useCase: 'Redirect', scenario: 'Cache hit', target: { kind: 'database' }, quantifier: 'never' },
      { kind: 'calls', useCase: 'Redirect', target: { node: 'api' }, quantifier: 'every' },
      { kind: 'writesBeforeResponding', useCase: 'Shorten', target: { node: 'db' } },
      { kind: 'responds', useCase: 'Shorten', scenario: 'Shorten', status: '201' },
      { kind: 'responds', useCase: 'Redirect', status: '3xx' },
      // A missing scenario is what this assertion checks, so it is not a warning.
      { kind: 'hasScenario', useCase: 'Redirect', scenario: 'Cache down' },
      { kind: 'handlesFailure', useCase: 'Redirect', target: { node: 'cache' } },
      { kind: 'noPath', from: { node: 'client' }, to: { kind: 'database' } },
      { kind: 'replicas', target: { node: 'api' }, min: 2 },
      { kind: 'replicas', target: { tech: 'Redis' }, min: 1 },
      { kind: 'replicas', target: { kind: 'service' }, min: 2 },
    ]);
  });

  it('warns about unknown use cases, scenarios and nodes', () => {
    expect(bodyProblems('test "T" {\n  "Nope" calls api\n  "Redirect" scenario "Nope" calls api\n  no path from ghost to db\n}')).toEqual([
      ['warning', "Unknown use case 'Nope'"],
      ['warning', "Use case 'Redirect' has no scenario 'Nope'; its scenarios are 'Cache hit', 'Cache miss'"],
      ['warning', "Unknown node 'ghost'"],
    ]);
  });

  it('warns about a test without assertions and rejects duplicate names', () => {
    expect(bodyProblems('test "Empty" {\n}')).toEqual([['warning', "Test 'Empty' has no assertions"]]);
    expect(bodyProblems('test "T" {\n  api has replicas >= 1\n}\ntest "T" {\n  api has replicas >= 1\n}')).toEqual([['error', "Duplicate test 'T' (first on line 23)"]]);
  });

  it.each([
    ['"Redirect"', 'Expected calls, every scenario calls, never calls, never waits for, writes, responds, starts at, has scenario or handles failure of after "Redirect"'],
    ['"Redirect" invokes api', 'Expected calls, every scenario calls, never calls, never waits for, writes, responds, starts at, has scenario or handles failure of after "Redirect"'],
    ['"Redirect" calls', 'Expected a node id, [Tech] or any <kind>'],
    ['"Redirect" calls "api"', 'Expected a node id, [Tech] or any <kind>, not string "api"'],
    ['"Redirect" calls any', `Expected a kind after any: ${KINDS.join(', ')}, or strong store / eventual store`],
    ['"Redirect" calls api before', 'Expected a node id, [Tech] or any <kind>'],
    ['"Redirect" calls api after', 'Expected a node id, [Tech] or any <kind>'],
    ['"Redirect" calls api after db before cache', "Unexpected 'before'"],
    ['"Redirect" never waits any queue', `Expected 'for' here, e.g. "Redirect" never waits for any queue`],
    ['"Redirect" never waits for', 'Expected a node id, [Tech] or any <kind>'],
    ['"Redirect" starts client', `Expected 'at' here, e.g. "Redirect" starts at any queue`],
    ['"Redirect" scenario "Cache hit" starts at client', 'starts at is about the whole use case; leave out scenario "…"'],
    ['"Redirect" calls cache or', 'Expected a node id, [Tech] or any <kind>'],
    ['"Redirect" calls any strong', "Expected 'store' here, e.g. any strong store"],
    ['"Redirect" calls any eventual cache', "Expected 'store' here, e.g. any eventual store"],
    ['in "Redirect" api has replicas >= 2', 'Expected calls or never calls here, e.g. in "Redirect" api calls db'],
    ['in "Redirect"', 'Expected a node id, [Tech] or any <kind>'],
    ['api never db', "Expected 'calls' here, e.g. any service never calls any storage"],
    ['"Redirect" every calls api', `Expected 'scenario' here, e.g. "Redirect" every scenario calls any cache`],
    ['"Redirect" never api', `Expected 'calls' here, e.g. "Redirect" never calls any database`],
    ['"Shorten" writes db', `Expected 'before' here, e.g. "Shorten" writes db before responding`],
    ['"Shorten" writes db before', `Expected 'responding' here, e.g. "Shorten" writes db before responding`],
    ['"Shorten" responds', 'Expected a status code or class after responds, e.g. 201 or 4xx'],
    ['"Shorten" responds 2000', 'Expected a status code or class after responds, e.g. 201 or 4xx'],
    ['"Shorten" responds 6xx', 'Expected a status code or class after responds, e.g. 201 or 4xx'],
    ['"Shorten" responds ok', 'Expected a status code or class after responds, e.g. 201 or 4xx'],
    ['"Shorten" has scenario', 'Expected a scenario name in quotes after has scenario'],
    ['"Shorten" has replicas >= 2', `Expected 'scenario' here, e.g. "Shorten" has scenario "Not found"`],
    ['"Shorten" scenario "Shorten" has scenario "X"', 'has scenario is about the whole use case; leave out scenario "…"'],
    ['"Shorten" scenario "Shorten" handles failure of db', 'handles failure is about the whole use case; leave out scenario "…"'],
    ['"Shorten" handles db', `Expected 'failure' here, e.g. "Shorten" handles failure of cache`],
    ['"Shorten" scenario calls db', 'Expected a scenario name in quotes after scenario'],
    ['no path client to db', "Expected 'from' here, e.g. no path from client to any database"],
    ['no path from client db', "Expected 'to' here, e.g. no path from client to any database"],
    ['api has replicas 2', 'Expected >= here, e.g. api has replicas >= 2'],
    ['api has replicas >= 0', 'Expected a whole number of replicas, at least 1'],
    ['api has replicas >= 1.5', 'Expected a whole number of replicas, at least 1'],
    ['api has instances >= 2', "Expected 'replicas' here, e.g. api has replicas >= 2"],
    ['api calls', 'Expected a node id, [Tech] or any <kind>'],
    ['api sends db', 'Expected an assertion: "Use case" calls <node>, "Use case" writes <node> before responding, <node> calls <node>, no path from <node> to <node>, <node> has replicas >= 2, …'],
    ['api -> db', 'Expected an assertion: "Use case" calls <node>, "Use case" writes <node> before responding, <node> calls <node>, no path from <node> to <node>, <node> has replicas >= 2, …'],
    ['200', 'Expected an assertion: "Use case" calls <node>, "Use case" writes <node> before responding, <node> calls <node>, no path from <node> to <node>, <node> has replicas >= 2, …'],
  ])('reports %s', (line, message) => {
    const { diagram, diagnostics } = doc(`test "T" {\n  ${line}\n  api has replicas >= 1\n}`);
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([['error', message]]);
    // The bad line is dropped; the rest of the test is kept.
    expect(diagram.tests![0].assertions).toHaveLength(1);
  });

  it('reports the error at the offending token', () => {
    const { diagnostics } = doc('test "T" {\n  "Shorten" writes db before replying\n}');
    expect(diagnostics.find((d) => d.severity === 'error')).toMatchObject({ line: arch.split('\n').length + 1, col: 30, length: 8 });
  });
});

describe('section blocks', () => {
  it('are only allowed at the top level, and their lines are skipped there', () => {
    const { diagram, diagnostics } = parse('group g {\n  traffic {\n    "U" 1 rps\n  }\n  inner [Redis]\n}\nusecase "U" {\n  test "T" {\n    api calls db\n  }\n  a -> b\n}\noutside [Redis]');
    expect(diagnostics.map((d) => [d.severity, d.message, d.line])).toEqual([
      ['error', 'traffic is only allowed at the top level', 2],
      ['error', 'test is only allowed at the top level', 8],
    ]);
    expect(diagram).not.toHaveProperty('traffic');
    expect(diagram).not.toHaveProperty('tests');
    expect(diagram.nodes.find((n) => n.id === 'inner')?.parent).toBe('g');
    expect(diagram.nodes.find((n) => n.id === 'outside')?.parent).toBeUndefined();
    expect(diagram.useCases[0].steps).toHaveLength(1);
    expect(problems('usecase "U" {\n  decision "D" because "x"\n}')).toEqual([['error', 'decision is only allowed at the top level']]);
  });

  it('report a missing } and input after }', () => {
    expect(problems('traffic {\n  "U" 1 rps')).toEqual([
      ['error', 'Missing } to close traffic block'],
      ['warning', "Unknown use case 'U'"],
    ]);
    expect(problems('entity Url {')).toEqual([['error', "Missing } to close entity 'Url'"]]);
    expect(problems('test "T" {\n  api has replicas >= 1\n} x')).toEqual([
      ['warning', "Unknown node 'api'"],
      ['error', 'Unexpected input after }'],
    ]);
    expect(problems('requirements { cost <= 1 usd/month')).toEqual([
      ['error', 'Missing } to close requirements block'],
      ['error', "Unexpected 'cost'"],
    ]);
  });

  it('are contributed by imported files, with their problems located in that file', () => {
    const files = {
      'root.proschi': 'title "Root"\nimport "hld.proschi"\nusecase "U" {\n  a -> b\n}',
      'hld.proschi': 'title "HLD" "ignored"\ntraffic {\n  "U" 5 rps\n}\nrequirements {\n  p99 < 10ms\n}\ncapacity {\n  b 1k rps\n}\nentity E in b {\n  id uuid key\n}\ndecision "D" because "R"\ntest "T" {\n  "U" calls b\n  "U" calls ghost\n}',
    };
    const { diagram, diagnostics } = parse(files['root.proschi'], { path: 'root.proschi', resolve: mapResolver(files) });
    expect(diagram).toMatchObject({
      title: 'Root',
      traffic: [{ useCase: 'U', rps: 5, loc: { file: 'hld.proschi', line: 3 } }],
      requirements: [{ kind: 'latency', loc: { file: 'hld.proschi' } }],
      capacity: [{ node: 'b' }],
      entities: [{ name: 'E', store: 'b' }],
      decisions: [{ title: 'D' }],
      tests: [{ name: 'T', assertions: [{ kind: 'calls' }, { kind: 'calls' }] }],
    });
    expect(diagram).not.toHaveProperty('summary');
    expect(diagnostics).toEqual([
      expect.objectContaining({ message: "'b' is not a data store (cache, database, search, analytics, queue, storage); entity 'E' is placed in a client", file: 'hld.proschi' }),
      expect.objectContaining({ message: "Unknown node 'ghost'", file: 'hld.proschi', line: 17 }),
    ]);
  });

  it('leave the bundled URL shortener example free of problems', () => {
    const example = examples.find((e) => e.id === 'url-shortener')!;
    const { diagram, diagnostics } = parse(example.source);
    expect(diagnostics).toEqual([]);
    expect(diagram.summary).toBeTruthy();
    for (const key of ['traffic', 'requirements', 'capacity', 'entities', 'decisions', 'tests'] as const) expect(diagram[key]?.length, key).toBeGreaterThan(0);
    const kinds = new Set(diagram.tests!.flatMap((t) => t.assertions.map((a) => (a.kind === 'calls' ? `calls:${a.quantifier}` : a.kind))));
    expect([...kinds].sort()).toEqual(
      ['before', 'calls:every', 'calls:never', 'calls:some', 'handlesFailure', 'hasScenario', 'noPath', 'replicas', 'responds', 'writesBeforeResponding'].sort(),
    );
  });
});
