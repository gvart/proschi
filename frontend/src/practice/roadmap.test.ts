import { describe, expect, it } from 'vitest';
import { problems } from './catalog';
import { OPEN_STEPS, ROADMAP, roadmapAccess, roadmapFor, roadmapState, roadmapTarget, stepLock, unlockHint, validateRoadmap, type RoadmapStage } from './roadmap';
import type { Progress } from './progress';

/**
 * Problems the roadmap lists before their folders are merged. Empty this list
 * once they exist: the test below fails while a pending id is a real problem.
 */
const PENDING: string[] = [];

const stages = (...lists: string[][]): RoadmapStage[] => lists.map((problems, i) => ({ id: `s${i}`, title: `Stage ${i}`, why: 'Because.', problems }));
const solved = (...ids: string[]): Progress => Object.fromEntries(ids.map((id) => [id, { status: 'solved' as const }]));

describe('the roadmap', () => {
  const ids = new Set(problems.map((p) => p.id));
  const listed = ROADMAP.flatMap((s) => s.problems);

  it('is valid', () => expect(validateRoadmap(ROADMAP)).toEqual([]));

  it('lists only problems that exist (or are pending)', () => {
    expect(listed.filter((id) => !ids.has(id) && !PENDING.includes(id))).toEqual([]);
  });

  it('has no pending problem that already exists', () => {
    expect(PENDING.filter((id) => ids.has(id))).toEqual([]);
  });

  it('lists every problem', () => {
    expect(problems.map((p) => p.id).filter((id) => !listed.includes(id))).toEqual([]);
  });

  it('does not clash with a problem id', () => expect(ids.has('roadmap')).toBe(false));
});

describe('validateRoadmap', () => {
  it('reports repeated problems and stages, bad ids and empty stages', () => {
    const bad: RoadmapStage[] = [
      { id: 'a', title: 'A', why: 'x', problems: ['one', 'two'] },
      { id: 'a', title: ' ', why: '', problems: ['two', 'Bad_Id'] },
      { id: 'Nope', title: 'C', why: 'x', problems: [] },
    ];
    expect(validateRoadmap(bad)).toEqual([
      'Stage "a" appears twice',
      'Stage "a" has no title',
      'Stage "a" does not say what it teaches',
      'Stage "a": "two" is already in stage "a"',
      'Stage "a": "Bad_Id" is not a problem id',
      'Stage "Nope": the id must be lowercase words joined by "-"',
      'Stage "Nope" has no problems',
    ]);
    expect(validateRoadmap([])).toEqual(['The roadmap has no stages']);
  });
});

describe('roadmapFor', () => {
  it('skips problems that do not exist and drops stages left empty', () => {
    expect(roadmapFor(stages(['a', 'x']), ['a']).map((s) => s.problems)).toEqual([['a']]);
    expect(roadmapFor(stages(['x'], ['b', 'a']), ['a', 'b']).map((s) => s.problems)).toEqual([['b', 'a']]);
  });
});

describe('roadmapState', () => {
  const roadmap = stages(['a', 'b'], ['c']);
  const locked = (progress: Progress) => roadmapState(roadmap, progress).steps.filter((s) => s.locked).map((s) => s.id);

  it('opens only the first problem at the start', () => {
    const state = roadmapState(roadmap, {});
    expect(locked({})).toEqual(['b', 'c']);
    expect(state).toMatchObject({ solved: 0, next: { id: 'a', stage: 0 }, currentStage: 0 });
  });

  it('unlocks a problem once every earlier one is solved', () => {
    expect(locked(solved('a'))).toEqual(['c']);
    expect(locked(solved('a', 'b'))).toEqual([]);
    expect(roadmapState(roadmap, solved('a', 'b'))).toMatchObject({ solved: 2, next: { id: 'c' }, currentStage: 1 });
  });

  it('does not unlock on an attempt', () => {
    expect(locked({ a: { status: 'attempted' } })).toEqual(['b', 'c']);
  });

  it('keeps a problem solved out of order open, and the ones after the gap locked', () => {
    const state = roadmapState(roadmap, solved('b'));
    expect(locked(solved('b'))).toEqual(['c']);
    expect(state).toMatchObject({ solved: 1, next: { id: 'a' } });
  });

  it('has no next problem when every one is solved', () => {
    const state = roadmapState(roadmap, solved('a', 'b', 'c'));
    expect(state.next).toBeUndefined();
    expect(state).toMatchObject({ solved: 3, currentStage: 1 });
  });
});

describe('roadmapAccess', () => {
  it('takes an account to start, when the build has accounts', () => {
    expect(roadmapAccess({ status: 'signed-out', providers: ['github'] })).toBe('sign-in');
    expect(roadmapAccess({ status: 'loading' })).toBe('checking');
    expect(roadmapAccess({ status: 'signed-in', user: { id: 'u1', displayName: 'Ada', publicProfile: false }, providers: [] })).toBe('open');
  });

  it('is open in a build without accounts', () => expect(roadmapAccess({ status: 'off' })).toBe('open'));
});

describe('roadmapTarget', () => {
  it('reads a step and whether it opens on its lesson', () => {
    expect(roadmapTarget('roadmap/pastebin')).toEqual({ id: 'pastebin', lesson: false });
    expect(roadmapTarget('roadmap/pastebin/lesson')).toEqual({ id: 'pastebin', lesson: true });
  });

  it('is undefined off the roadmap', () => {
    expect(roadmapTarget('roadmap')).toBeUndefined();
    expect(roadmapTarget('roadmap/')).toBeUndefined();
    expect(roadmapTarget('pastebin/lesson')).toBeUndefined();
  });
});

describe('stepLock', () => {
  const roadmap = stages(['a', 'b'], ['c']);
  const title = (id: string) => id.toUpperCase();

  it('locks a step, lesson and challenge alike, until every step before it is solved', () => {
    const state = roadmapState(roadmap, solved('a'));
    expect(stepLock(state, 'a', 'open')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'b', 'open')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'c', 'open')).toEqual({ kind: 'order', next: 'b' });
    expect(unlockHint(stepLock(state, 'c', 'open'), title)).toBe('Solve B first');
  });

  it('keeps a step solved out of order open', () => {
    expect(stepLock(roadmapState(roadmap, solved('c')), 'c', 'open')).toEqual({ kind: 'open' });
  });

  it('locks every step signed out, and waits while the account loads', () => {
    const state = roadmapState(roadmap, solved('a'));
    expect(stepLock(state, 'a', 'sign-in')).toEqual({ kind: 'sign-in' });
    expect(unlockHint(stepLock(state, 'a', 'sign-in'), title)).toBe('Sign in to start the roadmap');
    expect(stepLock(state, 'a', 'checking')).toEqual({ kind: 'checking' });
  });

  it('opens the tutorial signed out: the first step, which teaches the language', () => {
    expect(OPEN_STEPS).toEqual(['hello-proschi']);
    expect(ROADMAP[0].problems[0]).toBe('hello-proschi');
    const state = roadmapState(stages(['hello-proschi', 'a']), {});
    expect(stepLock(state, 'hello-proschi', 'sign-in')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'hello-proschi', 'checking')).toEqual({ kind: 'checking' });
    expect(stepLock(state, 'a', 'sign-in')).toEqual({ kind: 'sign-in' });
  });

  it('leaves a problem that is not on the roadmap to the account alone', () => {
    const state = roadmapState(roadmap, {});
    expect(stepLock(state, 'elsewhere', 'open')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'elsewhere', 'sign-in')).toEqual({ kind: 'sign-in' });
    expect(unlockHint({ kind: 'open' }, title)).toBeUndefined();
  });
});
