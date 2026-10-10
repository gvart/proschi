import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The practice page's hash route (the hash without `#/`), with the scroll
 * position handled the way pages do: a new address (a link, a tab, a hash
 * set by code) opens at the top, and going back or forward returns to where
 * that address was left. Each history entry is stamped with a key in
 * `history.state` the first time it shows; an entry that comes back with a
 * known key is a back/forward visit.
 */

const STATE_KEY = 'proschiScroll';

/** Restoring waits this long at most for lazily loaded content to grow tall enough. */
const RESTORE_MS = 1000;

const readRoute = () => window.location.hash.replace(/^#\/?/, '');

let counter = 0;
const newKey = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** The current entry's key, stamping one (keeping the rest of the state) when it has none. */
function entryKey(): { key: string; known: boolean } {
  const state: unknown = window.history.state;
  const key = state && typeof state === 'object' ? (state as Record<string, unknown>)[STATE_KEY] : undefined;
  if (typeof key === 'string') return { key, known: true };
  const fresh = newKey();
  window.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), [STATE_KEY]: fresh }, '');
  return { key: fresh, known: false };
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(readRoute);
  // Where to scroll once the new route has rendered.
  const target = useRef<number | undefined>(undefined);
  useEffect(() => {
    const positions = new Map<string, number>();
    let current = entryKey().key;
    const onScroll = () => positions.set(current, window.scrollY);
    const onChange = () => {
      const { key, known } = entryKey();
      current = key;
      target.current = known ? (positions.get(key) ?? 0) : 0;
      setRoute(readRoute());
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  useLayoutEffect(() => {
    const y = target.current;
    if (y === undefined) return;
    target.current = undefined;
    window.scrollTo(0, y);
    if (y === 0) return;
    // A lazily loaded page may not be tall enough yet: try again until it is, or for a moment.
    const until = Date.now() + RESTORE_MS;
    let frame = 0;
    const retry = () => {
      if (Math.abs(window.scrollY - y) <= 1 || Date.now() > until) return;
      window.scrollTo(0, y);
      frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    // Stop when the reader scrolls first.
    const stop = () => cancelAnimationFrame(frame);
    window.addEventListener('wheel', stop, { once: true, passive: true });
    window.addEventListener('touchstart', stop, { once: true, passive: true });
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
    };
  }, [route]);
  return route;
}
