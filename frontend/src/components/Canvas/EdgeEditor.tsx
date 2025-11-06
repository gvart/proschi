import { useState, useEffect } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { X, Trash2, ArrowRight } from 'lucide-react';

export default function EdgeEditor() {
  const { selectedEdge, updateEdgeData, deleteEdge, selectEdge } = useCanvasStore();
  const [label, setLabel] = useState('');

  // Sync local state with selected edge when a different edge is selected
  useEffect(() => {
    if (selectedEdge) {
      setLabel(selectedEdge.label || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEdge?.id]); // Only update when edge ID changes, not on every label change

  if (!selectedEdge) {
    return null;
  }

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newLabel = e.target.value;
    setLabel(newLabel);
    updateEdgeData(selectedEdge.id, { label: newLabel });
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this connection?')) {
      deleteEdge(selectedEdge.id);
    }
  };

  const handleClose = () => {
    selectEdge(null);
  };

  return (
    <div className="absolute top-4 right-4 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Connection</h3>
        </div>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={handleLabelChange}
            placeholder="e.g., HTTP POST, Event, Query..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
        </div>

        <div className="pt-2 border-t border-gray-200">
          <button
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Connection
          </button>
        </div>

        <div className="text-xs text-gray-500">
          <div>From: {selectedEdge.source}</div>
          <div>To: {selectedEdge.target}</div>
        </div>
      </div>
    </div>
  );
}
