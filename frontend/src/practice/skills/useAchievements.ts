import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AchievementsAnswer } from '../../learn/achievements';
import { localDay } from '../../learn/streak';
import { api, ApiError } from '../../services/api';
import type { Progress } from '../progress';
import type { AccountState } from '../useAccount';
import { ACTIVITY_EVENT } from './activity';

/**
 * The learner's achievements and skill map, by account state: computed in
 * this browser in a build without accounts (localAchievements.ts, loaded
 * lazily with the cards), from GET /api/me/achievements signed in, and
 * locked signed out (the progress page shows a preview and a sign-in
 * invitation). Checked again after a review session or a solve
 * (ACTIVITY_EVENT), and when the caller asks, e.g. on a new route.
 */

export type AchievementsState =
  | { status: 'loading' }
  | { status: 'locked' }
  | { status: 'error'; message: string }
  | { status: 'ready'; answer: AchievementsAnswer };

export interface Achievements {
  state: AchievementsState;
  /** Checks again; signed in, at most every REFRESH_GAP_MS unless `force`. */
  refresh: (force?: boolean) => void;
  /** Marks earned badges as seen, once they were celebrated. */
  markSeen: (ids: string[]) => void;
}

/** Signed in, route changes ask the server again at most this often. */
const REFRESH_GAP_MS = 15_000;

const nowSeconds = () => Math.floor(Date.now() / 1000);

export function useAchievements(account: AccountState, progress: Progress): Achievements {
  const mode = account.status === 'off' ? 'local' : account.status === 'signed-in' ? 'account' : account.status === 'signed-out' ? 'locked' : 'loading';
  const userId = account.status === 'signed-in' ? account.user.id : undefined;
  const [state, setState] = useState<AchievementsState>({ status: 'loading' });
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const lastFetch = useRef(0);
  const request = useRef(0);

  const refresh = useCallback(
    (force = false) => {
      if (mode === 'loading') return setState({ status: 'loading' });
      if (mode === 'locked') return setState({ status: 'locked' });
      if (mode === 'account' && !force && Date.now() - lastFetch.current < REFRESH_GAP_MS) return;
      lastFetch.current = Date.now();
      const id = ++request.current;
      const answer: Promise<AchievementsAnswer> =
        mode === 'local'
          ? import('./localAchievements').then((m) => m.localAchievements(nowSeconds(), progressRef.current))
          : api<AchievementsAnswer>(`/api/me/achievements?day=${localDay()}`);
      answer.then(
        (a) => id === request.current && setState({ status: 'ready', answer: a }),
        (e: unknown) => {
          if (id !== request.current) return;
          lastFetch.current = 0;
          setState((s) =>
            // A failed refresh keeps what was shown.
            s.status === 'ready'
              ? s
              : { status: 'error', message: e instanceof ApiError && e.status === 401 ? 'Your session has expired; sign in again.' : 'Could not reach the server; try again.' },
          );
        },
      );
    },
    [mode],
  );

  // A new account state, and a new set of solved problems (a solve in a build without accounts), check again.
  const solvedKey = useMemo(
    () =>
      Object.entries(progress)
        .filter(([, p]) => p.status === 'solved')
        .map(([id]) => id)
        .sort()
        .join(','),
    [progress],
  );
  useEffect(() => refresh(true), [refresh, userId, solvedKey]);

  useEffect(() => {
    const onActivity = () => refresh(true);
    window.addEventListener(ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(ACTIVITY_EVENT, onActivity);
  }, [refresh]);

  const markSeen = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setState((s) =>
        s.status === 'ready' ? { ...s, answer: { ...s.answer, achievements: s.answer.achievements.map((a) => (ids.includes(a.id) ? { ...a, unseen: false } : a)) } } : s,
      );
      if (mode === 'local') void import('./localAchievements').then((m) => m.markSeenLocally(nowSeconds(), ids));
      else if (mode === 'account') void api('/api/me/achievements/seen', { method: 'POST', body: { ids } }).catch(() => undefined);
    },
    [mode],
  );

  return { state, refresh, markSeen };
}
