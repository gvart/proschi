import { createContext, useContext } from 'react';

/**
 * What an editable canvas lets a component node do in place: name it, and add
 * a component after it. Absent on read-only canvases and while a use case plays.
 */
export interface NodeActions {
  /** The node whose name is being typed on the canvas, if any. */
  editing: string | null;
  /** Ends naming: the name typed, or null to keep the one it has (Escape). */
  onName: (id: string, name: string | null) => void;
  /** The "+" on a hovered or selected node: opens the type picker beside `anchor` (screen pixels). */
  onAddAfter?: (id: string, anchor: { x: number; y: number }) => void;
}

export const NodeActionsContext = createContext<NodeActions | null>(null);

export const useNodeActions = () => useContext(NodeActionsContext);
