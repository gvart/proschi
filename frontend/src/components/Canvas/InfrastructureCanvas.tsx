import { useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from 'reactflow';
import type { NodeTypes, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import ComponentNode from './ComponentNode';
import ComponentPalette from './ComponentPalette';
import MetadataEditor from './MetadataEditor';
import EdgeEditor from './EdgeEditor';
import TextNode from './TextNode';
import GroupNode from './GroupNode';

const nodeTypes: NodeTypes = {
  componentNode: ComponentNode,
  textNode: TextNode,
  groupNode: GroupNode,
};

export default function InfrastructureCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    selectEdge,
    loadProject,
  } = useCanvasStore();

  useEffect(() => {
    // Load the default project on mount
    loadProject('1');
  }, [loadProject]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node);
    },
    [selectNode]
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      selectNode(null);
      selectEdge(edge);
    },
    [selectNode, selectEdge]
  );

  return (
    <div className="w-full h-screen bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-gray-50"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            switch (node.data.type) {
              case 'service':
                return '#3b82f6';
              case 'database':
                return '#10b981';
              case 'queue':
                return '#a855f7';
              case 'external':
                return '#f97316';
              case 'text':
                return '#eab308';
              case 'group':
                return node.data.borderColor || '#3b82f6';
              default:
                return '#6b7280';
            }
          }}
        />
      </ReactFlow>

      <ComponentPalette />
      <MetadataEditor />
      <EdgeEditor />
    </div>
  );
}
