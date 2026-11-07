import { joinImportPath, mapResolver, parse, type ImportResolver } from '../../../frontend/src/dsl';
import { defaultEngine } from '../../../frontend/src/hld/engine';
import type { Problem } from '../../../frontend/src/practice/types';
import type { DesignReviewRequest } from '../../../frontend/src/review/contract';
import { practiceReviewInput } from '../../../frontend/src/review/practice';
import { buildReviewRequest, type ReviewInput } from '../../../frontend/src/review/request';

/**
 * The design as the server measures it, for Design partner (src/partner.ts,
 * docs/design/paid-plans.md P29), which replaced the AI design review.
 *
 * The server never trusts the page's numbers (P6): it parses the source
 * itself, runs the simulation and, for a practice problem, the problem's
 * tests, and builds the request the model reads from that. Only the source,
 * the problem id and, for an editor diagram, the files it imports come from
 * the page.
 */

/**
 * Resolves the editor's imports against the files the page sent (path ->
 * source), never fetching anything; the root document resolves too, so a
 * cycle back to it is reported (as the editor's filesResolver does).
 */
export function sentFilesResolver(files: Record<string, string>, rootPath: string | undefined): ImportResolver {
  const resolve = mapResolver(files);
  return (importPath, fromPath) => {
    if (rootPath !== undefined && joinImportPath(fromPath, importPath) === rootPath) return { path: rootPath, source: '' };
    return resolve(importPath, fromPath);
  };
}

/**
 * The review request the server would build for `source`, from its own
 * parse, simulation and tests. With `problem`, the source is a solution to
 * it, parsed with the problem's given from the bundled problem files (as
 * verify.ts does), and any files the page sent are ignored. Without, an
 * editor diagram, its imports resolved against the files the page sent
 * (`files.imports`, parsed as data like the source).
 */
export function serverReviewRequest(source: string, problem?: Problem, files: { path?: string; imports?: Record<string, string> } = {}): DesignReviewRequest {
  if (problem) return buildReviewRequest(practiceReviewInput(problem, source, defaultEngine));
  const parsed = parse(source, { path: files.path, resolve: sentFilesResolver(files.imports ?? {}, files.path) });
  let input: ReviewInput;
  if (parsed.diagnostics.some((d) => d.severity === 'error')) {
    input = { source, ...files, parsed, run: { blocked: 'errors', results: [], passed: 0, solved: false } };
  } else {
    const analysis = defaultEngine.analyze(parsed.diagram);
    const results = defaultEngine.runTests(parsed.diagram, analysis);
    const passed = results.filter((r) => r.passed).length;
    input = { source, ...files, parsed, analysis, ...(results.length ? { run: { results, passed, solved: passed === results.length } } : {}) };
  }
  return buildReviewRequest(input);
}

export function testsText(req: DesignReviewRequest): string {
  const t = req.tests;
  if (!t) return 'The design has no tests (no requirements block).';
  if (t.blocked === 'errors') return 'The design has parse errors, so no test ran (see diagnostics in <design_summary>).';
  if (t.blocked === 'no-engine') return 'The simulation is not available, so no test ran.';
  const lines = [`${t.passed} of ${t.total} tests pass${t.solved ? ' (solved)' : ''}.`];
  for (const r of t.results) lines.push(`- ${r.passed ? 'PASS' : 'FAIL'} [${r.id}] ${r.name} (${r.category}): ${r.message}${r.hint ? ` Hint: ${r.hint}` : ''}`);
  return lines.join('\n');
}
