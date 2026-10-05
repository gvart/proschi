import { problemFromFiles } from '../../frontend/src/practice/problemFiles';
import { parseSolution, runTests } from '../../frontend/src/practice/workspace';
import type { Problem } from '../../frontend/src/practice/types';
import { defaultEngine } from '../../frontend/src/hld/engine';
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

/** Every problem's id and content version (problem.md `version`, 1 when absent); stats count only progress on these. */
export function currentVersions(): { id: string; v: number }[] {
  return problemIds().map((id) => ({ id, v: findProblem(id)?.version ?? 1 }));
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
  const run = runTests(parseSolution(problem, source), defaultEngine);
  return { solved: run.solved, passed: run.passed, total: run.results.length, ...run.metrics };
}
