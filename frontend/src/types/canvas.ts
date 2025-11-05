export type ComponentType = 'service' | 'database' | 'queue' | 'external';

export type TechStack =
  // Services
  | 'REST API'
  | 'GraphQL'
  | 'gRPC'
  | 'WebSocket'
  // Databases
  | 'PostgreSQL'
  | 'MySQL'
  | 'MongoDB'
  | 'Redis'
  | 'DynamoDB'
  // Queues
  | 'Kafka'
  | 'RabbitMQ'
  | 'SQS'
  | 'Redis Queue'
  // External
  | 'Third Party API'
  | 'Payment Gateway'
  | 'Auth Service';

export interface ComponentMetadata {
  id: string;
  name: string;
  type: ComponentType;
  techStack: TechStack;
  ownerTeam?: string;
  description?: string;
}

export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: ComponentMetadata;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  canvasState: CanvasState;
}
