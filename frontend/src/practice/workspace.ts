import { parse } from '../dsl/parser';
import type { ImportResolver, ParseResult } from '../dsl/types';
import type { Engine, TestResult } from '../hld/engine';
import { filesResolver } from '../playground/imports';
import type { Problem } from './types';

/**
 * The editor of a practice problem: the solution is a document named
 * solution.proschi whose `import "problem.proschi"` resolves to the problem's
 * `given` source, so the problem's traffic, requirements and tests apply to it
 * without being editable.
 */

export const PROBLEM_FILE = 'problem.proschi';
export const SOLUTION_FILE = 'solution.proschi';

export function problemResolver(problem: Problem): ImportResolver {
  return filesResolver({ [PROBLEM_FILE]: problem.given }, SOLUTION_FILE);
}

export function parseSolution(problem: Problem, source: string): ParseResult {
  return parse(source, { path: SOLUTION_FILE, resolve: problemResolver(problem) });
}

export interface RunResult {
  /** Why no tests ran: the simulation is missing, or the document has errors. */
  blocked?: 'no-engine' | 'errors';
  results: TestResult[];
  passed: number;
  /** Every test ran and passed. */
  solved: boolean;
}

/** Runs the problem's requirements and tests against a parsed solution. */
export function runTests(parsed: ParseResult, engine: Engine): RunResult {
  if (!engine.available) return { blocked: 'no-engine', results: [], passed: 0, solved: false };
  if (parsed.diagnostics.some((d) => d.severity === 'error')) return { blocked: 'errors', results: [], passed: 0, solved: false };
  const analysis = engine.analyze(parsed.diagram);
  const results = engine.runTests(parsed.diagram, analysis);
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, solved: results.length > 0 && passed === results.length };
}
