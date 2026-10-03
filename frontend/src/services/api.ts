import { loadJson, saveJson } from './storage';

// Types
export type ExecutionType = 'SYNC_REQUEST_RESPONSE' | 'ASYNC_FIRE_AND_FORGET' | 'ASYNC_REQUEST_RESPONSE';
export type Protocol = 'REST' | 'GRPC' | 'SOAP' | 'GRAPHQL' | 'MESSAGING' | 'OTHER';

export interface FlowStep {
  id?: string;
  stepOrder: number;
  stepName: string;
  fromServiceId: string;
  toServiceId: string;
  protocol: Protocol;
  httpMethod: string;
  endpoint: string;
  requestFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  requestBody?: string;
  responseFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  responseBody?: string;
  statusCode?: number;
  description?: string;
  executionType: ExecutionType;
  parallelGroup?: number;
  isParallel: boolean;
  isConditional: boolean;
  conditionExpression?: string;
  /** The call never got an answer (connection refused, timeout); written `a -x b`. */
  failed?: boolean;
}

export interface UseCase {
  id: string;
  name: string;
  description?: string;
  entryServiceId?: string;
  projectId: string;
  steps: FlowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface UseCaseListItem {
  id: string;
  name: string;
  description?: string;
  entryServiceId?: string;
  projectId: string;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUseCaseRequest {
  name: string;
  description?: string;
  entryServiceId?: string;
}

export interface UpdateUseCaseRequest {
  name: string;
  description?: string;
  entryServiceId?: string;
}

export interface CreateFlowStepRequest {
  stepOrder: number;
  stepName: string;
  fromServiceId: string;
  toServiceId: string;
  protocol: Protocol;
  httpMethod: string;
  endpoint: string;
  requestFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  requestBody?: string;
  responseFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  responseBody?: string;
  statusCode?: number;
  description?: string;
  executionType: ExecutionType;
  parallelGroup?: number;
  isParallel: boolean;
  isConditional: boolean;
  conditionExpression?: string;
}

// Initialize with sample data
const sampleUseCase: UseCase = {
  id: 'usecase-1',
  name: 'Create Order Flow',
  description: 'Complete flow for creating a new order in the e-commerce system',
  entryServiceId: 'node-1',
  projectId: '1',
  steps: [
    {
      id: 'step-1',
      stepOrder: 0,
      stepName: 'Client Request',
      fromServiceId: 'node-1',
      toServiceId: 'node-2',
      protocol: 'REST',
      httpMethod: 'POST',
      endpoint: '/api/orders',
      requestFormat: 'JSON',
      requestBody: JSON.stringify({
        userId: 'user123',
        items: [
          { productId: 'prod-1', quantity: 2, price: 29.99 },
          { productId: 'prod-2', quantity: 1, price: 49.99 }
        ],
        shippingAddress: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zip: '94102'
        }
      }, null, 2),
      responseFormat: 'JSON',
      responseBody: JSON.stringify({
        orderId: 'order-789',
        status: 'pending',
        totalAmount: 109.97
      }, null, 2),
      statusCode: 201,
      description: 'API Gateway receives create order request from client and sends response back',
      executionType: 'SYNC_REQUEST_RESPONSE',
      parallelGroup: undefined,
      isParallel: false,
      isConditional: false,
    },
    {
      id: 'step-2',
      stepOrder: 1,
      stepName: 'Validate User',
      fromServiceId: 'node-2',
      toServiceId: 'node-3',
      protocol: 'REST',
      httpMethod: 'GET',
      endpoint: '/api/users/user123',
      requestFormat: 'JSON',
      requestBody: '',
      responseFormat: 'JSON',
      responseBody: JSON.stringify({
        userId: 'user123',
        email: 'user@example.com',
        verified: true,
        creditLimit: 5000
      }, null, 2),
      statusCode: 200,
      description: 'Order Service validates user exists and is active (waits for response)',
      executionType: 'SYNC_REQUEST_RESPONSE',
      parallelGroup: undefined,
      isParallel: false,
      isConditional: false,
    },
    {
      id: 'step-3',
      stepOrder: 2,
      stepName: 'Store Order',
      fromServiceId: 'node-2',
      toServiceId: 'node-4',
      protocol: 'REST',
      httpMethod: 'POST',
      endpoint: '/orders',
      requestFormat: 'JSON',
      requestBody: JSON.stringify({
        orderId: 'order-789',
        userId: 'user123',
        items: '...',
        status: 'pending',
        createdAt: new Date().toISOString()
      }, null, 2),
      responseFormat: 'JSON',
      responseBody: JSON.stringify({
        success: true,
        insertedId: 'order-789'
      }, null, 2),
      statusCode: 201,
      description: 'Persist order details to database (runs in parallel with event publishing)',
      executionType: 'SYNC_REQUEST_RESPONSE',
      parallelGroup: 1,
      isParallel: true,
      isConditional: false,
    },
    {
      id: 'step-4',
      stepOrder: 3,
      stepName: 'Publish Event',
      fromServiceId: 'node-2',
      toServiceId: 'node-6',
      protocol: 'MESSAGING',
      httpMethod: 'POST',
      endpoint: '/events',
      requestFormat: 'JSON',
      requestBody: JSON.stringify({
        eventType: 'OrderCreated',
        orderId: 'order-789',
        timestamp: new Date().toISOString()
      }, null, 2),
      responseFormat: 'JSON',
      responseBody: JSON.stringify({
        messageId: 'msg-123',
        published: true
      }, null, 2),
      statusCode: 200,
      description: 'Fire-and-forget event publish to message queue (no response wait)',
      executionType: 'ASYNC_FIRE_AND_FORGET',
      parallelGroup: 1,
      isParallel: true,
      isConditional: false,
    },
  ],
  createdAt: new Date('2024-03-15').toISOString(),
  updatedAt: new Date('2024-03-20').toISOString(),
};

// Use cases are stored in the browser; the sample is seeded on first visit.
const USE_CASES_KEY = 'proschi.useCases';

const useCases = new Map<string, UseCase>(
  loadJson<UseCase[]>(USE_CASES_KEY, [sampleUseCase]).map(uc => [uc.id, uc])
);

const persist = () => saveJson(USE_CASES_KEY, Array.from(useCases.values()));

class LocalUseCaseService {
  async getUseCases(projectId: string): Promise<UseCaseListItem[]> {
    return Array.from(useCases.values())
      .filter(uc => uc.projectId === projectId)
      .map(uc => ({
        id: uc.id,
        name: uc.name,
        description: uc.description,
        entryServiceId: uc.entryServiceId,
        projectId: uc.projectId,
        stepCount: uc.steps.length,
        createdAt: uc.createdAt,
        updatedAt: uc.updatedAt,
      }));
  }

