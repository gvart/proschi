import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';

/** Loading and changing data in the admin panel's tabs. */

export interface Loaded<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload: () => void;
}

/** Loads `load()` on mount and whenever `deps` change; `reload` loads again. A 401 sends the page back to sign-in. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[], onSignedOut?: () => void): Loaded<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loadRef.current().then(
      (data) => live && setState({ data, loading: false }),
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) signedOutRef.current?.();
        setState((s) => ({ ...s, error: errorMessage(e), loading: false }));
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export function errorMessage(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
  return e instanceof Error ? e.message : String(e);
}

/** Runs a change, then `after()`; shows the error if it fails. */
export function useAction(after?: () => void): { run: (action: () => Promise<unknown>) => Promise<boolean>; busy: boolean; error?: string; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(undefined);
      try {
        await action();
        after?.();
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [after],
  );
  return { run, busy, error, clear: () => setError(undefined) };
}
