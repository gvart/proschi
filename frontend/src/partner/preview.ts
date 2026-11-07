import { diffDiagrams } from '../dsl/diff';
import type { Diagram } from '../dsl/types';

/**
 * What a change does to the drawing, for the change card's preview: the
 * nodes and connections it adds or changes (marked in the After view) and the
 * ones it removes (ghosted in the Before view), from the structural diff of
 * the two parsed diagrams (dsl/diff.ts). Connections compare by their two
 * ends. Pure.
 */

export interface PreviewMarks {
  addedNodes: Set<string>;
  changedNodes: Set<string>;
  removedNodes: Set<string>;
  /** `source->target` keys. */
  addedEdges: Set<string>;
  removedEdges: Set<string>;
}

export const edgeKey = (e: { source: string; target: string }) => `${e.source}->${e.target}`;

export function previewMarks(before: Diagram, after: Diagram): PreviewMarks {
  const d = diffDiagrams(before, after);
  return {
    addedNodes: new Set(d.nodes.added.map((n) => n.id)),
    changedNodes: new Set(d.nodes.changed.map((c) => c.key)),
    removedNodes: new Set(d.nodes.removed.map((n) => n.id)),
    addedEdges: new Set(d.edges.added.map(edgeKey)),
    removedEdges: new Set(d.edges.removed.map(edgeKey)),
  };
}

/** Whether the drawing changes at all (a change to traffic or requirements alone draws the same). */
export function changesDrawing(m: PreviewMarks): boolean {
  return m.addedNodes.size + m.changedNodes.size + m.removedNodes.size + m.addedEdges.size + m.removedEdges.size > 0;
}
