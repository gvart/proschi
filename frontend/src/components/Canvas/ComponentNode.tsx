import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import type { ComponentMetadata } from '../../types/canvas';
import { getTechStackIcon } from '../../utils/iconMapping';
import { CANVAS_ACCENT } from '../../utils/canvasColors';
import './canvas.css';

/**
 * A component on the canvas: monochrome card, thick border, hard shadow. Colour
 * is kept for what matters while you look: the selected node, and the active
 * or failing node during playback (classes from UseCasePlayback, styled in canvas.css).
 */
const ComponentNode = ({ data, selected }: NodeProps<ComponentMetadata>) => {
  const icon = getTechStackIcon(data.techStack, data.type);

  return (
    <div className="pc-node" data-selected={selected || undefined}>
      <NodeResizer color={CANVAS_ACCENT} isVisible={selected} minWidth={180} minHeight={80} />

      <Handle type="target" position={Position.Top} className="pc-handle" />

      <div className="flex items-center gap-2.5">
        <div className="pc-node__icon">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="pc-node__name truncate">{data.name}</div>
          <div className="pc-node__tech truncate">{data.techStack}</div>
        </div>
      </div>

      {data.ownerTeam && <div className="pc-node__team truncate">Team: {data.ownerTeam}</div>}

      <Handle type="source" position={Position.Bottom} className="pc-handle" />
    </div>
  );
};

export default memo(ComponentNode);
