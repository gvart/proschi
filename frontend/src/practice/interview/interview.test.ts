// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import listings from 'virtual:practice-listings';
import { interviewPool, NOT_IN_POOL, pickProblem, poolTopics } from './pick';
import { CUES } from './sounds';
import { autoSendLeft, AUTO_SEND_MS } from './autoSend';
import { loadDesign, loadDone, loadLast, recordStart, saveDesign } from './prefs';
import { interviewReducer, startSession } from '../modes/session';

const p = (id: string, difficulty: 'easy' | 'medium' | 'hard' = 'easy', tags: string[] = []) => ({ id, title: id, summary: '', difficulty, tags });

describe('the problem of a mock interview', () => {
  it('draws from every problem but the tutorial, narrowed by the filters', () => {
    const pool = interviewPool(listings);
    expect(pool.length).toBe(listings.length - NOT_IN_POOL.length);
    expect(pool.some((x) => x.id === 'hello-proschi')).toBe(false);
    expect(interviewPool(listings, { difficulty: 'hard' }).every((x) => x.difficulty === 'hard')).toBe(true);
    const [topic] = poolTopics(listings);
    expect(interviewPool(listings, { topic }).every((x) => x.tags.includes(topic))).toBe(true);
  });

  it('prefers problems not done yet, then any but the last one', () => {
    const pool = [p('a'), p('b'), p('c')];
    expect(pickProblem(pool, ['a', 'b'], () => 0.99)).toBe('c');
    expect(pickProblem(pool, [], () => 0)).toBe('a');
    expect(pickProblem(pool, [], () => 0.999)).toBe('c');
    // All done: never the same one twice in a row.
    for (const r of [0, 0.4, 0.99]) expect(pickProblem(pool, ['a', 'b', 'c'], () => r, 'b')).not.toBe('b');
    expect(pickProblem([p('a')], ['a'], () => 0.5, 'a')).toBe('a');
    expect(pickProblem([], [], () => 0.5)).toBeUndefined();
  });

  it('a run of new interviews goes through the pool before repeating', () => {
    const pool = interviewPool(listings);
    const done: string[] = [];
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < pool.length; i++) done.push(pickProblem(pool, done, random, done.at(-1))!);
    expect(new Set(done).size).toBe(pool.length);
  });
});

describe('what the room remembers', () => {
  beforeEach(() => localStorage.clear());

  it('the last interview and the problems done, most recent last', () => {
    expect(loadLast()).toBeUndefined();
    recordStart({ problem: 'a', kind: 'solo', minutes: 30 });
    recordStart({ problem: 'b', kind: 'mock', minutes: 45 });
    recordStart({ problem: 'a', kind: 'solo', minutes: 60 });
    expect(loadDone()).toEqual(['b', 'a']);
    expect(loadLast()).toEqual({ problem: 'a', kind: 'solo', minutes: 60 });
    localStorage.setItem('proschi.interview.last', '{"problem":"a","kind":"x","minutes":45}');
    expect(loadLast()).toBeUndefined();
  });

  it('the whiteboard per problem', () => {
    saveDesign('a', 'api');
    expect(loadDesign('a')).toBe('api');
    saveDesign('a', undefined);
    expect(loadDesign('a')).toBeUndefined();
  });
});

describe('sound cues', () => {
  it('are short and quiet', () => {
    for (const [cue, notes] of Object.entries(CUES)) {
      expect(notes.length, cue).toBeGreaterThan(0);
      const end = Math.max(...notes.map((n) => n.at + n.dur));
      expect(end, cue).toBeLessThan(1);
      for (const n of notes) expect(n.gain ?? 1).toBeLessThanOrEqual(1);
    }
  });
});

describe('send on silence', () => {
  const draft = { text: 'How many links a month?', interim: '', heardAt: 1000, cancelled: false };
  it('counts down from the last words heard', () => {
    expect(autoSendLeft(draft, 1000)).toBe(AUTO_SEND_MS);
    expect(autoSendLeft(draft, 1000 + AUTO_SEND_MS - 300)).toBe(300);
    expect(autoSendLeft(draft, 9999)).toBe(0);
  });
  it('waits while words are still coming, for an empty box and after a cancel', () => {
    expect(autoSendLeft({ ...draft, interim: 'and the' }, 9999)).toBeUndefined();
    expect(autoSendLeft({ ...draft, text: '  ' }, 9999)).toBeUndefined();
    expect(autoSendLeft({ ...draft, cancelled: true }, 9999)).toBeUndefined();
    expect(autoSendLeft({ ...draft, heardAt: undefined }, 9999)).toBeUndefined();
  });
});

describe('finishing an interview on your own early', () => {
  it('stops the clock in whatever phase it is', () => {
    let s = startSession('a', 30, 0);
    s = interviewReducer(s, { type: 'advance', now: 60_000 });
    s = interviewReducer(s, { type: 'finish', now: 90_000 });
    expect(s.finishedAt).toBe(90_000);
    expect(s.phase).toBe('estimate');
    expect(s.spent.estimate).toBe(30_000);
    expect(s.runningSince).toBeUndefined();
  });
});
