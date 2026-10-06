import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { fixedLines, lockedLines, touchesFixed } from './codeExtensions';
import { breachDiagnostics } from './exportSource';
import type { Breach } from '../engine/run';

const doc = Text.of(['users "Users" [Actor]', 'api "App Server" [Service]', 'users -> api']);

describe('locked lines', () => {
  it('finds the declarations of fixed nodes, not their wires', () => {
    expect(fixedLines(doc, ['users'])).toEqual([{ from: 0, to: 21 }]);
  });

  it('refuses typing inside a fixed line, and passes edits around it', () => {
    const fixed = fixedLines(doc, ['users']);
    expect(touchesFixed(fixed, 5, 5)).toBe(true);
    expect(touchesFixed(fixed, 0, 21)).toBe(true);
    // At its ends (a new line before or after it) and across lines (select all, paste).
    expect(touchesFixed(fixed, 0, 0)).toBe(false);
    expect(touchesFixed(fixed, 21, 21)).toBe(false);
    expect(touchesFixed(fixed, 0, doc.length)).toBe(false);
  });

  it('as an editor extension, drops the change', () => {
    const state = EditorState.create({ doc, extensions: lockedLines(['users'], 'fixed') });
    expect(state.update({ changes: { from: 3, insert: 'x' } }).state.doc.toString()).toBe(doc.toString());
    expect(state.update({ changes: { from: doc.length, insert: '\nx' } }).state.doc.toString()).toBe(`${doc.toString()}\nx`);
  });
});

describe('breachDiagnostics', () => {
  const source = ['requirements {', '  p99 "Redirect" < 50ms', '}', '', 'api "App Server" [Service] x2', '', 'usecase "Redirect" {', '}'].join('\n');
  const breach = (b: Partial<Breach>): Breach => ({ kind: 'drop', message: 'm', trust: 1, learn: [], ...b });
  const name = (key: string) => (key === 'redirect' ? 'Redirect' : undefined);

  it('puts each breach on the line it is about', () => {
    const d = breachDiagnostics(source, [breach({ node: 'api', message: 'hot', hint: 'scale' }), breach({ kind: 'latency', useCase: 'redirect', message: 'slow' }), breach({ kind: 'unroutable', useCase: 'redirect', message: 'none' })], name);
    expect(d.map((x) => [x.line, x.message])).toEqual([
      [2, 'slow'],
      [5, 'hot scale'],
      [7, 'none'],
    ]);
    expect(d.every((x) => x.severity === 'warning')).toBe(true);
  });

  it('keeps one warning a line, and skips what it cannot place', () => {
    expect(breachDiagnostics(source, [breach({ node: 'api' }), breach({ node: 'api', message: 'again' }), breach({ node: 'nope' })], name)).toHaveLength(1);
  });
});
