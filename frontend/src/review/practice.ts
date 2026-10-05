import type { Analysis, Engine } from '../hld/engine';
import type { Problem } from '../practice/types';
import { PROBLEM_FILE, parseSolution, runTests } from '../practice/workspace';
import type { ReviewInput } from './request';

/** A practice solution's review input: parsed with the problem's given, its tests run and its design simulated once. */
export function practiceReviewInput(problem: Problem, source: string, engine: Engine): ReviewInput {
  const parsed = parseSolution(problem, source);
  // Keep the analysis runTests computes, as backend/src/verify.ts does.
  let analysis: Analysis | undefined;
  const run = runTests(parsed, { ...engine, analyze: (d) => (analysis = engine.analyze(d)) });
  return { problem, source, parsed, run, analysis, givenFiles: [PROBLEM_FILE] };
}
