import { memo, type CSSProperties, type ReactNode } from 'react';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from 'reactflow';
import { formatMs, formatRps } from '../../sim/format';
import type { EdgeOverlay } from '../../sim/overlay';
import { CANVAS_EDGE } from '../../utils/canvasColors';
import { heatStroke } from '../../utils/heat';
import { edgeLoadOf, loadWidth, showsLoadLabel, useLoadLabelsLegible, withLoad } from './edgeLoad';
import { hasMarker, useEdgeGeometry } from './useEdgeGeometry';

/** The arrowhead, in the edge's own colour (a tagged edge's `style.stroke`) and fading with it. */
export function EdgeHead({ d, style }: { d: string; style?: CSSProperties }) {
  if (!d) return null;
  return (
    <path
      d={d}
      className="pc-edge-head"
      style={{ fill: (style?.stroke as string | undefined) ?? CANVAS_EDGE, stroke: 'none', opacity: style?.opacity, transition: style?.transition, pointerEvents: 'none' }}
    />
  );
}

/** Under a tinted edge, a dark casing that keeps a yellow or pink line readable on the light paper. */
export function EdgeCasing({ path, load }: { path: string; load: EdgeOverlay | undefined }) {
  if (!load || !heatStroke(load.utilization, load.saturated)) return null;
  return <path d={path} className="pc-edge-casing" style={{ strokeWidth: loadWidth(load) + 2 }} />;
}

/**
 * The edge's label, then its requests and the latency they add. Zoomed out
 * past legibility the numbers are left out, and only the label stays.
 */
export function EdgeLoadLabel({ load, label, x, y }: { load: EdgeOverlay; label: ReactNode; x: number; y: number }) {
  const legible = useLoadLabelsLegible();
  if (!legible && !label) return null;
  return (
    <EdgeLabelRenderer>
      <div
        className="pc-edge-load nodrag nopan"
        data-critical={load.critical || undefined}
        data-numbers={legible || undefined}
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
      >
        {/* Under a label, one number a line: no wider than the room the layout kept for the label. */}
        {!legible ? (
          <span className="pc-edge-load__label">{label}</span>
        ) : label ? (
          <>
            <span className="pc-edge-load__label">{label}</span>
            <span>{formatRps(load.rps)}</span>
            {load.latencyMs !== undefined && <span>+{formatMs(load.latencyMs)}</span>}
          </>
        ) : (
          <span>
            {formatRps(load.rps)}
            {load.latencyMs !== undefined && ` · +${formatMs(load.latencyMs)}`}
          </span>
        )}
      </div>
    </EdgeLabelRenderer>
  );
}

/**
 * An architecture edge drawn along its orthogonal ELK route, with rounded
 * bends, the label where the layout kept room for it, and an arrowhead at the
 * target. `style`, markers and label props pass through as on React Flow's own edges.
 */
function RoutedEdge({ id, source, target, data, style: own, markerEnd, markerStart, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth }: EdgeProps) {
  const geometry = useEdgeGeometry(id, source, target);
  if (!geometry) return null;
  const load = edgeLoadOf(data);
  const style = withLoad(own, load);
  return (
    <>
      <EdgeCasing path={geometry.path} load={load} />
      <BaseEdge
        path={geometry.path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
        label={showsLoadLabel(load) ? undefined : label}
        labelX={geometry.labelX}
        labelY={geometry.labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        interactionWidth={interactionWidth}
      />
      {!hasMarker(markerEnd) && <EdgeHead d={geometry.head} style={style} />}
      {showsLoadLabel(load) && <EdgeLoadLabel load={load} label={label} x={geometry.labelX} y={geometry.labelY} />}
    </>
  );
}

export default memo(RoutedEdge);
