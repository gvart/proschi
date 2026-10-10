import { useEffect, useState } from 'react';
import { challengeDay, challengeSummary, type ChallengeSummary } from '../../learn/challenge';
import { api, type ChallengeToday } from '../../services/api';
import { localResults } from '../challenge/store';
import type { Account } from '../useAccount';

/**
 * The learner's daily challenge stats: from the server signed in (GET
 * /api/challenge/today), from this browser's results in a build without
 * accounts; null before a first challenge, undefined while unknown (or when
 * the server cannot be reached).
 */
export function useChallengeSummary(account: Account): ChallengeSummary | null | undefined {
  const status = account.state.status;
  const userId = account.state.status === 'signed-in' ? account.state.user.id : undefined;
  const [fetched, setFetched] = useState<{ userId: string; summary: ChallengeSummary | null } | undefined>(undefined);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<ChallengeToday>('/api/challenge/today').then(
      (today) => {
        if (cancelled) return;
        const summary = today.streak && today.best != null ? { current: today.streak.current, longest: today.streak.longest, best: today.best } : null;
        setFetched({ userId, summary });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (status === 'off') {
    return challengeSummary(
      Object.values(localResults()).map((r) => ({ day: r.day, score: r.score })),
      challengeDay(),
    );
  }
  return fetched && fetched.userId === userId ? fetched.summary : undefined;
}
