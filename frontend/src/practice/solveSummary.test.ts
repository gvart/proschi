import { describe, expect, it } from 'vitest';
import type { RoadmapStage } from './roadmap';
import { compareToReference, roadmapAfterSolve } from './solveSummary';

const STAGES: RoadmapStage[] = [
  { id: 'one', title: 'One', why: 'x', problems: ['a', 'b'] },
  { id: 'two', title: 'Two', why: 'x', problems: ['c'] },
];

describe('compareToReference', () => {
  it('says how much better or worse, in percent or times', () => {
    expect(compareToReference(100, 100, 'cheaper', 'pricier')).toBe('the same as the reference');
    expect(compareToReference(88, 100, 'cheaper', 'pricier')).toBe('12% cheaper than the reference');
    expect(compareToReference(130, 100, 'faster', 'slower')).toBe('30% slower than the reference');
    expect(compareToReference(300, 100, 'faster', 'slower')).toBe('3× slower than the reference');
    expect(compareToReference(25, 100, 'cheaper', 'pricier')).toBe('4× cheaper than the reference');
    expect(compareToReference(1500, 100, 'cheaper', 'pricier')).toBe('15× pricier than the reference');
    expect(compareToReference(5, 0, 'cheaper', 'pricier')).toBe('the same as the reference');
  });
});

describe('roadmapAfterSolve', () => {
  it('names the next problem, and the stage the last of its problems completes', () => {
    expect(roadmapAfterSolve(STAGES, 'a', {})).toEqual({ next: 'b' });
    expect(roadmapAfterSolve(STAGES, 'b', { a: { status: 'solved' } })).toEqual({ completed: 0, next: 'c' });
    // Solved out of order: the stage is not complete, and the next is the first one left.
    expect(roadmapAfterSolve(STAGES, 'b', {})).toEqual({ next: 'a' });
    expect(roadmapAfterSolve(STAGES, 'c', { a: { status: 'solved' }, b: { status: 'solved' } })).toEqual({ completed: 1 });
  });

  it('completes nothing for a problem solved before or off the roadmap', () => {
    expect(roadmapAfterSolve(STAGES, 'c', { a: { status: 'solved' }, b: { status: 'solved' }, c: { status: 'solved' } })).toEqual({});
    expect(roadmapAfterSolve(STAGES, 'zzz', {})).toEqual({});
  });
});
