import type { Diagram } from '../dsl/types';
import { analyze, runTests, type Analysis, type TestResult } from '../sim';

/**
 * The simulation as the HLD and the practice platform see it: injected, so
 * tests can pass their own, and so a page can run without one (it then says
 * that requirements and tests are not checked).
 */

export type { Analysis, AssertionResult, NodeAnalysis, ScenarioAnalysis, TestResult, UseCaseAnalysis } from '../sim';

export interface Engine {
  /** False for the placeholder below; the UI then explains that tests cannot run. */
  available: boolean;
  analyze(diagram: Diagram): Analysis | undefined;
  runTests(diagram: Diagram, analysis?: Analysis): TestResult[];
}

/** No simulation: no analysis and no test results. */
export const nullEngine: Engine = {
  available: false,
  analyze: () => undefined,
  runTests: () => [],
};

/** The simulation in frontend/src/sim; used by the web editor, the practice page and `proschi render --format hld-*`. */
export const defaultEngine: Engine = { available: true, analyze: (d) => analyze(d), runTests: (d, a) => runTests(d, a) };
