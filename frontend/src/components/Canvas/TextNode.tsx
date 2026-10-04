import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import type { NodeProps } from 'reactflow';
import { StickyNote } from 'lucide-react';
import type { ComponentMetadata } from '../../types/canvas';
import { CANVAS_ACCENT } from '../../utils/canvasColors';
import './canvas.css';

/** A sticky note: a faint yellow card, the only tint a note gets. */
function TextNode({ data, selected }: NodeProps<ComponentMetadata>) {
  const fontSize = data.fontSize || 14;
  const textContent = data.textContent || 'Double-click to edit';

  return (
    <div className="relative">
      <NodeResizer color={CANVAS_ACCENT} isVisible={selected} minWidth={150} minHeight={80} />
      <div className="pc-note" data-selected={selected || undefined}>
        <div className="flex items-start gap-2 mb-2">
          <StickyNote className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="font-semibold text-sm">{data.name}</div>
        </div>
        <div className="whitespace-pre-wrap break-words text-ink/85" style={{ fontSize: `${fontSize}px` }}>
          {textContent}
        </div>
      </div>

      <Handle type="target" position={Position.Top} className="pc-handle" />
      <Handle type="source" position={Position.Bottom} className="pc-handle" />
    </div>
  );
}

export default memo(TextNode);
