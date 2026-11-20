import { useState } from 'react';
import { parse } from '../../dsl';
import { setReplicas } from '../../dsl/edit';
import { kindOf } from '../../dsl/kinds';
import type { DiagramNode } from '../../dsl/types';
import { loadJson, saveJson } from '../../services/storage';

/** The state of visual editing that outlives a canvas (CanvasEditing.tsx): remembered per browser. */

/**
 * Whether the palette is docked beside the canvas, remembered per browser under `key`. It starts
 * hidden, so the diagram keeps its width until the reader asks for it (the toolbar's Add component).
 */
export function usePaletteOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => loadJson<boolean>(key, false));
  const set = (next: boolean) => {
    setOpen(next);
    saveJson(key, next);
  };
  return [open, set];
}

const MAP_KEY = 'proschi.flows.map';

/** Whether the Flows view's architecture map is open, remembered per browser; at first open on a wide screen (1280 and wider). */
export function useMapOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => loadJson<boolean | null>(MAP_KEY, null) ?? (typeof window === 'undefined' || window.innerWidth >= 1280));
  const set = (next: boolean) => {
    setOpen(next);
    saveJson(MAP_KEY, next);
  };
  return [open, set];
}

const CONNECT_HINT_KEY = 'proschi.canvas.connectHint';

/** Whether the connect hint was already dismissed (or a connection made) in this browser. */
export function useConnectHint(): [boolean, () => void] {
  const [seen, setSeen] = useState(() => loadJson<boolean>(CONNECT_HINT_KEY, false));
  return [
    seen,
    () => {
      setSeen(true);
      saveJson(CONNECT_HINT_KEY, true);
    },
  ];
}

/** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) on the canvas, outside fields: `undo`, `redo` or nothing. */
export function historyKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null }): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

const MINIMAP_KEY = 'proschi.canvas.minimap';

/** Whether the editor canvas shows its minimap, remembered per browser; off at first. */
export function useMiniMap(): [boolean, (shown: boolean) => void] {
  const [shown, setShown] = useState(() => loadJson<boolean>(MINIMAP_KEY, false));
  const set = (next: boolean) => {
    setShown(next);
    saveJson(MINIMAP_KEY, next);
  };
  return [shown, set];
}

type KeyEvent = Parameters<typeof historyKey>[0];

/** Typing in a field (the code editor is contenteditable): no canvas or page shortcut applies. */
export function typingIn(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.('input, textarea, select, [contenteditable]');
}

export type CanvasKey = 'copy' | 'paste' | 'duplicate' | 'find' | 'rename' | 'quick' | 'next' | 'previous' | 'connect' | 'type' | 'more' | 'fewer' | 'layout';

/** Keys without Ctrl/Cmd: one key each, so Cmd+R, Cmd+T and Cmd+± stay the browser's. */
const PLAIN_KEYS: Record<string, CanvasKey> = { '/': 'find', a: 'quick', c: 'connect', t: 'type', r: 'layout', '+': 'more', '=': 'more', '-': 'fewer' };

/**
 * The canvas's own keys, outside fields: Ctrl/Cmd+C, V and D; `/` or Ctrl/Cmd+F to find a node; F2 to rename the
 * selected one; A or Ctrl/Cmd+K for the command bar; Tab and Shift+Tab to the next and previous node; C to add one
 * connected from the selection; T to change its type; + and - for its replicas; R to lay the diagram out again.
 */
export function canvasKey(e: KeyEvent): CanvasKey | null {
  if (e.altKey || typingIn(e.target)) return null;
  if (!(e.ctrlKey || e.metaKey)) {
    if (e.key === 'Tab') return e.shiftKey ? 'previous' : 'next';
    if (e.key === 'F2') return e.shiftKey ? null : 'rename';
    return PLAIN_KEYS[e.key.length === 1 ? e.key.toLowerCase() : ''] ?? null;
  }
  if (e.shiftKey) return null;
  const actions: Record<string, CanvasKey> = { c: 'copy', v: 'paste', d: 'duplicate', f: 'find', k: 'quick' };
  return actions[e.key.toLowerCase()] ?? null;
}

/**
 * The node Tab (or Shift+Tab, `back`) selects after `current`: in reading order, top to bottom, then left to
 * right, around the end; the first (or last) when none is selected.
 */
export function stepNode(nodes: readonly { id: string; x: number; y: number }[], current: string | undefined, back: boolean): string | undefined {
  // Nodes whose tops are within a row's height of each other read as one row.
  const order = [...nodes].sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x).map((n) => n.id);
  if (order.length === 0) return undefined;
  const at = current === undefined ? -1 : order.indexOf(current);
  if (at < 0) return back ? order[order.length - 1] : order[0];
  return order[(at + (back ? -1 : 1) + order.length) % order.length];
}

/** Whether a node has replicas and a capacity to set: a component, not a client, a note or a box. */
export function scalable(node: DiagramNode): boolean {
  const kind = kindOf(node);
  return kind !== 'client' && kind !== 'other';
}

/** `?` outside fields: the keyboard shortcuts. */
export function isShortcutsKey(e: KeyEvent): boolean {
  return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target);
}

/**
 * `source` with node `id`'s replicas one more (or, `delta` -1, one fewer, never under one): + and - on the canvas.
 * Read from the text itself, so keys pressed faster than the diagram is parsed again each count.
 */
export function stepReplicas(source: string, id: string, delta: 1 | -1): string {
  const node = parse(source).diagram.nodes.find((n) => n.id === id && n.loc.file === undefined);
  return node ? setReplicas(source, id, (node.replicas ?? 1) + delta) : source;
}
