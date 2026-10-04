import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, apiEnabled, loginUrl, type Me, type ProviderId, type RunRecord, type User } from '../services/api';
import { takeLoginError } from './account';

export type AccountState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'signed-out'; providers: ProviderId[]; message?: string }
  | { status: 'signed-in'; user: User; message?: string };

export interface Account {
  state: AccountState;
  signIn: (provider: ProviderId) => void;
  signOut: () => Promise<void>;
  update: (patch: Partial<Pick<User, 'displayName' | 'publicProfile'>>) => Promise<void>;
  remove: () => Promise<void>;
  /** Records a test run on the server, signed in; undefined otherwise or when it fails. */
  recordRun: (problemId: string, source: string, solved: boolean) => Promise<RunRecord | undefined>;
}

type Boot = { me: Me } | { providers: ProviderId[]; message?: string };

let boot: Promise<Boot> | undefined;

async function providers(): Promise<ProviderId[]> {
  return (await api<{ providers: ProviderId[] }>('/auth/providers').catch(() => ({ providers: [] }))).providers;
}

/**
 * Once per page load: the account of the session cookie, or the sign-in
 * providers and why a sign-in the API redirected back from failed. Shared,
 * so StrictMode's second effect does not load it twice.
 */
function bootAccount(): Promise<Boot> {
  boot ??= (async () => {
    const { error, cleanUrl } = takeLoginError(window.location.href);
    if (error) window.history.replaceState(window.history.state, '', cleanUrl);
    let message = error === 'cancelled' ? 'Sign-in cancelled.' : error ? 'Sign-in failed; try again.' : undefined;
    try {
      return { me: await api<Me>('/api/me') };
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) message = 'Could not reach the server; your progress is kept in this browser.';
    }
    return { providers: await providers(), message };
  })();
  return boot;
}

/**
 * The practice account. `onSignedIn` gets the server's progress once the
 * account is loaded, to merge with the browser's.
 */
export function useAccount(onSignedIn: (me: Me) => void): Account {
  const [state, setState] = useState<AccountState>(apiEnabled ? { status: 'loading' } : { status: 'off' });
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const signedIn = state.status === 'signed-in';

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    void bootAccount().then((result) => {
      if (cancelled) return;
      if ('me' in result) {
        setState({ status: 'signed-in', user: result.me.user });
        onSignedInRef.current(result.me);
      } else setState({ status: 'signed-out', providers: result.providers, message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedOut = useCallback(async (message?: string) => {
    boot = undefined;
    setState({ status: 'signed-out', providers: await providers(), message });
  }, []);

  const signIn = useCallback((provider: ProviderId) => {
    const { pathname, search, hash } = window.location;
    window.location.assign(loginUrl(provider, `${pathname}${search}${hash}`));
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await signedOut();
  }, [signedOut]);

  /** Runs an API call signed in; a rejected session signs out. */
  const whenSignedIn = useCallback(
    async <T>(call: () => Promise<T>): Promise<T | undefined> => {
      if (!signedIn) return undefined;
      try {
        return await call();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await signedOut('Your session expired; sign in again.');
        else setState((s) => (s.status === 'signed-in' ? { ...s, message: e instanceof Error ? e.message : String(e) } : s));
        return undefined;
      }
    },
    [signedIn, signedOut],
  );

  const update = useCallback(
    async (patch: Partial<Pick<User, 'displayName' | 'publicProfile'>>) => {
      const result = await whenSignedIn(() => api<{ user: User }>('/api/me', { method: 'PATCH', body: patch }));
      if (result) setState((s) => (s.status === 'signed-in' ? { ...s, user: { ...s.user, ...result.user }, message: undefined } : s));
    },
    [whenSignedIn],
  );

  const remove = useCallback(async () => {
    const done = await whenSignedIn(() => api<void>('/api/me', { method: 'DELETE' }).then(() => true));
    if (done) await signedOut('Your account and its progress on the server are deleted.');
  }, [whenSignedIn, signedOut]);

  const recordRun = useCallback(
    (problemId: string, source: string, solved: boolean) =>
      whenSignedIn(() => api<RunRecord>(`/api/problems/${encodeURIComponent(problemId)}/runs`, { method: 'POST', body: { source, solved } })),
    [whenSignedIn],
  );

  return { state, signIn, signOut, update, remove, recordRun };
}
