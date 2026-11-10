import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { StringStream } from '@codemirror/language';
import { CompletionContext } from '@codemirror/autocomplete';
import { builtinTypes, parse } from '../../dsl';
import { proschiCompletions, proschiStreamParser, toCmDiagnostics } from './proschiLanguage';

/** [text, style] for each non-blank token of one line. */
function highlight(line: string): [string, string | null][] {
  const parser = proschiStreamParser;
  const state = parser.startState!(2);
  const stream = new StringStream(line, 2, 2);
  const out: [string, string | null][] = [];
  while (!stream.eol()) {
    const style = parser.token(stream, state);
    const text = stream.current();
    if (text.trim()) out.push([text, style]);
    stream.start = stream.pos;
  }
  return out;
}

/** [text, style] per line, keeping the tokenizer state from line to line like the editor does. */
function highlightDoc(source: string): [string, string | null][][] {
  const parser = proschiStreamParser;
  const state = parser.startState!(2);
  return source.split('\n').map((line) => {
    const stream = new StringStream(line, 2, 2);
    const out: [string, string | null][] = [];
    while (!stream.eol()) {
      const style = parser.token(stream, state);
      const text = stream.current();
      if (text.trim()) out.push([text, style]);
      stream.start = stream.pos;
    }
    return out;
  });
}

describe('proschiLanguage', () => {
  it('highlights when only after an alt name', () => {
    expect(highlight('} alt "Missing" when "no such order" {')).toEqual([
      ['}', 'brace'],
      ['alt', 'keyword'],
      ['"Missing"', 'string'],
      ['when', 'keyword'],
      ['"no such order"', 'string'],
      ['{', 'brace'],
    ]);
    expect(highlight('alt Missing when "x" {')[2]).toEqual(['when', 'keyword']);
    expect(highlight('when -> api')[0]).toEqual(['when', 'variableName']);
    expect(highlight('a -> when')[2]).toEqual(['when', 'variableName']);
  });

  it('highlights import as a keyword', () => {
    expect(highlight('import "infra.proschi"')).toEqual([
      ['import', 'keyword'],
      ['"infra.proschi"', 'string'],
    ]);
    expect(highlight('importer -> db')[0]).toEqual(['importer', 'variableName']);
  });
});

