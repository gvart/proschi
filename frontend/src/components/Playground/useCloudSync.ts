import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, apiEnabled, loginUrl, type ProviderId } from '../../services/api';
import { loadJson, saveJson } from '../../services/storage';
import type { DocStore } from '../../playground/docStore';
import type { DocSync, SyncStatus } from '../../playground/cloudSync';

/** The sync state and settings, in localStorage (sync.ts StoredSync). */
export const SYNC_KEY = 'proschi.docs.sync';

export type CloudState =
  /** A build without accounts: the editor saves in this browser only. */
  | { kind: 'unavailable' }
  | { kind: 'signed-out'; providers: ProviderId[] }
  | Exclude<SyncStatus, { kind: 'signed-out' }>;

export interface CloudSync {
  state: CloudState;
  enabled: boolean;
  signIn: (provider: ProviderId) => void;
  setEnabled: (on: boolean) => void;
  deleteCloudCopies: () => Promise<void>;
}

/**
 * Cloud sync for the editor, in the build with accounts only: asks the API
 * who is signed in, lazily, and then keeps the diagrams in `store` synced
 * with the account (src/playground/cloudSync.ts). Signed out, or in a build
 * without accounts, nothing is sent anywhere.
 */
export function useCloudSync(store: DocStore, onConflict: (titles: string[]) => void): CloudSync {
  const [state, setState] = useState<CloudState>(apiEnabled ? { kind: 'loading' } : { kind: 'unavailable' });
  const [enabled, setEnabledState] = useState(true);
  const syncRef = useRef<DocSync | null>(null);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    let sync: DocSync | null = null;
    const signedOut = async () => {
      const { providers } = await api<{ providers: ProviderId[] }>('/auth/providers').catch(() => ({ providers: [] as ProviderId[] }));
      if (!cancelled) setState({ kind: 'signed-out', providers });
    };

    const boot = async () => {
      let userId: string;
      try {
        userId = (await api<{ user: { id: string } }>('/api/me')).user.id;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) await signedOut();
        else {
          setState({ kind: 'offline' });
          window.addEventListener('online', () => !cancelled && void boot(), { once: true });
        }
        return;
      }
      const { DocSync, fetchTransport } = await import('../../playground/cloudSync');
      if (cancelled) return;
      sync = new DocSync({
        store,
        transport: fetchTransport,
        userId,
        storage: { load: () => loadJson<unknown>(SYNC_KEY, null), save: (value) => saveJson(SYNC_KEY, value) },
        onConflict: (titles) => onConflictRef.current(titles),
        onSignedOut: () => void signedOut(),
      });
      syncRef.current = sync;
      setEnabledState(sync.enabled);
      sync.onStatus((status) => {
        if (status.kind !== 'signed-out') setState(status);
      });
      const first = sync.getStatus();
      if (first.kind !== 'signed-out') setState(first);
      sync.start();
    };
    void boot();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void syncRef.current?.flush(true);
      else void syncRef.current?.sync();
    };
    const onHide = () => void syncRef.current?.flush(true);
    const onOnline = () => void syncRef.current?.sync();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      sync?.stop();
      syncRef.current = null;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('online', onOnline);
    };
  }, [store]);

  const signIn = useCallback((provider: ProviderId) => {
    const { pathname, search, hash } = window.location;
    window.location.assign(loginUrl(provider, `${pathname}${search}${hash}`));
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    syncRef.current?.setEnabled(on);
    setEnabledState(on);
  }, []);

  const deleteCloudCopies = useCallback(async () => {
    const sync = syncRef.current;
    if (!sync) return;
    setEnabledState(false);
    try {
      await sync.deleteCloudCopies();
    } catch (e) {
      setState({ kind: 'error', message: `Could not delete your cloud copies: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, []);

  return { state, enabled, signIn, setEnabled, deleteCloudCopies };
}

/** The sync status in words, for the Diagrams menu. */
export function cloudLabel(state: CloudState): string {
  switch (state.kind) {
    case 'unavailable':
      return 'Saved in this browser only — export a backup.';
    case 'loading':
      return 'Saved in this browser';
    case 'signed-out':
      return 'Sign in to keep your diagrams on every device';
    case 'off':
      return 'Cloud sync is off — saved in this browser only';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved to your account';
    case 'offline':
      return 'Offline — saved in this browser';
    case 'error':
      return `Saved in this browser; not in your account yet: ${state.message}`;
  }
}
