import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMistakes, MAX_MISTAKES, readMistakes, recordMistake } from './recentMistakes';

describe('recent mistakes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the latest per problem, newest first, at most MAX_MISTAKES', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    recordMistake('chat', 'A', 1);
    recordMistake('kv', 'B', 2);
    recordMistake('chat', 'C', 3);
    expect(loadMistakes()).toEqual([
      { problem: 'chat', title: 'C', at: 3 },
      { problem: 'kv', title: 'B', at: 2 },
    ]);
    for (let i = 0; i < MAX_MISTAKES + 5; i++) recordMistake(`p${i}`, 'X', 10 + i);
    expect(loadMistakes()).toHaveLength(MAX_MISTAKES);
    expect(loadMistakes()[0].problem).toBe(`p${MAX_MISTAKES + 4}`);
  });

  it('drops anything malformed', () => {
    expect(readMistakes({})).toEqual([]);
    expect(readMistakes([null, { problem: '__proto__', title: 'A', at: 1 }, { problem: 'a', title: 2, at: 1 }, { problem: 'a', title: 'A', at: 1.5 }, { problem: 'b', title: 'B', at: 4 }])).toEqual([
      { problem: 'b', title: 'B', at: 4 },
    ]);
  });
});
