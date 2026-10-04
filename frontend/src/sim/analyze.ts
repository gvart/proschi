import type { Diagram, DiagramNode, DiagramStep, DiagramUseCase, Kind, Percentile } from '../dsl/types';
import { accessIn } from './access';
import { criticalPath, fallbacksFor, findScenario, findUseCase, needs, pathNodes } from './flow';
import { formatPercent, formatRps } from './format';
import { capacityOf, combinedUtilization, profileOf, type Profile } from './profiles';

/**
 * A deterministic, analytical model of the design under its traffic
 * (docs/design/hld-and-practice.md §2, §7): read and write load and
 * utilisation per node, latency percentiles per scenario and use case,
 * availability, cost with egress.
 */

export interface NodeAnalysis {
  id: string;
  kind: Kind;
  replicas: number;
  /** Partitions (`capacity { n shards 4 }`), each with `replicas` instances; 1 by default. */
  shards: number;
  /** Reads and writes together, fan-out included. */
  loadRps: number;
  /**
   * All replicas and shards together. When reads and writes have different
   * capacities, the effective capacity under the current mix
   * (`loadRps / utilization`), or the read capacity without load. Infinity
   * for clients.
   */
  capacityRps: number;
  /** How busy the node is, 0..1+ (see `combinedUtilization`, §7.2). */
  utilization: number;
  saturated: boolean;
  /** Read and write load and capacity (all replicas and shards together), and their utilisation (§7.2). */
  readLoadRps: number;
  writeLoadRps: number;
  readCapacityRps: number;
  writeCapacityRps: number;
  readUtilization: number;
  writeUtilization: number;
  /** `shards`: writes go to one primary per shard and replicas only add reads (relational databases). */
  writeScaling: 'replicas' | 'shards';
  /** Data stores only (§7.4). */
  consistency?: 'strong' | 'eventual';
  /** Hop latency under the current load (payload transfer time not included). */
  latencyMs: number;
  /** With replicas, as a fraction 0..1. */
  availability: number;
  /** All replicas and shards together, per month, egress included. */
  costUsd: number;
  /** Data leaving this node per month (§7.3), in GB, and what it costs (included in `costUsd`). */
  egressGbPerMonth: number;
  egressUsd: number;
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
  /** Instances and egress together, per month. */
  totalCostUsd: number;
  /** The egress part of `totalCostUsd` (§7.3). */
  totalEgressUsd: number;
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

/** Seconds in the 30-day month that monthly costs are quoted for. */
export const SECONDS_PER_MONTH = 2_592_000;
const BYTES_PER_MB = 1e6;
const BYTES_PER_GB = 1e9;

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

/** Times the step happens per request (`x200 …`, §7.3); 1 when absent. */
export const multiplierOf = (step: DiagramStep): number => (step.multiplier !== undefined && step.multiplier > 0 ? step.multiplier : 1);

/** Requests per second a node receives, split by access (§7.2). */
export interface Load {
  read: number;
  write: number;
}

/** Calls `visit` with every request step that carries traffic and its rate `R · m(s)` (fan-out not applied). */
function forEachStepRate(diagram: Diagram, traffic: Map<string, UseCaseTraffic>, visit: (step: DiagramStep, rate: number) => void) {
  for (const u of diagram.useCases) {
    const { rps, shares } = traffic.get(u.id) ?? { rps: 0, shares: [] };
    u.scenarios.forEach((s, i) => {
      const rate = rps * (shares[i] ?? 0);
      if (rate > 0) for (const step of s.steps) visit(step, rate);
    });
  }
}

/**
 * `R · m(s) · multiplier` on the target of every request step (`->`, `->>`,
 * `-x`), split into reads and writes (§2.2, §7.2, §7.3).
 */
export function computeLoad(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, Load> {
  const load = new Map<string, Load>();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    const entry = load.get(step.toServiceId) ?? { read: 0, write: 0 };
    entry[access(step)] += rate * multiplierOf(step);
    load.set(step.toServiceId, entry);
  });
  return load;
}

/**
 * Which node a step's payload leaves (§7.3): the target for a read (it
 * answers with the payload), the sender for a write (it sends it).
 */
export const egressSource = (step: DiagramStep, access: 'read' | 'write'): string => (access === 'read' ? step.toServiceId : step.fromServiceId);

