import { describe, expect, it } from 'vitest';
import { parseView } from './view';

describe('parseView', () => {
  it('knows the three views', () => {
    expect(parseView('diagram')).toBe('diagram');
    expect(parseView('results')).toBe('results');
    expect(parseView('hld')).toBe('hld');
  });

  it('sends the old Analysis and Tests tabs to Results', () => {
    expect(parseView('analysis')).toBe('results');
    expect(parseView('tests')).toBe('results');
  });

  it('ignores anything else', () => {
    expect(parseView(null)).toBeUndefined();
    expect(parseView(undefined)).toBeUndefined();
    expect(parseView('Tests')).toBeUndefined();
    expect(parseView('')).toBeUndefined();
  });
});
