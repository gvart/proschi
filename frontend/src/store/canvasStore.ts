import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
} from 'reactflow';
import type { ComponentMetadata, Project } from '../types/canvas';
import { mockApi } from '../services/mockApi';

interface CanvasStore {
  nodes: Node[];
  edges: Edge[];
  currentProject: Project | null;
  selectedNode: Node | null;
  selectedNodes: string[]; // Array of selected node IDs for multi-select
  selectedEdge: Edge | null;
  clipboard: Node[]; // Clipboard for copy/paste

  // Actions
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (type: ComponentMetadata['type'], techStack: ComponentMetadata['techStack']) => void;
  deleteNode: (nodeId: string) => void;
  deleteSelectedNodes: () => void;
  updateNodeData: (nodeId: string, data: Partial<ComponentMetadata>) => void;
  selectNode: (node: Node | null) => void;
  setSelectedNodes: (nodeIds: string[]) => void;
  selectEdge: (edge: Edge | null) => void;
  updateEdgeData: (edgeId: string, data: Partial<Edge>) => void;
  deleteEdge: (edgeId: string) => void;
  copySelectedNodes: () => void;
  pasteNodes: (position?: { x: number; y: number }) => void;
  duplicateSelectedNodes: () => void;
  bringToFront: (nodeIds: string[]) => void;
  sendToBack: (nodeIds: string[]) => void;
  loadProject: (projectId: string) => Promise<void>;
  saveCanvas: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  currentProject: null,
  selectedNode: null,
  selectedNodes: [],
  selectedEdge: null,
  clipboard: [],

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),

  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },

  addNode: (type, techStack) => {
    let nodeType = 'componentNode';
    const nodeData: ComponentMetadata = {
      id: `node-${Date.now()}`,
      name: `New ${type}`,
      type,
      techStack,
      ownerTeam: '',
      description: '',
    };

    // Set node type based on component type
    if (type === 'text') {
      nodeType = 'textNode';
      nodeData.textContent = 'Enter your text here...';
      nodeData.fontSize = 14;
    } else if (type === 'group') {
      nodeType = 'groupNode';
      nodeData.backgroundColor = '#f0f9ff';
      nodeData.borderColor = '#3b82f6';
      nodeData.borderStyle = 'dashed';
    }

    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: nodeType,
      position: {
        x: Math.random() * 400 + 200,
        y: Math.random() * 300 + 100,
      },
      data: nodeData,
      zIndex: 1000, // Default zIndex for new nodes
    };

    set({ nodes: [...get().nodes, newNode] });
  },

  deleteNode: (nodeId) => {
    set({
      nodes: get().nodes.filter(node => node.id !== nodeId),
      edges: get().edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
      selectedNode: get().selectedNode?.id === nodeId ? null : get().selectedNode,
    });
  },

  updateNodeData: (nodeId, data) => {
    set({
      nodes: get().nodes.map(node => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: { ...node.data, ...data },
          };
        }
        return node;
      }),
    });
  },

  selectNode: (node) => set({
    selectedNode: node,
    selectedNodes: node ? [node.id] : [],
    selectedEdge: null
  }),

  setSelectedNodes: (nodeIds) => set({
    selectedNodes: nodeIds,
    selectedNode: nodeIds.length === 1 ? get().nodes.find(n => n.id === nodeIds[0]) || null : null,
    selectedEdge: null,
  }),

  selectEdge: (edge) => set({
    selectedEdge: edge,
    selectedNode: null,
    selectedNodes: []
  }),

  updateEdgeData: (edgeId, data) => {
    const updatedEdges = get().edges.map(edge => {
      if (edge.id === edgeId) {
        return { ...edge, ...data };
      }
      return edge;
    });

    // Also update selectedEdge if it's the one being modified
    const currentSelectedEdge = get().selectedEdge;
    const updatedSelectedEdge = currentSelectedEdge?.id === edgeId
      ? { ...currentSelectedEdge, ...data }
      : currentSelectedEdge;

    set({
      edges: updatedEdges,
      selectedEdge: updatedSelectedEdge,
    });
  },

  deleteEdge: (edgeId) => {
    set({
      edges: get().edges.filter(edge => edge.id !== edgeId),
      selectedEdge: get().selectedEdge?.id === edgeId ? null : get().selectedEdge,
    });
  },

  deleteSelectedNodes: () => {
    const { selectedNodes } = get();
    if (selectedNodes.length === 0) return;

    set({
      nodes: get().nodes.filter(node => !selectedNodes.includes(node.id)),
      edges: get().edges.filter(edge =>
        !selectedNodes.includes(edge.source) && !selectedNodes.includes(edge.target)
      ),
      selectedNode: null,
      selectedNodes: [],
    });
  },

  copySelectedNodes: () => {
    const { nodes, selectedNodes } = get();
    const nodesToCopy = nodes.filter(node => selectedNodes.includes(node.id));
    set({ clipboard: nodesToCopy });
  },

  pasteNodes: (position) => {
    const { clipboard, nodes } = get();
    if (clipboard.length === 0) return;

    // Calculate offset for pasted nodes
    const offset = position
      ? { x: position.x - clipboard[0].position.x, y: position.y - clipboard[0].position.y }
      : { x: 50, y: 50 };

    // Find the maximum zIndex to place new nodes on top
    const maxZIndex = Math.max(...nodes.map(n => n.zIndex || 0), 0);

    const newNodes = clipboard.map((node, index) => {
      const newId = `node-${Date.now()}-${index}`;
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y,
        },
        data: {
          ...node.data,
          id: newId,
        },
        selected: true,
        zIndex: maxZIndex + 1 + index, // Place on top with incremental zIndex
      };
    });

    const newNodeIds = newNodes.map(n => n.id);
    set({
      nodes: [...nodes, ...newNodes],
      selectedNodes: newNodeIds,
      selectedNode: newNodes.length === 1 ? newNodes[0] : null,
    });
  },

  duplicateSelectedNodes: () => {
    const { nodes, selectedNodes } = get();
    const nodesToDuplicate = nodes.filter(node => selectedNodes.includes(node.id));

    // Find the maximum zIndex to place new nodes on top
    const maxZIndex = Math.max(...nodes.map(n => n.zIndex || 0), 0);

    const newNodes = nodesToDuplicate.map((node, index) => {
      const newId = `node-${Date.now()}-${index}`;
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + 50,
          y: node.position.y + 50,
        },
        data: {
          ...node.data,
          id: newId,
          name: `${node.data.name} (Copy)`,
        },
        selected: true,
        zIndex: maxZIndex + 1 + index, // Place on top with incremental zIndex
      };
    });

    const newNodeIds = newNodes.map(n => n.id);
    set({
      nodes: [...nodes, ...newNodes],
      selectedNodes: newNodeIds,
      selectedNode: newNodes.length === 1 ? newNodes[0] : null,
    });
  },

  bringToFront: (nodeIds) => {
    const { nodes } = get();

    // Find the maximum zIndex currently in use
    const maxZIndex = Math.max(...nodes.map(n => n.zIndex || 0), 0);

    // Update nodes: bring selected nodes to front with higher zIndex
    const updatedNodes = nodes.map(node => {
      if (nodeIds.includes(node.id)) {
        return {
          ...node,
          zIndex: maxZIndex + 1,
        };
      }
      return node;
    });

    set({ nodes: updatedNodes });
  },

  sendToBack: (nodeIds) => {
    const { nodes } = get();

    // Find the minimum zIndex currently in use
    const minZIndex = Math.min(...nodes.map(n => n.zIndex || 0), 0);

    // Update nodes: send selected nodes to back with lower zIndex
    const updatedNodes = nodes.map(node => {
      if (nodeIds.includes(node.id)) {
        return {
          ...node,
          zIndex: minZIndex - 1,
        };
      }
      return node;
    });

    set({ nodes: updatedNodes });
  },

  loadProject: async (projectId) => {
    const project = await mockApi.getProject(projectId);
    if (project) {
      set({
        currentProject: project,
        nodes: project.canvasState.nodes,
        edges: project.canvasState.edges,
      });
    }
  },

  saveCanvas: async () => {
    const { currentProject, nodes, edges } = get();
    if (currentProject) {
      // Convert ReactFlow types to Canvas types
      const canvasNodes = nodes.map(node => ({
        id: node.id,
        type: node.type || 'default',
        position: node.position,
        data: node.data as ComponentMetadata,
      }));

      const canvasEdges = edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: typeof edge.label === 'string' ? edge.label : undefined,
      }));

      await mockApi.saveCanvasState(currentProject.id, {
        nodes: canvasNodes,
        edges: canvasEdges,
        viewport: { x: 0, y: 0, zoom: 1 },
      });
    }
  },

  setCurrentProject: (project) => {
    set({
      currentProject: project,
      nodes: project?.canvasState.nodes || [],
      edges: project?.canvasState.edges || [],
    });
  },
}));
