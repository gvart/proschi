// Keeps the toasts (DialogHost.tsx) above the bars pinned to the bottom of a
// page: the workspace's tests bar, the interview's composer, the canvas's
// selection toolbar. Each bar registers itself with useToastClearance; the
// tallest one that sits under the toasts sets --ps-toast-bottom, which
// dialogs.css adds to the toasts' bottom offset.

import { useCallback, useEffect } from 'react';

/** Mirrors dialogs.css: the toasts' column, full width at and below 640px. */
const TOAST_GAP = 16;
const TOAST_WIDTH = 384;
const PHONE = 640;

interface Box {
  top: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

/**
 * How far above the viewport's bottom the toasts must start so they don't
 * cover this box: 0 when it is hidden, beside the toasts' column, or not a
 * bottom bar (its top is in the upper half, like a full-height pane).
 */
export function clearanceOf(box: Box, viewport: { width: number; height: number }, inset = 0): number {
  if (box.width === 0 || box.height === 0) return 0;
  const phone = viewport.width <= PHONE;
  const gap = phone ? 12 : TOAST_GAP;
  const right = phone ? viewport.width : viewport.width - inset;
  const column = phone ? { left: 0, right } : { left: right - TOAST_GAP - Math.min(TOAST_WIDTH, right - 2 * TOAST_GAP), right };
  if (box.right <= column.left || box.left >= column.right) return 0;
  if (box.top < viewport.height / 2 || box.top >= viewport.height) return 0;
  return Math.ceil(viewport.height - box.top - gap + 8);
}

const clearances = new Map<object, number>();
/** How far from the right edge the toasts sit (useToastInset): a column pinned to the right, like the interview room's chat. */
let inset = 0;

function apply() {
  const max = Math.max(0, ...clearances.values());
  const root = document.documentElement.style;
  if (max > 0) root.setProperty('--ps-toast-bottom', `${max}px`);
  else root.removeProperty('--ps-toast-bottom');
}

/**
 * A ref for a bar along the bottom of the page: while it is mounted and
 * visible, toasts sit above it. Measured on resize (its own, the window's
 * and the visual viewport's, which the phone keyboard changes).
 */
export function useToastClearance(): (el: HTMLElement | null) => (() => void) | undefined {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return undefined;
    const key = {};
    const measure = () => {
      clearances.set(key, clearanceOf(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, inset));
      apply();
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      clearances.delete(key);
      apply();
    };
  }, []);
}

/**
 * Keeps the toasts `px` from the right edge while mounted (0: back at the
 * edge), so they never cover a column pinned there, such as the interview
 * room's chat. Phones keep their full-width toasts at the bottom.
 */
export function useToastInset(px: number): void {
  useEffect(() => {
    inset = px;
    const root = document.documentElement.style;
    if (px > 0) root.setProperty('--ps-toast-right', `${px}px`);
    else root.removeProperty('--ps-toast-right');
    return () => {
      inset = 0;
      root.removeProperty('--ps-toast-right');
    };
  }, [px]);
}
