import { useCallback } from 'react';
import { useStore, type ReactFlowState } from 'reactflow';
import type { Point } from '../../dsl/autoLayout';
import { fallbackRoute, labelPoint, roundedPath, snapToBottom, type Box } from '../../dsl/edgePath';
import type { ComponentMetadata } from '../../types/canvas';

/** Length and half-width of the arrowhead drawn at the target. */
const HEAD = { length: 10, half: 5 };

export interface EdgeGeometry {
  path: string;
  labelX: number;
  labelY: number;
  /** Where the edge leaves its source, for the playback packet. */
  start: Point;
  /** The arrowhead's outline, at the target end. */
  head: string;
}

/** React Flow passes `url('#')` when the edge has no marker of its own. */
export const hasMarker = (marker: string | undefined) => !!marker && !/#'?\)$/.test(marker);

const close = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** The arrowhead at the end of `points`; the line is cut back to its base so it does not poke through the tip. */
function withHead(points: Point[]): { points: Point[]; head: string } {
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const len = Math.hypot(tip.x - before.x, tip.y - before.y);
  if (len < HEAD.length) return { points, head: '' };
  const ux = (tip.x - before.x) / len;
  const uy = (tip.y - before.y) / len;
  const base = { x: tip.x - ux * HEAD.length, y: tip.y - uy * HEAD.length };
  const r = (n: number) => Math.round(n * 10) / 10;
  const head = `M${r(tip.x)},${r(tip.y)} L${r(base.x - uy * HEAD.half)},${r(base.y + ux * HEAD.half)} L${r(base.x + uy * HEAD.half)},${r(base.y - ux * HEAD.half)} Z`;
  return { points: [...points.slice(0, -1), base], head };
}

/**
 * The geometry of edge `id`: along the route the auto layout gave it while
 * both ends are still where it was routed for, otherwise (a node is being
 * dragged, was pinned with `pos`, or is still gliding into place) an
 * orthogonal path between the facing sides of the two nodes as they are now.
 * The selector returns a string, so the edge re-renders only when its path changes.
 */
export function useEdgeGeometry(id: string, source: string, target: string): EdgeGeometry | undefined {
  const selector = useCallback(
    (state: ReactFlowState): string => {
      const s = state.nodeInternals.get(source);
      const t = state.nodeInternals.get(target);
      const sAt = s?.positionAbsolute;
      const tAt = t?.positionAbsolute;
      if (!s || !t || !sAt || !tAt || !s.width || !s.height || !t.width || !t.height) return '';
      const route = (s.data as ComponentMetadata | undefined)?.routes?.[id];
      let points: Point[];
      let label: Point | undefined;
      const box = (at: Point, n: { width?: number | null; height?: number | null }): Box => ({ ...at, width: n.width ?? 0, height: n.height ?? 0 });
      if (route && close(route.from, sAt) && close(route.to, tAt) && route.points.length >= 2) {
        points = snapToBottom(snapToBottom(route.points, 'start', box(sAt, s)), 'end', box(tAt, t));
        label = route.label;
      } else {
        points = fallbackRoute(box(sAt, s), box(tAt, t));
      }
      const drawn = withHead(points);
      const at = label ?? labelPoint(points);
      return JSON.stringify({ path: roundedPath(drawn.points), labelX: at.x, labelY: at.y, start: points[0], head: drawn.head });
    },
    [id, source, target],
  );
  const geometry = useStore(selector);
  return geometry ? (JSON.parse(geometry) as EdgeGeometry) : undefined;
}

