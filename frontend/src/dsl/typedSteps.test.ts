import { describe, expect, it } from 'vitest';
import { analyze } from '../sim/analyze';
import { parse } from './parser';
import type { ParseOptions } from './types';

/** Typed operations in steps (docs/design/typed-components.md). */

const TYPES = `type Ledger extends PostgreSQL {
  op write APPEND latency 3 cost 2
  op read "full scan" latency 10
}
type Shop extends [REST API] {
  status 202, 429
  header If-None-Match
}
type Cachey extends Redis {}
`;

const doc = (steps: string, extra = '') => `${TYPES}
client [Actor]
api [Shop]
db [Ledger]
plain [Database]
cache [Cachey]
client -> api
api -> db
api -> plain
api -> cache
${extra}
usecase "U" {
${steps}
}`;

const run = (source: string, options: ParseOptions = {}) => parse(source, options);
const steps = (source: string) => run(source).diagram.useCases[0].scenarios[0].steps;
const messages = (source: string, options: ParseOptions = {}) => run(source, options).diagnostics.map((d) => `${d.severity}: ${d.message}`);

describe('step labels resolve their operation on the target type', () => {
  it('matches an op case-insensitively, reports its canonical name and takes its access', () => {
    const [a, b, c] = steps(doc('  api -> db : append entry\n  api -> db : SELECT * FROM t\n  api -> db : Full Scan of everything'));
    expect(a.op).toEqual({ name: 'APPEND', access: 'write', latency: 3, cost: 2 });
    expect(a.access).toBe('write');
    expect(b.op).toEqual({ name: 'SELECT', access: 'read' });
    expect(c.op).toMatchObject({ name: 'full scan', access: 'read', latency: 10 });
  });

  it('takes the access from the op, over the verb list', () => {
    // DEL is a Redis write; the verb list alone reads it.
    const [del] = steps(doc('  api -> cache : DEL k'));
    expect(del.op?.name).toBe('DEL');
    expect(del.access).toBe('write');
  });

  it('warns about a word that is no op, suggests the closest one and reads the label as a comment', () => {
    const source = doc('  api -> db : persist row\n  api -> db : INSRT row');
    expect(messages(source)).toEqual([
      "warning: Ledger has no operation 'persist'. Its operations are APPEND, full scan, LISTEN, NOTIFY, COPY, VACUUM, SELECT, WITH, …. Treated as a comment.",
      "warning: Ledger has no operation 'INSRT'. Did you mean INSERT? Treated as a comment.",
    ]);
    const [persist] = steps(source);
    expect(persist.op).toBeUndefined();
    expect(persist.access).toBe('read');
  });

  it('keeps a verb that wrote before a write, with the warning', () => {
    const source = doc('  api -> db : CHARGE row');
    expect(steps(source)[0].access).toBe('write');
    expect(messages(source)).toEqual([expect.stringMatching(/^warning: Ledger has no operation 'CHARGE'\. Its operations are APPEND, full scan, .*\. Treated as a write, as before\.$/)]);
  });

  it('points the warning at the word, after prefixes and a quote', () => {
    const source = doc('  api -> db : x3 ~2KB "persist row"');
    const line = source.split('\n').findIndex((l) => l.includes('persist')) + 1;
    const d = run(source).diagnostics[0];
    expect(d).toMatchObject({ line, length: 'persist'.length });
    expect(source.split('\n')[line - 1].slice(d.col - 1, d.col - 1 + d.length)).toBe('persist');
  });

  it('checks the HTTP method against an HTTP type', () => {
    const [get, post] = steps(doc('  client -> api : GET /items\n  client -> api : POST /items'));
    expect(get.op).toEqual({ name: 'GET', access: 'read' });
    expect(post.op).toEqual({ name: 'POST', access: 'write' });
    const custom = `type Ro extends Service { op read GET }\nclient [Actor]\nro [Ro]\nusecase "U" {\n  client -> ro : DELETE /x\n}`;
    expect(messages(custom)).toEqual(["warning: Ro has no operation 'DELETE'. Its operations are GET. Treated as a write, as before."]);
    expect(parse(custom).diagram.useCases[0].steps[0].access).toBe('write');
  });

  it('checks response statuses against the responder type', () => {
    const source = doc('  client -> api : GET /items\n  api --> client : 202 accepted\n  client -> api : GET /x\n  api --> client : 299 odd');
    expect(messages(source)).toEqual([expect.stringMatching(/^warning: Shop has no status 299; it answers 100, 101, .*, …$/)]);
    const d = run(source).diagnostics[0];
    const text = source.split('\n')[d.line - 1];
    expect(text.slice(d.col - 1, d.col - 1 + d.length)).toBe('299');
  });

  it('reads headers after the endpoint and checks them against the type', () => {
    const source = doc('  client -> api : GET /items header Authorization, If-None-Match fetch json {"a": 1}\n  client -> api : GET /x header Authorizaton');
    const [a, b] = steps(source);
    expect(a.headers).toEqual(['Authorization', 'If-None-Match']);
    expect(a.description).toBe('fetch');
    expect(a.requestBody).toBe('{"a": 1}');
    expect(b.headers).toEqual(['Authorizaton']);
    expect(messages(source)).toEqual(["warning: Shop has no header 'Authorizaton'. Did you mean Authorization?"]);
  });

  it('leaves labels without a header clause as before', () => {
    const [a] = steps(doc('  client -> api : GET /items headers of the page'));
    expect(a.headers).toBeUndefined();
    expect(a.description).toBe('headers of the page');
  });

  it('changes nothing for untyped and unknown targets', () => {
    const source = `client [Actor]\nsvc [Service Box]\nusecase "U" {\n  client -> svc : persist row\n  client -> svc : INSERT row\n}`;
    const plain = messages(source);
    expect(plain.filter((m) => m.includes('has no'))).toEqual([]);
    const [a, b] = parse(source).diagram.useCases[0].steps;
    expect([a.access, b.access, a.op, b.op]).toEqual(['read', 'write', undefined, undefined]);
    const generic = steps(doc('  api -> plain : persist row'));
    expect(generic[0].op).toBeUndefined();
  });

  it('checks built-in types too', () => {
    const source = `client [Actor]\napi [REST API]\ndb [PostgreSQL]\nclient -> api\napi -> db\nusecase "U" {\n  client -> api : place order\n  api -> db : persist row\n  api --> client : 299\n}`;
    expect(messages(source).map((m) => m.split(':')[0])).toEqual(['warning', 'warning', 'warning']);
    expect(messages(source, { strictOps: true })).toEqual([
      expect.stringMatching(/^error: REST API has no operation 'place'\. Its operations are GET, /),
      expect.stringMatching(/^error: PostgreSQL has no operation 'persist'\. Its operations are LISTEN, NOTIFY, COPY, VACUUM, SELECT, /),
      expect.stringMatching(/^error: REST API has no status 299;/),
    ]);
  });

  it('turns the warnings into errors with strictOps', () => {
    const source = doc('  api -> db : persist row\n  client -> api : GET /x header X-Nope');
    expect(messages(source, { strictOps: true }).map((m) => m.split(':')[0])).toEqual(['error', 'error']);
  });

  it('reports a step shared by several scenarios once', () => {
    const source = doc('  api -> db : persist\n  alt "a" {\n    api -> db : SELECT 1\n  } else "b" {\n    api -> db : SELECT 2\n  }');
    expect(messages(source).filter((m) => m.includes('persist'))).toHaveLength(1);
  });
});