/** GB per month leaving each node: `rps × share × multiplier × size × 2 592 000 s ÷ 10⁹`. */
export function computeEgressGb(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, number> {
  const gb = new Map<string, number>();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (!step.sizeBytes || step.sizeBytes <= 0) return;
    const source = egressSource(step, access(step));
    gb.set(source, (gb.get(source) ?? 0) + (rate * multiplierOf(step) * step.sizeBytes * SECONDS_PER_MONTH) / BYTES_PER_GB);
  });
  return gb;
}

/**
 * Time to move a step's payload (§7.3): `size ÷ bandwidth`, at the slower of
 * the sender's and the receiver's per-replica bandwidth. Counted once, also
 * for a fan-out step.
 */
export function transferMs(step: DiagramStep, bandwidthOf: (id: string) => number): number {
  if (!step.sizeBytes || step.sizeBytes <= 0) return 0;
  const mbps = Math.min(bandwidthOf(step.fromServiceId), bandwidthOf(step.toServiceId));
  return mbps > 0 && Number.isFinite(mbps) ? (step.sizeBytes / BYTES_PER_MB / mbps) * 1000 : 0;
}

export const utilizationOf = (load: number, capacity: number): number => (Number.isFinite(capacity) && capacity > 0 ? load / capacity : 0);

/** `base / (1 − min(ρ, 0.95))` */
export const hopLatency = (baseMs: number, utilization: number): number => baseMs / (1 - Math.min(utilization, QUEUE_CAP));

/** `A = 1 − (1 − a)^replicas` */
export const replicatedAvailability = (a: number, replicas: number): number => 1 - (1 - a) ** replicas;

/** The load and capacity fields of a node analysis. */
export type Usage = Pick<
  NodeAnalysis,
  | 'loadRps'
  | 'capacityRps'
  | 'utilization'
  | 'saturated'
  | 'readLoadRps'
  | 'writeLoadRps'
  | 'readCapacityRps'
  | 'writeCapacityRps'
  | 'readUtilization'
  | 'writeUtilization'
  | 'writeScaling'
>;

/** Load, capacity and utilisation of a node with `replicas` replicas under the given read and write load (§7.2). */
export function usageOf(p: Profile, replicas: number, readLoadRps: number, writeLoadRps: number): Usage {
  const { readRps: readCapacityRps, writeRps: writeCapacityRps } = capacityOf(p, replicas);
  const readUtilization = utilizationOf(readLoadRps, readCapacityRps);
  const writeUtilization = utilizationOf(writeLoadRps, writeCapacityRps);
  const utilization = combinedUtilization(p, readUtilization, writeUtilization);
  const loadRps = readLoadRps + writeLoadRps;
  return {
    loadRps,
    capacityRps: readCapacityRps === writeCapacityRps || utilization === 0 ? readCapacityRps : loadRps / utilization,
    utilization,
    saturated: utilization >= 1,
    readLoadRps,
    writeLoadRps,
    readCapacityRps,
    writeCapacityRps,
    readUtilization,
    writeUtilization,
    writeScaling: p.writeScaling,
  };
}

/**
 * `12k of 20k, 60%`; for a single-primary store that takes writes, reads and
 * writes separately: `reads 10k of 20k, 50%; writes 2k of 5k, 40%`.
 */
export function usageText(n: Usage): string {
  const part = (load: number, capacity: number, rho: number) => `${formatRps(load)} of ${formatRps(capacity)}, ${formatPercent(rho)}`;
  if (n.writeScaling === 'shards' && n.writeLoadRps > 0) {
    return `reads ${part(n.readLoadRps, n.readCapacityRps, n.readUtilization)}; writes ${part(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization)}`;
  }
  return part(n.loadRps, n.capacityRps, n.utilization);
}

/** Writes are what saturates the node, and replicas cannot help with them (a single-primary store). */
export const writeBound = (n: Usage): boolean => n.writeScaling === 'shards' && n.writeUtilization >= n.readUtilization && n.writeLoadRps > 0;

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

