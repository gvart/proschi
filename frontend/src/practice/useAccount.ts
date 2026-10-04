import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, apiEnabled, loginUrl, type Me, type ProviderId, type RunRecord, type User } from '../services/api';
import { loadSession, newLoginNonce, saveSession, takeLoginNonce, takeLoginParams, type Session } from './account';

export type AccountState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'signed-out'; providers: ProviderId[]; message?: string }
  | { status: 'signed-in'; user: User; token: string; message?: string };

export interface Account {
  state: AccountState;
  signIn: (provider: ProviderId) => void;
  signOut: () => Promise<void>;
  update: (patch: Partial<Pick<User, 'displayName' | 'publicProfile'>>) => Promise<void>;
  remove: () => Promise<void>;
  /** Records a test run on the server, signed in; undefined otherwise or when it fails. */
  recordRun: (problemId: string, source: string, solved: boolean) => Promise<RunRecord | undefined>;
}

type Boot = { me: Me; token: string } | { providers: ProviderId[]; message?: string };

let boot: Promise<Boot> | undefined;

async function providers(): Promise<ProviderId[]> {
  return (await api<{ providers: ProviderId[] }>('/auth/providers').catch(() => ({ providers: [] }))).providers;
}

/**
 * Once per page load: finish a sign-in the API redirected back from
 * (?login=<code>), then load the account of the stored session. Shared, so
 * StrictMode's second effect does not exchange the one-time code twice.
 */
function bootAccount(): Promise<Boot> {
  boot ??= (async () => {
    const { code, error, cleanUrl } = takeLoginParams(window.location.href);
    if (code || error) window.history.replaceState(window.history.state, '', cleanUrl);
    let message = error === 'cancelled' ? 'Sign-in cancelled.' : error ? 'Sign-in failed; try again.' : undefined;
    let session = loadSession();
    const nonce = takeLoginNonce();
    if (code) {
      try {
        session = await api<Session>('/auth/session', { method: 'POST', body: { code, nonce } });
        saveSession(session);
      } catch {
        message = 'Sign-in failed; try again.';
      }
    }
    if (session) {
      try {
        return { me: await api<Me>('/api/me', { token: session.token }), token: session.token };
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) saveSession(undefined);
        else message = 'Could not reach the server; your progress is kept in this browser.';
      }
    }
    return { providers: await providers(), message };
  })();
  return boot;
}

/**
 * The practice account. `onSignedIn` gets the server's progress once the
 * account is loaded, to merge with the browser's.
 */
export function useAccount(onSignedIn: (me: Me, token: string) => void): Account {
  const [state, setState] = useState<AccountState>(apiEnabled ? { status: 'loading' } : { status: 'off' });
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;
  const token = state.status === 'signed-in' ? state.token : undefined;

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    void bootAccount().then((result) => {
      if (cancelled) return;
      if ('me' in result) {
        setState({ status: 'signed-in', user: result.me.user, token: result.token });
        onSignedInRef.current(result.me, result.token);
      } else setState({ status: 'signed-out', providers: result.providers, message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedOut = useCallback(async (message?: string) => {
    saveSession(undefined);
    boot = undefined;
    setState({ status: 'signed-out', providers: await providers(), message });
  }, []);

  const signIn = useCallback((provider: ProviderId) => {
    const nonce = newLoginNonce();
    if (nonce) window.location.assign(loginUrl(provider, window.location.href, nonce));
    else setState((s) => (s.status === 'signed-out' ? { ...s, message: 'Sign-in needs site storage, which this browser blocks.' } : s));
  }, []);

  const signOut = useCallback(async () => {
    if (token) await api('/auth/logout', { method: 'POST', token }).catch(() => undefined);
    await signedOut();
  }, [token, signedOut]);

  /** Runs an API call with the session; a rejected session signs out. */
  const withToken = useCallback(
    async <T>(call: (token: string) => Promise<T>): Promise<T | undefined> => {
      if (!token) return undefined;
      try {
        return await call(token);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await signedOut('Your session expired; sign in again.');
        else setState((s) => (s.status === 'signed-in' ? { ...s, message: e instanceof Error ? e.message : String(e) } : s));
        return undefined;
      }
    },
    [token, signedOut],
  );

  const update = useCallback(
    async (patch: Partial<Pick<User, 'displayName' | 'publicProfile'>>) => {
      const result = await withToken((t) => api<{ user: User }>('/api/me', { method: 'PATCH', token: t, body: patch }));
      if (result) setState((s) => (s.status === 'signed-in' ? { ...s, user: { ...s.user, ...result.user }, message: undefined } : s));
    },
    [withToken],
  );

  const remove = useCallback(async () => {
    const done = await withToken((t) => api<void>('/api/me', { method: 'DELETE', token: t }).then(() => true));
    if (done) await signedOut('Your account and its progress on the server are deleted.');
  }, [withToken, signedOut]);

  const recordRun = useCallback(
    (problemId: string, source: string, solved: boolean) =>
      withToken((t) => api<RunRecord>(`/api/problems/${encodeURIComponent(problemId)}/runs`, { method: 'POST', token: t, body: { source, solved } })),
    [withToken],
  );

  return { state, signIn, signOut, update, remove, recordRun };
}
