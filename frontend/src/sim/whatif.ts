import type { Diagram, SourceLoc, WhatIf } from '../dsl/types';
import { analyze, components, resolveTraffic, type Analysis, type AnalyzeOptions } from './analyze';
import { findUseCase } from './flow';
import { runTests, type TestResult } from './tests';

/**
 * What-ifs (docs/HLD.md, "What-ifs"): the design analysed again with more or
 * less traffic, nodes down or other replica counts, and checked against its
 * requirements. Everything here is pure: the base analysis is never touched,
 * and a diagram without `whatif` blocks analyses exactly as before.
 */

/** The numbers a what-if is compared by. */
export interface Headline {
  /** The slowest p99 of the use cases with traffic (of all of them when none has traffic), in ms. */
  p99Ms: number;
  /** The lowest availability of the use cases with traffic, 0..1 (1 when none has traffic). */
  availability: number;
  /** Instances and egress per month. */
  costUsd: number;
}

export interface WhatIfResult {
  name: string;
  /** The `whatif` line; absent for a what-if built in code. */
  loc?: SourceLoc;
  /** What the analysis was made with: pass them to `analyze` and `runTests` to repeat it. */
  options: AnalyzeOptions;
  analysis: Analysis;
  /** Requirements, systems and tests, as `runTests` gives them. */
  results: TestResult[];
  /** Every requirement (and every system the design sends load to) holds; `test` blocks do not count. */
  passed: boolean;
  headline: Headline;
  /** Changes that name an unknown use case or node, and were left out. */
  warnings: string[];
}

export function headlineOf(analysis: Analysis): Headline {
  const loaded = analysis.useCases.filter((u) => u.rps > 0);
  const p99s = (loaded.length ? loaded : analysis.useCases).map((u) => u.percentiles.p99).filter((x) => Number.isFinite(x));
  return {
    p99Ms: p99s.length ? Math.max(...p99s) : 0,
    availability: loaded.length ? Math.min(...loaded.map((u) => u.availability)) : 1,
    costUsd: analysis.totalCostUsd,
  };
}

/** Requirement and system results hold; flow tests do not depend on load, so they are left out. */
export const requirementsPass = (results: TestResult[]): boolean => results.every((r) => r.passed || r.id.startsWith('test:'));

export function findWhatIf(diagram: Diagram, name: string): WhatIf | undefined {
  return diagram.whatifs?.find((w) => w.name === name);
}

/**
 * The analysis options of a what-if, on top of `base`: `traffic "X" x3`
 * multiplies X's rate (the one in `base`, else the traffic block's),
 * `traffic "X" 50k rps` sets it, `fail n` takes n down, `n x4` runs four
 * replicas of n, `cache hit 40%` sets the cache's hit rate.
 */
export function whatIfOptions(diagram: Diagram, whatif: WhatIf, base: AnalyzeOptions = {}): { options: AnalyzeOptions; warnings: string[] } {
  const warnings: string[] = [];
  const traffic = resolveTraffic(diagram);
  const ids = new Set(components(diagram).map((n) => n.id));
  const rps = new Map(base.trafficRps ?? []);
  const replicas = new Map(base.replicas ?? []);
  const failed = new Set(base.failed ?? []);
  const hitRates = new Map(base.hitRates ?? []);
  for (const change of whatif.changes) {
    if (change.kind === 'traffic') {
      const u = findUseCase(diagram, change.useCase);
      if (!u) {
        warnings.push(`What-if "${whatif.name}": no use case named "${change.useCase}"; its traffic change is ignored`);
        continue;
      }
      const current = rps.get(u.id) ?? traffic.get(u.id)?.rps ?? 0;
      rps.set(u.id, change.rps ?? current * (change.multiply ?? 1));
      continue;
    }
    if (!ids.has(change.node)) {
      warnings.push(`What-if "${whatif.name}": no node '${change.node}'; ${change.kind === 'fail' ? 'fail' : change.kind === 'hit' ? 'its hit rate' : 'its replicas'} ignored`);
      continue;
    }
    if (change.kind === 'fail') failed.add(change.node);
    else if (change.kind === 'hit') hitRates.set(change.node, change.percent);
    else replicas.set(change.node, change.replicas);
  }
  return {
    options: {
      ...base,
      ...(rps.size ? { trafficRps: rps } : {}),
      ...(replicas.size ? { replicas } : {}),
      ...(failed.size ? { failed } : {}),
      ...(hitRates.size ? { hitRates } : {}),
    },
    warnings,
  };
}

