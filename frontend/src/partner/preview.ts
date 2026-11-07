import type { Diagram } from '../dsl/types';

/**
 * What a change does to the diagram, for the change card's preview: the
 * nodes and connections it adds (highlighted in the After view) and removes
 * (ghosted in the Before view). Connections compare by their two ends. Pure.
 */

export interface DiagramDiff {
  addedNodes: Set<string>;
  removedNodes: Set<string>;
  /** `source->target` keys. */
  addedEdges: Set<string>;
  removedEdges: Set<string>;
}

export const edgeKey = (e: { source: string; target: string }) => `${e.source}->${e.target}`;

export function diffDiagrams(before: Diagram, after: Diagram): DiagramDiff {
  const minus = (a: string[], b: string[]) => {
    const other = new Set(b);
    return new Set(a.filter((x) => !other.has(x)));
  };
  const bn = before.nodes.map((n) => n.id);
  const an = after.nodes.map((n) => n.id);
  const be = before.edges.map(edgeKey);
  const ae = after.edges.map(edgeKey);
  return { addedNodes: minus(an, bn), removedNodes: minus(bn, an), addedEdges: minus(ae, be), removedEdges: minus(be, ae) };
}

/** Whether the change touches the diagram at all (a config-only change has nothing to preview). */
export function changesDiagram(d: DiagramDiff): boolean {
  return d.addedNodes.size + d.removedNodes.size + d.addedEdges.size + d.removedEdges.size > 0;
}
