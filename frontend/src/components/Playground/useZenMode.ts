import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Zen mode: hides the header, menus and tabs so only the editor and the diagram
 * remain. Ctrl/Cmd+. toggles it, Escape leaves it. It lasts for this tab's
 * session (sessionStorage), never longer: a new visit starts with the full UI.
 */

const ZEN_KEY = 'proschi.zen';

function readZen(): boolean {
  try {
    return window.sessionStorage.getItem(ZEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeZen(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(ZEN_KEY, '1');
    else window.sessionStorage.removeItem(ZEN_KEY);
  } catch {
    // Storage blocked: zen lasts until the page is left.
  }
}

/** Ctrl+. (Cmd+. on a Mac), without Shift or Alt. */
export function isZenShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === '.' || e.code === 'Period');
}

export interface ZenMode {
  zen: boolean;
  toggle: () => void;
  exit: () => void;
  /** What the live region announces after the last change, if anything. */
  announcement: string;
}

export function useZenMode(): ZenMode {
  const [zen, setZen] = useState(readZen);
  const [announcement, setAnnouncement] = useState('');
  // The latest state for the keyboard handler, which is registered once.
  const zenRef = useRef(zen);

  const set = useCallback((on: boolean) => {
    zenRef.current = on;
    setZen(on);
    writeZen(on);
    setAnnouncement(on ? 'Zen mode on. Press Escape or Ctrl+. to show the menus again.' : 'Zen mode off.');
  }, []);
  const toggle = useCallback(() => set(!zenRef.current), [set]);
  const exit = useCallback(() => set(false), [set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isZenShortcut(e)) {
        e.preventDefault();
        set(!zenRef.current);
        return;
      }
      // Escape first closes whatever has it (autocomplete, a dialog); only a free Escape leaves zen.
      if (e.key === 'Escape' && zenRef.current && !e.defaultPrevented) set(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  // The announcement is spoken once; clear it so the same message can be spoken again later.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(''), 3000);
    return () => clearTimeout(timer);
  }, [announcement]);

  return { zen, toggle, exit, announcement };
}
