import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { loadJson, saveJson } from '../../services/storage';
import { clampPaneHeight, PANE_MAX_SHARE, PANE_MIN } from './flows';

/**
 * The canvas column of both editable canvases (the editor's DiagramView and
 * practice's EditableCanvas): the rail and the canvas in a row, and under
 * them, while it is open on a wider screen, the Flows pane (FlowsPanel's
 * `pane` layout) behind a drag handle. The canvas gets shorter rather than
 * covered. The pane's height is remembered for every canvas.
 */

const HEIGHT_KEY = 'proschi.flows.height';
/** Before one was chosen: about two fifths of the column. */
const DEFAULT_SHARE = 0.42;
/** An arrow key moves the handle this far; with Shift, four times as far. */
const KEY_STEP = 24;

interface FlowsSplitProps {
  phone: boolean;
  /** The Flows pane, while it is open; null hides it and its handle. */
  pane: ReactNode;
  /** The pane's height was changed by hand (a drag let go, or a key), so the canvas may glide to a new fit. */
  onResized: () => void;
  /** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z anywhere in the column (the canvas's undo and redo). */
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  /** The rail and the canvas. */
  children: ReactNode;
}

export function FlowsSplit({ phone, pane, onResized, onKeyDown, children }: FlowsSplitProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const [column, setColumn] = useState(0);
  const [chosen, setChosen] = useState<number | null>(() => loadJson<number | null>(HEIGHT_KEY, null));
  const open = !!pane;
  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!open || !el) return;
    const update = () => {
      if (el.offsetHeight > 0) setColumn(el.offsetHeight);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);
  const height = clampPaneHeight(typeof chosen === 'number' && Number.isFinite(chosen) ? chosen : (column || 600) * DEFAULT_SHARE, column || 600);
  const max = clampPaneHeight(Infinity, column || 600);

  const commit = (next: number) => {
    const clamped = clampPaneHeight(next, column || 600);
    setChosen(clamped);
    saveJson(HEIGHT_KEY, clamped);
    onResized();
  };
  const drag = useRef<{ y: number; height: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { y: e.clientY, height };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setChosen(clampPaneHeight(drag.current.height + drag.current.y - e.clientY, column || 600));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const start = drag.current;
    drag.current = null;
    commit(start.height + start.y - e.clientY);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const next = e.key === 'ArrowUp' ? height + step : e.key === 'ArrowDown' ? height - step : e.key === 'Home' ? PANE_MIN : e.key === 'End' ? max : undefined;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    commit(next);
  };

  return (
    <div ref={columnRef} className="flex h-full min-h-0 min-w-0 flex-col" onKeyDown={onKeyDown}>
      <div className={`flex min-h-0 min-w-0 flex-1 ${phone ? 'flex-col' : ''}`}>{children}</div>
      {pane && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the flows pane"
            aria-valuemin={PANE_MIN}
            aria-valuemax={max}
            aria-valuenow={height}
            aria-valuetext={`${height} pixels, at most ${Math.round(PANE_MAX_SHARE * 100)}% of the column`}
            tabIndex={0}
            title="Drag, or use the arrow keys, to resize"
            data-testid="flows-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKey}
            className="group/handle relative z-10 h-[2px] shrink-0 cursor-row-resize touch-none bg-ink outline-hidden transition-colors before:absolute before:inset-x-0 before:-bottom-1.5 before:-top-1.5 before:content-[''] hover:bg-pop-pink focus-visible:bg-pop-pink active:bg-pop-pink"
          >
            <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-bw-1 border-ink bg-surface group-hover/handle:bg-pop-pink group-focus-visible/handle:bg-pop-pink" />
          </div>
          <div className="min-h-0 shrink-0" style={{ height }} data-testid="flows-pane">
            {pane}
          </div>
        </>
      )}
    </div>
  );
}
