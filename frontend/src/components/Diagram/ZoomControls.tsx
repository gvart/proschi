import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getNodesBounds, getViewportForBounds, useReactFlow, useStore, useStoreApi } from 'reactflow';
import { shallow } from 'zustand/shallow';
import 'reactflow/dist/style.css';
import '../Canvas/canvas.css';
import { FIT_PADDING, movedByHand } from './useFitOnChange';

/**
 * The zoom buttons of the diagram views (React Flow or not), bottom left:
 * zoom in, zoom out, fit (pressed while the view stays fitted), and the zoom
 * level, which goes back to 100%. React Flow's look and icons, so the views
 * match; `children` adds buttons below (the minimap's).
 */
export interface ZoomControlsProps {
  zoom: number;
  min: number;
  max: number;
  /** The view is fitted and follows the pane as it is resized. */
  fitted: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  children?: ReactNode;
}

export function ZoomControls({ zoom, min, max, fitted, onZoomIn, onZoomOut, onFit, onReset, children }: ZoomControlsProps) {
  const pct = Math.round(zoom * 100);
  return (
    <div className="react-flow__panel react-flow__controls pc-zoom bottom left" role="group" aria-label="Zoom" data-testid="rf__controls">
      <button type="button" className="react-flow__controls-button react-flow__controls-zoomin" onClick={onZoomIn} disabled={zoom >= max - 1e-3} aria-label="zoom in" title="Zoom in (Ctrl/⌘ + scroll)">
        <PlusIcon />
      </button>
      <button type="button" className="react-flow__controls-button react-flow__controls-zoomout" onClick={onZoomOut} disabled={zoom <= min + 1e-3} aria-label="zoom out" title="Zoom out (Ctrl/⌘ + scroll)">
        <MinusIcon />
      </button>
      <button type="button" className="react-flow__controls-button react-flow__controls-fitview" onClick={onFit} aria-pressed={fitted} aria-label="fit view" title="Fit the whole diagram in view">
        <FitViewIcon />
      </button>
      <button type="button" className="react-flow__controls-button pc-zoom__pct" onClick={onReset} aria-label={`Zoom ${pct}%, reset to 100%`} title="Actual size (100%)">
        {pct}%
      </button>
      {children}
    </div>
  );
}

const GLIDE_MS = 250;

/**
 * ZoomControls for a React Flow canvas, in place of its `<Controls>`. Fit fits
 * the whole diagram at any zoom up to the canvas's maximum, and keeps it
 * fitted as the pane is resized until the view is zoomed or panned.
 */
export function CanvasControls({ children }: { children?: ReactNode }) {
  const { zoomIn, zoomOut, zoomTo, setViewport } = useReactFlow();
  const store = useStoreApi();
  const [zoom, min, max, width, height] = useStore((s) => [s.transform[2], s.minZoom, s.maxZoom, s.width, s.height], shallow);
  const transform = useStore((s) => s.transform);
  const [fitted, setFitted] = useState(false);
  /** Where the last fit went, and when it got there. */
  const target = useRef<{ x: number; y: number; zoom: number; at: number } | undefined>(undefined);

  const fit = (duration: number) => {
    const { getNodes, nodeOrigin, minZoom, maxZoom, width: w, height: h } = store.getState();
    const nodes = getNodes().filter((n) => !n.hidden);
    if (nodes.length === 0 || !w || !h) return;
    const viewport = getViewportForBounds(getNodesBounds(nodes, nodeOrigin), w, h, minZoom, maxZoom, FIT_PADDING);
    target.current = { ...viewport, at: performance.now() + duration };
    void setViewport(viewport, { duration });
  };

  // While fitted, the fit follows the pane's size.
  useEffect(() => {
    if (fitted) fit(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the pane is resized
  }, [width, height]);

  // A zoom or pan since the fit (by hand, or by the canvas re-fitting itself) leaves it.
  useEffect(() => {
    if (fitted && movedByHand(transform, target.current)) setFitted(false);
  }, [fitted, transform]);

  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ms = reduced ? 0 : GLIDE_MS;
  return (
    <ZoomControls
      zoom={zoom}
      min={min}
      max={max}
      fitted={fitted}
      onZoomIn={() => {
        setFitted(false);
        void zoomIn({ duration: ms });
      }}
      onZoomOut={() => {
        setFitted(false);
        void zoomOut({ duration: ms });
      }}
      onFit={() => {
        fit(ms);
        setFitted(true);
      }}
      onReset={() => {
        setFitted(false);
        void zoomTo(1, { duration: ms });
      }}
    >
      {children}
    </ZoomControls>
  );
}

// React Flow's own control icons (@reactflow/controls), so every view's buttons look alike.
function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 5" aria-hidden="true">
      <path d="M0 0h32v4.2H0z" />
    </svg>
  );
}

function FitViewIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 30" aria-hidden="true">
      <path d="M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" />
    </svg>
  );
}
