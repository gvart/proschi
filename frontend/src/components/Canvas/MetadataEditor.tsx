import { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import type { ComponentMetadata } from '../../types/canvas';

export default function MetadataEditor() {
  const selectedNode = useCanvasStore((state) => state.selectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const selectNode = useCanvasStore((state) => state.selectNode);

  const [formData, setFormData] = useState<Partial<ComponentMetadata>>({});

  useEffect(() => {
    if (selectedNode) {
      setFormData(selectedNode.data);
    }
  }, [selectedNode]);

  if (!selectedNode) {
    return null;
  }

  const handleChange = (field: keyof ComponentMetadata, value: string) => {
    const newData = { ...formData, [field]: value };
    setFormData(newData);
    updateNodeData(selectedNode.id, newData);
  };

  const handleClose = () => {
    selectNode(null);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this component?')) {
      deleteNode(selectedNode.id);
    }
  };

  return (
    <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg w-80">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">Component Details</h3>
        <button
          onClick={handleClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            type="text"
            value={formData.name || ''}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Component name"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Type
          </label>
          <input
            type="text"
            value={formData.type || ''}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 text-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Technology Stack
          </label>
          <input
            type="text"
            value={formData.techStack || ''}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 text-gray-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Owner Team
          </label>
          <input
            type="text"
            value={formData.ownerTeam || ''}
            onChange={(e) => handleChange('ownerTeam', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Platform Team"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={formData.description || ''}
            onChange={(e) => handleChange('description', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
            placeholder="Brief description of this component"
          />
        </div>
      </div>

      <div className="p-4 border-t border-gray-200">
        <button
          onClick={handleDelete}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium"
        >
          <Trash2 className="w-4 h-4" />
          Delete Component
        </button>
      </div>
    </div>
  );
}
