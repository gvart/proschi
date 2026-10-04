import { useEffect, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { Diagram } from '../../dsl';
import { layoutDiagram, provisionalLayout, toFlowEdges } from '../../dsl/layout';
import { settleNodes } from './settle';

/**
 * Lays `diagram` out (ELK, async, in a worker) whenever it changes and passes
 * the nodes to `apply`, which must be stable. While nothing laid out is shown
 * yet (ELK is still loading), a provisional grid comes first and then glides
 * into ELK's layout. Returns a counter that changes once that has happened, so
 * the view can fit the final layout. With `everyLayout` it changes after every
 * new layout instead: for read-only canvases, which should re-fit whenever the
 * layout moves (edges added between the same nodes reshape it too).
 */
export function useAutoLayout(diagram: Diagram, apply: (nodes: Node[]) => void, { everyLayout = false } = {}): number {
  const shown = useRef<{ nodes: Node[]; provisional: boolean }>({ nodes: [], provisional: false });
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let cancelSettle = () => {};
    const show = (nodes: Node[], provisional: boolean) => {
      shown.current = { nodes, provisional };
      apply(nodes);
    };
    let from: Node[] | undefined;
    if ((shown.current.nodes.length === 0 || shown.current.provisional) && diagram.nodes.length > 0) {
      // Nodes still on their way keep their place; the rest start on the grid.
      const current = new Map(shown.current.nodes.map((n) => [n.id, n]));
      from = provisionalLayout(diagram).map((n) => {
        const c = current.get(n.id);
        return c && c.parentNode === n.parentNode ? { ...n, position: c.position } : n;
      });
      show(from, true);
    }
    layoutDiagram(diagram)
      .then((laidOut) => {
        if (cancelled) return;
        if (!from) {
          show(laidOut, false);
          if (everyLayout) setSettled((n) => n + 1);
          return;
        }
        cancelSettle = settleNodes(from, laidOut, (nodes) => {
          show(nodes, nodes !== laidOut);
          if (nodes === laidOut) setSettled((n) => n + 1);
        });
      })
      .catch((error) => console.error('Layout failed:', error));
    return () => {
      cancelled = true;
      cancelSettle();
    };
  }, [diagram, apply, everyLayout]);
  return settled;
}

/**
 * React Flow nodes and edges of a diagram, laid out again whenever it changes, for read-only canvases;
 * `settled` changes after every layout (useAutoLayout's `everyLayout`), so a fit key built on it re-fits.
 */
export function useDiagramLayout(diagram: Diagram): { nodes: Node[]; edges: Edge[]; settled: number } {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => setEdges(toFlowEdges(diagram)), [diagram]);
  const settled = useAutoLayout(diagram, setNodes, { everyLayout: true });
  return { nodes, edges, settled };
}
