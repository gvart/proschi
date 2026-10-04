import { format } from '../dsl/format';
import { parse } from '../dsl/parser';
import type { Diagnostic } from '../dsl/types';
import { defaultEngine, type Engine } from '../hld/engine';
import { GIVEN, PROBLEM_MD, SOLUTION, STARTER, WRONG_DIR, expectFailLines } from './problemFiles';
import type { Problem } from './types';
import { PROBLEM_FILE, parseSolution, runTests } from './workspace';

/**
 * The one definition of a valid practice problem (docs/PRACTICE.md, "What
 * `problem check` enforces"), shared by the frontend test suite and
 * `proschi problem check`. Pure: give it a Problem (from problemFiles.ts) and
 * a simulation; it returns every violation with the file it is in.
 */

export interface Violation {
  /** Path inside the problem folder, e.g. solution.proschi or wrong/no-cache.proschi. */
  file: string;
  line?: number;
  message: string;
}

export interface WrongReport {
  name: string;
  file: string;
  /** The tests its `# expect-fail:` lines name. */
  expectFail: string[];
  /** Every test it fails. */
  failed: string[];
  /** Named tests it passes (each one is a violation). */
  missing: string[];
  /** Tests it fails without naming them (informational). */
  alsoFails: string[];
}

export interface ProblemReport {
  id: string;
  /** Requirements and tests the reference solution ran. */
  tests: number;
  /** Tests the starter fails. */
  starterFails: string[];
  wrong: WrongReport[];
  violations: Violation[];
}

const IMPORT_LINE = `import "${PROBLEM_FILE}"`;

/** Use case names in the given `traffic` block. */
export function trafficUseCases(given: string): string[] {
  return [...(given.match(/traffic\s*\{([\s\S]*?)\}/)?.[1] ?? '').matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** The first line that is not a `#` comment, and its 1-based number. */
function firstCodeLine(source: string): { text: string; line: number } {
  const lines = source.split('\n');
  const i = lines.findIndex((l) => !l.startsWith('#'));
  return i < 0 ? { text: '', line: lines.length } : { text: lines[i], line: i + 1 };
}

export function validateProblem(problem: Problem, engine: Engine = defaultEngine): ProblemReport {
  const violations: Violation[] = [];
  const add = (file: string, message: string, line?: number) => violations.push({ file, message, ...(line ? { line } : {}) });
  const fileOf = (d: Diagnostic, own: string) => (d.file === PROBLEM_FILE ? GIVEN : own);
  const report = (own: string, ds: Diagnostic[]) => {
    for (const d of ds) add(fileOf(d, own), `${d.severity}: ${d.message}`, d.line);
  };

  // problem.md
  if (!/^## Functional requirements$/m.test(problem.statement)) add(PROBLEM_MD, 'The statement needs a "## Functional requirements" section');
  const useCases = trafficUseCases(problem.given);
  if (useCases.length === 0) add(GIVEN, 'The given needs a traffic block naming at least one use case');
  for (const name of useCases) {
    if (!problem.statement.includes(`**${name}**`)) add(PROBLEM_MD, `The statement must name the use case **${name}** in bold`);
    if (!problem.solution.includes(`usecase "${name}"`)) add(SOLUTION, `The solution must define usecase "${name}" from the traffic`);
  }

  // given.proschi: standalone, error-free, canonical.
  const importLine = problem.given.split('\n').findIndex((l) => /^\s*import /.test(l));
  if (importLine >= 0) add(GIVEN, 'The given must not import anything', importLine + 1);
  report(GIVEN, parse(problem.given).diagnostics.filter((d) => d.severity === 'error'));
  if (format(problem.given) !== problem.given) add(GIVEN, 'Not in canonical format; run proschi fmt');

  // solution.proschi: no diagnostics at all, canonical, passes every test.
  if (!problem.solution.startsWith(`${IMPORT_LINE}\n`)) add(SOLUTION, `Must start with ${IMPORT_LINE}`, 1);
  const solution = parseSolution(problem, problem.solution);
  report(SOLUTION, solution.diagnostics);
  if (format(problem.solution) !== problem.solution) add(SOLUTION, 'Not in canonical format; run proschi fmt');
  const solutionRun = runTests(solution, engine);
  const testNames = new Set(solutionRun.results.map((r) => r.name));
  if (solutionRun.blocked === 'no-engine') add(SOLUTION, 'No simulation to run the tests with');
  else if (solutionRun.blocked !== 'errors') {
    if (solutionRun.results.length === 0) add(GIVEN, 'The problem has no requirements or tests');
    for (const r of solutionRun.results.filter((r) => !r.passed)) add(SOLUTION, `Fails "${r.name}": ${r.message}`, r.loc?.file === undefined ? r.loc?.line : undefined);
  }

  // starter.proschi: no errors of its own, fails at least one test.
  if (!problem.starter.startsWith(`${IMPORT_LINE}\n`)) add(STARTER, `Must start with ${IMPORT_LINE}`, 1);
  const starter = parseSolution(problem, problem.starter);
  report(STARTER, starter.diagnostics.filter((d) => d.severity === 'error'));
  const starterRun = runTests(starter, engine);
  const starterFails = starterRun.results.filter((r) => !r.passed).map((r) => r.name);
  if (!starterRun.blocked && starterFails.length === 0) add(STARTER, 'The starter passes every test; it must leave something to solve');

  // wrong/*.proschi: parse without errors and fail every test they name.
  const wrong: WrongReport[] = (problem.wrong ?? []).map((w) => {
    const file = `${WRONG_DIR}/${w.name}.proschi`;
    const expectFail = w.expectFail.length ? w.expectFail : expectFailLines(w.source);
    if (expectFail.length === 0) add(file, 'Start the file with one or more "# expect-fail: <test name>" lines', 1);
    const code = firstCodeLine(w.source);
    if (code.text !== IMPORT_LINE) add(file, `After the comment lines the file must start with ${IMPORT_LINE}`, code.line);
    const parsed = parseSolution(problem, w.source);
    report(file, parsed.diagnostics.filter((d) => d.severity === 'error'));
    const run = runTests(parsed, engine);
    const failed = run.results.filter((r) => !r.passed).map((r) => r.name);
    const missing: string[] = [];
    if (!run.blocked) {
      const lines = w.source.split('\n');
      for (const name of expectFail) {
        const line = lines.findIndex((l) => l.startsWith('#') && l.includes(name)) + 1 || undefined;
        if (!testNames.has(name) && !failed.includes(name)) {
          add(file, `No test or requirement is named "${name}" (names: ${[...testNames].map((n) => JSON.stringify(n)).join(', ')})`, line);
          missing.push(name);
        } else if (!failed.includes(name)) {
          add(file, `Expected to fail "${name}", but it passes`, line);
          missing.push(name);
        }
      }
    }
    return { name: w.name, file, expectFail, failed, missing, alsoFails: failed.filter((n) => !expectFail.includes(n)) };
  });

  return { id: problem.id, tests: solutionRun.results.length, starterFails, wrong, violations };
}