describe('section highlighting', () => {
  const styleOf = (lines: [string, string | null][][], line: number, text: string) => lines[line].find(([t]) => t === text)?.[1];

  it('highlights section words only in section blocks', () => {
    const lines = highlightDoc(
      [
        'traffic {',
        '  "Redirect" 100k rps mix "Cache hit" 90%, "Cache miss" 10%',
        '}',
        'requirements {',
        '  p99 "Redirect" < 50ms',
        '  survive failure of any cache',
        '  cost <= 3000 usd/month',
        '}',
        'mix -> any',
      ].join('\n'),
    );
    expect(lines[0]).toEqual([
      ['traffic', 'keyword'],
      ['{', 'brace'],
    ]);
    expect(lines[1]).toEqual([
      ['"Redirect"', 'string'],
      ['100k rps', 'number'],
      ['mix', 'keyword'],
      ['"Cache hit"', 'string'],
      ['90%', 'number'],
      [',', 'punctuation'],
      ['"Cache miss"', 'string'],
      ['10%', 'number'],
    ]);
    expect(lines[4]).toEqual([
      ['p99', 'keyword'],
      ['"Redirect"', 'string'],
      ['<', 'operator'],
      ['50ms', 'number'],
    ]);
    expect(lines[5].map(([, style]) => style)).toEqual(['keyword', 'keyword', 'keyword', 'keyword', 'variableName']);
    expect(styleOf(lines, 6, '3000 usd/month')).toBe('number');
    // Outside a section the same words are ids.
    expect(lines[8]).toEqual([
      ['mix', 'variableName'],
      ['->', 'operator'],
      ['any', 'variableName'],
    ]);
  });

  it('highlights entity, decision and test blocks and the one-line decision', () => {
    const lines = highlightDoc(
      [
        'entity Url in db "Codes" {',
        '  code string key',
        '}',
        'decision "Cache" {',
        '  rejected "Memcached" "no replication"',
        '}',
        'decision "Base62" because "short"',
        'test "Cache first" {',
        '  "Redirect" scenario "Hit" never calls any database',
        '  api has replicas >= 2',
        '}',
      ].join('\n'),
    );
    expect(lines[0].map(([, style]) => style)).toEqual(['keyword', 'variableName', 'keyword', 'variableName', 'string', 'brace']);
    expect(styleOf(lines, 1, 'key')).toBe('keyword');
    expect(styleOf(lines, 4, 'rejected')).toBe('keyword');
    expect(styleOf(lines, 6, 'decision')).toBe('keyword');
    expect(styleOf(lines, 6, 'because')).toBe('keyword');
    expect(lines[8].filter(([, style]) => style === 'keyword').map(([t]) => t)).toEqual(['scenario', 'never', 'calls', 'any']);
    expect(lines[9]).toEqual([
      ['api', 'variableName'],
      ['has', 'keyword'],
      ['replicas', 'keyword'],
      ['>=', 'operator'],
      ['2', 'number'],
    ]);
  });

  it('keeps nodes named like section keywords, and highlights replicas', () => {
    const lines = highlightDoc('test "Runner" [REST API]\napi "API" [REST API] x3\nx3 [Redis]');
    expect(lines[0][0]).toEqual(['test', 'variableName']);
    expect(styleOf(lines, 1, 'x3')).toBe('number');
    expect(lines[2][0]).toEqual(['x3', 'variableName']);
  });

  it('highlights constants: the let line and each use', () => {
    const lines = highlightDoc('let peak = 120k rps\nlet [REST API]\napi [REST API] x$n\ntraffic {\n  "Read" $peak\n}');
    expect(lines[0]).toEqual([
      ['let', 'keyword'],
      ['peak', 'variableName'],
      ['=', 'operator'],
      ['120k rps', 'number'],
    ]);
    expect(lines[1][0]).toEqual(['let', 'variableName']);
    expect(styleOf(lines, 2, 'x$n')).toBe('atom');
    expect(styleOf(lines, 4, '$peak')).toBe('atom');
  });

  it('highlights budgets, retries, drain rates and lag', () => {
    const lines = highlightDoc('requirements {\n  cost @Payments <= 500 usd/month\n  cost group checkout <= 5 usd/month\n  lag "Pay" < 30s\n}\ncapacity {\n  pay errors 2% retries 3 drain 5k rps\n}');
    expect(styleOf(lines, 1, '@Payments')).toBe('attributeName');
    expect(styleOf(lines, 2, 'group')).toBe('keyword');
    expect(styleOf(lines, 3, 'lag')).toBe('keyword');
    expect(styleOf(lines, 6, 'errors')).toBe('keyword');
    expect(styleOf(lines, 6, 'retries')).toBe('keyword');
    expect(styleOf(lines, 6, 'drain')).toBe('keyword');
  });

  it('highlights the v2 words, units and label prefixes', () => {
    const lines = highlightDoc(
      [
        'test "T" {',
        '  "U" never waits for any queue or any eventual store',
        '  in "U" api calls db after cache',
        '  "U" starts at any strong store',
        '}',
        'capacity {',
        '  db reads 30k rps writes 8k rps shards 4 consistency strong bandwidth 500 MB/s egress 0.05 usd/GB',
        '}',
        'usecase "U" {',
        '  worker -> feeds : x200 ~2MB LPUSH feed',
        '  a -> b : xml x200',
        '}',
      ].join('\n'),
    );
    const keywords = (i: number) => lines[i].filter(([, s]) => s === 'keyword').map(([t]) => t);
    expect(keywords(1)).toEqual(['never', 'waits', 'for', 'any', 'or', 'any', 'eventual', 'store']);
    expect(keywords(2)).toEqual(['in', 'calls', 'after']);
    expect(keywords(3)).toEqual(['starts', 'at', 'any', 'strong', 'store']);
    expect(keywords(6)).toEqual(['reads', 'writes', 'shards', 'consistency', 'strong', 'bandwidth', 'egress']);
    expect(styleOf(lines, 6, '500 MB/s')).toBe('number');
    expect(styleOf(lines, 6, '0.05 usd/GB')).toBe('number');
    expect(styleOf(lines, 9, 'x200')).toBe('number');
    expect(styleOf(lines, 9, '~2MB')).toBe('number');
    expect(styleOf(lines, 9, 'LPUSH')).not.toBe('number');
    expect(styleOf(lines, 10, 'x200')).toBeUndefined();
  });
});

