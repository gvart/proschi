import { describe, expect, it } from 'vitest';
import { analyze, complete, definition, hover, outline, quickFix, references, rename, semanticTokens, toRange, type TextEdit } from '../src/analysis';
import { builtinTypes } from '../src/proschi';

// Typed components (docs/design/typed-components.md) in the language server.
// Names of built-in types and their ops come from builtinTypes(), so these
// tests keep passing whatever the stdlib ships.
const builtin = [...builtinTypes().values()];
const withOps = builtin.find((t) => !t.abstract && t.ops.some((o) => o.access === 'read') && t.ops.some((o) => o.access === 'write') && /^\w+$/.test(t.name))!;
const http = builtin.find((t) => !t.abstract && t.statuses.length > 0 && t.headers.length > 0)!;
const abstract = builtin.find((t) => t.abstract && t.name !== 'Component')!;

const doc = `abstract type Store extends ${withOps.name} {
  doc "Keeps things"
}

type LedgerDb extends Store {
  kind database
  op write APPEND latency 2
}

type [Ledger Api] extends [${http.name}] {}

api "API" [Ledger Api]
ledger "Ledger" [LedgerDb]
api -> ledger

usecase "Append" {
  api -> ledger : APPEND
  api --> api : 201
}
`;
const a = analyze(doc);
const lineOf = (text: string) => doc.split('\n').findIndex((l) => l.includes(text));
const at = (text: string, offset = 0) => ({ line: lineOf(text), character: doc.split('\n')[lineOf(text)].indexOf(text) + offset });
const labels = (text: string, pos: { line: number; character: number }) => complete(analyze(text), pos).map((i) => i.label);

function applyEdits(text: string, edits: TextEdit[]): string {
  const lines = text.split('\n');
  for (const e of [...edits].sort((x, y) => y.range.start.line - x.range.start.line || y.range.start.character - x.range.start.character)) {
    const l = lines[e.range.start.line];
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character);
  }
  return lines.join('\n');
}

