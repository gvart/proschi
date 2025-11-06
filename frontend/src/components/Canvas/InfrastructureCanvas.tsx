import { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from 'reactflow';
import type { NodeTypes, Node, Edge, ReactFlowInstance } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';

import { useCanvasStore } from '../../store/canvasStore';
import ComponentNode from './ComponentNode';
import ComponentPalette from './ComponentPalette';
import MetadataEditor from './MetadataEditor';
import EdgeEditor from './EdgeEditor';
import TextNode from './TextNode';
import GroupNode from './GroupNode';
import { ContextMenu, createNodeContextMenuItems } from './ContextMenu';

const nodeTypes: NodeTypes = {
  componentNode: ComponentNode,
  textNode: TextNode,
  groupNode: GroupNode,
};

function InfrastructureCanvasContent() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    selectNode,
    selectEdge,
    selectedNodes,
    setSelectedNodes,
    clipboard,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNodes,
    deleteSelectedNodes,
    bringToFront,
    sendToBack,
  } = useCanvasStore();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

  // Handle node selection changes from ReactFlow
  const handleNodesChange = useCallback(
    (changes: any[]) => {
      onNodesChange(changes);

      // Update selected nodes when selection changes
      const selectionChanges = changes.filter(
        (change) => change.type === 'select'
      );

      if (selectionChanges.length > 0) {
        const selected = nodes
          .filter((node) => node.selected)
          .map((node) => node.id);
        setSelectedNodes(selected);
      }
    },
    [onNodesChange, nodes, setSelectedNodes]
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node);
    },
    [selectNode]
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
    setContextMenu(null);
  }, [selectNode, selectEdge]);

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      selectNode(null);
      selectEdge(edge);
      setContextMenu(null);
    },
    [selectNode, selectEdge]
  );

  // Handle right-click on nodes or canvas
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if user is typing in an input field
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? event.metaKey : event.ctrlKey;

      // Delete
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelectedNodes();
      }
      // Copy (Ctrl/Cmd + C)
      else if (modKey && event.key === 'c') {
        event.preventDefault();
        copySelectedNodes();
      }
      // Paste (Ctrl/Cmd + V)
      else if (modKey && event.key === 'v') {
        event.preventDefault();
        pasteNodes();
      }
      // Duplicate (Ctrl/Cmd + D)
      else if (modKey && event.key === 'd') {
        event.preventDefault();
        duplicateSelectedNodes();
      }
      // Select All (Ctrl/Cmd + A)
      else if (modKey && event.key === 'a') {
        event.preventDefault();
        const allNodeIds = nodes.map((node) => node.id);
        setSelectedNodes(allNodeIds);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    deleteSelectedNodes,
    copySelectedNodes,
    pasteNodes,
    duplicateSelectedNodes,
    nodes,
    setSelectedNodes,
  ]);

  // Context menu items
  const contextMenuItems = createNodeContextMenuItems(
    selectedNodes.length,
    clipboard.length > 0,
    () => copySelectedNodes(),
    () => {
      if (contextMenu && reactFlowInstanceRef.current) {
        const position = reactFlowInstanceRef.current.screenToFlowPosition({
          x: contextMenu.x,
          y: contextMenu.y,
        });
        pasteNodes(position);
      } else {
        pasteNodes();
      }
    },
    () => duplicateSelectedNodes(),
    () => deleteSelectedNodes(),
    () => bringToFront(selectedNodes),
    () => sendToBack(selectedNodes)
  );

  return (
    <div className="w-full h-screen bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onContextMenu={handleContextMenu}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        nodeTypes={nodeTypes}
        fitView
        className="bg-gray-50"
        multiSelectionKeyCode="Control"
        selectionKeyCode="Shift"
        deleteKeyCode={null} // Disable default delete, we handle it ourselves
        panOnDrag={[1, 2]} // Pan with left and middle mouse button
        selectionOnDrag // Enable box selection
        elevateNodesOnSelect={false} // Disable auto-elevation so our zIndex control works
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ComponentPalette />
      <MetadataEditor />
      <EdgeEditor />
    </div>
  );
}

export default function InfrastructureCanvas() {
  const { loadProject } = useCanvasStore();

  useEffect(() => {
    // Load the default project on mount
    loadProject('1');
  }, [loadProject]);

  return <InfrastructureCanvasContent />;
}
