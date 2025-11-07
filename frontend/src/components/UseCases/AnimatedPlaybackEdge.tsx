import { useEffect, useRef, useState } from 'react';
import { BaseEdge, getBezierPath } from 'reactflow';
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
  const [dotPosition, setDotPosition] = useState({ x: sourceX, y: sourceY });

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const isActive = data?.isActive || false;
  const progress = data?.progress || 0;

  // Calculate dot position based on progress
  useEffect(() => {
    if (!pathRef.current || !isActive) return;

    const pathElement = pathRef.current;
    const pathLength = pathElement.getTotalLength();
    const targetLength = (progress / 100) * pathLength;
    const point = pathElement.getPointAtLength(targetLength);

    setDotPosition({ x: point.x, y: point.y });
  }, [progress, isActive, edgePath]);

  return (
    <>
      {/* Hidden path for calculation */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="none"
        style={{ visibility: 'hidden', pointerEvents: 'none' }}
      />

      {/* Visible edge */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {/* Animated dot traveling along the edge */}
      {isActive && progress < 100 && (
        <g>
          {/* Pulsing outer circle */}
          <circle
            cx={dotPosition.x}
            cy={dotPosition.y}
            r="10"
            fill="#60a5fa"
            opacity="0.3"
          >
            <animate
              attributeName="r"
              values="10;14;10"
              dur="1s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0.1;0.3"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Main dot */}
          <circle
            cx={dotPosition.x}
            cy={dotPosition.y}
            r="6"
            fill="#3b82f6"
            stroke="#ffffff"
            strokeWidth="2"
          />
        </g>
      )}
    </>
  );
}
