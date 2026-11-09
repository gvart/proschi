import type { CSSProperties } from 'react';
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
