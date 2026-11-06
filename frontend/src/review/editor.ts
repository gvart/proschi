import type { ParseResult } from '../dsl/types';
import type { Analysis, TestResult } from '../hld/engine';
import type { ReviewInput } from './request';

/**
 * The editor's review input: the document, its parse, and the analysis and
 * test results the editor already computed (Analysis/useSimulation.ts), with
 * the document's path and the files its imports read, so the server can
 * parse it the same way. A
 * document with errors is reviewed for its errors only, as on the practice
 * page.
 */
export function editorReviewInput(source: string, parsed: ParseResult, analysis: Analysis, results: TestResult[], files: { path?: string; imports?: Record<string, string> } = {}): ReviewInput {
  if (parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { source, ...files, parsed, run: { blocked: 'errors', results: [], passed: 0, solved: false } };
  }
  const passed = results.filter((r) => r.passed).length;
  return { source, ...files, parsed, analysis, ...(results.length ? { run: { results, passed, solved: passed === results.length } } : {}) };
}
