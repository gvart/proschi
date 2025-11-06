import { useState, useEffect } from 'react';
import { X, Trash2, Copy, Clipboard, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import { useCanvasStore } from '../../store/canvasStore';
import type { ComponentMetadata } from '../../types/canvas';

export default function MetadataEditor() {
  const selectedNode = useCanvasStore((state) => state.selectedNode);
  const selectedNodes = useCanvasStore((state) => state.selectedNodes);
  const nodes = useCanvasStore((state) => state.nodes);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const deleteSelectedNodes = useCanvasStore((state) => state.deleteSelectedNodes);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const setSelectedNodes = useCanvasStore((state) => state.setSelectedNodes);
  const copySelectedNodes = useCanvasStore((state) => state.copySelectedNodes);
  const duplicateSelectedNodes = useCanvasStore((state) => state.duplicateSelectedNodes);
  const bringToFront = useCanvasStore((state) => state.bringToFront);
  const sendToBack = useCanvasStore((state) => state.sendToBack);

  const [formData, setFormData] = useState<Partial<ComponentMetadata>>({});

  useEffect(() => {
    if (selectedNode) {
      setFormData(selectedNode.data);
    }
  }, [selectedNode]);

  // Show multi-select panel if multiple nodes are selected
  if (selectedNodes.length > 1) {
    const selectedNodesList = nodes.filter(node => selectedNodes.includes(node.id));

    return (
      <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg w-80">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-700">
            {selectedNodes.length} Components Selected
          </h3>
          <button
            onClick={() => setSelectedNodes([])}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-600">
            <p className="font-medium mb-2">Selected components:</p>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {selectedNodesList.map((node) => (
                <li key={node.id} className="text-gray-700">
                  • {node.data.name}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <button
              onClick={() => copySelectedNodes()}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
            <button
              onClick={() => duplicateSelectedNodes()}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors text-sm"
            >
              <Clipboard className="w-4 h-4" />
              Duplicate
            </button>
            <button
              onClick={() => bringToFront(selectedNodes)}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm"
            >
              <ArrowUpToLine className="w-4 h-4" />
              To Front
            </button>
            <button
              onClick={() => sendToBack(selectedNodes)}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm"
            >
              <ArrowDownToLine className="w-4 h-4" />
              To Back
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={() => {
              if (confirm(`Are you sure you want to delete ${selectedNodes.length} components?`)) {
                deleteSelectedNodes();
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Delete All Selected
          </button>
        </div>
      </div>
    );
  }

  if (!selectedNode) {
    return null;
  }

  const handleChange = (field: keyof ComponentMetadata, value: string | number) => {
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

        {/* Text Node Fields */}
        {formData.type === 'text' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Text Content
              </label>
              <textarea
                value={formData.textContent || ''}
                onChange={(e) => handleChange('textContent', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={4}
                placeholder="Enter your text..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Font Size
              </label>
              <input
                type="number"
                value={formData.fontSize || 14}
                onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={8}
                max={72}
              />
            </div>
          </>
        )}

        {/* Group Node Fields */}
        {formData.type === 'group' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Background Color
              </label>
              <input
                type="color"
                value={formData.backgroundColor || '#f0f9ff'}
                onChange={(e) => handleChange('backgroundColor', e.target.value)}
                className="w-full h-10 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Border Color
              </label>
              <input
                type="color"
                value={formData.borderColor || '#3b82f6'}
                onChange={(e) => handleChange('borderColor', e.target.value)}
                className="w-full h-10 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Border Style
              </label>
              <select
                value={formData.borderStyle || 'dashed'}
                onChange={(e) => handleChange('borderStyle', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>
          </>
        )}
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
