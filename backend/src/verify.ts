import { problemFromFiles } from '../../frontend/src/practice/problemFiles';
import { parseSolution, runTests } from '../../frontend/src/practice/workspace';
import type { Problem } from '../../frontend/src/practice/types';
import { defaultEngine, type Analysis, type Engine } from '../../frontend/src/hld/engine';
import { problemFolders } from './problems.gen';

/**
 * Server-side checks of practice solutions with the parser, simulation and
 * problems the practice page uses, so a solve recorded here is one the page
 * would show as solved.
 */

const cache = new Map<string, Problem | undefined>();

export function findProblem(id: string): Problem | undefined {
  if (!Object.prototype.hasOwnProperty.call(problemFolders, id)) return undefined;
  if (!cache.has(id)) cache.set(id, problemFromFiles(id, problemFolders[id]));
  return cache.get(id);
}

export function problemIds(): string[] {
  return Object.keys(problemFolders);
}

export interface Verdict {
  solved: boolean;
  passed: number;
  total: number;
  /** Of a solving design: monthly cost and the worst use case p99. */
  costUsd?: number;
  p99Ms?: number;
}

export function verify(problem: Problem, source: string): Verdict {
  // Keep the analysis runTests computes, for the design metrics.
  let analysis: Analysis | undefined;
  const engine: Engine = { ...defaultEngine, analyze: (d) => (analysis = defaultEngine.analyze(d)) };
  const run = runTests(parseSolution(problem, source), engine);
  const verdict: Verdict = { solved: run.solved, passed: run.passed, total: run.results.length };
  if (!run.solved || !analysis) return verdict;
  const p99s = analysis.useCases.map((u) => u.percentiles.p99).filter(Number.isFinite);
  return {
    ...verdict,
    ...(Number.isFinite(analysis.totalCostUsd) ? { costUsd: analysis.totalCostUsd } : {}),
    ...(p99s.length ? { p99Ms: Math.max(...p99s) } : {}),
  };
}
