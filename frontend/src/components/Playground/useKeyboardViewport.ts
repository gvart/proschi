import { useEffect, useState, type CSSProperties } from 'react';

/** Less than this between the layout and visual viewports is browser chrome, not an on-screen keyboard. */
const KEYBOARD_MIN_PX = 120;

export interface KeyboardViewport {
  /** True while an on-screen keyboard covers part of the page. */
  open: boolean;
  /** For the page root: pins it to the part of the screen the keyboard leaves visible. */
  style: CSSProperties | undefined;
}

/**
 * Keeps a full-height page (h-[100dvh]) above the on-screen keyboard. iOS Safari does not shrink dvh for the
 * keyboard, so fields near the bottom (the settings card, the end of the code) end up underneath it. While the
 * keyboard is up, the root takes the visual viewport's height and follows it as Safari pans the page.
 */
export function useKeyboardViewport(): KeyboardViewport {
  const [box, setBox] = useState<{ height: number; top: number } | undefined>(undefined);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Pinch zoom shrinks the visual viewport too; leave that to the browser.
      const keyboard = vv.scale < 1.05 && document.documentElement.clientHeight - vv.height > KEYBOARD_MIN_PX;
      setBox((prev) => {
        if (!keyboard) return undefined;
        const next = { height: Math.round(vv.height), top: Math.round(vv.offsetTop) };
        return prev?.height === next.height && prev.top === next.top ? prev : next;
      });
    };
    // The page shrank under the focused field: bring it back into view.
    const reveal = () => {
      update();
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable]')) {
        requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest' }));
      }
    };
    update();
    vv.addEventListener('resize', reveal);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', reveal);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return {
    open: box !== undefined,
    style: box && {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: box.height,
      // Fixed boxes stay on the layout viewport; Safari pans the visual one within it.
      transform: `translateY(${box.top}px)`,
    },
  };
}
