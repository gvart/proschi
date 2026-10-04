import { useEffect, useState } from 'react';

/** Geometry for the tour popover; plain functions so they can be unit tested. */

export type Side = 'right' | 'left' | 'bottom' | 'top';

const MARGIN = 12;
const GAP = 12;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The part of `el` on screen, also clipped to `clip` (e.g. the pane a long editor line scrolls in). */
export function visibleRect(el: Element | null | undefined, clip?: Element | null): Box | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const c = clip?.getBoundingClientRect() ?? { top: 0, left: 0, bottom: Infinity, right: Infinity };
  // Clip to the viewport: a whole pane should be outlined where it is visible.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = Math.max(r.top, c.top, 0);
  const left = Math.max(r.left, c.left, 0);
  const bottom = Math.min(r.bottom, c.bottom, vh);
  const right = Math.min(r.right, c.right, vw);
  if (bottom <= top || right <= left) return null;
  return { top, left, width: right - left, height: bottom - top };
}

export const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Where the popover goes: next to the target on the first side it fits, else docked. Exported for tests. */
export function placePopover(
  target: Box | null,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { phone: boolean; sides?: Side[]; dock?: 'top' | 'bottom'; align?: 'center' | 'end' },
): { top: number; left: number } {
  const { width: w, height: h } = size;
  const { width: vw, height: vh } = viewport;
  if (options.phone || !target) {
    const dock = options.dock ?? (target && target.top + target.height / 2 > vh / 2 ? 'top' : 'bottom');
    const left = options.phone ? MARGIN : clamp((vw - w) / 2, MARGIN, vw - w - MARGIN);
    return { left, top: dock === 'top' ? MARGIN : Math.max(MARGIN, vh - h - MARGIN) };
  }
  const t = target;
  const midX = clamp(options.align === 'end' ? t.left + t.width - w : t.left + t.width / 2 - w / 2, MARGIN, vw - w - MARGIN);
  const midY = clamp(t.top + t.height / 2 - h / 2, MARGIN, vh - h - MARGIN);
  for (const side of options.sides ?? ['bottom', 'right', 'left', 'top']) {
    if (side === 'right' && t.left + t.width + GAP + w <= vw - MARGIN) return { top: midY, left: t.left + t.width + GAP };
    if (side === 'left' && t.left - GAP - w >= MARGIN) return { top: midY, left: t.left - GAP - w };
    if (side === 'bottom' && t.top + t.height + GAP + h <= vh - MARGIN) return { top: t.top + t.height + GAP, left: midX };
    if (side === 'top' && t.top - GAP - h >= MARGIN) return { top: t.top - GAP - h, left: midX };
  }
  // The target fills the screen: sit inside it, at the bottom.
  return { top: clamp(t.top + t.height - h - MARGIN, MARGIN, vh - h - MARGIN), left: midX };
}

/** Phones get the one-pane layout (Tailwind's md breakpoint) and docked tour cards. */
export function useIsPhone(): boolean {
  const query = '(max-width: 767px)';
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setPhone(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, []);
  return phone;
}