describe('op multipliers in the simulation', () => {
  const sim = (label: string) => {
    const source = `${TYPES}
client [Actor]
api [Service]
db [Ledger]
client -> api
api -> db
traffic {
  "U" 100 rps
}
usecase "U" {
  client -> api : POST /x
  api -> db : ${label}
}`;
    const result = parse(source);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    return analyze(result.diagram);
  };

  it('multiplies the target latency by the op latency, and its load by the op cost', () => {
    const base = sim('INSERT row');
    const append = sim('APPEND row');
    const db = (a: ReturnType<typeof analyze>) => a.nodes.find((n) => n.id === 'db')!;
    expect(db(append).writeLoadRps).toBeCloseTo(2 * db(base).writeLoadRps);
    const mean = (a: ReturnType<typeof analyze>) => a.useCases[0].scenarios[0].meanMs;
    const api = db(base);
    // INSERT and APPEND are both writes; APPEND's hop at the db takes 3× its time (at twice the load).
    expect(mean(append) - mean(base)).toBeGreaterThan(api.latencyMs * 1.9);
  });

  it('leaves the numbers as they are without multipliers', () => {
    expect(sim('SELECT 1')).toEqual(sim('select 1'));
    const plain = sim('INSERT row');
    const untyped = analyze(parse(`client [Actor]\napi [Service]\ndb [PostgreSQL]\nclient -> api\napi -> db\ntraffic {\n  "U" 100 rps\n}\nusecase "U" {\n  client -> api : POST /x\n  api -> db : INSERT row\n}`).diagram);
    expect(untyped.nodes).toEqual(plain.nodes);
    expect(untyped.useCases[0].percentiles).toEqual(plain.useCases[0].percentiles);
  });
});
