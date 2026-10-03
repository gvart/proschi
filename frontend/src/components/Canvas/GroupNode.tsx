import { memo } from 'react';
import { NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import { FolderOpen } from 'lucide-react';
import type { ComponentMetadata } from '../../types/canvas';

function GroupNode({ data, selected }: NodeProps<ComponentMetadata>) {
  const backgroundColor = data.backgroundColor || '#f0f9ff';
  const borderColor = data.borderColor || '#3b82f6';
  const borderStyle = data.borderStyle || 'dashed';

  return (
    <div className="relative w-full h-full">
      <NodeResizer
        isVisible={selected}
        minWidth={300}
        minHeight={200}
      />
      <div
        className={`
          rounded-lg p-4 transition-all duration-200
          ${selected ? 'shadow-lg' : 'shadow-md'}
        `}
        style={{
          width: '100%',
          height: '100%',
          minWidth: 300,
          minHeight: 200,
          backgroundColor,
          border: `2px ${borderStyle} ${borderColor}`,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <FolderOpen className="w-5 h-5" style={{ color: borderColor }} />
          <div
            className="font-semibold text-lg"
            style={{ color: borderColor }}
          >
            {data.name}
          </div>
        </div>

        {data.description && (
          <div className="text-sm text-gray-600 mt-1">
            {data.description}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(GroupNode);
