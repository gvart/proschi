import type { Diagram, DiagramNode, DiagramUseCase, Kind, Percentile } from '../dsl/types';
import { criticalPath, fallbacksFor, findScenario, findUseCase, needs, pathNodes } from './flow';
import { formatPercent, formatRps } from './format';
import { profileOf, type Profile } from './profiles';

/**
 * A deterministic, analytical model of the design under its traffic
 * (docs/design/hld-and-practice.md §2): load and utilisation per node,
 * latency percentiles per scenario and use case, availability, cost.
 */

export interface NodeAnalysis {
  id: string;
  kind: Kind;
  replicas: number;
  loadRps: number;
  /** All replicas together; Infinity for clients. */
  capacityRps: number;
  /** load / capacity */
  utilization: number;
  saturated: boolean;
  /** Hop latency under the current load. */
  latencyMs: number;
  /** With replicas, as a fraction 0..1. */
  availability: number;
  /** All replicas together, per month. */
  costUsd: number;
  durable: boolean;
}

export type Percentiles = Record<'p50' | 'p90' | 'p95' | 'p99' | 'p999', number>;

export interface ScenarioAnalysis {
  id: string;
  name: string;
  /** Share of the use case's traffic, 0..1. */
  share: number;
  meanMs: number;
  percentiles: Percentiles;
}

export interface UseCaseAnalysis {
  id: string;
  name: string;
  rps: number;
  scenarios: ScenarioAnalysis[];
  percentiles: ScenarioAnalysis['percentiles'];
  /** Fraction 0..1. */
  availability: number;
}

export interface Analysis {
  nodes: NodeAnalysis[];
  useCases: UseCaseAnalysis[];
  totalCostUsd: number;
  /** Ids of single-replica nodes a use case needs and cannot do without. */
  singlePointsOfFailure: string[];
  warnings: string[];
}

