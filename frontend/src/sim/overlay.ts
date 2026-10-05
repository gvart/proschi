import type { Diagram, TrafficEntry } from '../dsl/types';
import type { Analysis } from './analyze';
import { findUseCase } from './flow';

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
}

export interface FlowOverlay {
  from: string;
  to: string;
  rps: number;
  /** Fire-and-forget or background work: drawn hollow. */
  async: boolean;
}

export interface SimOverlay {
  nodes: Record<string, NodeOverlay>;
  flows: FlowOverlay[];
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

/** The overlay of a diagram's analysis: utilisation per node and the flows at its `traffic` rates. */
export function analysisOverlay(diagram: Diagram, analysis: Analysis): SimOverlay {
  const nodes: Record<string, NodeOverlay> = {};
  for (const n of analysis.nodes) {
    const works = Number.isFinite(n.capacityRps) && n.kind !== 'client';
    nodes[n.id] = {
      ...(works ? { utilization: n.utilization, saturated: n.saturated } : {}),
      ...(n.replicas > 1 ? { replicas: n.replicas } : {}),
      ...(n.shards > 1 ? { shards: n.shards } : {}),
    };
  }
  return { nodes, flows: flowsOf(diagram, diagram.traffic ?? []) };
}
