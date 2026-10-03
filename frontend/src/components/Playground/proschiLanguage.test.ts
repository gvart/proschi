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

  it('stays quiet inside labels', () => {
    expect(complete('a -> b : POST /ord')).toBeNull();
  });
});