  async getUseCase(useCaseId: string): Promise<UseCase> {
    const useCase = useCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    return { ...useCase };
  }

  async createUseCase(
    projectId: string,
    data: CreateUseCaseRequest
  ): Promise<UseCase> {
    const newUseCase: UseCase = {
      id: `usecase-${Date.now()}`,
      name: data.name,
      description: data.description,
      entryServiceId: data.entryServiceId,
      projectId,
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    useCases.set(newUseCase.id, newUseCase);
    persist();
    return { ...newUseCase };
  }

  async updateUseCase(
    useCaseId: string,
    data: UpdateUseCaseRequest
  ): Promise<UseCase> {
    const useCase = useCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    useCase.name = data.name;
    useCase.description = data.description;
    useCase.entryServiceId = data.entryServiceId;
    useCase.updatedAt = new Date().toISOString();
    persist();
    return { ...useCase };
  }

  async deleteUseCase(useCaseId: string): Promise<void> {
    useCases.delete(useCaseId);
    persist();
  }

  async addFlowStep(
    useCaseId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    const useCase = useCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    const newStep: FlowStep = {
      id: `step-${Date.now()}`,
      ...data,
    };
    useCase.steps.push(newStep);
    useCase.steps.sort((a, b) => a.stepOrder - b.stepOrder);
    useCase.updatedAt = new Date().toISOString();
    persist();
    return { ...useCase };
  }

  async updateFlowStep(
    useCaseId: string,
    stepId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    const useCase = useCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    const stepIndex = useCase.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) {
      throw new Error('Step not found');
    }
    useCase.steps[stepIndex] = {
      ...useCase.steps[stepIndex],
      ...data,
    };
    useCase.steps.sort((a, b) => a.stepOrder - b.stepOrder);
    useCase.updatedAt = new Date().toISOString();
    persist();
    return { ...useCase };
  }

  async deleteFlowStep(useCaseId: string, stepId: string): Promise<void> {
    const useCase = useCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    useCase.steps = useCase.steps.filter(s => s.id !== stepId);
    useCase.updatedAt = new Date().toISOString();
    persist();
  }
}

export const api = new LocalUseCaseService();
