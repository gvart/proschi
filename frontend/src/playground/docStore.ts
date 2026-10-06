import type { DocumentState } from './documents';

/**
 * The editor's diagrams as a tiny external store (read with
 * useSyncExternalStore). Updates apply at once, so cloud sync can read the
 * latest state, merge the server's changes into it and write it back
 * without racing the next keystroke.
 */
export interface DocStore {
  get: () => DocumentState;
  set: (next: DocumentState | ((current: DocumentState) => DocumentState)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDocStore(initial: DocumentState): DocStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? next(state) : next;
      if (value === state) return;
      state = value;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
