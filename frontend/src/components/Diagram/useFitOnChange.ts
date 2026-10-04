import { useEffect, useRef, type RefObject } from 'react';
import { getNodesBounds, getViewportForBounds, useNodesInitialized, useReactFlow, useStore, useStoreApi } from 'reactflow';

const PADDING = 0.15;

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
}

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
export function useFitOnChange(key: string, { duration, wrapper, inset }: FitOptions = {}) {
  const { fitView, setViewport } = useReactFlow();
  const store = useStoreApi();
  const measured = useNodesInitialized();
  const sized = useStore((s) => s.getNodes().every((n) => !!n.width && !!n.height));
  // Re-run when the recorded pane size changes, so a fit held back for a stale size happens once it is right.
  const paneSize = useStore((s) => `${s.width}x${s.height}`);
  const top = Math.max(0, Math.round(inset?.top ?? 0));
  const bottom = Math.max(0, Math.round(inset?.bottom ?? 0));
  const fitKey = `${key}|${top}|${bottom}`;
  const fitted = useRef<string | undefined>(undefined);
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
      fitted.current = fitKey;
      const free = height - top - bottom;
      if ((top || bottom) && free > height / 4) {
        const nodes = getNodes().filter((n) => !n.hidden);
        if (nodes.length === 0) return;
        const viewport = getViewportForBounds(getNodesBounds(nodes, nodeOrigin), width, free, minZoom, maxZoom, PADDING);
        setViewport({ ...viewport, y: viewport.y + top }, { duration });
      } else {
        fitView({ padding: PADDING, duration });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, measured, sized, paneSize, fitView, setViewport, duration, wrapper, store, top, bottom]);
}
