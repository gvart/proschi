import { useEffect, useRef } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from 'reactflow';
import type { EdgeProps } from 'reactflow';

export function AnimatedPlaybackEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = data?.isActive || false;
  const progress = data?.progress || 0;

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {/* Animated dot traveling along the edge */}
      {isActive && progress < 100 && (
        <g>
          <path
            ref={pathRef}
            id={`edge-path-${id}`}
            d={edgePath}
            fill="none"
            stroke="none"
          />

          <circle r="4" fill="#3b82f6">
            <animateMotion
              dur="1.5s"
              repeatCount="1"
              keyPoints={`${progress / 100};${progress / 100}`}
              keyTimes="0;1"
              calcMode="linear"
            >
              <mpath xlinkHref={`#edge-path-${id}`} />
            </animateMotion>
          </circle>

          {/* Pulsing effect */}
          <circle r="8" fill="#60a5fa" opacity="0.4">
            <animateMotion
              dur="1.5s"
              repeatCount="1"
              keyPoints={`${progress / 100};${progress / 100}`}
              keyTimes="0;1"
              calcMode="linear"
            >
              <mpath xlinkHref={`#edge-path-${id}`} />
            </animateMotion>
            <animate
              attributeName="r"
              from="8"
              to="12"
              dur="1s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.6"
              to="0"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </g>
      )}
    </>
  );
}
