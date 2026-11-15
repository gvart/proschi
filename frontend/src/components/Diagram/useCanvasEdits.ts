import { useRef } from 'react';
import { parse } from '../../dsl';
import type { Diagram } from '../../dsl/types';
import { clearPosition, clearPositions, copyNodes, duplicateNodes, pasteNodes, retargetConnection, setNodePosition, type PasteOptions } from '../../dsl/edit';
import { MOD_KEY } from '../Playground/modKey';

/**
 * The text edits behind canvas gestures that both editable canvases share
 * (the editor's DiagramView and practice's EditableCanvas): dragging to pin,
 * Auto-layout, copy, paste and duplicate, reconnecting an edge's end, and
 * unpinning. Every one is a dsl/edit.ts edit of `source`; nodes and edges from
 * an imported file stay as they are, with a notice saying why.
 */
interface CanvasEditsOptions {
  /** This document's text. */
  source: string;
  /** The diagram drawn (with its imports), for the edges a reconnect names. */
  diagram: Diagram;
  /** Applies one edit to the text. */
  apply: (edit: (source: string) => string) => void;
  /** Nodes declared in imported files (id → file). */
  imported: ReadonlyMap<string, string>;
  onNotice: (message: string) => void;
  /** The canvas shows a design in another file (the editor navigated into a system), where nothing is added. */
  lockedIn?: string;
}

export function useCanvasEdits({ source, diagram, apply, imported, onNotice, lockedIn }: CanvasEditsOptions) {
  /** What Ctrl/Cmd+C on the canvas copied (see copyNodes), and how often it was pasted since, so each paste lands a step further. */
  const clipboard = useRef<{ text: string; pastes: number } | null>(null);

  /** Writes dragged nodes' `pos x,y`; imported ones are left to their file. */
  const move = (moved: { id: string; position: { x: number; y: number } }[]) => {
    const own = moved.filter((n) => !imported.has(n.id));
    if (own.length > 0) apply((src) => own.reduce((acc, n) => setNodePosition(acc, n.id, n.position), src));
  };
  /** Removes every `pos x,y`: the layout is automatic again. */
  const resetLayout = () => apply(clearPositions);

  const copy = (ids: string[]) => {
    const text = copyNodes(source, ids.filter((id) => !imported.has(id)));
    if (!text) return onNotice('Groups, systems and imported components are copied in the code.');
    clipboard.current = { text, pastes: 0 };
    // Also as text, to paste into the code or another app; the canvas pastes its own copy.
    navigator.clipboard?.writeText(text).catch(() => undefined);
    const count = parse(text).diagram.nodes.length;
    onNotice(`Copied ${count === 1 ? 'a component' : `${count} components`}; ${MOD_KEY}+V pastes.`);
  };
  /** Applies a paste in one edit and returns the new nodes' ids, so the canvas selects them. */
  const addOnCanvas = (paste: (src: string, options: PasteOptions) => { source: string; ids: string[] }, step: number) => {
    if (lockedIn) {
      onNotice(`This is the design in ${lockedIn}; add components there.`);
      return undefined;
    }
    const options = { taken: [...imported.keys()], offset: { x: 40 * step, y: 40 * step } };
    const { ids } = paste(source, options);
    if (ids.length > 0) apply((src) => paste(src, options).source);
    return ids;
  };
  const paste = () => {
    const clip = clipboard.current;
    if (!clip) return undefined;
    clip.pastes++;
    return addOnCanvas((src, options) => pasteNodes(src, clip.text, options), clip.pastes);
  };
  const duplicate = (ids: string[]) => {
    const own = ids.filter((id) => !imported.has(id));
    const added = addOnCanvas((src, options) => duplicateNodes(src, own, options), 1);
    if (added?.length === 0) onNotice('Groups, systems and imported components are duplicated in the code.');
    return added;
  };
  /** Moves an end of a connection to another node (an edge's end dragged onto it). */
  const reconnect = (edgeId: string, from: string, to: string) => {
    const edge = diagram.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    if (lockedIn || edge.loc.file || imported.has(from) || imported.has(to)) {
      return onNotice(`Declared in ${lockedIn ?? edge.loc.file ?? imported.get(from) ?? imported.get(to)}; connect it there.`);
    }
    // Edge ids count duplicates across every file; the text edit needs this document's own id.
    const rootId = parse(source).diagram.edges.find((r) => r.loc.line === edge.loc.line)?.id;
    if (!rootId) return;
    const result = retargetConnection(source, rootId, from, to);
    if (result.error !== undefined) return onNotice(result.error);
    apply((src) => retargetConnection(src, rootId, from, to).source ?? src);
  };
  const unpin = (id: string) => {
    if (imported.has(id)) return onNotice(`'${id}' is declared in ${imported.get(id)}; unpin it there.`);
    apply((src) => clearPosition(src, id));
  };
  return { move, resetLayout, copy, paste, duplicate, reconnect, unpin };
}