export interface AnalyzeOptions {
  /** What a failed call (`-x`) costs; 1 000 ms by default. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 1000;
/** Utilisation above which a node counts as hot (amber in the editor). */
export const HOT = 0.7;
/** Queueing delay is capped at this utilisation, so a saturated node still has a finite latency. */
const QUEUE_CAP = 0.95;

/** Tail factors over the mean: `p_q = mean × f(q)`. */
export const PERCENTILE_FACTORS: Record<Percentile, number> = { 50: 1.0, 90: 1.6, 95: 2.0, 99: 3.0, 99.9: 5.0 };
export const PERCENTILE_KEYS: Record<Percentile, keyof Percentiles> = { 50: 'p50', 90: 'p90', 95: 'p95', 99: 'p99', 99.9: 'p999' };
const PERCENTILES = Object.keys(PERCENTILE_KEYS).map(Number) as Percentile[];

/** Components the model covers: groups and text nodes are ignored. */
export function components(diagram: Diagram): DiagramNode[] {
  return diagram.nodes.filter((n) => n.kind === 'component');
}

export const replicasOf = (node: DiagramNode): number => Math.max(1, node.replicas ?? 1);

/** Traffic of a use case: requests per second, and each scenario's share (aligned with `useCase.scenarios`). */
export interface UseCaseTraffic {
  rps: number;
  shares: number[];
}

/**
 * Applies `traffic { … }`: without `mix` all traffic goes to the first
 * scenario; shares that do not add up to 100% are normalised. Use cases
 * without a traffic line get 0 rps, with the first scenario as their shape.
 */
export function resolveTraffic(diagram: Diagram, warnings: string[] = []): Map<string, UseCaseTraffic> {
  const result = new Map<string, UseCaseTraffic>();
  for (const u of diagram.useCases) result.set(u.id, { rps: 0, shares: u.scenarios.map((_, i) => (i === 0 ? 1 : 0)) });
  const seen = new Set<string>();
  for (const entry of diagram.traffic ?? []) {
    const useCase = findUseCase(diagram, entry.useCase);
    if (!useCase) {
      warnings.push(`Traffic for unknown use case "${entry.useCase}" is ignored`);
      continue;
    }
    if (seen.has(useCase.id)) continue;
    seen.add(useCase.id);
    const shares = useCase.scenarios.map(() => 0);
    for (const { scenario, share } of entry.mix ?? []) {
      const found = findScenario(useCase, scenario);
      if (found) shares[useCase.scenarios.indexOf(found)] += share;
      else warnings.push(`"${useCase.name}" has no scenario "${scenario}"; its traffic share is ignored`);
    }
    const total = shares.reduce((a, b) => a + b, 0);
    if (total <= 0) shares[0] = 1;
    else {
      if (Math.abs(total - 1) > 1e-6) warnings.push(`Traffic mix of "${useCase.name}" adds up to ${formatPercent(total)}; shares are scaled to 100%`);
      for (let i = 0; i < shares.length; i++) shares[i] /= total;
    }
    result.set(useCase.id, { rps: entry.rps, shares: useCase.scenarios.length ? shares : [] });
  }
  return result;
}

/** `R · m(s)` on the target of every request step (`->`, `->>`, `-x`). */
export function computeLoad(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, number> {
  const load = new Map<string, number>();
  for (const u of diagram.useCases) {
    const { rps, shares } = traffic.get(u.id) ?? { rps: 0, shares: [] };
    u.scenarios.forEach((s, i) => {
      const rate = rps * (shares[i] ?? 0);
      if (rate > 0) for (const step of s.steps) load.set(step.toServiceId, (load.get(step.toServiceId) ?? 0) + rate);
    });
  }
  return load;
}

export const utilizationOf = (load: number, capacity: number): number => (Number.isFinite(capacity) && capacity > 0 ? load / capacity : 0);

/** `base / (1 − min(ρ, 0.95))` */
export const hopLatency = (baseMs: number, utilization: number): number => baseMs / (1 - Math.min(utilization, QUEUE_CAP));

/** `A = 1 − (1 − a)^replicas` */
export const replicatedAvailability = (a: number, replicas: number): number => 1 - (1 - a) ** replicas;

/**
 * `p_q(U) = max { p_q(s) : m(s) ≥ 1 − q }`: any scenario carrying more than
 * the tail share dominates the percentile. When no single scenario carries
 * that much (p50 over three equal scenarios), the scenarios are taken slowest
 * first until their shares reach the tail.
 */
export function useCasePercentile(scenarios: { share: number; value: number }[], q: Percentile): number {
  const tail = 1 - q / 100 - 1e-9;
  const heavy = scenarios.filter((s) => s.share >= tail && s.share > 0);
  if (heavy.length) return Math.max(...heavy.map((s) => s.value));
  let covered = 0;
  for (const s of [...scenarios].sort((a, b) => b.value - a.value)) {
    covered += s.share;
    if (covered >= tail) return s.value;
  }
  return scenarios.length ? Math.max(...scenarios.map((s) => s.value)) : 0;
}

/** Index of the scenario with the largest share (the first on ties). */
export function mainScenarioIndex(shares: number[]): number {
  let best = 0;
  shares.forEach((share, i) => {
    if (share > shares[best]) best = i;
  });
  return best;
}

export function analyze(diagram: Diagram, options: AnalyzeOptions = {}): Analysis {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warnings: string[] = [];
  const nodes = components(diagram);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const overrides = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (!byId.has(o.node)) warnings.push(`Capacity for unknown node '${o.node}' is ignored`);
  const profiles = new Map<string, Profile>(nodes.map((n) => [n.id, profileOf(n, overrides.get(n.id))]));

  const traffic = resolveTraffic(diagram, warnings);
  const load = computeLoad(diagram, traffic);

  const nodeResults: NodeAnalysis[] = nodes.map((n) => {
    const p = profiles.get(n.id)!;
    const replicas = replicasOf(n);
    const loadRps = load.get(n.id) ?? 0;
    const capacityRps = p.rps * replicas;
    const utilization = utilizationOf(loadRps, capacityRps);
    return {
      id: n.id,
      kind: p.kind,
      replicas,
      loadRps,
      capacityRps,
      utilization,
      saturated: utilization >= 1,
      latencyMs: hopLatency(p.latencyMs, utilization),
      availability: replicatedAvailability(p.availability, replicas),
      costUsd: replicas * p.costUsd,
      durable: p.durable,
    };
  });
  const nodeById = new Map(nodeResults.map((n) => [n.id, n]));
  const hopMs = (id: string) => nodeById.get(id)?.latencyMs ?? 0;
  const availabilityOf = (id: string) => nodeById.get(id)?.availability ?? 1;

  for (const n of nodeResults) {
    const usage = `${formatRps(n.loadRps)} of ${formatRps(n.capacityRps)}, ${formatPercent(n.utilization)}`;
    if (n.saturated) warnings.push(`'${n.id}' is saturated: ${usage}. Add replicas or take load off it.`);
    else if (n.utilization > HOT) warnings.push(`'${n.id}' runs hot: ${usage}.`);
  }

  const useCases: UseCaseAnalysis[] = diagram.useCases.map((u) => {
    const { rps, shares } = traffic.get(u.id)!;
    const scenarios: ScenarioAnalysis[] = u.scenarios.map((s, i) => {
      const meanMs = criticalPath(u, s).reduce(
        (sum, part) => sum + Math.max(...part.map((hop) => (hop.failed ? timeoutMs : hopMs(hop.target)))),
        0,
      );
      return { id: s.id, name: s.name, share: shares[i] ?? 0, meanMs, percentiles: percentilesOf(meanMs) };
    });
    const percentiles = Object.fromEntries(
      PERCENTILES.map((q) => [PERCENTILE_KEYS[q], useCasePercentile(scenarios.map((s) => ({ share: s.share, value: s.percentiles[PERCENTILE_KEYS[q]] })), q)]),
    ) as Percentiles;
    if (rps > 0 && u.scenarios.length === 0) warnings.push(`"${u.name}" has traffic but no steps`);
    return { id: u.id, name: u.name, rps, scenarios, percentiles, availability: useCaseAvailability(u, shares, availabilityOf) };
  });

  return {
    nodes: nodeResults,
    useCases,
    totalCostUsd: nodeResults.reduce((sum, n) => sum + n.costUsd, 0),
    singlePointsOfFailure: singlePointsOfFailure(diagram),
    warnings,
  };
}

function percentilesOf(meanMs: number): Percentiles {
  return Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], meanMs * PERCENTILE_FACTORS[q]])) as Percentiles;
}

