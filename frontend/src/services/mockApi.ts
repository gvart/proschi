import type { Project, CanvasState } from '../types/canvas';

// Simulated delay for API calls
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock data
const mockProjects: Project[] = [
  {
    id: '1',
    name: 'E-Commerce Platform',
    description: 'Main e-commerce microservices architecture',
    createdAt: new Date('2024-01-15').toISOString(),
    updatedAt: new Date('2024-03-20').toISOString(),
    canvasState: {
      nodes: [
        {
          id: 'node-1',
          type: 'componentNode',
          position: { x: 250, y: 100 },
          data: {
            id: 'node-1',
            name: 'API Gateway',
            type: 'service',
            techStack: 'REST API',
            ownerTeam: 'Platform',
            description: 'Main entry point for all client requests'
          }
        },
        {
          id: 'node-2',
          type: 'componentNode',
          position: { x: 100, y: 300 },
          data: {
            id: 'node-2',
            name: 'Order Service',
            type: 'service',
            techStack: 'REST API',
            ownerTeam: 'Orders',
            description: 'Handles order processing and management'
          }
        },
        {
          id: 'node-3',
          type: 'componentNode',
          position: { x: 400, y: 300 },
          data: {
            id: 'node-3',
            name: 'User Service',
            type: 'service',
            techStack: 'GraphQL',
            ownerTeam: 'Platform',
            description: 'User authentication and profile management'
          }
        },
        {
          id: 'node-4',
          type: 'componentNode',
          position: { x: 100, y: 500 },
          data: {
            id: 'node-4',
            name: 'Orders DB',
            type: 'database',
            techStack: 'PostgreSQL',
            ownerTeam: 'Orders',
            description: 'Order data storage'
          }
        },
        {
          id: 'node-5',
          type: 'componentNode',
          position: { x: 400, y: 500 },
          data: {
            id: 'node-5',
            name: 'Users DB',
            type: 'database',
            techStack: 'PostgreSQL',
            ownerTeam: 'Platform',
            description: 'User data storage'
          }
        },
        {
          id: 'node-6',
          type: 'componentNode',
          position: { x: 700, y: 300 },
          data: {
            id: 'node-6',
            name: 'Event Bus',
            type: 'queue',
            techStack: 'Kafka',
            ownerTeam: 'Platform',
            description: 'Event streaming platform'
          }
        }
      ],
      edges: [
        { id: 'edge-1', source: 'node-1', target: 'node-2', label: 'HTTP' },
        { id: 'edge-2', source: 'node-1', target: 'node-3', label: 'GraphQL' },
        { id: 'edge-3', source: 'node-2', target: 'node-4', label: 'SQL' },
        { id: 'edge-4', source: 'node-3', target: 'node-5', label: 'SQL' },
        { id: 'edge-5', source: 'node-2', target: 'node-6', label: 'Publish' },
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  },
  {
    id: '2',
    name: 'Analytics Pipeline',
    description: 'Data analytics and reporting infrastructure',
    createdAt: new Date('2024-02-10').toISOString(),
    updatedAt: new Date('2024-03-18').toISOString(),
    canvasState: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  }
];

let currentProject: Project | null = mockProjects[0];

// Mock API methods
export const mockApi = {
  // Projects
  async getProjects(): Promise<Project[]> {
    await delay(300);
    return [...mockProjects];
  },

  async getProject(id: string): Promise<Project | null> {
    await delay(200);
    return mockProjects.find(p => p.id === id) || null;
  },

  async createProject(name: string, description?: string): Promise<Project> {
    await delay(400);
    const newProject: Project = {
      id: `project-${Date.now()}`,
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      canvasState: {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      }
    };
    mockProjects.push(newProject);
    return newProject;
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    await delay(300);
    const project = mockProjects.find(p => p.id === id);
    if (!project) throw new Error('Project not found');

    Object.assign(project, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    return project;
  },

  async deleteProject(id: string): Promise<void> {
    await delay(300);
    const index = mockProjects.findIndex(p => p.id === id);
    if (index !== -1) {
      mockProjects.splice(index, 1);
    }
  },

  // Canvas state
  async getCanvasState(projectId: string): Promise<CanvasState> {
    await delay(200);
    const project = mockProjects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    return project.canvasState;
  },

  async saveCanvasState(projectId: string, canvasState: CanvasState): Promise<void> {
    await delay(300);
    const project = mockProjects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');

    project.canvasState = canvasState;
    project.updatedAt = new Date().toISOString();
  },

  // Current project helpers
  getCurrentProject(): Project | null {
    return currentProject;
  },

  setCurrentProject(project: Project): void {
    currentProject = project;
  }
};