/** Analyses the design under one what-if and runs its requirements and tests. */
export function runWhatIf(diagram: Diagram, whatif: WhatIf, base: AnalyzeOptions = {}): WhatIfResult {
  const { options, warnings } = whatIfOptions(diagram, whatif, base);
  const analysis = analyze(diagram, options);
  const results = runTests(diagram, analysis, options);
  return { name: whatif.name, loc: whatif.loc, options, analysis, results, passed: requirementsPass(results), headline: headlineOf(analysis), warnings };
}

/** Every `whatif` block of the diagram, in order. */
export function runWhatIfs(diagram: Diagram, base: AnalyzeOptions = {}): WhatIfResult[] {
  return (diagram.whatifs ?? []).map((w) => runWhatIf(diagram, w, base));
}

export interface SweepStep {
  rps: number;
  /** Requirements hold at this rate. */
  passed: boolean;
  headline: Headline;
  /** Ids of the nodes at or past 100% utilisation. */
  saturated: string[];
  /** Names of the requirements that fail. */
  failing: string[];
}

export interface NodeSaturation {
  node: string;
  /** The use case rate at which the node reaches 100%, to about 0.1% of the range. */
  rps: number;
  /** Already saturated at the start of the range: `rps` is the start. */
  atStart: boolean;
}

export interface SweepResult {
  /** The use case name. */
  useCase: string;
  from: number;
  to: number;
  steps: SweepStep[];
  /** Nodes that saturate within the range, by the rate at which they do. */
  saturation: NodeSaturation[];
  /**
   * The highest rate in the range at which the requirements still hold (to
   * about 0.1% of the range); `to` when they hold over all of it, undefined
   * when they fail already at `from`.
   */
  maxPassingRps?: number;
}

/**
 * Analyses the design with `useCase` at `steps` evenly spaced rates from
 * `from` to `to` (both included), then finds by bisection where each node
 * saturates and the highest rate at which the requirements hold. `base` is a
 * what-if's options, or none. Throws for an unknown use case.
 */
export function sweep(diagram: Diagram, useCase: string, from: number, to: number, opts: { steps?: number; base?: AnalyzeOptions } = {}): SweepResult {
  const u = findUseCase(diagram, useCase);
  if (!u) throw new Error(`No use case named "${useCase}"`);
  if (!(from >= 0) || !(to > from)) throw new Error('The sweep range must go up, e.g. 10k..500k');
  const base = opts.base ?? {};
  const count = Math.max(2, Math.round(opts.steps ?? 10));
  const at = (rps: number, cheap = false): AnalyzeOptions => ({
    ...base,
    trafficRps: new Map([...(base.trafficRps ?? []), [u.id, rps]]),
    ...(cheap ? { percentiles: [] } : {}),
  });
  const passesAt = (rps: number) => {
    const options = at(rps);
    return requirementsPass(runTests(diagram, analyze(diagram, options), options));
  };
  const tolerance = Math.max(1, (to - from) / 1000);
  /** The largest x in [lo, hi] with `ok(x)`, given ok(lo) and not ok(hi). */
  const bisect = (lo: number, hi: number, ok: (x: number) => boolean) => {
    while (hi - lo > tolerance) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const steps: SweepStep[] = [];
  for (let i = 0; i < count; i++) {
    const rps = from + ((to - from) * i) / (count - 1);
    const options = at(rps);
    const analysis = analyze(diagram, options);
    const results = runTests(diagram, analysis, options);
    steps.push({
      rps,
      passed: requirementsPass(results),
      headline: headlineOf(analysis),
      saturated: analysis.nodes.filter((n) => n.saturated).map((n) => n.id),
      failing: results.filter((r) => !r.passed && !r.id.startsWith('test:')).map((r) => r.name),
    });
  }

  const saturation: NodeSaturation[] = [];
  for (const id of new Set(steps.flatMap((s) => s.saturated))) {
    const first = steps.findIndex((s) => s.saturated.includes(id));
    if (first === 0) {
      saturation.push({ node: id, rps: from, atStart: true });
      continue;
    }
    const free = (rps: number) => !analyze(diagram, at(rps, true)).nodes.find((n) => n.id === id)?.saturated;
    saturation.push({ node: id, rps: bisect(steps[first - 1].rps, steps[first].rps, free), atStart: false });
  }
  saturation.sort((a, b) => a.rps - b.rps || a.node.localeCompare(b.node));

  let maxPassingRps: number | undefined;
  const firstFail = steps.findIndex((s) => !s.passed);
  if (firstFail === -1) maxPassingRps = to;
  else if (firstFail > 0) maxPassingRps = bisect(steps[firstFail - 1].rps, steps[firstFail].rps, passesAt);

  return { useCase: u.name, from, to, steps, saturation, ...(maxPassingRps !== undefined ? { maxPassingRps } : {}) };
}
