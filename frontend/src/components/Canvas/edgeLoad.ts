import type { CSSProperties } from 'react';
import { useStore } from 'reactflow';
import type { EdgeOverlay } from '../../sim/overlay';
import { heatStroke } from '../../utils/heat';

/** What the load overlay put on an edge (`data.overlay`), if it is on. */
export const edgeLoadOf = (data: unknown): EdgeOverlay | undefined => (data as { overlay?: EdgeOverlay } | undefined)?.overlay;

/** Bold on the p99 path. */
export const loadWidth = (load: EdgeOverlay) => (load.critical ? 5 : 2.5);

/** An edge's style under the load overlay: tinted by the node it feeds, bold on the p99 path. */
export function withLoad(style: CSSProperties | undefined, load: EdgeOverlay | undefined): CSSProperties | undefined {
  if (!load) return style;
  const stroke = heatStroke(load.utilization, load.saturated) ?? (load.critical ? 'rgb(var(--c-ink))' : undefined);
  return { ...style, ...(stroke ? { stroke } : {}), strokeWidth: loadWidth(load) };
}

/** Whether the overlay replaces the edge's own label with its chip (`EdgeLoadLabel`). */
export const showsLoadLabel = (load: EdgeOverlay | undefined): load is EdgeOverlay => !!load && load.rps > 0;

/** Below this zoom the chips' 11px text would draw under 8px: they are left out rather than drawn illegibly. */
export const LOAD_LABEL_MIN_ZOOM = 0.72;

/** Whether the view is close enough to read the edges' chips; re-renders an edge only when that flips. */
export const useLoadLabelsLegible = (): boolean => useStore((s) => s.transform[2] >= LOAD_LABEL_MIN_ZOOM);
