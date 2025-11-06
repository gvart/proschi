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

// API Service
class ApiService {
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

  // Use Case APIs
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

  // Flow Step APIs
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

export const api = new ApiService();
