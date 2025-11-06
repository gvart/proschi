import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import type { ComponentMetadata } from '../../types/canvas';
import { getTechStackIcon, getComponentTypeColor } from '../../utils/iconMapping';

const ComponentNode = ({ data, selected }: NodeProps<ComponentMetadata>) => {
  const color = getComponentTypeColor(data.type);
  const icon = getTechStackIcon(data.techStack);

  return (
    <div
      className={`
        px-4 py-3 shadow-lg rounded-lg border-2 bg-white min-w-[180px] h-full
        ${selected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-300'}
      `}
    >
      <NodeResizer
        color={selected ? '#3b82f6' : '#d1d5db'}
        isVisible={selected}
        minWidth={180}
        minHeight={80}
      />

      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-2">
        <div className={`p-2 rounded ${color} text-white flex-shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-800 truncate">{data.name}</div>
          <div className="text-xs text-gray-500 truncate">{data.techStack}</div>
        </div>
      </div>

      {data.ownerTeam && (
        <div className="text-xs text-gray-600 mt-1 truncate">
          Team: {data.ownerTeam}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
};

export default memo(ComponentNode);
