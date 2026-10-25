import { memo, type CSSProperties } from 'react';
import { BaseEdge, type EdgeProps } from 'reactflow';
import { CANVAS_EDGE } from '../../utils/canvasColors';
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

/**
 * An architecture edge drawn along its orthogonal ELK route, with rounded
 * bends, the label where the layout kept room for it, and an arrowhead at the
 * target. `style`, markers and label props pass through as on React Flow's own edges.
 */
function RoutedEdge({ id, source, target, style, markerEnd, markerStart, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth }: EdgeProps) {
  const geometry = useEdgeGeometry(id, source, target);
  if (!geometry) return null;
  return (
    <>
      <BaseEdge
        path={geometry.path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={style}
        label={label}
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
    </>
  );
}

export default memo(RoutedEdge);
