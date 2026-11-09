import { describe, expect, it } from 'vitest';
import { analyze, complete, cursorFixes, definition, hover, outline, quickFix, references, rename, renameEdits, renameTarget, semanticTokens, testQuickFix, toRange, type RenameResult, type TextEdit } from '../src/analysis';

const doc = `title "Shop"

group vpc "VPC" {
  api "Order API" [REST API] @orders "Takes orders"
  db  "Orders DB" [PostgreSQL]
}

api -> db : SQL

usecase "Place order" {
  web -> api : POST /orders json {
    "sku": "api"
  }
  alt "Placed" {
    api -> db : INSERT
    api --> web : 201
  } alt "DB down" {
    api -x db : INSERT
    api --> web : 503
  }
}
`;
const a = analyze(doc);
const lineOf = (text: string) => doc.split('\n').findIndex((l) => l.includes(text));

describe('analysis', () => {
  it('converts 1-based parser locations to 0-based ranges', () => {
    expect(toRange({ line: 2, col: 3, length: 4 })).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 6 } });
    expect(toRange({ line: 1, col: 1, length: 0 }).end.character).toBe(1);
  });

  it('completes tech stacks inside brackets and closes the bracket', () => {
    const items = complete(analyze('db [Postg'), { line: 0, character: 9 });
    const pg = items.find((i) => i.label === 'PostgreSQL')!;
    expect(pg).toMatchObject({ kind: 'tech', insertText: 'PostgreSQL]', range: { start: { line: 0, character: 4 } } });
    expect(complete(analyze('db [Postg]'), { line: 0, character: 9 }).find((i) => i.label === 'PostgreSQL')?.insertText).toBe('PostgreSQL');
    // The whole catalog, with aliases to filter on: typing S3 finds AWS S3.
    expect(items.length).toBeGreaterThan(200);
    expect(items.find((i) => i.label === 'AWS S3')?.filterText).toContain('S3');
    expect(pg.filterText).toContain('Postgres');
  });

  it('completes keywords and node ids at the start of a line, ids after an arrow', () => {
    const start = complete(a, { line: lineOf('api -> db : SQL'), character: 0 }).map((i) => i.label);
    expect(start).toEqual(expect.arrayContaining(['usecase', 'alt', 'api', 'db', 'web']));
    const after = complete(a, { line: lineOf('api -> db : SQL'), character: 7 }).map((i) => i.label);
    expect(after).not.toContain('usecase');
    expect(after).toContain('db');
  });

  it('completes the high-level design sections with snippets', () => {
    const items = complete(analyze('t'), { line: 0, character: 1 });
    for (const label of ['traffic', 'requirements', 'capacity', 'entity', 'decision', 'test']) {
      expect(items.find((i) => i.label === label), label).toMatchObject({ kind: 'keyword', snippet: expect.stringContaining('{\n\t') });
    }
    expect(items.find((i) => i.label === 'entity')?.snippet).toBe('entity ${1:Name} in ${2:store} {\n\t${3:id} ${4:uuid} key$0\n}');
  });

  it('outlines the high-level design sections declared in this document', () => {
    const hld = analyze(
      `${doc}traffic {\n  "Place order" 50 rps\n}\nrequirements {\n  p99 < 200ms # every use case\n  durable "Place order"\n}\nentity Order in db {\n  id uuid key\n}\ndecision "Postgres" because "transactions"\ntest "Writes first" {\n  "Place order" writes db before responding\n}\n`,
    );
    const symbols = outline(hld);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ['vpc', 'group'],
      ['Place order', 'usecase'],
      ['traffic', 'section'],
      ['requirements', 'section'],
      ['entities', 'section'],
      ['decisions', 'section'],
      ['tests', 'section'],
    ]);
    const [traffic, requirements, entities, decisions, tests] = symbols.slice(2);
    expect(traffic.children.map((c) => [c.name, c.detail, c.kind])).toEqual([['Place order', '50 rps', 'traffic']]);
    expect(requirements.children.map((c) => c.name)).toEqual(['p99 < 200ms', 'durable "Place order"']);
    expect(requirements.range).toEqual({ start: requirements.children[0].range.start, end: requirements.children[1].range.end });
    expect(entities.children.map((c) => [c.name, c.detail])).toEqual([['Order', 'in db · 1 field']]);
    expect(decisions.children.map((c) => [c.name, c.detail])).toEqual([['Postgres', 'transactions']]);
    expect(tests.children.map((c) => [c.name, c.detail, c.kind])).toEqual([['Writes first', '1 assertion', 'test']]);
  });

  it('offers assertions at the start of a line in a test block, and only there', () => {
    const labels = (text: string, line: number, character: number) => complete(analyze(text), { line, character }).map((i) => i.label);
    const inTest = complete(analyze('api [REST API]\ntest "T" {\n  "U" calls api\n  \n}'), { line: 3, character: 2 });
    expect(inTest.map((i) => i.label)).toEqual(expect.arrayContaining(['"Use case" never waits for', '"Use case" starts at', 'node never calls node', 'api']));
    expect(inTest.map((i) => i.label)).not.toContain('usecase');
    expect(inTest.find((i) => i.label === '"Use case" calls … after …')?.snippet).toBe('"${1:Use case}" calls ${2:node} after ${3:node}');
    expect(labels('api [REST API]\ntest "T" {\n}\n', 3, 0)).toContain('usecase');
    expect(labels('requirements {\n  \n}', 1, 2)).not.toContain('"Use case" starts at');
  });

  it('offers only alt after a closing brace', () => {
    const items = complete(analyze('usecase "U" {\n  alt "A" {\n  } a'), { line: 2, character: 5 });
    expect(items.map((i) => i.label)).toEqual(['alt']);
    expect(items[0].snippet).toContain('alt "${1:Scenario}"');
  });

  it('offers when right after an alt name, and only there', () => {
    const items = complete(analyze('usecase "U" {\n  alt "Missing" w'), { line: 1, character: 17 });
    expect(items.map((i) => i.label)).toEqual(['when']);
    expect(items[0].snippet).toContain('when "${1:condition}"');
    expect(complete(analyze('usecase "U" {\n  } alt "B" '), { line: 1, character: 12 }).map((i) => i.label)).toEqual(['when']);
    expect(complete(analyze('a -> b\nusecase "U" {\n  a '), { line: 2, character: 4 }).map((i) => i.label)).not.toContain('when');
  });

  it('stays quiet in labels and payloads', () => {
    expect(complete(a, { line: lineOf('POST /orders'), character: 20 })).toEqual([]);
    expect(complete(a, { line: lineOf('"sku"'), character: 5 })).toEqual([]);
  });

  it('jumps from a use to the declaration', () => {
    const line = lineOf('api -> db : SQL');
    expect(definition(a, { line, character: 8 })).toEqual({ start: { line: lineOf('db  "Orders DB"'), character: 2 }, end: { line: lineOf('db  "Orders DB"'), character: 4 } });
    // web is never declared
    expect(definition(a, { line: lineOf('web -> api'), character: 3 })).toBeNull();
    // ids inside strings, tech stacks and payloads are not node references
    expect(definition(a, { line: lineOf('"sku": "api"'), character: 13 })).toBeNull();
    expect(definition(a, { line: 0, character: 8 })).toBeNull();
  });

  it('finds every use of a node, and nothing in strings or payloads', () => {
    const refs = references(a, { line: lineOf('api "Order API"'), character: 3 });
    expect(refs.map((r) => r.start.line)).toEqual([3, 7, 10, 14, 15, 17, 18]);
  });

  it('describes a node on hover', () => {
    const h = hover(a, { line: lineOf('api -> db : SQL'), character: 1 })!;
    expect(h.markdown).toContain('**Order API** `api`');
    expect(h.markdown).toContain('`REST API`');
    expect(h.markdown).toContain('owned by @orders');
    expect(h.markdown).toContain('Takes orders');
    expect(h.markdown).toContain('In group `vpc`');
    expect(h.markdown).toContain('Used in: “Place order”');
    expect(hover(a, { line: lineOf('web -> api'), character: 3 })!.markdown).toContain('Not declared');
  });

  it('outlines groups, nodes, use cases and scenarios', () => {
    const symbols = outline(a);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ['vpc', 'group'],
      ['Place order', 'usecase'],
    ]);
    expect(symbols[0].children.map((c) => c.name)).toEqual(['api', 'db']);
    expect(symbols[1].detail).toBe('POST /orders · 2 scenarios');
    expect(symbols[1].children.map((c) => [c.name, c.detail, c.range.start.line])).toEqual([
      ['Placed', undefined, lineOf('alt "Placed"')],
      ['DB down', 'error path', lineOf('alt "DB down"')],
    ]);
  });

  it('quick-fixes a missing connection by adding it above the use cases', () => {
    const warning = a.diagnostics.find((d) => d.message.startsWith('No connection'))!;
    expect(warning).toMatchObject({ line: lineOf('web -> api') + 1, message: "No connection between 'web' and 'api' in the architecture; add 'web -> api'" });
    const fix = quickFix(a, warning.message)!;
    expect(fix.title).toBe("Add connection 'web -> api'");
    const fixed = applyEdit(doc, fix.edit);
    expect(fixed).toBe(doc.replace('api -> db : SQL\n', 'api -> db : SQL\nweb -> api\n'));
    expect(analyze(fixed).diagnostics).toEqual([]);
    expect(quickFix(a, "Unknown tech stack 'Cobol'; simulated as a generic service, like [Service]")).toBeNull();
  });

  it('quick-fixes an unknown tech stack with the suggested one', () => {
    const src = 'db "Orders" [Postgress] x2\n';
    const b = analyze(src);
    const warning = b.diagnostics[0];
    expect(warning.message).toMatch(/^Unknown tech stack 'Postgress'\. Did you mean 'PostgreSQL'\?/);
    const fix = quickFix(b, warning.message, toRange(warning))!;
    expect(fix.title).toBe("Change to 'PostgreSQL'");
    expect(applyEdit(src, fix.edit)).toBe('db "Orders" [PostgreSQL] x2\n');
    // Without a suggestion there is nothing to fix.
    expect(quickFix(b, "Unknown tech stack 'Zzyzx'; simulated as a generic service, like [Service]", toRange(warning))).toBeNull();
  });

  it('tokenizes node ids, tech stacks and teams, but not strings, labels or payloads', () => {
    const at = (text: string) => semanticTokens(a).filter((t) => t.line === lineOf(text)).map((t) => [doc.split('\n')[t.line].substr(t.character, t.length), t.kind]);
    expect(at('api "Order API"')).toEqual([['api', 'node'], ['[REST API]', 'tech'], ['@orders', 'team']]);
    expect(at('api -> db : SQL')).toEqual([['api', 'node'], ['db', 'node']]);
    expect(at('"sku": "api"')).toEqual([]);
    expect(at('api -x db')).toEqual([['api', 'node'], ['db', 'node']]);
    expect(semanticTokens(a).some((t) => t.line === lineOf('usecase "Place order"'))).toBe(false);
  });

  it('tokenizes legend tags and keeps tokens after a hex color', () => {
    const src = 'legend {\n  owned "Owned" green\n}\napi [Go] color #3b82f6 .owned @team\nowned [Go]\napi -> owned .owned : x .owned';
    const tokens = semanticTokens(analyze(src)).map((t) => [t.line, src.split('\n')[t.line].substr(t.character, t.length), t.kind]);
    expect(tokens).toEqual([
      [1, 'owned', 'tag'],
      [3, 'api', 'node'],
      [3, '[Go]', 'tech'],
      [3, '.owned', 'tag'],
      [3, '@team', 'team'],
      [4, 'owned', 'node'],
      [4, '[Go]', 'tech'],
      [5, 'api', 'node'],
      [5, 'owned', 'node'],
      [5, '.owned', 'tag'],
    ]);
  });
});