const complete = (doc: string, explicit = false) => {
  const state = EditorState.create({ doc });
  return proschiCompletions(() => ['gateway', 'orders'])(new CompletionContext(state, doc.length, explicit));
};

describe('style highlighting', () => {
  it('highlights color, critical, tags, palette names and hex colors', () => {
    expect(highlight('api "API" [Go] color teal critical .owned')).toEqual([
      ['api', 'variableName'],
      ['"API"', 'string'],
      ['[Go]', 'typeName'],
      ['color', 'keyword'],
      ['teal', 'atom'],
      ['critical', 'keyword'],
      ['.owned', 'attributeName'],
    ]);
    expect(highlight('db color #3b82f6 # a comment')).toEqual([
      ['db', 'variableName'],
      ['color', 'keyword'],
      ['#3b82f6', 'atom'],
      ['# a comment', 'comment'],
    ]);
    const edge = highlight('a -> b .planned : x .y');
    expect(edge.slice(0, 5)).toEqual([
      ['a', 'variableName'],
      ['->', 'operator'],
      ['b', 'variableName'],
      ['.planned', 'attributeName'],
      [':', 'punctuation'],
    ]);
    // After the colon a dot word is part of the label.
    expect(edge.slice(5).every(([, style]) => style === 'string')).toBe(true);
    expect(highlight('teal -> db')[0]).toEqual(['teal', 'variableName']);
  });

  it('highlights the layout hints, and nodes named like them', () => {
    expect(highlight('direction right')).toEqual([
      ['direction', 'keyword'],
      ['right', 'atom'],
    ]);
    expect(highlight('  layout ordered # tidy')).toEqual([
      ['layout', 'keyword'],
      ['ordered', 'atom'],
      ['# tidy', 'comment'],
    ]);
    expect(highlight('api [Go] rank 2 x2')).toEqual([
      ['api', 'variableName'],
      ['[Go]', 'typeName'],
      ['rank', 'keyword'],
      ['2', 'number'],
      ['x2', 'number'],
    ]);
    expect(highlight('group g "G" rank last {').slice(3, 5)).toEqual([
      ['rank', 'keyword'],
      ['last', 'atom'],
    ]);
    expect(highlight('direction [Go]')[0]).toEqual(['direction', 'variableName']);
    expect(highlight('layout -> rank')).toEqual([
      ['layout', 'variableName'],
      ['->', 'operator'],
      ['rank', 'variableName'],
    ]);
  });

  it('highlights the legend block', () => {
    const lines = highlightDoc('legend {\n  planned "Planned" blue dashed\n  blue "B" color #fff\n}\nblue [Go]');
    expect(lines[0][0]).toEqual(['legend', 'keyword']);
    expect(lines[1]).toEqual([
      ['planned', 'variableName'],
      ['"Planned"', 'string'],
      ['blue', 'atom'],
      ['dashed', 'keyword'],
    ]);
    expect(lines[2]).toEqual([
      ['blue', 'variableName'],
      ['"B"', 'string'],
      ['color', 'keyword'],
      ['#fff', 'atom'],
    ]);
    expect(lines[4][0]).toEqual(['blue', 'variableName']);
  });
});

