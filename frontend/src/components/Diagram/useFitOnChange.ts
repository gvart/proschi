import { useEffect, useRef, type RefObject } from 'react';
import { getNodesBounds, getViewportForBounds, useNodesInitialized, useReactFlow, useStore, useStoreApi } from 'reactflow';

const PADDING = 0.15;
/** Fitting never zooms in past this, so a diagram of two nodes is not blown up to fill the pane. */
export const FIT_MAX_ZOOM = 1.1;
/**
 * After components are added, fitting never zooms out below this, so they stay readable; the view
 * pans to the newest one instead of shrinking the whole diagram.
 */
export const ADD_MIN_ZOOM = 0.75;
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
  /**
   * The component the canvas added last. While it is new to the fit (or the one the last fit followed), and the
   * nodes before it are all still there, the fit keeps a readable zoom (ADD_MIN_ZOOM) and pans to it.
   */
  added?: string;
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
export function useFitOnChange(key: string, { duration, wrapper, inset, glide = '', right: rightInset, added: addedId }: FitOptions = {}) {
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
  /** The key of the last fit, to tell a change of only the covered parts (an inset). */
  const fittedKey = useRef<string | undefined>(undefined);
  /** The viewport the last fit went to, and when: a different one since means the reader zoomed or panned. */
  const target = useRef<{ x: number; y: number; zoom: number; at: number } | undefined>(undefined);
  /** The nodes of the last fit, to tell an addition; and the node it followed (see `added`). */
  const fittedIds = useRef<ReadonlySet<string>>(new Set());
  const added = useRef<string | undefined>(undefined);
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
      // Only what covers the pane changed (a bar's height, a docked card): like a glide, it leaves a view the reader moved.
      const coverOnly = fittedKey.current === key;
      fitted.current = fitKey;
      fittedBase.current = baseKey;
      fittedKey.current = key;
      if ((glideOnly || coverOnly) && movedByHand(store.getState().transform, target.current)) return;
      const ms = glideOnly && !reduced ? GLIDE_MS : duration;
      const nodes = getNodes().filter((n) => !n.hidden);
      if (nodes.length === 0) return;
      const ids = new Set(nodes.map((n) => n.id));
      const before = fittedIds.current;
      // Added on the canvas to the nodes there were; the later fits of the same nodes (a layout settling, its id
      // following its name) follow it too.
      const kept = [...before].every((id) => ids.has(id) || id === added.current);
      const follow = !!addedId && ids.has(addedId) && kept && (!before.has(addedId) || added.current === addedId);
      added.current = follow ? addedId : undefined;
      fittedIds.current = ids;
      const free = height - top - bottom;
      const covered = (top || bottom) && free > height / 4;
      // Beside a floating panel only while that leaves a usable strip; past that the panel is the reader's focus.
      const freeWidth = width - right >= MIN_FIT_WIDTH ? width - right : width;
      const freeHeight = covered ? free : height;
      const viewport = getViewportForBounds(getNodesBounds(nodes, nodeOrigin), freeWidth, freeHeight, minZoom, Math.min(maxZoom, FIT_MAX_ZOOM), PADDING);
      const newest = added.current ? nodes.find((n) => n.id === added.current) : undefined;
      // Too small to read after an addition: the newest node at a readable zoom, in the middle of the free part.
      const readable =
        newest && viewport.zoom < ADD_MIN_ZOOM
          ? (() => {
              const at = newest.positionAbsolute ?? newest.position;
              const zoom = Math.min(ADD_MIN_ZOOM, maxZoom);
              return { x: freeWidth / 2 - (at.x + (newest.width ?? 0) / 2) * zoom, y: freeHeight / 2 - (at.y + (newest.height ?? 0) / 2) * zoom, zoom };
            })()
          : viewport;
      const next = covered ? { ...readable, y: readable.y + top } : readable;
      target.current = { ...next, at: performance.now() + (ms ?? 0) };
      setViewport(next, { duration: ms });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, baseKey, key, measured, sized, paneSize, setViewport, duration, wrapper, store, top, bottom, right, addedId]);
}

/** Whether the view is not where the last fit left it (after its glide): the reader zoomed or panned since. */
function movedByHand([x, y, zoom]: [number, number, number], last: { x: number; y: number; zoom: number; at: number } | undefined): boolean {
  if (!last || performance.now() < last.at + 50) return false;
  return Math.abs(x - last.x) > 1 || Math.abs(y - last.y) > 1 || Math.abs(zoom - last.zoom) > 0.001;
}
