import { useState, useEffect } from 'react';
import { Plus, PlayCircle, Edit, Trash2, Search } from 'lucide-react';
import { api, type UseCaseListItem } from '../../services/api';
import { useCanvasStore } from '../../store/canvasStore';

interface UseCaseListViewProps {
  projectId: string;
  onEditUseCase: (useCaseId: string) => void;
  onPlayUseCase: (useCaseId: string) => void;
}

export default function UseCaseListView({
  projectId,
  onEditUseCase,
  onPlayUseCase,
}: UseCaseListViewProps) {
  const [useCases, setUseCases] = useState<UseCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUseCaseName, setNewUseCaseName] = useState('');
  const [newUseCaseDescription, setNewUseCaseDescription] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadUseCases();
  }, [projectId]);

  const loadUseCases = async () => {
    try {
      setLoading(true);
      const data = await api.getUseCases(projectId);
      setUseCases(data);
    } catch (error) {
      console.error('Failed to load use cases:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUseCase = async () => {
    if (!newUseCaseName.trim()) return;

    try {
      setCreating(true);
      await api.createUseCase(projectId, {
        name: newUseCaseName,
        description: newUseCaseDescription || undefined,
      });
      setNewUseCaseName('');
      setNewUseCaseDescription('');
      setShowCreateModal(false);
      await loadUseCases();
    } catch (error) {
      console.error('Failed to create use case:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUseCase = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      await api.deleteUseCase(id);
      await loadUseCases();
    } catch (error) {
      console.error('Failed to delete use case:', error);
    }
  };

  const filteredUseCases = useCases.filter(
    (useCase) =>
      useCase.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      useCase.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading use cases...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Use Cases</h2>
            <p className="mt-1 text-sm text-gray-500">
              Define and visualize step-by-step request flows
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            New Use Case
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            size={20}
          />
          <input
            type="text"
            placeholder="Search use cases..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Use Case Grid */}
      <div className="flex-1 overflow-auto p-6">
        {filteredUseCases.length === 0 ? (
          <div className="text-center py-12">
            <PlayCircle size={48} className="mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm ? 'No use cases found' : 'No use cases yet'}
            </h3>
            <p className="text-gray-500 mb-6">
              {searchTerm
                ? 'Try adjusting your search terms'
                : 'Get started by creating your first use case'}
            </p>
            {!searchTerm && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={20} />
                Create Use Case
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredUseCases.map((useCase) => (
              <div
                key={useCase.id}
                className="bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-lg transition-all overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 flex-1 mr-2">
                      {useCase.name}
                    </h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onEditUseCase(useCase.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit use case"
                      >
                        <Edit size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteUseCase(useCase.id, useCase.name)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete use case"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {useCase.description && (
                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                      {useCase.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                    <div className="flex items-center gap-1">
                      <span>{useCase.stepCount} steps</span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 bg-gray-50 px-6 py-3 flex gap-2">
                  <button
                    onClick={() => onEditUseCase(useCase.id)}
                    className="flex-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onPlayUseCase(useCase.id)}
                    className="flex-1 inline-flex items-center justify-center gap-1 text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
                  >
                    <PlayCircle size={16} />
                    Play
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Use Case Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                Create New Use Case
              </h2>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Use Case Name *
                </label>
                <input
                  type="text"
                  value={newUseCaseName}
                  onChange={(e) => setNewUseCaseName(e.target.value)}
                  placeholder="e.g., Create Order Flow"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (Optional)
                </label>
                <textarea
                  value={newUseCaseDescription}
                  onChange={(e) => setNewUseCaseDescription(e.target.value)}
                  placeholder="Describe the use case..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end rounded-b-lg">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewUseCaseName('');
                  setNewUseCaseDescription('');
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={creating}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUseCase}
                disabled={!newUseCaseName.trim() || creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? 'Creating...' : 'Create Use Case'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