const hld = `api [REST API]
db [PostgreSQL]
cache [Redis]
user -> api
api -> cache
api -> db

usecase "Redirect" {
  user -> api : GET /code
  alt "Cache hit" {
    api -> cache : GET code
  } alt "Cache miss" {
    api -> db : SELECT url
  }
}

usecase "Shorten" {
  user -> api : POST /urls
  api -> db : INSERT url
}

traffic {
  "Redirect" 1k rps mix "Cache hit" 90%, "Cache miss" 10%
}

requirements {
  p99 "Redirect" scenario "Cache miss" < 100ms
  durable "Shorten"
}

capacity {
  db 20k rps
}

test "Flows" {
  "Redirect" has scenario "Cache hit"
  in "Shorten" api calls db
}
`;
const h = analyze(hld);
const hl = (text: string, from = 0) => hld.split('\n').findIndex((l, i) => i >= from && l.includes(text));
/** The position of the first character of `text` (or `at` characters into it) on the first line with it. */
const at = (text: string, offset = 0) => ({ line: hl(text), character: hld.split('\n')[hl(text)].indexOf(text) + offset });

function applyEdits(text: string, edits: TextEdit[]): string {
  return [...edits].sort((x, y) => y.range.start.line - x.range.start.line || y.range.start.character - x.range.start.character).reduce(applyEdit, text);
}

