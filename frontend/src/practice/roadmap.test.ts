import { describe, expect, it } from 'vitest';
import { problems } from './catalog';
import { ROADMAP, roadmapFor, roadmapState, validateRoadmap, type RoadmapStage } from './roadmap';
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
