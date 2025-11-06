// Set to true to use mock data, false to use real API
const USE_MOCK_DATA = true;

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Types
export interface FlowStep {
  id?: string;
  stepOrder: number;
  stepName: string;
  fromServiceId: string;
  toServiceId: string;
  httpMethod: string;
  endpoint: string;
  requestFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  requestBody?: string;
  responseFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  responseBody?: string;
  statusCode?: number;
  description?: string;
  isParallel: boolean;
  isConditional: boolean;
  conditionExpression?: string;
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
  httpMethod: string;
  endpoint: string;
  requestFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  requestBody?: string;
  responseFormat: 'JSON' | 'XML' | 'FREE_TEXT';
  responseBody?: string;
  statusCode?: number;
  description?: string;
  isParallel: boolean;
  isConditional: boolean;
  conditionExpression?: string;
}

// Mock Data Store
const mockUseCases: Map<string, UseCase> = new Map();

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
      description: 'API Gateway receives create order request from client',
      isParallel: false,
      isConditional: false,
    },
    {
      id: 'step-2',
      stepOrder: 1,
      stepName: 'Validate User',
      fromServiceId: 'node-2',
      toServiceId: 'node-3',
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
      description: 'Order Service validates user exists and is active',
      isParallel: false,
      isConditional: false,
    },
    {
      id: 'step-3',
      stepOrder: 2,
      stepName: 'Store Order',
      fromServiceId: 'node-2',
      toServiceId: 'node-4',
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
      description: 'Persist order details to database',
      isParallel: false,
      isConditional: false,
    },
    {
      id: 'step-4',
      stepOrder: 3,
      stepName: 'Publish Event',
      fromServiceId: 'node-2',
      toServiceId: 'node-6',
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
      description: 'Publish order created event to message queue',
      isParallel: false,
      isConditional: false,
    },
  ],
  createdAt: new Date('2024-03-15').toISOString(),
  updatedAt: new Date('2024-03-20').toISOString(),
};

mockUseCases.set(sampleUseCase.id, sampleUseCase);

// Helper function to simulate API delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock API Service
class MockApiService {
  async getUseCases(projectId: string): Promise<UseCaseListItem[]> {
    await delay(300);
    const useCases = Array.from(mockUseCases.values())
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
    return useCases;
  }

  async getUseCase(useCaseId: string): Promise<UseCase> {
    await delay(200);
    const useCase = mockUseCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    return { ...useCase };
  }

  async createUseCase(
    projectId: string,
    data: CreateUseCaseRequest
  ): Promise<UseCase> {
    await delay(400);
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
    mockUseCases.set(newUseCase.id, newUseCase);
    return { ...newUseCase };
  }

  async updateUseCase(
    useCaseId: string,
    data: UpdateUseCaseRequest
  ): Promise<UseCase> {
    await delay(300);
    const useCase = mockUseCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    useCase.name = data.name;
    useCase.description = data.description;
    useCase.entryServiceId = data.entryServiceId;
    useCase.updatedAt = new Date().toISOString();
    return { ...useCase };
  }

  async deleteUseCase(useCaseId: string): Promise<void> {
    await delay(300);
    mockUseCases.delete(useCaseId);
  }

  async addFlowStep(
    useCaseId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    await delay(400);
    const useCase = mockUseCases.get(useCaseId);
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
    return { ...useCase };
  }

  async updateFlowStep(
    useCaseId: string,
    stepId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    await delay(300);
    const useCase = mockUseCases.get(useCaseId);
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
    return { ...useCase };
  }

  async deleteFlowStep(useCaseId: string, stepId: string): Promise<void> {
    await delay(300);
    const useCase = mockUseCases.get(useCaseId);
    if (!useCase) {
      throw new Error('Use case not found');
    }
    useCase.steps = useCase.steps.filter(s => s.id !== stepId);
    useCase.updatedAt = new Date().toISOString();
  }
}

// Real API Service
class RealApiService {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  }

  async getUseCases(projectId: string): Promise<UseCaseListItem[]> {
    return this.request(`/projects/${projectId}/use-cases`);
  }

  async getUseCase(useCaseId: string): Promise<UseCase> {
    return this.request(`/use-cases/${useCaseId}`);
  }

  async createUseCase(
    projectId: string,
    data: CreateUseCaseRequest
  ): Promise<UseCase> {
    return this.request(`/projects/${projectId}/use-cases`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUseCase(
    useCaseId: string,
    data: UpdateUseCaseRequest
  ): Promise<UseCase> {
    return this.request(`/use-cases/${useCaseId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUseCase(useCaseId: string): Promise<void> {
    await this.request(`/use-cases/${useCaseId}`, {
      method: 'DELETE',
    });
  }

  async addFlowStep(
    useCaseId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    return this.request(`/use-cases/${useCaseId}/steps`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFlowStep(
    useCaseId: string,
    stepId: string,
    data: CreateFlowStepRequest
  ): Promise<UseCase> {
    return this.request(`/use-cases/${useCaseId}/steps/${stepId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFlowStep(useCaseId: string, stepId: string): Promise<void> {
    await this.request(`/use-cases/${useCaseId}/steps/${stepId}`, {
      method: 'DELETE',
    });
  }
}

// Export the appropriate service based on the flag
export const api = USE_MOCK_DATA ? new MockApiService() : new RealApiService();

// Log which service is being used
console.log(`🔧 API Service: ${USE_MOCK_DATA ? 'MOCK DATA (no backend needed)' : 'REAL API (backend required)'}`);
