import { createContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReactFlow, useStore, useStoreApi, type Edge, type Node, type NodeDragHandler } from 'reactflow';
import { loadJson, saveJson } from '../../services/storage';
import { edgeOverlays, type SimOverlay } from '../../sim/overlay';
import type { Diagram } from '../../dsl/types';
import type { FindItem } from './nodeSearch';

/**
 * The canvas behaviour both editable canvases share (the editor's DiagramView
 * and practice's EditableCanvas): the load overlay's state and wiring, dragging
 * to pin and the node finder's list. Their controls are in CanvasTools.tsx.
 */

/** "Overlay: load", remembered under `key`: on unless this viewer turned it off. */
export function useOverlayOn(key: string): [boolean, () => void] {
  const [on, setOn] = useState(() => loadJson<boolean>(key, true) !== false);
  return [
    on,
    () => {
      setOn(!on);
      saveJson(key, !on);
    },
  ];
}

/** The edges with what they carry while the overlay is on: rps and latency chips, tinted by load (RoutedEdge). */
export function withEdgeLoads(edges: Edge[], overlay: SimOverlay | undefined): Edge[] {
  if (!overlay) return edges;
  const loads = edgeOverlays(edges, overlay);
  return edges.map((e) => (loads[e.id] ? { ...e, data: { ...(e.data ?? {}), overlay: loads[e.id] } } : e));
}

/** The nodes with their load while the overlay is on: the utilisation and the bottleneck ring (ComponentNode). */
export function withNodeLoads(nodes: Node[], overlay: SimOverlay | undefined): Node[] {
  if (!overlay) return nodes;
  return nodes.map((n) => (overlay.nodes[n.id] ? { ...n, data: { ...n.data, overlay: overlay.nodes[n.id] } } : n));
}

/**
 * Dragging a node pins it: a real move (not a click) writes its `pos x,y` through `onMove`; a node from an
 * imported file goes back where it was (`restore`), with a notice, as its text is in another file.
 */
export function usePinDrag({
  imported,
  onMove,
  restore,
  onNotice,
  lockedNotice = (id, file) => `'${id}' is declared in ${file}; move it there.`,
}: {
  imported: ReadonlyMap<string, string>;
  onMove: (moved: { id: string; position: { x: number; y: number } }[]) => void;
  restore: (positions: Map<string, { x: number; y: number }>) => void;
  onNotice: (message: string) => void;
  /** Why an imported node went back. */
  lockedNotice?: (id: string, file: string) => string;
}): { onNodeDragStart: NodeDragHandler; onNodeDragStop: NodeDragHandler } {
  const start = useRef(new Map<string, { x: number; y: number }>());
  return {
    onNodeDragStart: (_event, _node, dragged) => {
      start.current = new Map(dragged.map((n) => [n.id, { ...n.position }]));
    },
    onNodeDragStop: (_event, _node, dragged) => {
      // A click is a drag that never moved; only real moves are written to the text.
      const moved = dragged.filter((n) => {
        const from = start.current.get(n.id);
        return !from || Math.abs(from.x - n.position.x) > 1 || Math.abs(from.y - n.position.y) > 1;
      });
      const locked = moved.filter((n) => imported.has(n.id));
      if (locked.length > 0) {
        restore(new Map(locked.flatMap((n) => (start.current.has(n.id) ? [[n.id, start.current.get(n.id)!] as const] : []))));
        onNotice(lockedNotice(locked[0].id, imported.get(locked[0].id)!));
      }
      if (moved.length > locked.length) onMove(moved.filter((n) => !imported.has(n.id)).map((n) => ({ id: n.id, position: n.position })));
    },
  };
}

/** The nodes the finder offers: those drawn, without groups and notes (and the node itself) when connecting `connectFrom`. */
export function finderItemsOf(diagram: Diagram, drawn: readonly Node[], connectFrom?: string): FindItem[] {
  const ids = new Set(drawn.map((n) => n.id));
  return diagram.nodes
    .filter((n) => ids.has(n.id) && (!connectFrom || (n.id !== connectFrom && n.kind !== 'group' && n.kind !== 'text')))
    .map((n) => ({ id: n.id, name: n.name, tech: n.techStack || undefined }));
}

/** Below this width a canvas pane is narrow: the load legend starts folded and the shortcut hint shortens. */
export const NARROW_PANE = 640;

/** Whether the element is narrower than `below` pixels, followed as it resizes (kept while it is hidden). */
export function useNarrow(ref: RefObject<HTMLElement | null>, below = NARROW_PANE): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      if (el.offsetWidth > 0) setNarrow(el.offsetWidth < below);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, below]);
  return narrow;
}