describe('toCmDiagnostics', () => {
  it('maps line/column to document offsets', () => {
    const src = 'a\nb [Nope]';
    const [d] = toCmDiagnostics(parse(src).diagnostics, Text.of(src.split('\n')));
    expect(src.slice(d.from, d.to)).toBe('[Nope]');
    expect(d.severity).toBe('warning');
  });

  it('clamps ranges to the line and drops lines past the end', () => {
    const doc = Text.of(['abc']);
    expect(toCmDiagnostics([{ severity: 'error', message: 'x', line: 1, col: 2, length: 99 }], doc)).toEqual([
      { from: 1, to: 3, severity: 'error', message: 'x' },
    ]);
    expect(toCmDiagnostics([{ severity: 'error', message: 'x', line: 5, col: 1, length: 1 }], doc)).toEqual([]);
  });
});

describe('proschiCompletions', () => {
  it('offers tech stacks inside brackets', () => {
    const result = complete('db [Postg');
    expect(result?.from).toBe(4);
    expect(result?.options.map((o) => o.label)).toContain('PostgreSQL');
  });

  it('offers keywords and ids at the start of a line', () => {
    const labels = complete('or')?.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['usecase', 'group', 'alt', 'import', 'orders']));
  });

  it('offers only ids after an arrow', () => {
    const labels = complete('gateway -> o')?.options.map((o) => o.label);
    expect(labels).toEqual(['gateway', 'orders']);
  });

  it('offers when right after an alt name', () => {
    expect(complete('  alt "Missing" w')?.options.map((o) => o.label)).toEqual(['when']);
    expect(complete('  } alt "B" ', true)?.options.map((o) => o.label)).toEqual(['when']);
  });

  it('offers the section keywords as snippets at the start of a line', () => {
    const options = complete('te')!.options;
    for (const label of ['traffic', 'requirements', 'capacity', 'entity', 'decision', 'test']) {
      expect(options.find((o) => o.label === label), label).toMatchObject({ type: 'keyword', apply: expect.any(Function) });
    }
  });

  it('offers assertions at the start of a line inside a test block', () => {
    const labels = complete('test "T" {\n  "U" calls db\n  ne', true)?.options.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['"Use case" never waits for', '"Use case" calls … after …', 'node never calls node', 'gateway']));
    expect(labels).not.toContain('usecase');
    expect(complete('test "T" {\n}\nus')?.options.map((o) => o.label)).toContain('usecase');
  });

  it('offers the operations and headers of the node types after uses and sends header', () => {
    const ops = complete('db [PostgreSQL]\ntest "T" {\n  "U" uses ', true)?.options.map((o) => o.label);
    expect(ops).toEqual(expect.arrayContaining(['SELECT', 'INSERT']));
    const headers = complete('api [REST API]\ntest "T" {\n  "U" sends header ', true)?.options.map((o) => o.label);
    expect(headers).toEqual(expect.arrayContaining(['Authorization', 'Idempotency-Key']));
    expect(complete('test "T" {\n  ', true)?.options.map((o) => o.label)).toEqual(expect.arrayContaining(['"Use case" uses … on', '"Use case" sends header … to']));
  });

  it('stays quiet inside labels', () => {
    expect(complete('a -> b : POST /ord')).toBeNull();
  });
});

