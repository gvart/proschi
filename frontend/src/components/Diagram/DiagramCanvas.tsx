import { useEffect } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, ReactFlowProvider, useNodesInitialized, useReactFlow } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import TextNode from '../Canvas/TextNode';

/**
 * A read-only canvas of a parsed diagram, for pages that show a design without
 * editing it through the canvas (the HLD overview, the practice editor).
 */

const nodeTypes = { componentNode: ComponentNode, groupNode: GroupNode, textNode: TextNode };

interface DiagramCanvasProps {
  nodes: Node[];
  edges: Edge[];
  /** Hide zoom controls, e.g. for a small preview. */
  compact?: boolean;
  /** Changes when the canvas becomes visible again, so it can re-fit. */
  fitKey?: string;
}

function Canvas({ nodes, edges, compact, fitKey }: DiagramCanvasProps) {
  const { fitView } = useReactFlow();
  const measured = useNodesInitialized();
  const structure = nodes.map((n) => n.id).join('|');
  useEffect(() => {
    if (!measured) return;
    const frame = requestAnimationFrame(() => fitView({ padding: 0.15 }));
    return () => cancelAnimationFrame(frame);
  }, [structure, measured, fitView, fitKey]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      zoomOnScroll={!compact}
      preventScrolling={!compact}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      {!compact && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}

export default function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
