import { describe, expect, it } from 'vitest';
import { analyze, complete, definition, hover, outline, quickFix, references, toRange, type TextEdit } from '../src/analysis';

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
  });

  it('completes keywords and node ids at the start of a line, ids after an arrow', () => {
    const start = complete(a, { line: lineOf('api -> db : SQL'), character: 0 }).map((i) => i.label);
    expect(start).toEqual(expect.arrayContaining(['usecase', 'alt', 'api', 'db', 'web']));
    const after = complete(a, { line: lineOf('api -> db : SQL'), character: 7 }).map((i) => i.label);
    expect(after).not.toContain('usecase');
    expect(after).toContain('db');
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
    expect(quickFix(a, "Unknown tech stack 'Nope'; drawing a Rectangle")).toBeNull();
  });
});

function applyEdit(text: string, { range, newText }: TextEdit): string {
  const lines = text.split('\n');
  const offset = (p: { line: number; character: number }) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return text.slice(0, offset(range.start)) + newText + text.slice(offset(range.end));
}