/**
 * How far the canvas's top bar (CanvasTopBar) reaches into the pane `ref`, in pixels with a small gap, so a fit
 * keeps the diagram below its buttons and tools. The load legend counts folded (its one line) and an open popover
 * (the what-if card) not at all, so opening either does not move the diagram. Measured again when `contents` (what the bar shows) changes, and as the pane or
 * the bar resizes (the bar wraps in a narrow pane).
 */
export function useTopBarInset(ref: RefObject<HTMLElement | null>, contents: string): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    const bar = pane.querySelector<HTMLElement>('[data-canvas-topbar]');
    const measure = () => {
      if (pane.offsetWidth === 0) return;
      setInset((prev) => {
        const next = barBottom(pane, bar);
        return Math.abs(prev - next) > 1 ? next : prev;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    if (bar) observer.observe(bar);
    return () => observer.disconnect();
  }, [ref, contents]);
  return inset;
}

function barBottom(pane: HTMLElement, bar: HTMLElement | null): number {
  const top = pane.getBoundingClientRect().top;
  let bottom = top;
  for (const group of bar ? Array.from(bar.children) : []) {
    // A passing hint (the connect hint) does not move the diagram either.
    if (group.matches('[data-topbar-passing]')) continue;
    /** How far an open popover pushed the parts below it down. */
    let shift = 0;
    for (const part of group.matches('[data-topbar-right]') ? Array.from(group.children) : [group]) {
      // A popover open in the bar (the what-if card) is passing, like an open legend: it does not move the diagram,
      // so neither it nor the room it takes from the legend under it counts.
      if (part.matches('[data-topbar-popover]')) {
        const next = part.nextElementSibling;
        if (part.childElementCount > 0 && next) shift = next.getBoundingClientRect().top - part.getBoundingClientRect().top;
        continue;
      }
      const box = ((part.matches('.pc-load-legend') && part.querySelector('summary')) || part).getBoundingClientRect();
      if (box.height > 0) bottom = Math.max(bottom, box.bottom - shift);
    }
  }
  return bottom > top ? Math.round(bottom - top + 8) : 0;
}

/**
 * Where a popover of the top-right tools (the what-if card) opens: a slot between the tools and the load legend,
 * so the legend moves down under the card instead of the card covering it.
 */
export const ToolsPopoverSlot = createContext<HTMLElement | null>(null);

/** Whether a pointer is pressed anywhere on the page (a click under way, or a drag). */
let pressed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (pressed = true), true);
  for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, () => (pressed = false), true);
}

/**
 * `open`, turned on a moment late and never while a pointer is pressed. The rail that a selection opens (the
 * Selection tab) narrows the canvas, and the diagram glides to its new fit; waiting lets the click that selected
 * finish what it began first: a double-click, or a drag to pin.
 */
export function useLateOpen(open: boolean, ms = 350): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const wait = () => {
      timer = window.setTimeout(() => (pressed ? wait() : setLate(true)), ms);
    };
    wait();
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [open, ms]);
  return open && late;
}

/** The row of the rail (CanvasEditing's PaletteDock) and the canvas: side by side, or on a phone the canvas over its sheet. */
export const railRowClass = (phone: boolean) => (phone ? 'flex h-full flex-col' : 'flex h-full');

/** After the pane's own glide to a new fit (useFitOnChange's 300ms), with a margin. */
const KEEP_IN_VIEW_MS = 400;

/**
 * Keeps the selected node `id` on screen when the rail (`railOpen`) opens or closes and the pane changes size
 * under it: beside the canvas, or a phone's sheet under it. The fit that follows already does, unless the reader
 * zoomed or panned; then the view pans, at the same zoom, to bring the node back into the middle.
 */
export function useKeepInView(id: string | undefined, railOpen: boolean) {
  const { getNode, getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();
  const size = useStore((s) => `${s.width}x${s.height}`);
  const last = useRef({ size, railOpen });
  useEffect(() => {
    // The pane takes its new size a moment after the rail changes; another resize (a splitter) is left alone.
    const resized = last.current.size !== size && last.current.railOpen !== railOpen;
    if (last.current.size !== size) last.current = { size, railOpen };
    if (!id || !resized) return;
    const timer = window.setTimeout(() => {
      const node = getNode(id);
      const { width, height } = store.getState();
      if (!node?.width || !node.height || !width || !height) return;
      const { x, y, zoom } = getViewport();
      const at = node.positionAbsolute ?? node.position;
      const left = at.x * zoom + x;
      const top = at.y * zoom + y;
      if (left >= 0 && top >= 0 && left + node.width * zoom <= width && top + node.height * zoom <= height) return;
      setViewport({ x: width / 2 - (at.x + node.width / 2) * zoom, y: height / 2 - (at.y + node.height / 2) * zoom, zoom });
    }, KEEP_IN_VIEW_MS);
    return () => clearTimeout(timer);
  }, [id, size, railOpen, getNode, getViewport, setViewport, store]);
}
