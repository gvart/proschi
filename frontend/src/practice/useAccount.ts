import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, apiEnabled, loginUrl, type Me, type ProviderId, type RunRecord, type User } from '../services/api';
import { loginMessage, takeLoginError } from './account';

export type AccountState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'signed-out'; providers: ProviderId[]; message?: string }
  /** `providers`: those on offer, to link; `user.providers` are the linked ones. */
  | { status: 'signed-in'; user: User; providers: ProviderId[]; message?: string };

export interface Account {
  state: AccountState;
  signIn: (provider: ProviderId) => void;
  /** Adds a provider's sign-in to the account (through the provider's page). */
  link: (provider: ProviderId) => void;
  unlink: (provider: ProviderId) => Promise<void>;
  signOut: () => Promise<void>;
  /** Ends every session of the account, this one included. */
  signOutEverywhere: () => Promise<void>;
  update: (patch: Partial<Pick<User, 'displayName' | 'publicProfile' | 'dailyGoal'>>) => Promise<void>;
  remove: () => Promise<void>;
  /** Saves everything the server stores about the account as proschi-data.json. */
  downloadData: () => Promise<void>;
  /** Records a test run on the server, signed in, with the local `day` it was made; undefined otherwise or when it fails. */
  recordRun: (problemId: string, source: string, solved: boolean, day: string) => Promise<RunRecord | undefined>;
}

type Boot = { me?: Me; providers: ProviderId[]; message?: string };

let boot: Promise<Boot> | undefined;

async function providers(): Promise<ProviderId[]> {
  return (await api<{ providers: ProviderId[] }>('/auth/providers').catch(() => ({ providers: [] }))).providers;
}

/**
 * Once per page load: the account of the session cookie, the sign-in
 * providers, and what became of a sign-in or linking the API redirected back
 * from. Shared, so StrictMode's second effect does not load it twice.
 */
function bootAccount(): Promise<Boot> {
  boot ??= (async () => {
    const { cleanUrl, ...outcome } = takeLoginError(window.location.href);
    if (outcome.error || outcome.linked) window.history.replaceState(window.history.state, '', cleanUrl);
    let message = loginMessage(outcome);
    const offered = providers();
    try {
      return { me: await api<Me>('/api/me'), providers: await offered, message };
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) message = 'Could not reach the server; your progress is kept in this browser.';
    }
    return { providers: await offered, message };
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
    void bootAccount().then(({ me, providers, message }) => {
      if (cancelled) return;
      if (me) {
        setState({ status: 'signed-in', user: me.user, providers, message });
        onSignedInRef.current(me);
      } else setState({ status: 'signed-out', providers, message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedOut = useCallback(async (message?: string) => {
    boot = undefined;
    setState({ status: 'signed-out', providers: await providers(), message });
  }, []);

  const goToProvider = useCallback((provider: ProviderId, link: boolean) => {
    const { pathname, search, hash } = window.location;
    window.location.assign(loginUrl(provider, `${pathname}${search}${hash}`, link));
  }, []);
  const signIn = useCallback((provider: ProviderId) => goToProvider(provider, false), [goToProvider]);
  const link = useCallback((provider: ProviderId) => goToProvider(provider, true), [goToProvider]);

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

  const unlink = useCallback(
    async (provider: ProviderId) => {
      const done = await whenSignedIn(() => api<void>(`/api/me/identities/${provider}`, { method: 'DELETE' }).then(() => true));
      if (done) {
        setState((s) =>
          s.status === 'signed-in' ? { ...s, user: { ...s.user, providers: s.user.providers?.filter((p) => p !== provider) }, message: undefined } : s,
        );
      }
    },
    [whenSignedIn],
  );

  const signOutEverywhere = useCallback(async () => {
    const done = await whenSignedIn(() => api<void>('/api/me/sessions/revoke-all', { method: 'POST' }).then(() => true));
    if (done) await signedOut('Signed out on every device.');
  }, [whenSignedIn, signedOut]);

  const update = useCallback(
    async (patch: Partial<Pick<User, 'displayName' | 'publicProfile' | 'dailyGoal'>>) => {
      const result = await whenSignedIn(() => api<{ user: User }>('/api/me', { method: 'PATCH', body: patch }));
      if (result) setState((s) => (s.status === 'signed-in' ? { ...s, user: { ...s.user, ...result.user }, message: undefined } : s));
    },
    [whenSignedIn],
  );

  const remove = useCallback(async () => {
    const done = await whenSignedIn(() => api<void>('/api/me', { method: 'DELETE' }).then(() => true));
    if (done) await signedOut('Your account and its progress on the server are deleted.');
  }, [whenSignedIn, signedOut]);

  const downloadData = useCallback(async () => {
    const data = await whenSignedIn(() => api<unknown>('/api/me/export'));
    if (data === undefined) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'proschi-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [whenSignedIn]);

  const recordRun = useCallback(
    (problemId: string, source: string, solved: boolean, day: string) =>
      whenSignedIn(() => api<RunRecord>(`/api/problems/${encodeURIComponent(problemId)}/runs`, { method: 'POST', body: { source, solved, day } })),
    [whenSignedIn],
  );

  return { state, signIn, link, unlink, signOut, signOutEverywhere, update, remove, downloadData, recordRun };
}
