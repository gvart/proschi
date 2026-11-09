import type { Diagram, TrafficEntry } from '../dsl/types';
import { resolveTraffic, trafficFor, type Analysis } from './analyze';
import { criticalPath, findUseCase } from './flow';

/**
 * What the canvas draws on top of a diagram while it is simulated: how busy
 * each node is, and the requests flowing along the connections. The editor
 * fills it from the analysis at the `traffic` block's rates; the Arcade from
 * each tick of a wave.
 */

export interface NodeOverlay {
  /** 0..1+; left out for nodes that do no work (clients, third parties). */
  utilization?: number;
  /** At or past 100%: requests are dropped. */
  saturated?: boolean;
  down?: boolean;
  replicas?: number;
  shards?: number;
  /** An instance size, e.g. "L". */
  size?: string;
  /** The most utilised node, or one past 100%: the first to give way as traffic grows. */
  bottleneck?: boolean;
}

export interface FlowOverlay {
  from: string;
  to: string;
  rps: number;
  /** Fire-and-forget or background work: drawn hollow. */
  async: boolean;
  /** What the hop adds to a request: the target's mean latency under this load (service time plus queueing). */
  latencyMs?: number;
}

/** The synchronous path behind a use case's p99: the scenario that dominates its tail, hop by hop. */
export interface CriticalPathOverlay {
  useCase: string;
  scenario: string;
  p99Ms: number;
  /** Nodes in the order the path reaches them, the caller first. */
  nodes: string[];
  links: { from: string; to: string }[];
}

export interface SimOverlay {
  nodes: Record<string, NodeOverlay>;
  flows: FlowOverlay[];
  /** The p99 path of the use case picked, or of the busiest one. */
  critical?: CriticalPathOverlay;
}

/** What an edge of the canvas carries while the overlay is on: its flows in both directions, summed. */
export interface EdgeOverlay {
  rps: number;
  /** The latency its busiest flow adds (the target's mean hop latency). */
  latencyMs?: number;
  /** Utilisation of the node its busiest flow goes to: the edge takes that node's colour. */
  utilization?: number;
  saturated?: boolean;
  /** Every flow on it is async. */
  async: boolean;
  /** On the p99 path. */
  critical?: boolean;
}

/** Requests per second along each connection, summed over the use cases' scenarios at the traffic's rates. */
export function flowsOf(diagram: Diagram, traffic: readonly TrafficEntry[]): FlowOverlay[] {
  const flows = new Map<string, FlowOverlay>();
  for (const t of traffic) {
    const u = findUseCase(diagram, t.useCase);
    if (!u || t.rps <= 0) continue;
    for (const sc of u.scenarios) {
      const share = t.mix ? (t.mix.find((m) => m.scenario === sc.name)?.share ?? 0) : sc === u.scenarios[0] ? 1 : 0;
      if (share <= 0) continue;
      for (const step of sc.steps) {
        if (step.failed) continue;
        const key = `${step.fromServiceId}>${step.toServiceId}`;
        const f = flows.get(key) ?? { from: step.fromServiceId, to: step.toServiceId, rps: 0, async: step.executionType !== 'SYNC_REQUEST_RESPONSE' };
        f.rps += t.rps * share * (step.multiplier ?? 1);
        flows.set(key, f);
      }
    }
  }
  return [...flows.values()];
}

const works = (n: Analysis['nodes'][number]) => Number.isFinite(n.capacityRps) && n.kind !== 'client';

/**
 * The traffic the analysis was made with: the `traffic` block's, unless a
 * what-if (sim/whatif.ts) changed a rate or took nodes down, in which case
 * each use case's analysed rate, with its shares moved to the fallbacks.
 */
function analysedTraffic(diagram: Diagram, analysis: Analysis, failed: ReadonlySet<string>): TrafficEntry[] {
  const declared = resolveTraffic(diagram);
  const rates = new Map(analysis.useCases.map((u) => [u.id, u.rps]));
  const changed = failed.size > 0 || [...declared].some(([id, t]) => rates.has(id) && rates.get(id) !== t.rps);
  if (!changed) return diagram.traffic ?? [];
  const loc = { line: 0, col: 0, length: 0 };
  return [...trafficFor(diagram, { trafficRps: rates, failed })].flatMap(([id, t]) => {
    const u = diagram.useCases.find((c) => c.id === id);
    if (!u || !(t.rps > 0)) return [];
    return [{ useCase: u.name, rps: t.rps, mix: u.scenarios.map((s, i) => ({ scenario: s.name, share: t.shares[i] ?? 0 })), loc }];
  });
}

/**
 * The overlay of a diagram's analysis: utilisation per node (the bottleneck
 * marked), the flows at its `traffic` rates with the latency each hop adds,
 * and the p99 path of the busiest use case.
 */
