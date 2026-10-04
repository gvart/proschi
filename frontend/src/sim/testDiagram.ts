import { parse } from '../dsl/parser';
import type { Assertion, CapacityOverride, Diagram, DiagramStep, FlowTest, Requirement, SourceLoc, TrafficEntry } from '../dsl/types';

/**
 * Test helper: parses a document (nodes, connections, use cases, scenarios)
 * and attaches traffic, requirements, capacity and tests by hand, so tests
 * can pin exact inputs (and locations) without writing the syntax. `x<n>`
 * replicas are given as a map; step fields (`multiplier`, `sizeBytes`,
 * `access`, §7.2–§7.3) can be set per step as `"<use case>:<index>"`, the
 * index counting the request steps of each scenario from 0.
 */

type Loose<T> = T extends unknown ? Omit<T, 'loc'> & { loc?: SourceLoc } : never;

export interface Extras {
  replicas?: Record<string, number>;
  traffic?: Loose<TrafficEntry>[];
  requirements?: Loose<Requirement>[];
  capacity?: Loose<CapacityOverride>[];
  tests?: { name: string; assertions: Loose<Assertion>[]; loc?: SourceLoc }[];
  steps?: Record<string, Partial<Pick<DiagramStep, 'multiplier' | 'sizeBytes' | 'access'>>>;
}

export const at = (line: number): SourceLoc => ({ line, col: 1, length: 1 });

export function diagramOf(source: string, extras: Extras = {}): Diagram {
  const { diagram, diagnostics } = parse(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(`Test source has errors: ${errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`);
  let line = 1000;
  const withLoc = <T extends { loc?: SourceLoc }>(x: T) => ({ ...x, loc: x.loc ?? at(line++) });
  const patch = (useCase: string, steps: DiagramStep[]) => steps.map((s, i) => ({ ...s, ...extras.steps?.[`${useCase}:${i}`] }));
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => (extras.replicas?.[n.id] ? { ...n, replicas: extras.replicas[n.id] } : n)),
    useCases: extras.steps
      ? diagram.useCases.map((u) => ({ ...u, steps: patch(u.name, u.steps), scenarios: u.scenarios.map((s) => ({ ...s, steps: patch(u.name, s.steps) })) }))
      : diagram.useCases,
    traffic: extras.traffic?.map(withLoc) as TrafficEntry[] | undefined,
    requirements: extras.requirements?.map(withLoc) as Requirement[] | undefined,
    capacity: extras.capacity?.map(withLoc) as CapacityOverride[] | undefined,
    tests: extras.tests?.map((t) => withLoc({ ...t, assertions: t.assertions.map(withLoc) as Assertion[] })) as FlowTest[] | undefined,
  };
}
