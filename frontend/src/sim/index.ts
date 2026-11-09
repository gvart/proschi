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
  type QueueAnalysis,
  type RetryAnalysis,
  type ScenarioAnalysis,
  type UseCaseAnalysis,
} from './analyze';
export { costBreakdown, scopedCost, type CostBreakdown, type CostShare } from './cost';
export { runTests, requirementFixes, requirementName, type AssertionResult, type TestFix, type TestResult } from './tests';
export {
  findWhatIf,
  headlineOf,
  requirementsPass,
  runWhatIf,
  runWhatIfs,
  sweep,
  whatIfOptions,
  type Headline,
  type NodeSaturation,
  type SweepResult,
  type SweepStep,
  type WhatIfResult,
} from './whatif';
export {
  availabilityRow,
  checkRow,
  costRow,
  deltaRows,
  designDelta,
  p99Row,
  utilizationRow,
  type CheckChange,
  type DeltaRow,
  type DesignDelta,
  type DesignDeltaOptions,
  type Pair,
  type Tone,
  type UseCaseDelta,
  type UtilizationDelta,
} from './delta';
export { analyzeSystems, contractOf, inboundLoad, type EntryContract, type SystemAnalysis, type SystemBreach, type SystemContract } from './systems';
export { kindOf, KINDS } from '../dsl/kinds';
export { profileOf, KIND_PROFILES, TECH_PROFILES, type Profile } from './profiles';
export { SIM_VERSION } from './version';
export { formatAvailability, formatCount, formatDuration, formatMs, formatPercent, formatRps, formatTraffic, formatUsd } from './format';
