import { useSyncExternalStore } from 'react';
import type { EditorView } from '../../partner/contract';
import { loadJson, saveJson } from '../../services/storage';

/**
 * The editor's two exclusive modes (docs/impl/visual-editor.md, S10): Visual
 * builds on the canvas, with the code only to look at; Code is the text with
 * the diagram beside it, view-only. One choice for the editor, practice and the
 * interview room, remembered in this browser; a first visit lands in Visual.
 */
export type EditorMode = EditorView;

export const MODE_KEY = 'proschi.editor.mode';

const read = (): EditorMode => (loadJson<unknown>(MODE_KEY, null) === 'code' ? 'code' : 'visual');

let mode: EditorMode | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const get = () => (mode ??= read());

export function setEditorMode(next: EditorMode): void {
  if (next === get()) return;
  mode = next;
  saveJson(MODE_KEY, next);
  for (const listener of listeners) listener();
}

/** The mode, shared by every component that shows it (the header's switch and the layout under it). */
export function useEditorMode(): [EditorMode, (next: EditorMode) => void] {
  return [useSyncExternalStore(subscribe, get), setEditorMode];
}

/** Ctrl/Cmd+\ switches the mode, from anywhere on the page (inside the code editor too, where it is unbound). */
export function isModeShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash');
}
