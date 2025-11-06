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
  selectedEdge: Edge | null;

  // Actions
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addNode: (type: ComponentMetadata['type'], techStack: ComponentMetadata['techStack']) => void;
  deleteNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<ComponentMetadata>) => void;
  selectNode: (node: Node | null) => void;
  selectEdge: (edge: Edge | null) => void;
  updateEdgeData: (edgeId: string, data: Partial<Edge>) => void;
  deleteEdge: (edgeId: string) => void;
  loadProject: (projectId: string) => Promise<void>;
  saveCanvas: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  currentProject: null,
  selectedNode: null,
  selectedEdge: null,

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

  selectNode: (node) => set({ selectedNode: node, selectedEdge: null }),

  selectEdge: (edge) => set({ selectedEdge: edge, selectedNode: null }),

  updateEdgeData: (edgeId, data) => {
    set({
      edges: get().edges.map(edge => {
        if (edge.id === edgeId) {
          return { ...edge, ...data };
        }
        return edge;
      }),
    });
  },

  deleteEdge: (edgeId) => {
    set({
      edges: get().edges.filter(edge => edge.id !== edgeId),
      selectedEdge: get().selectedEdge?.id === edgeId ? null : get().selectedEdge,
    });
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
