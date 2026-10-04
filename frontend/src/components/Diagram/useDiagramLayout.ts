import { useEffect, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { Diagram } from '../../dsl';
import { layoutDiagram, toFlowEdges } from '../../dsl/layout';

/** React Flow nodes and edges of a diagram, laid out again (ELK, async) whenever it changes. */
export function useDiagramLayout(diagram: Diagram): { nodes: Node[]; edges: Edge[] } {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => {
    let cancelled = false;
    setEdges(toFlowEdges(diagram));
    layoutDiagram(diagram)
      .then((laidOut) => !cancelled && setNodes(laidOut))
      .catch((error) => console.error('Layout failed:', error));
    return () => {
      cancelled = true;
    };
  }, [diagram]);
  return { nodes, edges };
}
