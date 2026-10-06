import { describe, expect, it } from 'vitest';
import { problems } from './catalog';
import { OPTIONAL_STEPS, ROADMAP, requiredStages, roadmapAccess, roadmapFor, roadmapState, roadmapTarget, stepLock, unlockHint, validateRoadmap, type RoadmapStage } from './roadmap';
import type { Progress } from './progress';
import { roadmapAfterSolve } from './solveSummary';
import { ruleProgress, type StatsSnapshot } from '../learn/achievements';

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

  it('opens the first stage signed out, in order, and locks the stages after it', () => {
    const fresh = roadmapState(roadmap, {});
    expect(stepLock(fresh, 'a', 'sign-in')).toEqual({ kind: 'open' });
    expect(stepLock(fresh, 'b', 'sign-in')).toEqual({ kind: 'order', next: 'a' });
    const state = roadmapState(roadmap, solved('a', 'b'));
    expect(stepLock(state, 'c', 'sign-in')).toEqual({ kind: 'sign-in' });
    expect(unlockHint(stepLock(state, 'c', 'sign-in'), title)).toBe('Sign in to continue past stage 1');
  });

  it('waits while the account loads', () => {
    const state = roadmapState(roadmap, solved('a'));
    expect(stepLock(state, 'a', 'checking')).toEqual({ kind: 'checking' });
  });

  it('opens the tutorial signed out: the first step, which teaches the language', () => {
    expect(OPTIONAL_STEPS).toEqual(['hello-proschi']);
    expect(ROADMAP[0].problems[0]).toBe('hello-proschi');
    const state = roadmapState(stages(['hello-proschi', 'a'], ['b']), {});
    expect(stepLock(state, 'hello-proschi', 'sign-in')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'hello-proschi', 'checking')).toEqual({ kind: 'checking' });
    // The unsolved tutorial locks nothing: the rest of the first stage is open signed out too, the stages after it take an account.
    expect(stepLock(state, 'a', 'sign-in')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'b', 'sign-in')).toEqual({ kind: 'sign-in' });
    // Wherever it sits, the tutorial opens signed out.
    expect(stepLock(roadmapState(stages(['a'], ['hello-proschi']), {}), 'hello-proschi', 'sign-in')).toEqual({ kind: 'open' });
  });

  it('never locks anything behind the tutorial: an existing learner keeps stage 2 open and stage 1 complete', () => {
    const [foundations, caching] = ROADMAP;
    expect(foundations.problems[0]).toBe('hello-proschi');
    // Everything of stage 1 solved before the tutorial existed.
    const old = solved(...foundations.problems.filter((id) => id !== 'hello-proschi'));
    const state = roadmapState(ROADMAP, old);
    expect(state.steps.filter((s) => s.stage === 1).map((s) => [s.id, s.locked])).toEqual(caching.problems.map((id, i) => [id, i > 0]));
    expect(stepLock(state, caching.problems[0], 'open')).toEqual({ kind: 'open' });
    expect(state.next?.id).toBe(caching.problems[0]);
    expect(state.currentStage).toBe(1);
    // The tutorial stays open and unsolved, and a later locked step waits for the first required one.
    expect(state.steps[0]).toMatchObject({ id: 'hello-proschi', status: 'todo', locked: false, optional: true });
    expect(stepLock(state, caching.problems[1], 'open')).toEqual({ kind: 'order', next: caching.problems[0] });
    // Stage 1 counts as complete: solving its last required problem completes it; solving the tutorial afterwards does not again.
    const last = foundations.problems.at(-1)!;
    const before = solved(...foundations.problems.filter((id) => id !== 'hello-proschi' && id !== last));
    expect(roadmapAfterSolve(ROADMAP, last, before)).toEqual({ completed: 0, next: caching.problems[0] });
    expect(roadmapAfterSolve(ROADMAP, 'hello-proschi', old).completed).toBeUndefined();
    // The Foundations badge counts the required problems only.
    expect(requiredStages(ROADMAP)[0].problems).not.toContain('hello-proschi');
    const context = { problems: problems.map((p) => ({ id: p.id, difficulty: p.difficulty, tags: p.tags })), stages: requiredStages(ROADMAP) };
    const snapshot = { solved: foundations.problems.filter((id) => id !== 'hello-proschi').map((id) => ({ id, firstRun: false, underReference: false })) } as Partial<StatsSnapshot> as StatsSnapshot;
    expect(ruleProgress({ kind: 'stage', stage: 'foundations' }, snapshot, context)).toEqual({ current: 4, target: 4 });
  });

  it('recommends the tutorial to a learner who has solved nothing, without locking the first required step', () => {
    const state = roadmapState(ROADMAP, {});
    expect(state.next?.id).toBe('hello-proschi');
    expect(state.blocker?.id).toBe(ROADMAP[0].problems[1]);
    expect(state.steps[1]).toMatchObject({ id: ROADMAP[0].problems[1], locked: false });
    expect(state.steps[2].locked).toBe(true);
  });

  it('leaves a problem that is not on the roadmap to the account alone', () => {
    const state = roadmapState(roadmap, {});
    expect(stepLock(state, 'elsewhere', 'open')).toEqual({ kind: 'open' });
    expect(stepLock(state, 'elsewhere', 'sign-in')).toEqual({ kind: 'sign-in' });
    expect(unlockHint({ kind: 'open' }, title)).toBeUndefined();
  });
});