describe('rename', () => {
  it('renames a node id everywhere it is used as a node, but not in strings or labels', () => {
    expect(renameTarget(h, at('db [PostgreSQL]', 1))).toEqual({ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } }, placeholder: 'db' });
    const result = rename(h, at('db [PostgreSQL]'), 'store') as RenameResult;
    const renamed = applyEdits(hld, result.edits);
    expect(renamed).toContain('store [PostgreSQL]');
    expect(renamed).toContain('api -> store : SELECT url');
    expect(renamed).toContain('  store 20k rps');
    expect(renamed).toContain('in "Shorten" api calls store');
    expect(renamed).not.toMatch(/\bdb\b/);
    expect(analyze(renamed).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('rejects a node id that is invalid or taken', () => {
    expect(rename(h, at('db [PostgreSQL]'), 'my db')).toEqual({ error: "'my db' is not a node id; use letters, digits and _" });
    expect(rename(h, at('db [PostgreSQL]'), 'cache')).toEqual({ error: "There is already a node 'cache'" });
  });

  it('renames a use case in its header, traffic, requirements and tests', () => {
    const target = renameTarget(h, at('"Shorten" api calls', 3));
    expect(target).toEqual({ range: { start: { line: hl('in "Shorten"'), character: 6 }, end: { line: hl('in "Shorten"'), character: 13 } }, placeholder: 'Shorten' });
    const result = rename(h, at('"Shorten" api calls', 3), 'Shorten URL') as RenameResult;
    expect(result.edits).toHaveLength(3);
    const renamed = applyEdits(hld, result.edits);
    expect(renamed).toContain('usecase "Shorten URL" {');
    expect(renamed).toContain('durable "Shorten URL"');
    expect(renamed).toContain('in "Shorten URL" api calls db');

    const redirect = applyEdits(hld, (rename(h, at('usecase "Redirect"', 10), 'Go') as RenameResult).edits);
    expect(redirect).toContain('usecase "Go" {');
    expect(redirect).toContain('  "Go" 1k rps mix "Cache hit" 90%');
    expect(redirect).toContain('p99 "Go" scenario "Cache miss"');
    expect(redirect).toContain('  "Go" has scenario "Cache hit"');
    expect(analyze(redirect).diagnostics).toEqual([]);
    expect(rename(h, at('usecase "Redirect"', 10), 'Shorten')).toEqual({ error: 'There is already a use case named "Shorten"' });
    expect(rename(h, at('usecase "Redirect"', 10), 'a"b')).toMatchObject({ error: expect.stringContaining('cannot be a name') });
  });

  it("renames a scenario in its alt header and where its use case's traffic, requirements and tests name it", () => {
    const fromMix = applyEdits(hld, (rename(h, at('"Cache miss" 10%', 2), 'Miss') as RenameResult).edits);
    expect(fromMix).toContain('} alt "Miss" {');
    expect(fromMix).toContain('mix "Cache hit" 90%, "Miss" 10%');
    expect(fromMix).toContain('scenario "Miss" < 100ms');
    expect(fromMix).toContain('alt "Cache hit" {');

    const fromHeader = applyEdits(hld, (rename(h, at('alt "Cache hit"', 6), 'Hit') as RenameResult).edits);
    expect(fromHeader).toContain('alt "Hit" {');
    expect(fromHeader).toContain('mix "Hit" 90%');
    expect(fromHeader).toContain('has scenario "Hit"');
    expect(analyze(fromHeader).diagnostics).toEqual([]);
  });

  it('renames an outer alt inside the full names of its nested scenarios', () => {
    const src = 'usecase "U" {\n  a -> b\n  alt "A" {\n    alt "X" {\n      b -> c\n    } alt "Y" {\n      b -> d\n    }\n  } alt "B" {\n    b -> e\n  }\n}\ntraffic {\n  "U" 1 rps mix "A › X" 50%, "A › Y" 25%, "B" 25%\n}\n';
    const s = analyze(src);
    const pos = { line: 2, character: 8 };
    expect(renameTarget(s, pos)?.placeholder).toBe('A');
    const renamed = applyEdits(src, (rename(s, pos, 'Outer') as RenameResult).edits);
    expect(renamed).toContain('alt "Outer" {');
    expect(renamed).toContain('mix "Outer › X" 50%, "Outer › Y" 25%, "B" 25%');
    // A nested name renames only that segment.
    const inner = applyEdits(src, (rename(s, { line: 13, character: 21 }, 'Z') as RenameResult).edits);
    expect(inner).toContain('alt "Z" {');
    expect(inner).toContain('"A › Z" 50%, "A › Y" 25%');
  });

  it('points at the imported file that declares a node', () => {
    const src = 'import "infra.proschi"\nusecase "U" {\n  web -> api : GET\n}\n';
    const s = analyze(src, { resolve: () => ({ path: '/p/infra.proschi', source: 'api [REST API]\n' }) });
    const result = rename(s, { line: 2, character: 10 }, 'gateway') as RenameResult;
    expect(result.edits).toEqual([{ range: { start: { line: 2, character: 9 }, end: { line: 2, character: 12 } }, newText: 'gateway' }]);
    expect(result).toMatchObject({ symbol: { kind: 'node', id: 'api' }, declaredIn: '/p/infra.proschi' });
    // A document that declares a node of that id itself has a different node.
    expect(renameEdits(analyze('api [Go]\n'), result.symbol, 'gateway', '/p/infra.proschi')).toEqual([]);
    expect(renameEdits(analyze('api [Go]\n'), result.symbol, 'gateway')).toHaveLength(1);
  });

  it("renames a team use case from a system's expose line", () => {
    const team = 'api [REST API]\nusecase "Place order" {\n  api -> api : POST\n}\n';
    const src = 'system orders "Orders" {\n  from "orders.proschi"\n  expose api "Orders API" -> "Place order"\n}\n';
    const s = analyze(src, { resolve: (p) => (p === 'orders.proschi' ? { path: '/p/orders.proschi', source: team } : undefined) });
    const pos = { line: 2, character: 32 };
    expect(renameTarget(s, pos)?.placeholder).toBe('Place order');
    const result = rename(s, pos, 'Order') as RenameResult;
    expect(result).toMatchObject({ symbol: { kind: 'usecase', name: 'Place order' }, declaredIn: '/p/orders.proschi' });
    expect(applyEdits(src, result.edits)).toContain('expose api "Orders API" -> "Order"');
    // In the team file itself, the header.
    expect(applyEdits(team, renameEdits(analyze(team), result.symbol, 'Order'))).toContain('usecase "Order" {');
    // As a use case of this document, nothing here.
    expect(renameEdits(s, result.symbol, 'Order')).toEqual([]);
  });

  it('renames a use case in what-if traffic', () => {
    const src = 'a [Actor]\nb [REST API]\na -> b\nusecase "U" {\n  a -> b\n}\ntraffic {\n  "U" 1k rps\n}\nwhatif "Spike" {\n  traffic "U" x10\n  fail b\n}\n';
    const s = analyze(src);
    expect(s.diagnostics).toEqual([]);
    const renamed = applyEdits(src, (rename(s, { line: 3, character: 10 }, 'Read') as RenameResult).edits);
    expect(renamed).toContain('  traffic "Read" x10');
    expect(renamed).toContain('whatif "Spike" {');
    expect(analyze(renamed).diagnostics).toEqual([]);
    // Completed there too.
    const typing = src.replace('traffic "U" x10', 'traffic "');
    expect(complete(analyze(typing), { line: 10, character: 11 }).map((i) => i.label)).toEqual(['U']);
  });

  it('has nothing to rename on keywords, labels and free strings', () => {
    expect(renameTarget(h, at('usecase "Redirect"', 2))).toBeNull();
    expect(renameTarget(h, at('GET code', 1))).toBeNull();
    expect(renameTarget(h, at('test "Flows"', 7))).toBeNull();
    expect(rename(h, at('test "Flows"', 7), 'x')).toBeNull();
  });
});

describe('completion of names and capacity parts', () => {
  const labels = (src: string, line: number, character: number) => complete(analyze(src), { line, character }).map((i) => i.label);

  it('completes use case names in traffic, requirements and test assertions', () => {
    const items = complete(analyze(hld.replace('traffic {\n', 'traffic {\n  "\n')), { line: hl('traffic {') + 1, character: 3 });
    expect(items.map((i) => [i.label, i.kind, i.insertText])).toEqual([
      ['Redirect', 'usecase', 'Redirect"'],
      ['Shorten', 'usecase', 'Shorten"'],
    ]);
    expect(items[0].range).toEqual({ start: { line: hl('traffic {') + 1, character: 3 }, end: { line: hl('traffic {') + 1, character: 3 } });
    // A closing quote already there is not doubled.
    expect(complete(analyze(hld.replace('durable "Shorten"', 'durable "Sh"')), { line: hl('durable'), character: 13 })[1]).toMatchObject({ label: 'Shorten', insertText: 'Shorten' });
    expect(labels(hld.replace('durable "Shorten"', 'p99 "'), hl('durable'), 7)).toEqual(['Redirect', 'Shorten']);
    expect(labels(hld.replace('in "Shorten" api calls db', 'in "'), hl('in "'), 6)).toEqual(['Redirect', 'Shorten']);
    // Not in the quotes of a decision or a label.
    expect(complete(analyze('decision "'), { line: 0, character: 10 })).toEqual([]);
  });

  it('completes scenario names after mix, scenario and has scenario', () => {
    const mix = hld.replace('mix "Cache hit" 90%, "Cache miss" 10%', 'mix "Cache hit" 90%, "');
    expect(labels(mix, hl('mix'), mix.split('\n')[hl('mix')].length)).toEqual(['Cache hit', 'Cache miss']);
    const first = hld.replace('mix "Cache hit" 90%, "Cache miss" 10%', 'mix "');
    expect(labels(first, hl('mix'), first.split('\n')[hl('mix')].length)).toEqual(['Cache hit', 'Cache miss']);
    expect(labels(hld, hl('scenario "Cache miss"'), hld.split('\n')[hl('scenario "Cache miss"')].indexOf('Cache miss'))).toEqual(['Cache hit', 'Cache miss']);
    expect(labels(hld, hl('has scenario'), hld.split('\n')[hl('has scenario')].indexOf('Cache hit'))).toEqual(['Cache hit', 'Cache miss']);
    // A use case without alts has no scenario names to offer.
    expect(labels(hld.replace('"Redirect" has scenario', '"Shorten" has scenario'), hl('has scenario'), 27)).toEqual([]);
  });

  it('completes capacity parts after a node id, and node ids at the start of a line', () => {
    const src = 'db [PostgreSQL]\ncapacity {\n  db 20k rps \n  \n  db size \n}\n';
    const parts = labels(src, 2, 13);
    expect(parts).toEqual(expect.arrayContaining(['latency', 'shards', 'size', 'durable', 'consistency', 'timeout']));
    expect(parts).not.toContain('rps');
    expect(complete(analyze(src), { line: 2, character: 13 }).find((i) => i.label === 'latency')).toMatchObject({ kind: 'keyword', snippet: 'latency ${1:5ms}' });
    expect(labels(src, 3, 2)).toEqual(['db']);
    expect(labels(src, 4, 10)).toEqual(['S', 'M', 'L']);
    expect(labels('db [PostgreSQL]\ncapacity {\n  db latency 5ms \n}', 2, 18)).not.toContain('latency');
    // Still while the block has no closing brace.
    expect(labels('db [PostgreSQL]\ncapacity {\n  db ', 2, 5)).toContain('shards');
  });
});

describe('quick fixes for capacity, traffic and failed requirements', () => {
  it('removes a capacity part given twice', () => {
    const src = 'db [PostgreSQL]\ncapacity {\n  db 20k rps latency 4ms latency 5 ms durable\n}\n';
    const b = analyze(src);
    const error = b.diagnostics.find((d) => d.message.includes('given twice'))!;
    expect(error.message).toBe("Latency is given twice for 'db'");
    const fix = quickFix(b, error.message, toRange(error))!;
    expect(fix.title).toBe("Remove the repeated 'latency 5 ms'");
    expect(applyEdit(src, fix.edit)).toBe(src.replace(' latency 5 ms', ''));
    expect(analyze(applyEdit(src, fix.edit)).diagnostics).toEqual([]);

    const rate = 'db [PostgreSQL]\ncapacity {\n  db 20k rps 30k rps\n}\n';
    const r = analyze(rate);
    const again = r.diagnostics.find((d) => d.message.includes('given twice'))!;
    expect(applyEdit(rate, quickFix(r, again.message, toRange(again))!.edit)).toBe(rate.replace(' 30k rps', ''));
  });

  it('adds a traffic line for a use case that has none, into the block or a new one', () => {
    const [fix] = cursorFixes(h, { start: { line: hl('usecase "Shorten"'), character: 3 }, end: { line: hl('usecase "Shorten"'), character: 3 } });
    expect(fix.title).toBe('Add a traffic line for "Shorten"');
    const added = applyEdit(hld, fix.edit);
    expect(added).toContain('  "Redirect" 1k rps mix "Cache hit" 90%, "Cache miss" 10%\n  "Shorten" 100 rps\n}');
    expect(analyze(added).diagram.traffic?.map((t) => t.useCase)).toEqual(['Redirect', 'Shorten']);
    // A use case with traffic, or a line that is not a use case header, has nothing to add.
    expect(cursorFixes(h, { start: { line: hl('usecase "Redirect"'), character: 0 }, end: { line: hl('usecase "Redirect"'), character: 0 } })).toEqual([]);
    expect(cursorFixes(h, { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })).toEqual([]);

    const bare = 'usecase "Read" {\n  a -> b\n}';
    const [first] = cursorFixes(analyze(bare), { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
    expect(applyEdit(bare, first.edit)).toBe(`${bare}\n\ntraffic {\n  "Read" 100 rps\n}\n`);
  });

  const ITEMS = `client [Actor]
api [REST API]
db [PostgreSQL]
client -> api
api -> db
usecase "Read" {
  client -> api : GET /items
  api -> db : SELECT item
  api --> client : 200
}
traffic {
  "Read" 1k rps
}
requirements {
  survive any node failure
}
`;

  it('adds x2 to a single point of failure that survive names', () => {
    const b = analyze(ITEMS);
    const fix = testQuickFix(b, { start: { line: 14, character: 2 }, end: { line: 14, character: 26 } })!;
    expect(fix.title).toBe("Add x2 to 'api'");
    expect(applyEdit(ITEMS, fix.edit)).toContain('api [REST API] x2\n');
    // Not on another line.
    expect(testQuickFix(b, { start: { line: 13, character: 0 }, end: { line: 13, character: 1 } })).toBeNull();
  });

  it('adds the shards the saturation hint computes to the capacity block', () => {
    const src = `client [Actor]
api [REST API] x40
db [PostgreSQL] x3
client -> api
api -> db
usecase "Write" {
  client -> api : POST /items
  api -> db : INSERT item
  api --> client : 201
}
traffic {
  "Write" 6k rps
}
requirements {
  p99 "Write" < 1000ms
}
`;
    const b = analyze(src);
    const fix = testQuickFix(b, { start: { line: 14, character: 2 }, end: { line: 14, character: 5 } })!;
    expect(fix.title).toBe("Add shards 2 to the capacity of 'db'");
    const fixed = applyEdit(src, fix.edit);
    expect(fixed).toContain('capacity {\n  db shards 2\n}');
    expect(analyze(fixed).diagram.capacity).toEqual([expect.objectContaining({ node: 'db', shards: 2 })]);
  });
});

function applyEdit(text: string, { range, newText }: TextEdit): string {
  const lines = text.split('\n');
  const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return text.slice(0, offset(range.start)) + newText + text.slice(offset(range.end));
}
