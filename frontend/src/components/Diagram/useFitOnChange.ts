import { useEffect, useRef, type RefObject } from 'react';
import { getNodesBounds, getViewportForBounds, useNodesInitialized, useReactFlow, useStore, useStoreApi } from 'reactflow';

const PADDING = 0.15;
/** Fitting never zooms in past this, so a diagram of two nodes is not blown up to fill the pane. */
export const FIT_MAX_ZOOM = 1.1;
/** For `<ReactFlow fitView fitViewOptions>`, the first fit before this hook takes over. */
export const FIT_VIEW_OPTIONS = { padding: PADDING, maxZoom: FIT_MAX_ZOOM };

/** Parts of the pane covered by something floating over it (e.g. a tour card docked to a phone's edge). */
export interface FitInset {
  top?: number;
  bottom?: number;
}

interface FitOptions {
  duration?: number;
  wrapper?: RefObject<HTMLElement | null>;
  /** Fit the diagram into the part of the pane that is not covered; a change re-fits. */
  inset?: FitInset;
  /**
   * A change re-fits too, gliding there (unless motion is reduced) when it is
   * the only thing that changed: e.g. playback, which resizes the pane in place.
   * Such a change leaves the view alone once the reader zoomed or panned it.
   */
  glide?: string;
  /** The width of a panel floating over the pane's right side: the diagram fits beside it. A change re-fits like `glide`. */
  right?: number;
}

const GLIDE_MS = 300;
/** The narrowest strip beside a floating panel that the diagram is fitted into. */
const MIN_FIT_WIDTH = 160;

/**
 * Fits the view once the nodes are measured after `key` changes (nodes added
 * or removed, a layout settled, the pane shown again), not on every drag.
 * Nodes replaced by a new layout lose their measured size until React Flow
 * measures them again, so this waits for that rather than fitting nothing.
 *
 * It also waits for React Flow to know the size of its pane. While a pane is
 * hidden (the other tab on phones) React Flow records a placeholder 500×500,
 * and when the pane is shown again its resize observer corrects that a moment
 * later; fitting in between would centre the diagram in the wrong box.
 */
export function useFitOnChange(key: string, { duration, wrapper, inset, glide = '', right: rightInset }: FitOptions = {}) {
  const { setViewport } = useReactFlow();
  const store = useStoreApi();
  const measured = useNodesInitialized();
  const sized = useStore((s) => s.getNodes().every((n) => !!n.width && !!n.height));
  // Re-run when the recorded pane size changes, so a fit held back for a stale size happens once it is right.
  const paneSize = useStore((s) => `${s.width}x${s.height}`);
  const top = Math.max(0, Math.round(inset?.top ?? 0));
  const bottom = Math.max(0, Math.round(inset?.bottom ?? 0));
  const right = Math.max(0, Math.round(rightInset ?? 0));
  const baseKey = `${key}|${top}|${bottom}`;
  const fitKey = `${baseKey}|${right}|${glide}`;
  const fitted = useRef<string | undefined>(undefined);
  /** The base key of the last fit, to tell a glide-only change. */
  const fittedBase = useRef<string | undefined>(undefined);
  /** The viewport the last fit went to, and when: a different one since means the reader zoomed or panned. */
  const target = useRef<{ x: number; y: number; zoom: number; at: number } | undefined>(undefined);
  useEffect(() => {
    if (!measured || !sized || fitted.current === fitKey) return;
    const frame = requestAnimationFrame(() => {
      // A hidden pane has no size; fitting it would produce NaN. Fit again when it is shown, even if nothing else changed.
      if (wrapper && !wrapper.current?.offsetWidth) {
        fitted.current = undefined;
        return;
      }
      const { domNode, width, height, getNodes, minZoom, maxZoom, nodeOrigin } = store.getState();
      if (!domNode?.offsetWidth || Math.abs(domNode.offsetWidth - width) > 1 || Math.abs(domNode.offsetHeight - height) > 1) return;
      const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const glideOnly = fittedBase.current === baseKey;
      fitted.current = fitKey;
      fittedBase.current = baseKey;
      if (glideOnly && movedByHand(store.getState().transform, target.current)) return;
      const ms = glideOnly && !reduced ? GLIDE_MS : duration;
      const nodes = getNodes().filter((n) => !n.hidden);
      if (nodes.length === 0) return;
      const free = height - top - bottom;
      const covered = (top || bottom) && free > height / 4;
      // Beside a floating panel only while that leaves a usable strip; past that the panel is the reader's focus.
      const freeWidth = width - right >= MIN_FIT_WIDTH ? width - right : width;
      const viewport = getViewportForBounds(getNodesBounds(nodes, nodeOrigin), freeWidth, covered ? free : height, minZoom, Math.min(maxZoom, FIT_MAX_ZOOM), PADDING);
      const next = covered ? { ...viewport, y: viewport.y + top } : viewport;
      target.current = { ...next, at: performance.now() + (ms ?? 0) };
      setViewport(next, { duration: ms });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, baseKey, measured, sized, paneSize, setViewport, duration, wrapper, store, top, bottom, right]);
}

/** Whether the view is not where the last fit left it (after its glide): the reader zoomed or panned since. */
function movedByHand([x, y, zoom]: [number, number, number], last: { x: number; y: number; zoom: number; at: number } | undefined): boolean {
  if (!last || performance.now() < last.at + 50) return false;
  return Math.abs(x - last.x) > 1 || Math.abs(y - last.y) > 1 || Math.abs(zoom - last.zoom) > 0.001;
}