/**
 * Product of node availabilities over the synchronous path of the main
 * scenario. A node with a fallback (a success scenario that calls it with `-x`
 * and completes without it) contributes `1 − (1 − A(n)) · (1 − A(fallback))`,
 * where the fallback path is the nodes that scenario adds to the main path.
 */
export function useCaseAvailability(useCase: DiagramUseCase, shares: number[], availabilityOf: (id: string) => number): number {
  if (useCase.scenarios.length === 0) return 1;
  const main = pathNodes(useCase, useCase.scenarios[mainScenarioIndex(shares)]);
  const onMain = new Set(main);
  let result = 1;
  for (const id of main) {
    const a = availabilityOf(id);
    const fallback = Math.max(
      0,
      ...fallbacksFor(useCase, id).map((s) =>
        pathNodes(useCase, s)
          .filter((other) => other !== id && !onMain.has(other))
          .reduce((product, other) => product * availabilityOf(other), 1),
      ),
    );
    result *= 1 - (1 - a) * (1 - fallback);
  }
  return result;
}

/** Kinds that run as instances of your own; clients, annotations and third parties are left out of failure analysis. */
export const DEPLOYED = (kind: Kind): boolean => kind !== 'client' && kind !== 'other' && kind !== 'external';

/** Single-replica nodes that some use case needs and has no fallback for. */
export function singlePointsOfFailure(diagram: Diagram): string[] {
  return components(diagram)
    .filter((n) => replicasOf(n) === 1 && DEPLOYED(profileOf(n).kind))
    .filter((n) => diagram.useCases.some((u) => needs(u, n.id) && fallbacksFor(u, n.id).length === 0))
    .map((n) => n.id);
}
