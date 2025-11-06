import { useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from 'reactflow';
import type { NodeTypes, Node } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import ComponentNode from './ComponentNode';
import ComponentPalette from './ComponentPalette';
import MetadataEditor from './MetadataEditor';

const nodeTypes: NodeTypes = {
  componentNode: ComponentNode,
};

export default function InfrastructureCanvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
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
  }, [selectNode]);

  return (
    <div className="w-full h-screen bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
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
              default:
                return '#6b7280';
            }
          }}
        />
      </ReactFlow>

      <ComponentPalette />
      <MetadataEditor />
    </div>
  );
}
