import type { ParseResult } from '../dsl/types';
import type { Analysis, TestResult } from '../hld/engine';
import type { ReviewInput } from './request';

/**
 * The editor's review input: the document, its parse, and the analysis and
 * test results the editor already computed (Analysis/useSimulation.ts). A
 * document with errors is reviewed for its errors only, as on the practice
 * page.
 */
export function editorReviewInput(source: string, parsed: ParseResult, analysis: Analysis, results: TestResult[]): ReviewInput {
  if (parsed.diagnostics.some((d) => d.severity === 'error')) {
    return { source, parsed, run: { blocked: 'errors', results: [], passed: 0, solved: false } };
  }
  const passed = results.filter((r) => r.passed).length;
  return { source, parsed, analysis, ...(results.length ? { run: { results, passed, solved: passed === results.length } } : {}) };
}
