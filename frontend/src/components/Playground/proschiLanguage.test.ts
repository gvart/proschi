import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { parse } from '../../dsl';
import { proschiCompletions, toCmDiagnostics } from './proschiLanguage';

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
    expect(labels).toEqual(expect.arrayContaining(['usecase', 'group', 'alt', 'orders']));
  });

  it('offers only ids after an arrow', () => {
    const labels = complete('gateway -> o')?.options.map((o) => o.label);
    expect(labels).toEqual(['gateway', 'orders']);
  });

  it('stays quiet inside labels', () => {
    expect(complete('a -> b : POST /ord')).toBeNull();
  });
});