describe('types', () => {
  // Type and op names come from the stdlib, so the tests follow whatever it ships.
  const builtin = [...builtinTypes().values()];
  const withOps = builtin.find((t) => !t.abstract && t.ops.length > 0 && /^\w+$/.test(t.name))!;
  const http = builtin.find((t) => !t.abstract && t.statuses.length > 0 && t.headers.length > 0)!;

  it('highlights type headers and bodies', () => {
    const lines = highlightDoc(
      [
        `abstract type Store extends ${withOps.name} {`,
        '  kind database',
        '  op read SELECT, Scan latency 8 cost 2',
        '  header Authorization, Content-Type',
        '  doc "Keeps things"',
        '}',
        'type Ledger extends Store { op write APPEND }',
        'type "T" [Go]',
        'usecase "U" {',
        '  a -> b : GET /x header Authorization, Idempotency-Key',
        '}',
      ].join('\n'),
    );
    expect(lines[0]).toEqual([
      ['abstract', 'keyword'],
      ['type', 'keyword'],
      ['Store', 'typeName'],
      ['extends', 'keyword'],
      [withOps.name, 'typeName'],
      ['{', 'brace'],
    ]);
    expect(lines[1]).toEqual([
      ['kind', 'keyword'],
      ['database', 'atom'],
    ]);
    expect(lines[2].slice(0, 3)).toEqual([
      ['op', 'keyword'],
      ['read', 'keyword'],
      ['SELECT', 'variableName'],
    ]);
    expect(lines[2]).toContainEqual(['latency', 'keyword']);
    expect(lines[2]).toContainEqual(['cost', 'keyword']);
    expect(lines[3]).toEqual([
      ['header', 'keyword'],
      ['Authorization', 'propertyName'],
      [',', 'punctuation'],
      ['Content-Type', 'propertyName'],
    ]);
    expect(lines[4][0]).toEqual(['doc', 'keyword']);
    expect(lines[6].slice(4)).toEqual([
      ['{', 'brace'],
      ['op', 'keyword'],
      ['write', 'keyword'],
      ['APPEND', 'variableName'],
      ['}', 'brace'],
    ]);
    // Not a type header: a node called type.
    expect(lines[7][0]).toEqual(['type', 'variableName']);
    expect(lines[9]).toContainEqual(['header', 'keyword']);
    expect(lines[9]).toContainEqual(['Idempotency-Key', 'propertyName']);
  });

  it('offers built-in and declared types in brackets and after extends', () => {
    const options = complete('type Mine { kind cache }\nx [M')!.options;
    expect(options[0]).toMatchObject({ label: 'Mine', type: 'class' });
    expect(options.filter((o) => o.label === withOps.name)).toHaveLength(1);
    expect(options.find((o) => o.label === 'Component')?.detail).toMatch(/^abstract/);
    // Aliases still insert their tech.
    expect(options.some((o) => o.detail?.startsWith('→'))).toBe(true);
    const parents = complete('type X extends ')!;
    expect(parents.from).toBe(15);
    expect(parents.options.map((o) => o.label)).toContain(withOps.name);
  });

  it('offers property words, kinds and op access in a type body', () => {
    expect(complete('type X {\n  ', true)?.options.map((o) => o.label)).toEqual(expect.arrayContaining(['kind', 'op', 'header', 'doc', 'latencyMs']));
    expect(complete('type X {\n  kind ', true)?.options).toHaveLength(17);
    expect(complete('type X {\n  op ', true)?.options.map((o) => o.label)).toEqual(['read', 'write', 'forward']);
    expect(complete('type X {\n}\nus')?.options.map((o) => o.label)).toContain('usecase');
    expect(complete('ty')?.options.map((o) => o.label)).toEqual(expect.arrayContaining(['type', 'abstract type']));
  });

  it("offers a step's operations, a response's statuses and the target's headers", () => {
    const ops = complete(`db "DB" [${withOps.name}]\na -> db\nusecase "U" {\n  a -> db : `, true)!;
    expect(ops.options.map((o) => o.label)).toEqual(withOps.ops.map((o) => o.name));
    const api = `api "API" [${http.name}]\nweb -> api\nusecase "U" {\n`;
    expect(complete(`${api}  api --> web : `, true)!.options.map((o) => o.label)).toEqual(http.statuses.map(String));
    expect(complete(`${api}  web -> api : GET /x header `, true)!.options.map((o) => o.label)).toEqual(http.headers);
    expect(complete(`${api}  web -> api : GET /x `, true)!.options.map((o) => o.label)).toEqual(['header']);
    // A connection label outside a use case stays free text.
    expect(complete(`db "DB" [${withOps.name}]\na -> db : `, true)).toBeNull();
  });
});
