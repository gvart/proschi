import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { StringStream } from '@codemirror/language';
import { CompletionContext } from '@codemirror/autocomplete';
import { parse } from '../../dsl';
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
});

const complete = (doc: string, explicit = false) => {
  const state = EditorState.create({ doc });
  return proschiCompletions(() => ['gateway', 'orders'])(new CompletionContext(state, doc.length, explicit));
};

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

  it('stays quiet inside labels', () => {
    expect(complete('a -> b : POST /ord')).toBeNull();
  });
});
