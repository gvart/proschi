import { describe, expect, it } from 'vitest';
import { joinImportPath, mapResolver, parse } from './index';
import { format } from './format';

const infra = `title "Infra"
gateway "API Gateway" [AWS API Gateway]
orders [REST API]
db [PostgreSQL]
gateway -> orders
orders -> db
`;

const checkout = `title "Checkout"
import "infra.proschi"

usecase "Place order" {
  gateway -> orders : POST /orders
  orders -> db : INSERT order
  orders --> gateway : 201
}
`;

const parseWith = (files: Record<string, string>, root: string) =>
  parse(files[root], { path: root, resolve: mapResolver(files) });

describe('import', () => {
  it('merges what the imported file declares, keeping the root title', () => {
    const { diagram, diagnostics, imports } = parseWith({ 'infra.proschi': infra, 'checkout.proschi': checkout }, 'checkout.proschi');
    expect(diagnostics).toEqual([]);
    expect(diagram.title).toBe('Checkout');
    expect(diagram.nodes.map((n) => n.id)).toEqual(['gateway', 'orders', 'db']);
    expect(diagram.nodes.every((n) => !n.implicit && n.loc.file === 'infra.proschi')).toBe(true);
    expect(diagram.edges.map((e) => e.id)).toEqual(['gateway->orders', 'orders->db']);
    expect(diagram.useCases[0]).toMatchObject({ id: 'place-order', entryServiceId: 'gateway', loc: { line: 4 } });
    expect(diagram.useCases[0].loc.file).toBeUndefined();
    expect(diagram.useCases[0].steps[0]).toMatchObject({ protocol: 'REST', statusCode: 201 });
    expect(imports).toEqual([{ path: 'infra.proschi', resolved: 'infra.proschi', loc: { line: 2, col: 8, length: 15 } }]);
  });

  it('leaves imports out of the result when there are none', () => {
    expect(parse('a -> b')).not.toHaveProperty('imports');
  });

  it('creates implicit nodes only after every file is read', () => {
    const files = { 'a.proschi': 'import "b.proschi"\nx -> y', 'b.proschi': 'y [Redis]' };
    const { diagram } = parseWith(files, 'a.proschi');
    expect(diagram.nodes.map((n) => [n.id, !!n.implicit])).toEqual([
      ['y', false],
      ['x', true],
    ]);
  });

  it('resolves paths relative to the importing file', () => {
    const files = {
      'teams/shop.proschi': 'import "../infra/base.proschi"\nusecase "U" {\n  a -> b\n}',
      'infra/base.proschi': 'import "./nodes.proschi"\na -> b',
      'infra/nodes.proschi': 'a [REST API]\nb [Redis]',
    };
    const { diagram, diagnostics } = parseWith(files, 'teams/shop.proschi');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.map((n) => n.loc.file)).toEqual(['infra/nodes.proschi', 'infra/nodes.proschi']);
  });

  it('includes a file imported along several paths once', () => {
    const files = {
      'root.proschi': 'import "a.proschi"\nimport "b.proschi"',
      'a.proschi': 'import "shared.proschi"\na -> s',
      'b.proschi': 'import "shared.proschi"\nb -> s',
      'shared.proschi': 's [Redis]',
    };
    const { diagram, diagnostics } = parseWith(files, 'root.proschi');
    expect(diagnostics).toEqual([]);
    expect(diagram.nodes.filter((n) => n.id === 's')).toHaveLength(1);
  });

  it('reports import cycles on the import line', () => {
    const files = { 'a.proschi': 'import "b.proschi"\na [Redis]', 'b.proschi': 'import "a.proschi"\nb [Redis]' };
    const { diagram, diagnostics } = parseWith(files, 'a.proschi');
    expect(diagnostics).toEqual([
      { severity: 'error', message: 'Import cycle: a.proschi → b.proschi → a.proschi', line: 1, col: 8, length: 11, file: 'b.proschi' },
    ]);
    expect(diagram.nodes.map((n) => n.id)).toEqual(['b', 'a']);
    expect(parseWith({ 'self.proschi': 'import "self.proschi"' }, 'self.proschi').diagnostics[0].message).toBe(
      'Import cycle: self.proschi → self.proschi',
    );
  });

  it('reports files it cannot find', () => {
    const { diagnostics } = parseWith({ 'a.proschi': 'import "nope.proschi"' }, 'a.proschi');
    expect(diagnostics).toEqual([{ severity: 'error', message: "Cannot find 'nope.proschi'", line: 1, col: 8, length: 14 }]);
    const throwing = parse('import "x.proschi"', {
      resolve: () => {
        throw new Error('disk on fire');
      },
    });
    expect(throwing.diagnostics[0].message).toBe("Cannot find 'x.proschi'");
  });

  it('only warns when imports cannot be resolved in this context', () => {
    const { diagnostics, imports } = parse('import "infra.proschi"\na -> b');
    expect(diagnostics).toEqual([
      { severity: 'warning', message: "Imports are not resolved in this context; 'infra.proschi' was not loaded", line: 1, col: 8, length: 15 },
    ]);
    expect(imports).toEqual([{ path: 'infra.proschi', loc: { line: 1, col: 8, length: 15 } }]);
  });

  it('reports duplicate ids across files with the file and line of the first', () => {
    const files = { 'root.proschi': 'import "infra.proschi"\norders [Redis]', 'infra.proschi': '\norders [REST API]' };
    const { diagnostics } = parseWith(files, 'root.proschi');
    expect(diagnostics).toEqual([
      { severity: 'error', message: "Duplicate id 'orders' (first declared in infra.proschi on line 2)", line: 2, col: 1, length: 6 },
    ]);
    const later = parseWith({ 'root.proschi': 'orders [Redis]\nimport "infra.proschi"', 'infra.proschi': 'orders [REST API]' }, 'root.proschi');
    expect(later.diagnostics[0]).toMatchObject({ message: "Duplicate id 'orders' (first declared in root.proschi on line 1)", file: 'infra.proschi' });
  });

  it('keeps use case ids unique across files', () => {
    const files = { 'root.proschi': 'import "more.proschi"\nusecase "Pay" {\n  a -> b\n}', 'more.proschi': 'usecase "Pay" {\n  a -> c\n}' };
    expect(parseWith(files, 'root.proschi').diagram.useCases.map((u) => u.id)).toEqual(['pay', 'pay-2']);
  });

  it('marks problems from imported files with the file, after the root document', () => {
    const files = { 'root.proschi': 'import "infra.proschi"\nz [Nope]', 'infra.proschi': 'x [Nope]\ngroup g {' };
    const { diagnostics } = parseWith(files, 'root.proschi');
    expect(diagnostics.map((d) => [d.file, d.line, d.severity])).toEqual([
      [undefined, 2, 'warning'],
      ['infra.proschi', 1, 'warning'],
      ['infra.proschi', 2, 'error'],
    ]);
  });

  it('only allows imports at the top level, with a string path', () => {
    const errs = (src: string) => parse(src, { resolve: () => undefined }).diagnostics.map((d) => d.message);
    expect(errs('group g {\n  import "x.proschi"\n}')).toEqual(['import is only allowed at the top level']);
    expect(errs('usecase "U" {\n  import "x.proschi"\n}')).toEqual(['import is only allowed at the top level']);
    expect(errs('import infra')).toEqual(['Expected a file path, e.g. import "infra.proschi"']);
    expect(errs('import "x.proschi" extra')).toEqual(["Cannot find 'x.proschi'", "Unexpected 'extra'"]);
  });
});

