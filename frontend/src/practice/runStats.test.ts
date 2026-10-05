import { describe, expect, it, vi } from 'vitest';
import { readRunStats, withRunStats } from './runStats';
import { parseSolution, runTests } from './workspace';
import { defaultEngine } from '../hld/engine';
import { findProblem } from './catalog';

describe('run stats kept in the browser', () => {
  it('counts runs, the runs to the first solve and the cheapest solve, and measures the reference once', () => {
    const reference = vi.fn(() => 500);
    let s = withRunStats(undefined, { solved: false }, reference);
    expect(s).toEqual({ runs: 1 });
    s = withRunStats(s, { solved: true, metrics: { costUsd: 700 } }, reference);
    expect(s).toEqual({ runs: 2, runsToSolve: 2, bestCostUsd: 700, referenceCostUsd: 500 });
    s = withRunStats(s, { solved: true, metrics: { costUsd: 400 } }, reference);
    s = withRunStats(s, { solved: true, metrics: { costUsd: 900 } }, reference);
    expect(s).toEqual({ runs: 4, runsToSolve: 2, bestCostUsd: 400, referenceCostUsd: 500 });
    expect(reference).toHaveBeenCalledTimes(1);
  });

  it('reads back only well-formed entries', () => {
    expect(readRunStats({ a: { runs: 2, runsToSolve: 1, bestCostUsd: 3 }, b: { runs: 0 }, c: 'x', d: { runs: 1, bestCostUsd: -1 }, __proto__: { runs: 1 } })).toEqual({
      a: { runs: 2, runsToSolve: 1, bestCostUsd: 3 },
      d: { runs: 1 },
    });
    expect(readRunStats([])).toEqual({});
  });

  it('gets a solving run’s cost from the simulation', () => {
    const problem = findProblem('url-shortener')!;
    const run = runTests(parseSolution(problem, problem.solution), defaultEngine);
    expect(run.solved).toBe(true);
    expect(run.metrics?.costUsd).toBeGreaterThan(0);
    expect(run.metrics?.p99Ms).toBeGreaterThan(0);
    expect(runTests(parseSolution(problem, problem.starter), defaultEngine).metrics).toBeUndefined();
  });
});
