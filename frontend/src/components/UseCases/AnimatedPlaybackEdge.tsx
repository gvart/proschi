import { useEffect, useRef, useState } from 'react';
import { BaseEdge, getBezierPath } from 'reactflow';
import type { EdgeProps } from 'reactflow';

// The design system's packet (src/design/tokens.css): pink, ink-outlined, red when the answer is an error.
// Token colours go through `style` (CSS variables do not work in SVG presentation attributes), so they follow the theme.
const PACKET_COLOR = 'rgb(var(--c-pink))';
const ERROR_COLOR = 'rgb(var(--c-fail))';
const INK = 'rgb(var(--c-ink))';
const SHADOW = 'rgb(var(--c-shadow))';
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
  const dotColor = isError && (replying || !isRequestResponse) ? ERROR_COLOR : PACKET_COLOR;
  // The packet tumbles a little as it travels, and turns around for the reply.
  const spin = (progress / 100) * 180;

  return (
    <>
      {/* Hidden path for calculation */}
      <path ref={pathRef} d={edgePath} fill="none" stroke="none" style={{ visibility: 'hidden', pointerEvents: 'none' }} />

      {/* Visible edge */}
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />

      {/* Where a failed call was cut off */}
      {isActive && failed && progress >= FAIL_AT && (
        <g transform={`translate(${dotPosition.x} ${dotPosition.y})`} strokeLinecap="round">
          <circle r="13" strokeWidth="2.5" style={{ fill: 'rgb(var(--c-surface))', stroke: INK }} />
          <g strokeWidth="3.5" style={{ stroke: ERROR_COLOR }}>
            <line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} />
            <line x1={-5.5} y1={5.5} x2={5.5} y2={-5.5} />
          </g>
        </g>
      )}

      {/* The packet travelling along the edge */}
      {isActive && progress < 100 && !(failed && progress >= FAIL_AT) && (
        <g transform={`translate(${dotPosition.x} ${dotPosition.y})`}>
          <rect x="-6" y="-4" width="16" height="16" rx="3" transform={`rotate(${spin})`} style={{ fill: SHADOW }} />
          <rect x="-8" y="-8" width="16" height="16" rx="3" strokeWidth="2.5" transform={`rotate(${spin})`} style={{ fill: dotColor, stroke: INK }} />
        </g>
      )}
    </>
  );
}
