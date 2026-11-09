import { useEffect, useMemo, useState } from 'react';
import { localDay } from '../../learn/review';
import type { Account } from '../useAccount';
import { accountStore, localStore, memoryStore, type CardStore, type Loaded } from '../review/store';

/**
 * The card states and today's counts from the same store and scheduling as
 * the review page (review/ReviewRoute.tsx): this browser without accounts,
 * the server signed in, nothing kept signed out (the free sample deck).
 * Undefined while loading, or when the store cannot be read.
 */
export type TodayCards = { loaded: Loaded; signedOut: boolean };

/** `enabled` false loads nothing, e.g. when a parent already loaded them. */
export function useTodayCards(account: Account, enabled = true): TodayCards | undefined {
  const { state } = account;
  const userId = state.status === 'signed-in' ? state.user.id : undefined;
  const signedOut = state.status === 'signed-out';
  const store = useMemo<CardStore | undefined>(
    () => (!enabled ? undefined : state.status === 'off' ? localStore() : signedOut ? memoryStore() : userId ? accountStore(userId) : undefined),
    [enabled, state.status, signedOut, userId],
  );
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.load(localDay(new Date())).then(
      (l) => !cancelled && setLoaded(l),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [store]);
  return loaded && { loaded, signedOut };
}
