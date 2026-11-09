import { useState } from 'react';
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

export type CanvasKey = 'copy' | 'paste' | 'duplicate' | 'find';

/** The canvas's own keys, outside fields: Ctrl/Cmd+C, V and D, and `/` or Ctrl/Cmd+F to find a node. */
export function canvasKey(e: KeyEvent): CanvasKey | null {
  if (e.altKey || typingIn(e.target)) return null;
  if (!(e.ctrlKey || e.metaKey)) return e.key === '/' ? 'find' : null;
  if (e.shiftKey) return null;
  const actions: Record<string, CanvasKey> = { c: 'copy', v: 'paste', d: 'duplicate', f: 'find' };
  return actions[e.key.toLowerCase()] ?? null;
}

/** `?` outside fields: the keyboard shortcuts. */
export function isShortcutsKey(e: KeyEvent): boolean {
  return e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e.target);
}
