/**
 * Simulation and tests (docs/design/hld-and-practice.md §2, §3): pure
 * functions over a parsed Diagram, shared by the editor, the CLI, the
 * language server and the practice platform.
 */
export {
  analyze,
  HOT,
  type Analysis,
  type AnalyzeOptions,
  type NodeAnalysis,
  type Percentiles,
  type ScenarioAnalysis,
  type UseCaseAnalysis,
} from './analyze';
export { runTests, requirementName, type AssertionResult, type TestResult } from './tests';
export { kindOf, KINDS } from '../dsl/kinds';
export { profileOf, KIND_PROFILES, TECH_PROFILES, type Profile } from './profiles';
export { formatAvailability, formatMs, formatPercent, formatRps, formatUsd } from './format';
