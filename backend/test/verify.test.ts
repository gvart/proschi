import { describe, expect, it } from 'vitest';
import { findProblem, problemIds, verify } from '../src/verify';

describe('verify', () => {
  it('knows every problem folder', () => {
    expect(problemIds().length).toBeGreaterThan(5);
    expect(findProblem('url-shortener')?.title).toBeTruthy();
    expect(findProblem('nope')).toBeUndefined();
    expect(findProblem('__proto__')).toBeUndefined();
  });

  for (const id of problemIds()) {
    it(`${id}: the reference solution solves it, with its cost and p99; the starter and wrong designs do not`, () => {
      const problem = findProblem(id)!;
      const verdict = verify(problem, problem.solution);
      expect(verdict.solved).toBe(true);
      expect(verdict.passed).toBe(verdict.total);
      expect(verdict.costUsd).toBeGreaterThan(0);
      expect(verdict.p99Ms).toBeGreaterThan(0);
      expect(verify(problem, problem.starter)).toMatchObject({ solved: false });
      expect(verify(problem, problem.starter).costUsd).toBeUndefined();
      for (const wrong of problem.wrong ?? []) expect(verify(problem, wrong.source).solved, wrong.name).toBe(false);
    });
  }

  it('does not solve a document with errors', () => {
    const problem = findProblem('url-shortener')!;
    expect(verify(problem, 'this is not proschi {')).toMatchObject({ solved: false, total: 0 });
  });
});
