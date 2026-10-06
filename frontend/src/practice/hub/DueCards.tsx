import { useEffect, useMemo, useState } from 'react';
import deck from 'virtual:practice-cards';
import { localDay, NEW_PER_DAY, overview } from '../../learn/review';
import type { Account } from '../useAccount';
import { accountStore, localStore, memoryStore, type CardStore } from '../review/store';

/**
 * How many cards daily review has for today: those due and the new ones
 * today's allowance still lets in, from the same store and scheduling as
 * the review page (review/ReviewRoute.tsx). Signed out, the free sample
 * deck. Loaded lazily with the cards, like the review page.
 */
function useDueCount(account: Account): number | undefined {
  const { state } = account;
  const userId = state.status === 'signed-in' ? state.user.id : undefined;
  const signedOut = state.status === 'signed-out';
  const store = useMemo<CardStore | undefined>(
    () => (state.status === 'off' ? localStore() : signedOut ? memoryStore() : userId ? accountStore(userId) : undefined),
    [state.status, signedOut, userId],
  );
  const [count, setCount] = useState<number>();
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.load(localDay(new Date())).then(
      (loaded) => {
        if (cancelled) return;
        const stats = overview(deck.cards, loaded.states, deck.topics, { now: Math.floor(Date.now() / 1000), deck: signedOut ? 'sample' : undefined });
        setCount(stats.due + Math.min(stats.new, Math.max(0, NEW_PER_DAY - loaded.today.new)));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [store, signedOut]);
  return count;
}

/** "12 cards for today", once counted. */
export default function DueCards({ account }: { account: Account }) {
  const count = useDueCount(account);
  if (count === undefined) return <span className="text-sm text-muted">Counting your cards…</span>;
  return (
    <span data-testid="today-due" className="font-display text-lg font-extrabold tabular-nums text-ink">
      {count === 0 ? 'All caught up' : `${count} ${count === 1 ? 'card' : 'cards'} for today`}
    </span>
  );
}
