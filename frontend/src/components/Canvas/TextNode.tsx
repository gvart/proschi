import { memo } from 'react';
import { Handle, Position, NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import { StickyNote } from 'lucide-react';
import type { ComponentMetadata } from '../../types/canvas';

function TextNode({ data, selected }: NodeProps<ComponentMetadata>) {
  const fontSize = data.fontSize || 14;
  const textContent = data.textContent || 'Double-click to edit';

  return (
    <div className="relative">
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={80}
      />
      <div
        className={`
          bg-yellow-100 border-2 rounded-lg p-4
          ${selected ? 'border-yellow-500 shadow-lg' : 'border-yellow-300'}
          transition-all duration-200
        `}
        style={{ minWidth: 150, minHeight: 80 }}
      >
        <div className="flex items-start gap-2 mb-2">
          <StickyNote className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="font-medium text-yellow-800 text-sm">{data.name}</div>
        </div>

        <div
          className="text-gray-700 whitespace-pre-wrap break-words"
          style={{ fontSize: `${fontSize}px` }}
        >
          {textContent}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-yellow-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-yellow-500"
      />
    </div>
  );
}

export default memo(TextNode);
