import { describe, expect, it } from 'vitest';
import { parse } from '../dsl/parser';
import { pathMatches } from './flow';
import { runTests } from './tests';

/** Typed test assertions (docs/TESTS.md, "Typed assertions"): requests, operations and headers. */

const design = (tests: string) => `client [Actor]
api [REST API]
db [PostgreSQL]
cache [Redis]
q [SQS]
client -> api
api -> db
api -> cache
api -> q
usecase "Shorten" {
  client -> api : POST /urls header Idempotency-Key
  api -> db : INSERT url
  api ->> q : SendMessage created
  api --> client : 201
}
usecase "Redirect" {
  client -> api : GET /aZ3x9 header Authorization
  api -> cache : GET code
  alt "Miss" {
    api -> db : SELECT url
    api ->> cache : SET code
  } alt "Hit" {
  }
  api --> client : 302
}
test "t" {
${tests}
}`;

const withoutLoc = <T extends { loc: unknown }>(a: T): Omit<T, 'loc'> => {
  const copy: Partial<T> = { ...a };
  delete copy.loc;
  return copy as Omit<T, 'loc'>;
};

/** Each assertion line's result: passed, and its message. */
function results(tests: string) {
  const { diagram, diagnostics } = parse(design(tests));
  expect(diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
  return runTests(diagram)[0].assertions!.map((a) => [a.passed, a.message] as const);
}

describe('typed assertion grammar', () => {
  it('parses calls … with, uses … on and sends header … to, with quantifiers and ordering words', () => {
    const { diagram, diagnostics } = parse(
      design(
        [
          '"Redirect" calls api with GET /{code}',
          '"Shorten" uses INSERT on db before responding',
          '"Redirect" never uses INSERT on any database',
          '"Redirect" every scenario uses GET on cache',
          '"Redirect" uses GET on cache before any database',
          '"Redirect" uses SET on cache after db',
          '"Shorten" sends header Idempotency-Key to api',
          '"Shorten" sends header "Idempotency-Key" to api',
        ].join('\n'),
      ),
    );
    expect(diagnostics).toEqual([]);
    const strip = diagram.tests![0].assertions.map(withoutLoc);
    expect(strip).toEqual([
      { kind: 'calls', useCase: 'Redirect', target: { node: 'api' }, match: { method: 'GET', path: '/{code}' }, quantifier: 'some' },
      { kind: 'beforeResponding', useCase: 'Shorten', target: { node: 'db' }, match: { op: 'INSERT' } },
      { kind: 'calls', useCase: 'Redirect', target: { kind: 'database' }, match: { op: 'INSERT' }, quantifier: 'never' },
      { kind: 'calls', useCase: 'Redirect', target: { node: 'cache' }, match: { op: 'GET' }, quantifier: 'every' },
      { kind: 'before', useCase: 'Redirect', first: { node: 'cache' }, match: { op: 'GET' }, then: { kind: 'database' } },
      { kind: 'after', useCase: 'Redirect', target: { node: 'cache' }, match: { op: 'SET' }, after: { node: 'db' } },
      { kind: 'calls', useCase: 'Shorten', target: { node: 'api' }, match: { header: 'Idempotency-Key' }, quantifier: 'some' },
      { kind: 'calls', useCase: 'Shorten', target: { node: 'api' }, match: { header: 'Idempotency-Key' }, quantifier: 'some' },
    ]);
  });

  it('keeps the old assertions as they were', () => {
    const { diagram } = parse(design('"Redirect" calls cache before db\n"Redirect" never calls q'));
    expect(diagram.tests![0].assertions.map(withoutLoc)).toEqual([
      { kind: 'before', useCase: 'Redirect', first: { node: 'cache' }, then: { node: 'db' } },
      { kind: 'calls', useCase: 'Redirect', target: { node: 'q' }, quantifier: 'never' },
    ]);
  });

  it('explains a malformed clause', () => {
    const errors = (line: string) => parse(design(line)).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(errors('"Redirect" calls api with FETCH /x')[0]).toMatch(/^Expected an HTTP method after with/);
    expect(errors('"Redirect" calls api with GET')[0]).toMatch(/^Expected a path starting with \/ after GET/);
    expect(errors('"Redirect" uses INSERT db')[0]).toMatch(/^Expected 'on' here/);
    expect(errors('"Redirect" sends Authorization to api')[0]).toMatch(/^Expected 'header' here/);
    expect(errors('"Redirect" never reads db')[0]).toMatch(/^Expected calls, uses or sends header here/);
  });
});

describe('typed assertion results', () => {
  it('matches a request by method and path, with path parameters on either side', () => {
    expect(results('"Redirect" calls api with GET /{code}\n"Redirect" calls api with POST /urls')).toEqual([
      [true, '"Redirect" calls api with GET /{code} in "Miss", "Hit"'],
      [false, '"Redirect" never calls api with POST /urls; its steps there are GET /aZ3x9'],
    ]);
    expect(pathMatches('/urls/{code}', '/urls/abc')).toBe(true);
    expect(pathMatches('/urls/abc', '/urls/{id}')).toBe(true);
    expect(pathMatches('/urls/:code', '/urls/abc/')).toBe(true);
    expect(pathMatches('/urls/{code}', '/urls')).toBe(false);
    expect(pathMatches('/urls/{code}', '/links/abc')).toBe(false);
    expect(pathMatches('/feed', '/feed?page=2')).toBe(true);
  });

  it('matches the resolved operation, ignoring case', () => {
    expect(results('"Shorten" uses insert on db\n"Redirect" uses SELECT on [Database]\n"Redirect" never uses INSERT on any database\n"Shorten" uses SELECT on db')).toEqual([
      [true, '"Shorten" uses insert on db'],
      [true, '"Redirect" uses SELECT on [Database] in "Miss"'],
      [true, '"Redirect" never uses INSERT on any database'],
      [false, '"Shorten" never uses SELECT on db; its steps there are INSERT url'],
    ]);
  });

  it('fails an operation no selected type has, so a misspelt never cannot pass', () => {
    const [[passed, message]] = results('"Redirect" never uses SELCT on db');
    expect(passed).toBe(false);
    expect(message).toBe("No node matching db has an operation 'SELCT'");
  });

  it('checks every scenario and the order of typed calls', () => {
    expect(results('"Redirect" every scenario uses GET on cache\n"Redirect" every scenario uses SET on cache\n"Redirect" uses GET on cache before db\n"Redirect" uses SET on cache after db')).toEqual([
      [true, 'Every scenario of "Redirect" uses GET on cache'],
      [false, '"Redirect" does not use SET on cache in "Hit"; its steps there are GET code'],
      [true, '"Redirect" uses GET on cache before db'],
      [true, '"Redirect" uses SET on cache after db'],
    ]);
  });

  it('checks an operation before responding: synchronous and before the answer', () => {
    expect(results('"Shorten" uses INSERT on db before responding\n"Shorten" uses SendMessage on q before responding\n"Redirect" uses SET on cache before responding')).toEqual([
      [true, '"Shorten" uses INSERT on db before responding'],
      [false, '"Shorten" uses SendMessage on q only asynchronously: api ->> q : SendMessage created at line 13'],
      [false, '"Miss" uses SET on cache only asynchronously: api ->> cache : SET code at line 21; "Hit" never uses SET on cache before responding; its steps there are GET code'],
    ]);
  });

  it('matches a header the step sends, and fails one the type does not take', () => {
    expect(results('"Shorten" sends header idempotency-key to api\n"Redirect" sends header Idempotency-Key to api\n"Redirect" never sends header X-Nope to api')).toEqual([
      [true, '"Shorten" sends header idempotency-key to api'],
      [false, '"Redirect" never sends header Idempotency-Key to api; its steps there are GET /aZ3x9'],
      [false, "No node matching api takes the header 'X-Nope'"],
    ]);
  });
});

describe('[Type] selectors', () => {
  it('match subtypes through the resolved parent chain', () => {
    expect(results('"Redirect" calls [Database]\n"Redirect" calls [Cache] before [Database]\n"Shorten" never calls [Message Broker]\n"Shorten" calls [Message Queue]')).toEqual([
      [true, '"Redirect" calls [Database] in "Miss"'],
      [true, '"Redirect" calls [Cache] before [Database]'],
      [true, '"Shorten" never calls [Message Broker]'],
      [true, '"Shorten" calls [Message Queue]'],
    ]);
  });

  it('match a declared type and its children', () => {
    const source = `type Store extends PostgreSQL { op write APPEND }
type Ledger extends Store {}
client [Actor]
a [Store]
b [Ledger]
client -> a
client -> b
usecase "U" {
  client -> a : APPEND x
  client -> b : SELECT y
}
test "t" {
  "U" every scenario calls [Store]
  "U" uses SELECT on [Store]
  "U" uses APPEND on [Ledger]
}`;
    const { diagram } = parse(source);
    expect(runTests(diagram)[0].assertions!.map((a) => [a.passed, a.message])).toEqual([
      [true, 'Every scenario of "U" calls [Store]'],
      [true, '"U" uses SELECT on [Store]'],
      [false, '"U" never uses APPEND on [Ledger]; its steps there are SELECT y'],
    ]);
  });
});
