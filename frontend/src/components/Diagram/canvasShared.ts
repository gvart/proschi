import { useRef, useState } from 'react';
import type { Edge, Node, NodeDragHandler } from 'reactflow';
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