describe('imports and other checks', () => {
  it('counts connections from imported files for the missing-connection warning', () => {
    const files = { 'infra.proschi': infra, 'checkout.proschi': `${checkout}usecase "Audit" {\n  gateway -> db : GET /audit\n}\n` };
    const { diagnostics } = parseWith(files, 'checkout.proschi');
    // gateway -> orders and orders -> db are declared in infra.proschi; gateway -> db is not.
    expect(diagnostics.map((d) => [d.file, d.line, d.message])).toEqual([
      [undefined, 10, "No connection between 'gateway' and 'db' in the architecture; add 'gateway -> db'"],
    ]);
  });

  it('formats a document with imports idempotently, keeping the import lines', () => {
    const src = 'title "X"\n   import   "infra.proschi"  # base\nimport "teams/a b.proschi"\n\n\n\napi->db\nusecase "U" {\n  api -> db : GET /x\n}\n';
    const once = format(src);
    expect(once.split('\n').slice(1, 3)).toEqual(['import "infra.proschi" # base', 'import "teams/a b.proschi"']);
    expect(format(once)).toBe(once);
    expect(parse(once).imports?.map((i) => i.path)).toEqual(['infra.proschi', 'teams/a b.proschi']);
  });
});

describe('joinImportPath', () => {
  it('joins relative paths and normalises . and ..', () => {
    expect(joinImportPath('teams/shop.proschi', '../infra.proschi')).toBe('infra.proschi');
    expect(joinImportPath('a/b/c.proschi', './d/e.proschi')).toBe('a/b/d/e.proschi');
    expect(joinImportPath(undefined, 'x.proschi')).toBe('x.proschi');
    expect(joinImportPath('a.proschi', '../up.proschi')).toBe('../up.proschi');
  });

  it('falls back to the only file with the same name', () => {
    const resolve = mapResolver({ 'infra.proschi': 'a', 'x/other.proschi': 'b', 'y/other.proschi': 'c' });
    expect(resolve('lib/infra.proschi', 'root.proschi')).toEqual({ path: 'infra.proschi', source: 'a' });
    expect(resolve('other.proschi', 'root.proschi')).toBeUndefined();
  });
});
