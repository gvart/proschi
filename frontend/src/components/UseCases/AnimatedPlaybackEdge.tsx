import { useEffect, useRef, useState } from 'react';
import { BaseEdge, getBezierPath } from 'reactflow';
import type { EdgeProps } from 'reactflow';

const ERROR_COLOR = '#dc2626';
/** How far along the edge (in %) a failed call gets before it is cut off. */
const FAIL_AT = 55;

export function AnimatedPlaybackEdge({
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
  const isRequestResponse = data?.isRequestResponse || false;
  /** 4xx/5xx: the reply travels back in red. */
  const isError = data?.isError || false;
  /** The call never arrives: the dot stops short and a cross marks the spot. */
  const failed = data?.failed || false;

  // Calculate dot position based on progress
  // For request-response: 0-50% = request (forward), 50-100% = response (backward)
  useEffect(() => {
    if (!pathRef.current || !isActive) return;

    const pathElement = pathRef.current;
    const pathLength = pathElement.getTotalLength();

    let targetLength: number;
    if (failed) {
      targetLength = (Math.min(progress, FAIL_AT) / 100) * pathLength;
    } else if (isRequestResponse) {
      // For request-response: animate back and forth
      if (progress <= 50) {
        // Request phase: 0 to 50% = move forward along path
        targetLength = (progress / 50) * pathLength;
      } else {
        // Response phase: 50 to 100% = move backward along path
        const responseProgress = (progress - 50) / 50;
        targetLength = (1 - responseProgress) * pathLength;
      }
    } else {
      // For fire-and-forget: just move forward
      targetLength = (progress / 100) * pathLength;
    }

    const point = pathElement.getPointAtLength(targetLength);
    setDotPosition({ x: point.x, y: point.y });
  }, [progress, isActive, isRequestResponse, failed, edgePath]);

  const replying = isRequestResponse && progress > 50;
  const dotColor = isError && (replying || !isRequestResponse) ? ERROR_COLOR : '#3b82f6';

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
      {isActive && failed && progress >= FAIL_AT && (
        <g stroke={ERROR_COLOR} strokeWidth="3" strokeLinecap="round">
          <line x1={dotPosition.x - 7} y1={dotPosition.y - 7} x2={dotPosition.x + 7} y2={dotPosition.y + 7} />
          <line x1={dotPosition.x - 7} y1={dotPosition.y + 7} x2={dotPosition.x + 7} y2={dotPosition.y - 7} />
        </g>
      )}

      {isActive && progress < 100 && !(failed && progress >= FAIL_AT) && (
        <g>
          {/* Pulsing outer circle */}
          <circle
            cx={dotPosition.x}
            cy={dotPosition.y}
            r="10"
            fill={dotColor}
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
            fill={dotColor}
            stroke="#ffffff"
            strokeWidth="2"
          />
        </g>
      )}
    </>
  );
}
