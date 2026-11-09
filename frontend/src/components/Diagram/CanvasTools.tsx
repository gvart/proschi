import type { ReactNode } from 'react';
import { ControlButton, MiniMap, Panel } from 'reactflow';
import { Gauge, LayoutGrid, Map as MapIcon } from 'lucide-react';
import { CANVAS_EDGE } from '../../utils/canvasColors';
import type { SimOverlay } from '../../sim/overlay';
import type { LegendEntry } from '../../dsl/types';
import Legend from '../Canvas/Legend';
import LoadLegend from '../Overlay/LoadLegend';
import { toolButton } from '../Playground/ui';

/**
 * The canvas controls both editable canvases share (the editor's DiagramView
 * and practice's EditableCanvas): the load overlay's toggle and legend,
 * Auto-layout and the minimap. Their wiring is in canvasShared.ts.
 */

interface OverlayToolsProps {
  overlay?: SimOverlay;
  /** The document has traffic to simulate, so the overlay can be turned on. */
  canOverlay: boolean;
  onToggleOverlay: () => void;
  /** Beside the overlay toggle while the overlay is on (the editor's what-if pill). */
  whatIfControl?: ReactNode;
  /** Some node has a `pos x,y`, so Auto-layout is offered. */
  pinned: boolean;
  onResetLayout: () => void;
  /** The tools are hidden (the editor while a use case plays); the legends stay. */
  hideTools?: boolean;
  phone: boolean;
  /** The pane is narrow (practice, or the editor beside a docked panel): the load legend starts folded. */
  narrow?: boolean;
  legend?: LegendEntry[];
}

/** The canvas's top-right corner: the overlay toggle and Auto-layout, then the load legend and the diagram's own legend. */
export function OverlayTools({ overlay, canOverlay, onToggleOverlay, whatIfControl, pinned, onResetLayout, hideTools, phone, narrow, legend }: OverlayToolsProps) {
  return (
    <>
      {!hideTools && (
        <div className="flex items-center gap-1">
          {overlay && whatIfControl}
          {canOverlay && (
            <button
              type="button"
              onClick={onToggleOverlay}
              aria-pressed={overlay !== undefined}
              title="Show how busy each node is and the requests flowing, at the traffic block's rates"
              className={`${toolButton} aria-pressed:border-ink aria-pressed:bg-pop-yellow aria-pressed:text-on-accent aria-pressed:shadow-brutal-sm`}
            >
              <Gauge size={16} />
              <span className="whitespace-nowrap">
                <span className="hidden sm:inline">Overlay: </span>load
              </span>
            </button>
          )}
          {pinned && (
            <button onClick={onResetLayout} title="Remove every pos x,y and lay the diagram out automatically" className={toolButton}>
              <LayoutGrid size={16} />
              Auto-layout
            </button>
          )}
        </div>
      )}
      {overlay && !hideTools && <LoadLegend critical={overlay.critical} folded={phone || !!narrow} />}
      {legend && <Legend entries={legend} />}
    </>
  );
}

/** The minimap's button in the canvas controls; the minimap is for wide screens, on a phone it would cover the diagram. */
export function MiniMapButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <ControlButton className="[&>svg]:!fill-none aria-pressed:!bg-pop-yellow aria-pressed:!text-on-accent" onClick={onToggle} aria-label="Minimap" aria-pressed={shown} title={shown ? 'Hide the minimap' : 'Show the minimap'}>
      <MapIcon />
    </ControlButton>
  );
}

export function CanvasMiniMap() {
  return <MiniMap pannable zoomable ariaLabel="Minimap" nodeColor={CANVAS_EDGE} maskColor="rgb(var(--c-paper) / 0.6)" />;
}

/**
 * The canvas's top row: the editing buttons on the left, the overlay tools and legends on the right. One panel
 * across the canvas, so in a narrow pane (practice's diagram column, the editor with the Flows builder docked)
 * the right side wraps below the left instead of covering it.
 */
export function CanvasTopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  if (!left && !right) return null;
  return (
    <Panel position="top-left" style={{ right: 0 }} data-canvas-topbar className="pointer-events-none flex flex-wrap items-start gap-2">
      {left && <div className="pointer-events-auto flex flex-wrap gap-2">{left}</div>}
      {right && (
        <div data-topbar-right className="pointer-events-auto ml-auto flex flex-col items-end gap-2">
          {right}
        </div>
      )}
    </Panel>
  );
}
