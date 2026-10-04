import { parse } from '../dsl/parser';
import type { Assertion, CapacityOverride, Diagram, FlowTest, Requirement, SourceLoc, TrafficEntry } from '../dsl/types';

/**
 * Test helper: parses a document (nodes, connections, use cases, scenarios)
 * and attaches traffic, requirements, capacity and tests by hand, so tests
 * can pin exact inputs (and locations) without writing the syntax. `x<n>`
 * replicas are given as a map.
 */

type Loose<T> = T extends unknown ? Omit<T, 'loc'> & { loc?: SourceLoc } : never;

export interface Extras {
  replicas?: Record<string, number>;
  traffic?: Loose<TrafficEntry>[];
  requirements?: Loose<Requirement>[];
  capacity?: Loose<CapacityOverride>[];
  tests?: { name: string; assertions: Loose<Assertion>[]; loc?: SourceLoc }[];
}

export const at = (line: number): SourceLoc => ({ line, col: 1, length: 1 });

export function diagramOf(source: string, extras: Extras = {}): Diagram {
  const { diagram, diagnostics } = parse(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(`Test source has errors: ${errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`);
  let line = 1000;
  const withLoc = <T extends { loc?: SourceLoc }>(x: T) => ({ ...x, loc: x.loc ?? at(line++) });
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => (extras.replicas?.[n.id] ? { ...n, replicas: extras.replicas[n.id] } : n)),
    traffic: extras.traffic?.map(withLoc) as TrafficEntry[] | undefined,
    requirements: extras.requirements?.map(withLoc) as Requirement[] | undefined,
    capacity: extras.capacity?.map(withLoc) as CapacityOverride[] | undefined,
    tests: extras.tests?.map((t) => withLoc({ ...t, assertions: t.assertions.map(withLoc) as Assertion[] })) as FlowTest[] | undefined,
  };
}