/** Profiles of every component, with `capacity` overrides; warns about overrides for unknown nodes. */
export function profilesOf(diagram: Diagram, warnings: string[] = []): Map<string, Profile> {
  const nodes = components(diagram);
  const ids = new Set(nodes.map((n) => n.id));
  const overrides = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (!ids.has(o.node)) warnings.push(`Capacity for unknown node '${o.node}' is ignored`);
  return new Map<string, Profile>(nodes.map((n) => [n.id, profileOf(n, overrides.get(n.id))]));
}

export function analyze(diagram: Diagram, options: AnalyzeOptions = {}): Analysis {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warnings: string[] = [];
  const nodes = components(diagram);
  const profiles = profilesOf(diagram, warnings);

  const traffic = resolveTraffic(diagram, warnings);
  const load = computeLoad(diagram, traffic);
  const egress = computeEgressGb(diagram, traffic);

  const nodeResults: NodeAnalysis[] = nodes.map((n) => {
    const p = profiles.get(n.id)!;
    const replicas = replicasOf(n);
    const { read, write } = load.get(n.id) ?? { read: 0, write: 0 };
    const usage = usageOf(p, replicas, read, write);
    const egressGbPerMonth = egress.get(n.id) ?? 0;
    const egressUsd = egressGbPerMonth * p.egressUsdPerGb;
    return {
      id: n.id,
      kind: p.kind,
      replicas,
      shards: p.shards,
      ...usage,
      ...(p.consistency ? { consistency: p.consistency } : {}),
      latencyMs: hopLatency(p.latencyMs, usage.utilization),
      availability: replicatedAvailability(p.availability, replicas),
      costUsd: replicas * p.shards * p.costUsd + egressUsd,
      egressGbPerMonth,
      egressUsd,
      durable: p.durable,
    };
  });
  const nodeById = new Map(nodeResults.map((n) => [n.id, n]));
  const hopMs = (id: string) => nodeById.get(id)?.latencyMs ?? 0;
  const availabilityOf = (id: string) => nodeById.get(id)?.availability ?? 1;
  const bandwidthOf = (id: string) => profiles.get(id)?.bandwidthMBps ?? Infinity;

  for (const n of nodeResults) {
    const usage = usageText(n);
    if (n.saturated) warnings.push(`'${n.id}' is saturated: ${usage}. ${writeBound(n) ? 'Add shards for writes' : 'Add replicas'} or take load off it.`);
    else if (n.utilization > HOT) warnings.push(`'${n.id}' runs hot: ${usage}.`);
  }

  const useCases: UseCaseAnalysis[] = diagram.useCases.map((u) => {
    const { rps, shares } = traffic.get(u.id)!;
    const scenarios: ScenarioAnalysis[] = u.scenarios.map((s, i) => {
      const meanMs = criticalPath(u, s).reduce(
        (sum, part) => sum + Math.max(...part.map((hop) => (hop.failed ? timeoutMs : hopMs(hop.target) + transferMs(hop.step, bandwidthOf)))),
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
    totalEgressUsd: nodeResults.reduce((sum, n) => sum + n.egressUsd, 0),
    singlePointsOfFailure: singlePointsOfFailure(diagram),
    warnings,
  };
}

function percentilesOf(meanMs: number): Percentiles {
  return Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], meanMs * PERCENTILE_FACTORS[q]])) as Percentiles;
}

/**
 * Product of node availabilities over the synchronous path of the main
 * scenario. A node with a fallback (§7.6: a success scenario that calls it
 * with `-x` before responding and completes without it) contributes
 * `1 − (1 − A(n)) · (1 − A(fallback))`, where the fallback path is the nodes
 * that scenario adds to the main path.
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

/**
 * Kinds that run as instances of your own; clients, annotations, third
 * parties and DNS (off the request path, §7.5) are left out of failure analysis.
 */
export const DEPLOYED = (kind: Kind): boolean => kind !== 'client' && kind !== 'other' && kind !== 'external' && kind !== 'dns';

/** Single-replica nodes that some use case needs and has no fallback for. */
export function singlePointsOfFailure(diagram: Diagram): string[] {
  return components(diagram)
    .filter((n) => replicasOf(n) === 1 && DEPLOYED(profileOf(n).kind))
    .filter((n) => diagram.useCases.some((u) => needs(u, n.id) && fallbacksFor(u, n.id).length === 0))
    .map((n) => n.id);
}
