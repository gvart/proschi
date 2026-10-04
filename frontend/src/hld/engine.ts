import type { Diagram, Kind, SourceLoc } from '../dsl/types';

/**
 * The simulation as the HLD and the practice platform see it. The types are
 * copied from docs/design/hld-and-practice.md §2.7 and §3; the engine itself
 * lives in frontend/src/sim/ and is injected, so these pages work (and say
 * "simulation not available yet") without it.
 */

export interface NodeAnalysis {
  id: string;
  kind: Kind;
  replicas: number;
  loadRps: number;
  capacityRps: number;
  utilization: number;
  saturated: boolean;
  latencyMs: number;
  availability: number;
  costUsd: number;
  durable: boolean;
}

export interface ScenarioAnalysis {
  id: string;
  name: string;
  share: number;
  meanMs: number;
  percentiles: Record<'p50' | 'p90' | 'p95' | 'p99' | 'p999', number>;
}

export interface UseCaseAnalysis {
  id: string;
  name: string;
  rps: number;
  scenarios: ScenarioAnalysis[];
  percentiles: ScenarioAnalysis['percentiles'];
  availability: number;
}

export interface Analysis {
  nodes: NodeAnalysis[];
  useCases: UseCaseAnalysis[];
  totalCostUsd: number;
  singlePointsOfFailure: string[];
  warnings: string[];
}

export interface TestResult {
  /** Stable, e.g. "req:3" or "test:Redirect is served from the cache". */
  id: string;
  name: string;
  category: 'latency' | 'availability' | 'durability' | 'resilience' | 'cost' | 'flow';
  passed: boolean;
  /** What was measured: "p99 of Redirect is 41 ms (limit 50 ms)". */
  message: string;
  /** How to fix it, when failed. */
  hint?: string;
  /** The requirement or test line. */
  loc?: SourceLoc;
}

export interface Engine {
  /** False for the placeholder below; the UI then explains that tests cannot run yet. */
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

// The one place the real simulation is wired in (web editor, practice page and
// `proschi render --format hld-*` all use it), e.g.:
//   import { analyze, runTests } from '../sim';
//   export const defaultEngine: Engine = { available: true, analyze, runTests };
export const defaultEngine: Engine = nullEngine;
