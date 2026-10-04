import { memo } from 'react';
import { NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import { FolderOpen } from 'lucide-react';
import type { ComponentMetadata } from '../../types/canvas';
import { CANVAS_ACCENT } from '../../utils/canvasColors';
import './canvas.css';

/** A dashed frame around its members; explicit colours in the data still win. */
function GroupNode({ data, selected }: NodeProps<ComponentMetadata>) {
  const custom = {
    ...(data.backgroundColor ? { backgroundColor: data.backgroundColor } : {}),
    ...(data.borderColor ? { borderColor: data.borderColor } : {}),
    ...(data.borderStyle ? { borderStyle: data.borderStyle } : {}),
  };

  return (
    <div className="relative w-full h-full">
      <NodeResizer color={CANVAS_ACCENT} isVisible={selected} minWidth={300} minHeight={200} />
      <div className="pc-group" style={custom}>
        <div className="pc-group__name" style={data.borderColor ? { color: data.borderColor } : undefined}>
          <FolderOpen size={14} aria-hidden="true" />
          {data.name}
        </div>
        {data.description && <div className="pc-group__desc">{data.description}</div>}
      </div>
    </div>
  );
}

export default memo(GroupNode);
