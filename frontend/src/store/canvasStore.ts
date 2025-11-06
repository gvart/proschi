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
  loadProject: (projectId: string) => Promise<void>;
  saveCanvas: () => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: [],
  edges: [],
  currentProject: null,
  selectedNode: null,

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
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: 'componentNode',
      position: {
        x: Math.random() * 400 + 200,
        y: Math.random() * 300 + 100,
      },
      data: {
        id: `node-${Date.now()}`,
        name: `New ${type}`,
        type,
        techStack,
        ownerTeam: '',
        description: '',
      },
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

  selectNode: (node) => set({ selectedNode: node }),

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
