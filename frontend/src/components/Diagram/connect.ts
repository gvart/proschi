import { useEffect, useRef } from 'react';
import { useStore, useStoreApi, type Connection } from 'reactflow';
import type { Diagram } from '../../dsl/types';

/**
 * Connecting two components on either editable canvas (the editor's
 * DiagramView and practice's EditableCanvas): what a new connection is written
 * with, why one can't be made, and the drop target that works at any zoom.
 */

/** Why `from -> to` can't be added, or the label it is written with: the target type's `protocol`, if it has one. */
export function newConnection(diagram: Diagram, from: string, to: string): { error: string; label?: undefined } | { error?: undefined; label?: string } {
  const name = (id: string) => diagram.nodes.find((n) => n.id === id)?.name ?? id;
  if (from === to) return { error: `"${name(from)}" can't connect to itself.` };
  if (diagram.edges.some((e) => e.source === from && e.target === to)) return { error: `"${name(from)}" already connects to "${name(to)}".` };
  return { label: diagram.nodes.find((n) => n.id === to)?.resolvedType?.protocol };
}

/** How near a dot, in screen pixels, a drop still lands on it, whatever the zoom. */
const DROP_RADIUS = 24;

/**
 * Keeps connecting the same size on screen at any zoom: React Flow's drop
 * radius is in diagram units, and the dots' hit pads (canvas.css) are sized
 * by `--pc-zoom`. Rendered inside <ReactFlow>.
 */
export function ConnectAtAnyZoom() {
  const zoom = useStore((s) => s.transform[2]);
  const store = useStoreApi();
  useEffect(() => {
    store.setState({ connectionRadius: DROP_RADIUS / zoom });
    store.getState().domNode?.style.setProperty('--pc-zoom', String(zoom));
  }, [zoom, store]);
  return null;
}

/**
 * The drag-to-connect props of a canvas: a drop on a node that can't take the
 * connection (itself, or one it already has) is refused, its outline shows why
 * while hovered (ComponentNode's body target), and the drop says why in a notice.
 */
export function useConnectDrop(diagram: Diagram, onConnect: (from: string, to: string) => void, onNotice: (message: string) => void) {
  const store = useStoreApi();
  /** Dragging an end of an existing connection: refusals there need no notice. */
  const reconnecting = useRef(false);
  const check = (c: Connection) => !!c.source && !!c.target && newConnection(diagram, c.source, c.target).error === undefined;
  /** Lets the nodes' body targets take the pointer (canvas.css), at once: a render would miss the first moves. */
  const setConnecting = (on: boolean) => store.getState().domNode?.classList.toggle('pc-connecting', on);
  return {
    isValidConnection: (c: Connection) => reconnecting.current || check(c),
    onConnectStart: () => setConnecting(true),
    onConnect: (c: Connection) => c.source && c.target && onConnect(c.source, c.target),
    onConnectEnd: () => {
      setConnecting(false);
      const { connectionStatus, connectionStartHandle: start, connectionEndHandle: end } = store.getState();
      if (reconnecting.current || connectionStatus !== 'invalid' || !start || !end) return;
      const [from, to] = start.type === 'source' ? [start.nodeId, end.nodeId] : [end.nodeId, start.nodeId];
      const { error } = newConnection(diagram, from, to);
      if (error) onNotice(error);
    },
    onReconnectStart: () => {
      reconnecting.current = true;
    },
    onReconnectEnd: () => {
      reconnecting.current = false;
    },
  };
}
