import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  MoveUp,
  MoveDown,
  PlayCircle,
} from 'lucide-react';
import { api, type UseCase, type FlowStep, type CreateFlowStepRequest } from '../../services/api';
import { useCanvasStore } from '../../store/canvasStore';

interface UseCaseEditorProps {
  useCaseId: string;
  onBack: () => void;
  onPlay: (useCaseId: string) => void;
}

export default function UseCaseEditor({
  useCaseId,
  onBack,
  onPlay,
}: UseCaseEditorProps) {
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [showStepModal, setShowStepModal] = useState(false);
  const nodes = useCanvasStore((state) => state.nodes);

  useEffect(() => {
    loadUseCase();
  }, [useCaseId]);

  const loadUseCase = async () => {
    try {
      setLoading(true);
      const data = await api.getUseCase(useCaseId);
      setUseCase(data);
    } catch (error) {
      console.error('Failed to load use case:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddStep = () => {
    setEditingStep(null);
    setShowStepModal(true);
  };

  const handleEditStep = (index: number) => {
    setEditingStep(index);
    setShowStepModal(true);
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('Are you sure you want to delete this step?')) return;

    try {
      await api.deleteFlowStep(useCaseId, stepId);
      await loadUseCase();
    } catch (error) {
      console.error('Failed to delete step:', error);
    }
  };

  const handleSaveStep = async (stepData: CreateFlowStepRequest) => {
    try {
      if (editingStep !== null && useCase?.steps[editingStep]?.id) {
        await api.updateFlowStep(
          useCaseId,
          useCase.steps[editingStep].id!,
          stepData
        );
      } else {
        await api.addFlowStep(useCaseId, stepData);
      }
      await loadUseCase();
      setShowStepModal(false);
      setEditingStep(null);
    } catch (error) {
      console.error('Failed to save step:', error);
    }
  };

  const moveStep = async (fromIndex: number, toIndex: number) => {
    if (!useCase) return;

    const newSteps = [...useCase.steps];
    const [movedStep] = newSteps.splice(fromIndex, 1);
    newSteps.splice(toIndex, 0, movedStep);

    // Update step orders
    for (let i = 0; i < newSteps.length; i++) {
      const step = newSteps[i];
      if (step.id && step.stepOrder !== i) {
        try {
          await api.updateFlowStep(useCaseId, step.id, {
            ...step,
            stepOrder: i,
          });
        } catch (error) {
          console.error('Failed to update step order:', error);
        }
      }
    }

    await loadUseCase();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading use case...</div>
      </div>
    );
  }

  if (!useCase) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Use case not found</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{useCase.name}</h2>
              {useCase.description && (
                <p className="mt-1 text-sm text-gray-500">{useCase.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPlay(useCaseId)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <PlayCircle size={20} />
              Play Use Case
            </button>
            <button
              onClick={handleAddStep}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              Add Step
            </button>
          </div>
        </div>
      </div>

      {/* Steps List */}
      <div className="flex-1 overflow-auto p-6">
        {useCase.steps.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No steps defined yet
            </h3>
            <p className="text-gray-500 mb-6">
              Add steps to define the flow of your use case
            </p>
            <button
              onClick={handleAddStep}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus size={20} />
              Add First Step
            </button>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            {useCase.steps.map((step, index) => (
              <StepCard
                key={step.id || index}
                step={step}
                index={index}
                totalSteps={useCase.steps.length}
                nodes={nodes}
                onEdit={() => handleEditStep(index)}
                onDelete={() => step.id && handleDeleteStep(step.id)}
                onMoveUp={() => moveStep(index, index - 1)}
                onMoveDown={() => moveStep(index, index + 1)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Step Modal */}
      {showStepModal && (
        <StepModal
          step={editingStep !== null ? useCase.steps[editingStep] : undefined}
          stepOrder={editingStep !== null ? editingStep : useCase.steps.length}
          nodes={nodes}
          onSave={handleSaveStep}
          onClose={() => {
            setShowStepModal(false);
            setEditingStep(null);
          }}
        />
      )}
    </div>
  );
}

interface StepCardProps {
  step: FlowStep;
  index: number;
  totalSteps: number;
  nodes: any[];
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function StepCard({
  step,
  index,
  totalSteps,
  nodes,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: StepCardProps) {
  const fromNode = nodes.find((n) => n.id === step.fromServiceId);
  const toNode = nodes.find((n) => n.id === step.toServiceId);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        {/* Step Number */}
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold">
            {index + 1}
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{step.stepName}</h3>
              {step.description && (
                <p className="text-sm text-gray-600 mt-1">{step.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {index > 0 && (
                <button
                  onClick={onMoveUp}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Move up"
                >
                  <MoveUp size={16} />
                </button>
              )}
              {index < totalSteps - 1 && (
                <button
                  onClick={onMoveDown}
                  className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                  title="Move down"
                >
                  <MoveDown size={16} />
                </button>
              )}
              <button
                onClick={onEdit}
                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="Edit"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">From:</span>
              <span className="ml-2 font-medium text-gray-900">
                {fromNode?.data.name || step.fromServiceId}
              </span>
            </div>
            <div>
              <span className="text-gray-500">To:</span>
              <span className="ml-2 font-medium text-gray-900">
                {toNode?.data.name || step.toServiceId}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Method:</span>
              <span className="ml-2 font-medium text-gray-900">{step.httpMethod}</span>
            </div>
            <div>
              <span className="text-gray-500">Endpoint:</span>
              <span className="ml-2 font-medium text-gray-900">{step.endpoint}</span>
            </div>
          </div>

          {(step.requestBody || step.responseBody) && (
            <div className="mt-4 grid grid-cols-2 gap-4">
              {step.requestBody && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    Request ({step.requestFormat})
                  </div>
                  <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-32">
                    {step.requestBody}
                  </pre>
                </div>
              )}
              {step.responseBody && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-1">
                    Response ({step.responseFormat}) - {step.statusCode}
                  </div>
                  <pre className="text-xs bg-gray-50 p-2 rounded border border-gray-200 overflow-auto max-h-32">
                    {step.responseBody}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepModalProps {
  step?: FlowStep;
  stepOrder: number;
  nodes: any[];
  onSave: (step: CreateFlowStepRequest) => void;
  onClose: () => void;
}

function StepModal({ step, stepOrder, nodes, onSave, onClose }: StepModalProps) {
  const [formData, setFormData] = useState<CreateFlowStepRequest>({
    stepOrder: step?.stepOrder ?? stepOrder,
    stepName: step?.stepName || 'Step',
    fromServiceId: step?.fromServiceId || '',
    toServiceId: step?.toServiceId || '',
    httpMethod: step?.httpMethod || 'GET',
    endpoint: step?.endpoint || '/',
    requestFormat: step?.requestFormat || 'JSON',
    requestBody: step?.requestBody || '',
    responseFormat: step?.responseFormat || 'JSON',
    responseBody: step?.responseBody || '',
    statusCode: step?.statusCode || 200,
    description: step?.description || '',
    executionType: step?.executionType || 'SYNC_REQUEST_RESPONSE',
    parallelGroup: step?.parallelGroup,
    isParallel: step?.isParallel || false,
    isConditional: step?.isConditional || false,
    conditionExpression: step?.conditionExpression || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const serviceNodes = nodes.filter((n) => n.data.type === 'service');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-900">
            {step ? 'Edit Step' : 'Add Step'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Step Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Step Name *
            </label>
            <input
              type="text"
              value={formData.stepName}
              onChange={(e) => setFormData({ ...formData, stepName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Services */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From Service *
              </label>
              <select
                value={formData.fromServiceId}
                onChange={(e) =>
                  setFormData({ ...formData, fromServiceId: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select service</option>
                {serviceNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To Service *
              </label>
              <select
                value={formData.toServiceId}
                onChange={(e) =>
                  setFormData({ ...formData, toServiceId: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select service</option>
                {serviceNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.data.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* HTTP Method & Endpoint */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                HTTP Method *
              </label>
              <select
                value={formData.httpMethod}
                onChange={(e) =>
                  setFormData({ ...formData, httpMethod: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Endpoint *
              </label>
              <input
                type="text"
                value={formData.endpoint}
                onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                placeholder="/api/resource"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Execution Type & Parallel Group */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Execution Type *
              </label>
              <select
                value={formData.executionType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    executionType: e.target.value as 'SYNC_REQUEST_RESPONSE' | 'ASYNC_FIRE_AND_FORGET' | 'ASYNC_REQUEST_RESPONSE',
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SYNC_REQUEST_RESPONSE">Sync Request/Response</option>
                <option value="ASYNC_FIRE_AND_FORGET">Async Fire & Forget</option>
                <option value="ASYNC_REQUEST_RESPONSE">Async Request/Response</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {formData.executionType === 'SYNC_REQUEST_RESPONSE' && 'Wait for response, animate back and forth'}
                {formData.executionType === 'ASYNC_FIRE_AND_FORGET' && 'No response wait, one-way animation'}
                {formData.executionType === 'ASYNC_REQUEST_RESPONSE' && 'Non-blocking request with eventual response'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parallel Group
              </label>
              <input
                type="number"
                value={formData.parallelGroup ?? ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    parallelGroup: e.target.value ? parseInt(e.target.value) : undefined,
                  })
                }
                placeholder="Leave empty for sequential"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1"
              />
              <p className="mt-1 text-xs text-gray-500">
                Steps with same group number execute in parallel
              </p>
            </div>
          </div>

          {/* Request */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Request Format
            </label>
            <select
              value={formData.requestFormat}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  requestFormat: e.target.value as 'JSON' | 'XML' | 'FREE_TEXT',
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
            >
              <option value="JSON">JSON</option>
              <option value="XML">XML</option>
              <option value="FREE_TEXT">Free Text</option>
            </select>
            <textarea
              value={formData.requestBody}
              onChange={(e) =>
                setFormData({ ...formData, requestBody: e.target.value })
              }
              placeholder="Request body..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
          </div>

          {/* Response */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Response Format
            </label>
            <div className="grid grid-cols-4 gap-4 mb-2">
              <div className="col-span-3">
                <select
                  value={formData.responseFormat}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      responseFormat: e.target.value as 'JSON' | 'XML' | 'FREE_TEXT',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="JSON">JSON</option>
                  <option value="XML">XML</option>
                  <option value="FREE_TEXT">Free Text</option>
                </select>
              </div>
              <div>
                <input
                  type="number"
                  value={formData.statusCode}
                  onChange={(e) =>
                    setFormData({ ...formData, statusCode: parseInt(e.target.value) })
                  }
                  placeholder="Status"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <textarea
              value={formData.responseBody}
              onChange={(e) =>
                setFormData({ ...formData, responseBody: e.target.value })
              }
              placeholder="Response body..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {step ? 'Update Step' : 'Add Step'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