describe('types in the language server', () => {
  it('parses the fixture with no errors', () => {
    expect(a.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('completes built-in and declared types in brackets, abstract ones marked', () => {
    const items = complete(analyze('type Mine { kind cache }\nx [M'), { line: 1, character: 4 });
    const mine = items.find((i) => i.label === 'Mine')!;
    expect(mine).toMatchObject({ kind: 'type', insertText: 'Mine]' });
    expect(items.indexOf(mine)).toBe(0);
    const abs = items.find((i) => i.label === abstract.name)!;
    expect(abs.kind).toBe('type');
    expect(abs.detail).toMatch(/^abstract/);
    expect(items.find((i) => i.label === withOps.name)?.detail).toContain(withOps.doc ?? '');
    // Catalog techs without a type are still there.
    expect(items.length).toBeGreaterThan(200);
  });

  it('completes types after extends, bracketing names with spaces', () => {
    const items = complete(analyze('type X extends '), { line: 0, character: 15 });
    expect(items.find((i) => i.label === withOps.name)?.insertText).toBe(withOps.name);
    const spaced = items.find((i) => i.label.includes(' '))!;
    expect(spaced.insertText).toBe(`[${spaced.label}]`);
  });

  it('completes the body of a type: properties, kinds, op access', () => {
    const body = 'type X {\n  \n}';
    expect(labels(body, { line: 1, character: 2 })).toEqual(expect.arrayContaining(['kind', 'op', 'status', 'header', 'protocol', 'icon', 'doc', 'latencyMs']));
    expect(labels(body, { line: 1, character: 2 })).not.toContain('usecase');
    const kinds = labels('type X {\n  kind \n}', { line: 1, character: 7 });
    expect(kinds).toHaveLength(17);
    expect(kinds).toContain('database');
    expect(labels('type X {\n  op \n}', { line: 1, character: 5 })).toEqual(['read', 'write']);
    // After the block, keywords again.
    expect(labels('type X {\n}\n', { line: 2, character: 0 })).toContain('usecase');
    expect(labels('t', { line: 0, character: 1 })).toEqual(expect.arrayContaining(['type', 'abstract type']));
  });

  it("completes a step's operations from the target's type", () => {
    const src = `a "A" [Service]\ndb "DB" [${withOps.name}]\na -> db\nusecase "U" {\n  a -> db : \n}`;
    const items = complete(analyze(src), { line: 4, character: 12 });
    expect(items.map((i) => i.label)).toEqual(withOps.ops.map((o) => o.name));
    expect(items[0]).toMatchObject({ kind: 'op', detail: expect.stringContaining(withOps.ops[0].access) });
    // Outside a use case a connection label stays free text.
    expect(complete(analyze(`db "DB" [${withOps.name}]\na -> db : `), { line: 1, character: 10 })).toEqual([]);
  });

  it('completes statuses on a response and headers after header', () => {
    const src = `api "API" [${http.name}]\nweb -> api\nusecase "U" {\n  web -> api : GET /x header \n  api --> web : \n}`;
    const b = analyze(src);
    expect(complete(b, { line: 4, character: 16 }).map((i) => i.label)).toEqual(http.statuses.map(String));
    expect(complete(b, { line: 3, character: 29 }).map((i) => i.label)).toEqual(http.headers);
    const one = `api "API" [${http.name}]\nweb -> api\nusecase "U" {\n  web -> api : GET /x header ${http.headers[0]}, \n}`;
    expect(complete(analyze(one), { line: 3, character: 31 + http.headers[0].length }).map((i) => i.label)).toEqual(http.headers.slice(1));
  });

  it('hovers a type with its chain, kind, doc and ops', () => {
    const h = hover(a, at('[LedgerDb]', 3))!;
    expect(h.markdown).toContain('**LedgerDb** · type');
    expect(h.markdown).toContain(`\`LedgerDb → Store → ${withOps.name} → ${withOps.parents.join(' → ')}\``);
    expect(h.markdown).toContain('kind `database`');
    expect(h.markdown).toContain('Keeps things');
    expect(h.markdown).toMatch(/\*\*Write:\*\* .*`APPEND` \(latency ×2\)/);
    expect(h.markdown).toContain('**Read:**');
    expect(hover(a, at('extends Store', 9))!.markdown).toContain('**Store** · abstract type');
    expect(hover(a, at(`extends ${withOps.name}`, 9))!.markdown).toContain(', built in');
  });

  it('hovers an operation in a step', () => {
    const h = hover(a, at(': APPEND', 3))!;
    expect(h.markdown).toBe('**APPEND** · write operation of `LedgerDb`\n\nlatency ×2\n\nKeeps things');
  });

  it('jumps to, finds and renames a declared type', () => {
    expect(definition(a, at('[LedgerDb]', 2))).toEqual(toRange({ line: lineOf('type LedgerDb') + 1, col: 6, length: 8 }));
    expect(definition(a, at(`extends ${withOps.name}`, 9))).toBeNull();
    expect(references(a, at('Store {', 1)).map((r) => r.start.line)).toEqual([lineOf('abstract type Store'), lineOf('extends Store')]);
    const result = rename(a, at('[LedgerDb]', 2), 'Ledger Store');
    expect(result && 'edits' in result).toBe(true);
    const renamed = applyEdits(doc, (result as { edits: TextEdit[] }).edits);
    expect(renamed).toContain('type [Ledger Store] extends Store {');
    expect(renamed).toContain('ledger "Ledger" [Ledger Store]');
    expect(analyze(renamed).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(rename(a, at('[LedgerDb]', 2), 'Store')).toEqual({ error: "There is already a type 'Store'" });
    expect(rename(a, at(`extends ${withOps.name}`, 9), 'Mine')).toBeNull();
  });

  it('outlines and colours the declared types', () => {
    expect(outline(a).filter((s) => s.kind === 'type').map((s) => [s.name, s.detail])).toEqual([
      ['Store', `abstract · extends ${withOps.name} · ${withOps.kind}`],
      ['LedgerDb', 'extends Store · database'],
      ['Ledger Api', `extends ${http.name} · ${http.kind}`],
    ]);
    const header = semanticTokens(a).filter((t) => t.line === lineOf('type LedgerDb'));
    expect(header.map((t) => [t.character, t.length, t.kind])).toEqual([
      [5, 8, 'tech'],
      [22, 5, 'tech'],
    ]);
  });

  it('passes type diagnostics through, and quick-fixes an unknown parent', () => {
    const src = `type X extends ${withOps.name.slice(0, -1)} {\n  kind database\n}\n`;
    const b = analyze(src);
    const error = b.diagnostics.find((d) => d.message.startsWith('Unknown parent type'))!;
    expect(error).toBeDefined();
    expect(error.message).toContain(`Did you mean '${withOps.name}'?`);
    const fix = quickFix(b, error.message, toRange(error))!;
    expect(fix.title).toBe(`Change to '${withOps.name}'`);
    expect(applyEdits(src, [fix.edit])).toBe(src.replace(withOps.name.slice(0, -1), withOps.name));
    // In brackets the fix keeps them.
    const bracketed = `type X extends [${withOps.name.slice(0, -1)}] {}\n`;
    const c = analyze(bracketed);
    const err = c.diagnostics.find((d) => d.message.startsWith('Unknown parent type'))!;
    expect(applyEdits(bracketed, [quickFix(c, err.message, toRange(err))!.edit])).toBe(`type X extends [${withOps.name}] {}\n`);
  });
});
