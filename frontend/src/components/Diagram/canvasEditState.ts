import { useState } from 'react';
import { loadJson, saveJson } from '../../services/storage';

/** The state of visual editing that outlives a canvas (CanvasEditing.tsx): remembered per browser. */

/** Whether the palette is shown, remembered per browser under `key`; `wide` screens show it until it is hidden once. */
export function usePaletteOpen(key: string, wideFrom: number): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => loadJson<boolean | null>(key, null) ?? window.innerWidth >= wideFrom);
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
