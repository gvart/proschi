import { useEffect, useRef, type RefObject } from 'react';
import { useNodesInitialized, useReactFlow, useStore } from 'reactflow';

/**
 * Fits the view once the nodes are measured after `key` changes (nodes added
 * or removed, a layout settled, the pane shown again), not on every drag.
 * Nodes replaced by a new layout lose their measured size until React Flow
 * measures them again, so this waits for that rather than fitting nothing.
 */
export function useFitOnChange(key: string, { duration, wrapper }: { duration?: number; wrapper?: RefObject<HTMLElement | null> } = {}) {
  const { fitView } = useReactFlow();
  const measured = useNodesInitialized();
  const sized = useStore((s) => s.getNodes().every((n) => !!n.width && !!n.height));
  const fitted = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!measured || !sized || fitted.current === key) return;
    const frame = requestAnimationFrame(() => {
      // A hidden pane (the other mobile tab) has no size; fitting it would produce NaN.
      // Fit again when it is shown, even if nothing else changed.
      if (wrapper && !wrapper.current?.offsetWidth) {
        fitted.current = undefined;
        return;
      }
      fitted.current = key;
      fitView({ padding: 0.15, duration });
    });
    return () => cancelAnimationFrame(frame);
  }, [key, measured, sized, fitView, duration, wrapper]);
}
