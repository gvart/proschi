import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { renameId } from './edit';
import { examples } from './index';
import { tokenizeLine } from './lexer';
import { problems } from '../practice/catalog';
import { parseSolution } from '../practice/workspace';
import type { Diagnostic } from './types';

describe('renameId', () => {
  it('renames the declaration, connections, steps, ports, capacity, entities, tests and what-ifs', () => {
    const source = [
      'api "API" [REST API]',
      'api2 [Worker]',
      'db [PostgreSQL]',
      'group g "G" {',
      '  api',
      '}',
      'api -> db : SQL api',
      'api.http -> api2 # api in a comment',
      'capacity {',
      '  api 500 rps',
      '}',
      'entity api in api "Stored in api" {',
      '  id string key',
      '}',
      'whatif "Down" {',
      '  fail api',
      '}',
      'usecase "Read" {',
      '  api -> db : SELECT api {',
      '    "api": 1',
      '  }',
      '  db --> api : "api"',
      '}',
    ].join('\n');
    const result = renameId(source, 'api', 'orders_api');
    expect(result.source).toBe(
      [
        'orders_api "API" [REST API]',
        'api2 [Worker]',
        'db [PostgreSQL]',
        'group g "G" {',
        '  orders_api',
        '}',
        'orders_api -> db : SQL api',
        'orders_api.http -> api2 # api in a comment',
        'capacity {',
        '  orders_api 500 rps',
        '}',
        'entity api in orders_api "Stored in api" {',
        '  id string key',
        '}',
        'whatif "Down" {',
        '  fail orders_api',
        '}',
        'usecase "Read" {',
        '  orders_api -> db : SELECT api {',
        '    "api": 1',
        '  }',
        '  db --> orders_api : "api"',
        '}',
      ].join('\n'),
    );
  });

  it('renames a system and the nodes that reach it, but not its entry points, which its team file names', () => {
    const source = 'system pay "Payments" {\n  expose charge\n  capacity { 2k rps }\n}\nweb -> pay.charge\ncharge [Worker]\n';
    expect(renameId(source, 'pay', 'billing').source).toBe('system billing "Payments" {\n  expose charge\n  capacity { 2k rps }\n}\nweb -> billing.charge\ncharge [Worker]\n');
    expect(renameId(source, 'charge', 'charger').source).toBe(source.replace('charge [Worker]', 'charger [Worker]'));
    expect(parse(renameId(source, 'pay', 'billing').source!).diagnostics).toEqual(parse(source).diagnostics);
  });

  it('renames a node only a connection declares', () => {
    expect(renameId('a -> b\n', 'b', 'c').source).toBe('a -> c\n');
  });

  it('leaves type blocks alone', () => {
    const source = 'type Db extends PostgreSQL {\n  op read db\n}\ndb [Db]\n';
    expect(renameId(source, 'db', 'store').source).toBe('type Db extends PostgreSQL {\n  op read db\n}\nstore [Db]\n');
  });

  it('refuses an id that is taken, a keyword or not an identifier, and a node that is not here', () => {
    const source = 'a\nb\n';
    expect(renameId(source, 'a', 'b').error).toBeTruthy();
    expect(renameId(source, 'a', 'usecase').error).toBeTruthy();
    expect(renameId(source, 'a', 'x3').error).toBeTruthy();
    expect(renameId(source, 'a', 'two words').error).toBeTruthy();
    expect(renameId(source, 'a', 'c', ['c']).error).toBeTruthy();
    expect(renameId(source, 'nope', 'c').error).toBeTruthy();
  });
});

/**
 * A free id as long as `id`, so every column (and so every `loc`) stays where it was.
 * The upper case keeps it apart from the documents' own ids, which are lower case.
 */
function sameLength(id: string, used: Set<string>): string {
  for (const c of 'ZQXJKW') {
    const next = c + id.slice(1);
    if (!used.has(next)) return next;
  }
  throw new Error(`no free id for ${id}`);
}

/** Fields that hold a word that may equal an id without naming the node: a kind, a team, a name, a label. */
const NOT_AN_ID = new Set(['kind', 'type', 'ownerTeam', 'name', 'techStack', 'label', 'stepName', 'description', 'text', 'requestBody', 'responseBody']);

/** `value` with every reference to `from` as `to`: ids and edge ids (`a->b#2`), but not a word that only looks like one. */
function swapped(value: unknown, from: string, to: string, key = ''): unknown {
  if (typeof value === 'string') {
    if (NOT_AN_ID.has(key)) return value;
    if (value === from) return to;
    if (key === 'id') return value.replace(new RegExp(`(^|->)${from}(?=$|->|#)`, 'g'), `$1${to}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => swapped(v, from, to, key));
  if (value && typeof value === 'object') {
    // A use case's id comes from its name, a scenario's is its own.
    const useCase = 'scenarios' in value || 'condition' in value;
    // A node only a connection declares is named by its id.
    const implicit = 'implicit' in value && value.implicit === true;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, useCase && k === 'id' ? v : implicit && k === 'name' && v === from ? to : swapped(v, from, to, k)]));
  }
  return value;
}

const message = (d: Diagnostic) => `${d.severity} ${d.file ?? ''}:${d.line}:${d.col} ${d.message}`;

/** Ids the text names as identifiers, to tell whether an imported file names one. */
function identifiers(text: string): Set<string> {
  return new Set(text.split('\n').flatMap((line, i) => tokenizeLine(line, i + 1).tokens.filter((t) => t.kind === 'ident').map((t) => t.value)));
}

describe('renameId over every practice solution and example', () => {
  const documents = [
    ...problems.map((p) => ({ name: `problem ${p.id}`, source: p.solution, parse: (s: string) => parseSolution(p, s), given: identifiers(p.given ?? '') })),
    ...examples.map((e) => ({ name: `example ${e.id}`, source: e.source, parse: (s: string) => parse(s), given: new Set<string>() })),
  ];
  // Read alone too (its import unresolved), so a node the problem's file also names is renamed as well.
  documents.push(...problems.map((p) => ({ name: `problem ${p.id} alone`, source: p.solution, parse: (s: string) => parse(s), given: new Set<string>() })));
  it.each(documents.map((d) => [d.name, d] as const))('%s: renaming each node keeps the diagram, with only the id swapped', (_name, doc) => {
    const before = doc.parse(doc.source);
    const used = new Set(before.diagram.nodes.map((n) => n.id));
    // A node an imported file names can't follow its name: the file is not this document's.
    const own = before.diagram.nodes.filter((n) => n.loc.file === undefined && !doc.given.has(n.id));
    for (const node of own) {
      const id = sameLength(node.id, used);
      const result = renameId(doc.source, node.id, id);
      expect(result.error, `${node.id} → ${id}`).toBeUndefined();
      const after = doc.parse(result.source!);
      expect(after.diagram, `${node.id} → ${id}`).toEqual(swapped(before.diagram, node.id, id));
      const swap = (d: Diagnostic) => message(d).replace(/'[^']*'/g, (q) => q.replace(new RegExp(`\\b${node.id}\\b`, 'g'), id));
      expect(after.diagnostics.map(message), `${node.id} → ${id}`).toEqual(before.diagnostics.map(swap));
    }
  });
});