export function analysisOverlay(diagram: Diagram, analysis: Analysis): SimOverlay {
  const nodes: Record<string, NodeOverlay> = {};
  const bottlenecks = new Set(bottlenecksOf(analysis));
  const latency = new Map<string, number>();
  const failed = new Set<string>();
  for (const n of analysis.nodes) {
    latency.set(n.id, n.latencyMs);
    if (n.failed) failed.add(n.id);
    nodes[n.id] = {
      ...(works(n) ? { utilization: n.utilization, saturated: n.saturated } : {}),
      ...(n.replicas > 1 ? { replicas: n.replicas } : {}),
      ...(n.shards > 1 ? { shards: n.shards } : {}),
      ...(bottlenecks.has(n.id) ? { bottleneck: true } : {}),
      ...(n.failed ? { down: true } : {}),
    };
  }
  const flows = flowsOf(diagram, analysedTraffic(diagram, analysis, failed))
    .filter((f) => !failed.has(f.from) && !failed.has(f.to))
    .map((f) => (latency.has(f.to) ? { ...f, latencyMs: latency.get(f.to)! } : f));
  const critical = criticalPathOf(diagram, analysis);
  return { nodes, flows, ...(critical ? { critical } : {}) };
}

/** Utilisation from which a node counts as a bottleneck: where the editor calls it hot (`HOT` in analyze.ts). */
export const BOTTLENECK_FROM = 0.7;

/** The most utilised node that does work, if any carries load. */
export function busiestOf(analysis: Analysis): Analysis['nodes'][number] | undefined {
  return analysis.nodes.filter((n) => works(n) && n.utilization > 0).reduce<Analysis['nodes'][number] | undefined>((best, n) => (!best || n.utilization > best.utilization ? n : best), undefined);
}

/**
 * The nodes that give way first as traffic grows: the saturated ones and
 * those at `BOTTLENECK_FROM` or more. None while every node has room to spare.
 */
export function bottlenecksOf(analysis: Analysis): string[] {
  return analysis.nodes.filter((n) => works(n) && (n.saturated || n.utilization >= BOTTLENECK_FROM)).map((n) => n.id);
}

/**
 * The p99 path of a use case: the critical path of the scenario that
 * dominates its p99 (`tailScenario`). `useCase` names the one picked (its id
 * or name); without one, or when it has no traffic, the busiest use case.
 */
export function criticalPathOf(diagram: Diagram, analysis: Analysis, useCase?: string): CriticalPathOverlay | undefined {
  const live = analysis.useCases.filter((u) => u.rps > 0);
  const picked = useCase === undefined ? undefined : live.find((u) => u.id === useCase || u.name === useCase);
  const result = picked ?? live.reduce<(typeof live)[number] | undefined>((best, u) => (!best || u.rps > best.rps ? u : best), undefined);
  if (!result) return undefined;
  const u = diagram.useCases.find((d) => d.id === result.id) ?? findUseCase(diagram, result.name);
  const scenario = u?.scenarios[result.tailScenario.p99] ?? u?.scenarios[0];
  const entry = scenario?.steps[0];
  if (!u || !scenario || !entry) return undefined;
  const hops = criticalPath(u, scenario).flat();
  const nodes = [entry.fromServiceId];
  for (const h of hops) if (!nodes.includes(h.target)) nodes.push(h.target);
  return {
    useCase: u.name,
    scenario: scenario.name,
    p99Ms: result.percentiles.p99,
    nodes,
    links: hops.map((h) => ({ from: h.step.fromServiceId, to: h.step.toServiceId })),
  };
}

const joins = (a: string, b: string, from: string, to: string) => (a === from && b === to) || (a === to && b === from);

/**
 * Each canvas edge's share of the overlay, by edge id: the flows along it in
 * either direction, summed; the latency and colour of the busiest of them;
 * and whether it lies on the p99 path. Edges that carry nothing are left out.
 */
export function edgeOverlays(edges: readonly { id: string; source: string; target: string }[], overlay: SimOverlay): Record<string, EdgeOverlay> {
  const result: Record<string, EdgeOverlay> = {};
  for (const e of edges) {
    const flows = overlay.flows.filter((f) => f.rps > 0 && joins(e.source, e.target, f.from, f.to));
    const critical = overlay.critical?.links.some((l) => joins(e.source, e.target, l.from, l.to)) ?? false;
    if (flows.length === 0 && !critical) continue;
    const busiest = flows.reduce<FlowOverlay | undefined>((best, f) => (!best || f.rps > best.rps ? f : best), undefined);
    const target = busiest ? overlay.nodes[busiest.to] : undefined;
    result[e.id] = {
      rps: flows.reduce((sum, f) => sum + f.rps, 0),
      async: flows.length > 0 && flows.every((f) => f.async),
      ...(busiest?.latencyMs !== undefined ? { latencyMs: busiest.latencyMs } : {}),
      ...(target?.utilization !== undefined ? { utilization: target.utilization } : {}),
      ...(target?.saturated ? { saturated: true } : {}),
      ...(critical ? { critical: true } : {}),
    };
  }
  return result;
}
