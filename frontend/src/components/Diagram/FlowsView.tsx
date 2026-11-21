import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { historyKey, typingIn } from './canvasEditState';

/**
 * The canvas column of both editable canvases (the editor's DiagramView and
 * practice's EditableCanvas): the rail and the canvas in a row, and, while
 * the `Architecture | Flows` switch is on Flows (wider screens), the Flows
 * view over the whole column. The canvas stays mounted under it, hidden and
 * inert, so it keeps its view and the Flows view's map (ArchitectureMap.tsx)
 * reads its layout. F switches between the two, and Ctrl/Cmd+Z undoes
 * in either.
 */

interface FlowsViewProps {
  phone: boolean;
  /** The Flows view, while it is shown; null shows the canvas. */
  view: ReactNode;
  /** F: switches between the canvas and Flows; absent where there is no Flows view (Code mode, playback, a phone). */
  onToggle?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** The rail and the canvas. */
  children: ReactNode;
}

/** Keys that belong to a control with its own letter keys (a select's type-ahead, a menu): F there is not the switch. */
const OWN_KEYS = '[role="combobox"], [role="menu"], [role="dialog"], [role="listbox"]:not([data-sequence])';

export function FlowsView({ phone, view, onToggle, onUndo, onRedo, children }: FlowsViewProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const shown = !!view;
  // The focus goes with the switch: into the view when it shows (the canvas under it turns inert), back to the canvas when it goes.
  const was = useRef(shown);
  useLayoutEffect(() => {
    if (was.current === shown) return;
    was.current = shown;
    const lost = document.activeElement === document.body || document.activeElement === null || !!columnRef.current?.contains(document.activeElement);
    if (!lost) return;
    if (shown) (viewRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ?? viewRef.current?.querySelector<HTMLElement>('[data-flows-focus]'))?.focus({ preventScroll: true });
    else columnRef.current?.querySelector<HTMLElement>('[data-canvas-focus]')?.focus({ preventScroll: true });
  }, [shown]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = historyKey(e);
    if (step) {
      e.preventDefault();
      if (step === 'undo') onUndo();
      else onRedo();
      return;
    }
    if (onToggle && !e.defaultPrevented && e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target) && !(e.target as Element).closest?.(OWN_KEYS)) {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col" onKeyDown={onKeyDown}>
      <div ref={columnRef} className={`flex min-h-0 min-w-0 flex-1 ${phone ? 'flex-col' : ''} ${shown ? 'invisible' : ''}`} inert={shown}>
        {children}
      </div>
      {view && (
        <div ref={viewRef} data-testid="flows-view" className="absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col">
          {view}
        </div>
      )}
    </div>
  );
}

interface FlowsScrollerProps {
  /** The sequence diagram, given the width it has to fit its lanes in (the view's). */
  children: (fit: number | undefined) => ReactNode;
  /** Floats over the diagram's bottom right corner (the architecture map), and keeps clear of the selected step. */
  float?: ReactNode;
}

/** The sticky lane headers' strip (SequenceDiagram's HEADER): what floats up goes under it. */
const LANE_HEADERS = 52;
/** Between what floats and the edges. */
const GAP = 12;

type Size = { width: number; bar: number; barBottom: number; float: number };

/**
 * The body of the Flows view: one scrolling surface, the only one in the view. The diagram's lane headers stick at
 * its top; the lanes fit its width and only an over-wide diagram scrolls it sideways. What floats sits in the bottom
 * corner and moves to the top corner while the selected step, its toolbar or a card would be under it.
 */
export function FlowsScroller({ children, float }: FlowsScrollerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>();
  const floats = !!float;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = () => {
      const next: Size = {
        width: scroller.clientWidth,
        bar: scroller.offsetWidth - scroller.clientWidth,
        barBottom: scroller.offsetHeight - scroller.clientHeight,
        float: floatRef.current?.offsetHeight ?? 0,
      };
      setSize((prev) => (prev && (Object.keys(next) as (keyof Size)[]).every((k) => prev[k] === next[k]) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    // The content's size decides whether there are scrollbars.
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    if (floatRef.current) observer.observe(floatRef.current);
    return () => observer.disconnect();
  }, [floats]);

  // Up in the top corner while what is being worked on (the selected step, the draft of a new one) is under the bottom corner.
  const [up, setUp] = useState(false);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !floats) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = floatRef.current?.getBoundingClientRect();
        if (!box) return;
        const s = scroller.getBoundingClientRect();
        const bottom = { left: box.left, right: box.right, top: s.top + scroller.clientHeight - GAP - box.height, bottom: s.top + scroller.clientHeight - GAP };
        const work = [...scroller.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"], [role="dialog"], [data-step-toolbar], [data-label-editor], [data-card], [data-draft]')].map((el) => el.getBoundingClientRect());
        setUp(work.some((w) => w.left < bottom.right && w.right > bottom.left && w.top < bottom.bottom && w.bottom > bottom.top));
      });
    };
    check();
    scroller.addEventListener('scroll', check, { passive: true });
    const observer = new MutationObserver(check);
    observer.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'style'] });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      observer.disconnect();
    };
  }, [floats]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollerRef} data-flows-scroller className="absolute inset-0 overflow-auto bg-paper">
        <div className="flex min-h-full w-max min-w-full">
          {/* Room at the foot, so the last rows scroll clear of what floats in the corner. */}
          <div className="flex min-w-0 flex-1 flex-col" style={{ paddingBottom: (size?.float ?? 0) + GAP * 2 }}>
            {children(size?.width)}
          </div>
        </div>
      </div>
      {float && (
        <div
          ref={floatRef}
          className="absolute z-30"
          style={{ right: (size?.bar ?? 0) + GAP, ...(up ? { top: LANE_HEADERS + GAP } : { bottom: (size?.barBottom ?? 0) + GAP }) }}
        >
          {float}
        </div>
      )}
    </div>
  );
}
