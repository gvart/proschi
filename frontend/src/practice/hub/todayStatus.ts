import { useEffect, useState } from 'react';
import { challengeDay } from '../../learn/challenge';
import { api, type ChallengeToday } from '../../services/api';
import { localDaily } from '../../game/ui/daily';
import type { ServerMe } from '../../game/ui/useArcade';
import { guestChallenge, localResults } from '../challenge/store';
import type { Account } from '../useAccount';

/**
 * What the Today panel (TodayPanel.tsx) shows of today's daily challenge and
 * daily Arcade run, read from where their own pages keep them: this browser's
 * results in a build without accounts or signed out, the server signed in.
 */

/** Whether today's daily thing was played, and its score. */
export type Played = { status: 'loading' } | { status: 'unknown' } | { status: 'ready'; played: false } | { status: 'ready'; played: true; score?: number | null; maxScore?: number };

/** Today's daily challenge, from where the challenge page keeps it. */
export function useChallengeStatus(account: Account): Played {
  const mode = account.state.status;
  const [state, setState] = useState<Played>({ status: 'loading' });
  useEffect(() => {
    const day = challengeDay();
    if (mode === 'off' || mode === 'signed-out') {
      const result = mode === 'off' ? localResults()[day] : guestChallenge()?.result;
      setState(result && result.day === day ? { status: 'ready', played: true, score: result.score, maxScore: result.maxScore } : { status: 'ready', played: false });
      return;
    }
    if (mode !== 'signed-in') return;
    let cancelled = false;
    api<ChallengeToday>('/api/challenge/today').then(
      (answer) => !cancelled && setState(answer.attempt ? { status: 'ready', played: true, score: answer.attempt.score, maxScore: answer.attempt.maxScore } : { status: 'ready', played: false }),
      () => !cancelled && setState({ status: 'unknown' }),
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  return state;
}

/** Today's daily Arcade run, from where the Arcade keeps it (game/ui/useArcade.ts). */
export function useDailyRunStatus(account: Account): Played {
  const mode = account.state.status;
  const [state, setState] = useState<Played>({ status: 'loading' });
  useEffect(() => {
    if (mode === 'off' || mode === 'signed-out') {
      const daily = localDaily();
      setState(daily && daily.day === challengeDay() ? { status: 'ready', played: true, score: daily.score } : { status: 'ready', played: false });
      return;
    }
    if (mode !== 'signed-in') return;
    let cancelled = false;
    api<ServerMe>('/api/game/me').then(
      (me) => !cancelled && setState(me.daily.submitted ? { status: 'ready', played: true, score: me.daily.score } : { status: 'ready', played: false }),
      () => !cancelled && setState({ status: 'unknown' }),
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  return state;
}
