import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { Handle, Position, useNodeId, useStore } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import { Plus, TriangleAlert } from 'lucide-react';
import type { NodeProps } from 'reactflow';
import type { ComponentMetadata } from '../../types/canvas';
import { getTechStackIcon } from '../../utils/iconMapping';
import { CANVAS_ACCENT } from '../../utils/canvasColors';
import { heat, heatText } from '../../utils/heat';
import type { NodeOverlay } from '../../sim/overlay';
import { useNodeActions } from './nodeActions';
import './canvas.css';

/**
 * A component on the canvas: monochrome card, thick border, hard shadow. Colour
 * is kept for what matters while you look: the selected node, and the active
 * or failing node during playback (classes from UseCasePlayback, styled in canvas.css).
 */
const ComponentNode = ({ data, selected }: NodeProps<ComponentMetadata>) => {
  const icon = getTechStackIcon(data.techStack, data.type);
  const o = data.overlay;
  const u = o?.utilization;
  const id = useNodeId();
  const actions = useNodeActions();
  const editing = !!id && actions?.editing === id;

  return (
    <div
      className="pc-node"
      data-selected={selected || undefined}
      data-load={o ? (o.down ? 'down' : o.saturated ? 'over' : u !== undefined && u >= 0.9 ? 'hot' : 'ok') : undefined}
      data-heat={o ? heatText(u, o.down) : undefined}
      data-stack={o?.replicas && o.replicas > 1 ? Math.min(2, o.replicas - 1) : undefined}
      data-bottleneck={o?.bottleneck || undefined}
      // The load overlay wins over the node's colors while it is on (D4).
      style={o ? { background: heat(u, o.down) } : tintVars(data)}
    >
      {data.critical && (
        <span className="pc-node__critical" role="img" aria-label="Critical" title="Critical">
          <TriangleAlert size={13} strokeWidth={2.5} aria-hidden="true" />
        </span>
      )}
      {o?.bottleneck && (
        <span className="pc-node__tag" title="The busiest node: the first to give way as traffic grows">
          Bottleneck
        </span>
      )}
      <NodeResizer color={CANVAS_ACCENT} isVisible={selected && !data.fixedSize} minWidth={180} minHeight={80} />

      <Handle type="target" position={Position.Top} className="pc-handle pc-handle--in" isConnectableStart={false} />
      <BodyTarget />

      <div className="flex items-center gap-2.5">
        <div className="pc-node__icon">{icon}</div>
        <div className="flex-1 min-w-0">
          {editing ? (
            <NameField name={data.name} onDone={(name) => id && actions?.onName(id, name)} />
          ) : (
            <div className="pc-node__name truncate">{data.name}</div>
          )}
          <div className="pc-node__tech truncate">{data.techStack}</div>
        </div>
      </div>

      {data.ownerTeam && !o && <div className="pc-node__team truncate">Team: {data.ownerTeam}</div>}
      {o && <LoadBadge overlay={o} />}

      <Handle type="source" position={Position.Bottom} className="pc-handle" />
      {id && actions?.onAddAfter && !editing && (
        <button
          type="button"
          className="pc-node__add nodrag nopan"
          aria-label={`Add a component after ${data.name}`}
          title="Add a component connected from this one"
          onClick={(e) => {
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            actions.onAddAfter?.(id, { x: box.right, y: box.top + box.height / 2 });
          }}
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

/**
 * The name typed in place on the canvas: Enter (or leaving the field) keeps what is typed,
 * Escape the name the node had. Its keys stay in the field, away from the canvas's.
 */
function NameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  // A new node is hidden until React Flow has measured it, and a hidden field can't take the focus: try each frame.
  useEffect(() => {
    let tries = 0;
    let frame = requestAnimationFrame(function focus() {
      const field = ref.current;
      if (!field || document.activeElement === field) return;
      field.focus({ preventScroll: true });
      if (document.activeElement === field) field.select();
      else if (tries++ < 60) frame = requestAnimationFrame(focus);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      aria-label="Name"
      defaultValue={name}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="pc-node__name pc-node__name-field nodrag nopan"
    />
  );
}

/**
 * The whole node as a drop target for a new connection. It takes the pointer only while a connection
 * is being dragged (`.pc-connecting`, from useConnectDrop; else it would take the node's own drags), and outlines the node it is over: accent
 * when the drop connects, dashed red when it can't (useConnectDrop says why). It comes after the top
 * dot, which stays the first target: the one edges and their grips are anchored to.
 */
export function BodyTarget() {
  const nodeId = useNodeId();
  const status = useStore((s) => (s.connectionEndHandle?.nodeId === nodeId ? s.connectionStatus : null));
  return (
    <Handle
      type="target"
      id="body"
      position={Position.Top}
      isConnectableStart={false}
      className="pc-body-target"
      data-connect={status ?? undefined}
    />
  );
}

/** The node's colors as custom properties, so playback and overlay styles in canvas.css still win. */
function tintVars(data: ComponentMetadata): CSSProperties | undefined {
  if (!data.backgroundColor && !data.borderColor && !data.borderStyle) return undefined;
  return {
    ...(data.backgroundColor ? { '--pc-fill': data.backgroundColor } : {}),
    ...(data.borderColor ? { '--pc-line': data.borderColor } : {}),
    ...(data.borderStyle ? { '--pc-dash': data.borderStyle } : {}),
  } as CSSProperties;
}

/** Replicas, size, shards and how busy the node is, with a bar; "down" when it is. */
function LoadBadge({ overlay: o }: { overlay: NodeOverlay }) {
  const u = o.utilization;
  const parts = [o.replicas && o.replicas > 1 ? `×${o.replicas}` : '', o.size ?? '', o.shards && o.shards > 1 ? `⧉${o.shards}` : '', o.down ? 'down' : u !== undefined ? `${Math.round(u * 100)}%` : ''].filter(Boolean);
  return (
    <div className="pc-node__load">
      {parts.length > 0 && <div className="pc-node__stats">{parts.join(' · ')}</div>}
      {u !== undefined && !o.down && (
        <div className="pc-node__bar" aria-hidden="true">
          <div style={{ width: `${Math.min(100, u * 100)}%` }} data-over={u >= 1 || undefined} />
        </div>
      )}
    </div>
  );
}

export default memo(ComponentNode);
