import { useRef, type RefObject } from 'react';
import { BaseEdge } from 'reactflow';
import type { EdgeProps } from 'reactflow';
import { usePlaybackProgress } from './playbackClock';
import { EdgeHead } from '../Canvas/RoutedEdge';
import { hasMarker, useEdgeGeometry } from '../Canvas/useEdgeGeometry';

// The design system's packet (src/design/tokens.css): pink, ink-outlined, red when the answer is an error.
// Token colours go through `style` (CSS variables do not work in SVG presentation attributes), so they follow the theme.
const PACKET_COLOR = 'rgb(var(--c-pink))';
const ERROR_COLOR = 'rgb(var(--c-fail))';
const INK = 'rgb(var(--c-ink))';
const SHADOW = 'rgb(var(--c-shadow))';
/** How far along the edge (in %) a failed call gets before it is cut off. */
const FAIL_AT = 55;
/** React Flow's own `animated` look (reactflow/dist/style.css), for an edge whose packet has arrived. */
const FLOWING = { strokeDasharray: 5, animation: 'dashdraw 0.5s linear infinite' };

/**
 * Every edge of a canvas that can play a use case. Idle, it draws like
 * RoutedEdge (along its layout route); on the current step it carries the packet. The edge
 * type never changes between the two, so starting playback does not remount it.
 */
export function AnimatedPlaybackEdge({
  id,
  source,
  target,
  style = {},
  markerEnd,
  markerStart,
  data,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth,
}: EdgeProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const geometry = useEdgeGeometry(id, source, target);
  const isActive = !!data?.isActive;
  const failed = !!data?.failed;
  // Re-renders this edge once, when the packet arrives, not on every tick.
  const arrived = usePlaybackProgress((p) => isActive && p >= 100);
  if (!geometry) return null;
  const { path: edgePath, labelX, labelY } = geometry;

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={arrived && !failed ? { ...style, ...FLOWING } : style}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelShowBg={labelShowBg}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        labelBgBorderRadius={labelBgBorderRadius}
        interactionWidth={interactionWidth}
      />
      {!hasMarker(markerEnd) && <EdgeHead d={geometry.head} style={style} />}
      {isActive && (
        <>
          {/* Hidden path the packet's position is measured along */}
          <path ref={pathRef} d={edgePath} fill="none" stroke="none" style={{ visibility: 'hidden', pointerEvents: 'none' }} />
          <Packet
            pathRef={pathRef}
            from={geometry.start}
            isRequestResponse={!!data?.isRequestResponse}
            isError={!!data?.isError}
            failed={failed}
          />
        </>
      )}
    </>
  );
}

interface PacketProps {
  pathRef: RefObject<SVGPathElement | null>;
  from: { x: number; y: number };
  isRequestResponse: boolean;
  /** 4xx/5xx: the reply travels back in red. */
  isError: boolean;
  /** The call never arrives: the packet stops short and a cross marks the spot. */
  failed: boolean;
}

/** The packet on its way; the only part of the canvas that re-renders on every tick. */
function Packet({ pathRef, from, isRequestResponse, isError, failed }: PacketProps) {
  const progress = usePlaybackProgress();
  const path = pathRef.current;
  let at = from;
  if (path) {
    const length = path.getTotalLength();
    // Request-response: 0–50% goes out, 50–100% comes back.
    const share = failed
      ? Math.min(progress, FAIL_AT) / 100
      : isRequestResponse
        ? progress <= 50
          ? progress / 50
          : 1 - (progress - 50) / 50
        : progress / 100;
    const point = path.getPointAtLength(share * length);
    at = { x: point.x, y: point.y };
  }

  if (failed && progress >= FAIL_AT) {
    return (
      <g transform={`translate(${at.x} ${at.y})`} strokeLinecap="round">
        <circle r="13" strokeWidth="2.5" style={{ fill: 'rgb(var(--c-surface))', stroke: INK }} />
        <g strokeWidth="3.5" style={{ stroke: ERROR_COLOR }}>
          <line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} />
          <line x1={-5.5} y1={5.5} x2={5.5} y2={-5.5} />
        </g>
      </g>
    );
  }
  if (progress >= 100) return null;

  const replying = isRequestResponse && progress > 50;
  const color = isError && (replying || !isRequestResponse) ? ERROR_COLOR : PACKET_COLOR;
  // The packet tumbles a little as it travels, and turns around for the reply.
  const spin = (progress / 100) * 180;
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <rect x="-6" y="-4" width="16" height="16" rx="3" transform={`rotate(${spin})`} style={{ fill: SHADOW }} />
      <rect x="-8" y="-8" width="16" height="16" rx="3" strokeWidth="2.5" transform={`rotate(${spin})`} style={{ fill: color, stroke: INK }} />
    </g>
  );
}
