import ReactFlow, { Background, BackgroundVariant, Controls, ReactFlowProvider } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import ComponentNode from '../Canvas/ComponentNode';
import GroupNode from '../Canvas/GroupNode';
import TextNode from '../Canvas/TextNode';
import { useFitOnChange } from './useFitOnChange';

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
  /** No pan or zoom by hand, so touch and wheel scroll the page (an embedded preview). */
  still?: boolean;
  /** Glide to each new fit over this many ms instead of jumping. */
  fitDuration?: number;
}

function Canvas({ nodes, edges, compact, fitKey, still, fitDuration }: DiagramCanvasProps) {
  useFitOnChange(`${nodes.map((n) => n.id).join('|')}#${fitKey ?? ''}`, { duration: fitDuration });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      zoomOnScroll={!compact && !still}
      zoomOnPinch={!still}
      zoomOnDoubleClick={!still}
      panOnDrag={!still}
      preventScrolling={!compact && !still}
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      {!compact && !still && <Controls showInteractive={false} />}
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
