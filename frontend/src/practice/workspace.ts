import { parse } from '../dsl/parser';
import type { CapacityOverride, Diagnostic, ImportResolver, ParseResult } from '../dsl/types';
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

export const CAPACITY_MESSAGE = 'capacity is set by the problem; change the design (replicas, shards, caching) instead';

export function problemResolver(problem: Problem): ImportResolver {
  return filesResolver({ [PROBLEM_FILE]: problem.given }, SOLUTION_FILE);
}

/**
 * Practice rule: the problem decides what each component can take. `capacity`
 * lines outside the given file (in the solver's own file) are errors and the
 * simulation ignores them, except for `shards <n>`: how many shards a store
 * is split into is a design choice, and it costs replicas like one.
 */
export function enforceProblemCapacity(result: ParseResult): ParseResult {
  const capacity = result.diagram.capacity;
  if (!capacity?.some((c) => c.loc.file !== PROBLEM_FILE)) return result;
  const kept: CapacityOverride[] = [];
  const errors: Diagnostic[] = [];
  for (const c of capacity) {
    if (c.loc.file === PROBLEM_FILE) {
      kept.push(c);
      continue;
    }
    const { node, loc, shards, ...rest } = c;
    if (Object.keys(rest).length > 0) {
      errors.push({ severity: 'error', message: `${CAPACITY_MESSAGE} (only \`shards <n>\` may be set in your file)`, ...loc });
    }
    if (shards !== undefined) kept.push({ node, shards, loc });
  }
  const diagram = { ...result.diagram };
  if (kept.length) diagram.capacity = kept;
  else delete diagram.capacity;
  return { ...result, diagram, diagnostics: [...result.diagnostics, ...errors] };
}

/** Parses a solver's source against the problem, with the practice capacity rule applied. */
export function parseSolution(problem: Problem, source: string): ParseResult {
  return enforceProblemCapacity(parse(source, { path: SOLUTION_FILE, resolve: problemResolver(problem) }));
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
