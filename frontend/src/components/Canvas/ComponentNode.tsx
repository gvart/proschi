import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Server, Database, MessageSquare, ExternalLink } from 'lucide-react';
import type { ComponentMetadata } from '../../types/canvas';

const ComponentNode = ({ data, selected }: NodeProps<ComponentMetadata>) => {
  const getIcon = () => {
    switch (data.type) {
      case 'service':
        return <Server className="w-5 h-5" />;
      case 'database':
        return <Database className="w-5 h-5" />;
      case 'queue':
        return <MessageSquare className="w-5 h-5" />;
      case 'external':
        return <ExternalLink className="w-5 h-5" />;
      default:
        return <Server className="w-5 h-5" />;
    }
  };

  const getColor = () => {
    switch (data.type) {
      case 'service':
        return 'bg-blue-500';
      case 'database':
        return 'bg-green-500';
      case 'queue':
        return 'bg-purple-500';
      case 'external':
        return 'bg-orange-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div
      className={`
        px-4 py-3 shadow-lg rounded-lg border-2 bg-white min-w-[180px]
        ${selected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-300'}
      `}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3" />

      <div className="flex items-center gap-2 mb-2">
        <div className={`p-2 rounded ${getColor()} text-white`}>
          {getIcon()}
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-800">{data.name}</div>
          <div className="text-xs text-gray-500">{data.techStack}</div>
        </div>
      </div>

      {data.ownerTeam && (
        <div className="text-xs text-gray-600 mt-1">
          Team: {data.ownerTeam}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
};

export default memo(ComponentNode);
