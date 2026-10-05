import { useCallback, useEffect, useState } from 'react';
import {
  activityFromLog,
  activityFromSolves,
  computeStreak,
  DEFAULT_GOAL,
  goalFor,
  isDay,
  isGoalChoice,
  localDay,
  weeklyRecap,
  type DailyGoal,
  type Day,
  type DayActivity,
  type Streak,
  type WeeklyRecap,
} from '../learn/streak';
import { api, type ActivityAnswer } from '../services/api';
import { loadJson, saveJson } from '../services/storage';
import { isSafeKey } from '../playground/sanitize';
import { CARDS_LOG_KEY, readReviews } from './review/store';
import type { Account } from './useAccount';

/**
 * The daily goal and streak on the practice page: the browser's glue around
 * src/learn/streak.ts. Signed in, the server keeps the activity (card
 * reviews and the day of each first solve) and the goal, so every device
 * shows the same streak; a build without accounts computes it from this
 * browser's review log and the solve days kept below; signed out there is no
 * streak, only an invitation to sign in.
 */

/** A build without accounts: the local day each problem was first solved, `{[problem id]: day}`. */
export const SOLVES_KEY = 'proschi.solves';
/** A build without accounts: the daily goal, cards a day. */
export const GOAL_KEY = 'proschi.goal';
/** The Monday of the last weekly recap dismissed. */
export const RECAP_KEY = 'proschi.recap';

function readSolves(): Record<string, Day> {
  const raw = loadJson<unknown>(SOLVES_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, Day] => isSafeKey(e[0]) && isDay(e[1])));
}

/** Remembers the day a problem was first solved in this browser (a build without accounts); later solves keep the first. */
export function recordLocalSolve(problemId: string, day: Day): void {
  const solves = readSolves();
  if (!isSafeKey(problemId) || solves[problemId]) return;
  saveJson(SOLVES_KEY, { ...solves, [problemId]: day });
}

/** This browser's activity: the review log's days and the solve days. */
export function localActivity(): DayActivity[] {
  return [...activityFromLog(readReviews(loadJson<unknown>(CARDS_LOG_KEY, []))), ...activityFromSolves(readSolves())];
}

/** Whether the recap of the week starting `monday` was dismissed. */
export const recapDismissed = (monday: Day) => loadJson<unknown>(RECAP_KEY, '') === monday;
export const dismissRecap = (monday: Day) => saveJson(RECAP_KEY, monday);

export type ActivityState =
  /** The account is still loading. */
  | { status: 'checking' }
  /** Signed out: streaks need an account. */
  | { status: 'sign-in' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; days: DayActivity[]; goal: DailyGoal; today: Day };

export interface Activity {
  state: ActivityState;
  /** Sets the daily goal (one of GOAL_CHOICES): on the server signed in, in this browser without accounts. */
  setGoal: (cards: number) => Promise<void>;
  /** Reads the activity again, e.g. after a session or a solve. */
  refresh: () => void;
}

/** The streak and last week's recap of a ready state. */
export function summarize(state: Extract<ActivityState, { status: 'ready' }>): { streak: Streak; recap: WeeklyRecap } {
  return { streak: computeStreak(state.days, state.today, state.goal), recap: weeklyRecap(state.days, state.today, state.goal) };
}

/**
 * The viewer's activity, loaded again whenever `key` changes (e.g. the
 * route) while `enabled`.
 */
export function useActivity(account: Account, { key, enabled = true }: { key?: string; enabled?: boolean } = {}): Activity {
  const { state: accountState, update } = account;
  const userId = accountState.status === 'signed-in' ? accountState.user.id : undefined;
  const mode = accountState.status === 'off' ? 'local' : userId ? 'account' : accountState.status === 'signed-out' ? 'sign-in' : 'checking';
  const [state, setState] = useState<ActivityState>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (mode === 'checking' || mode === 'sign-in') {
      setState({ status: mode });
      return;
    }
    if (!enabled) return;
    const today = localDay();
    if (mode === 'local') {
      setState({ status: 'ready', days: localActivity(), goal: goalFor(loadJson<unknown>(GOAL_KEY, DEFAULT_GOAL.reviews)), today });
      return;
    }
    let cancelled = false;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }));
    api<ActivityAnswer>(`/api/me/activity?day=${today}`).then(
      (answer) => !cancelled && setState({ status: 'ready', days: answer.days, goal: answer.goal, today }),
      () => !cancelled && setState((s) => (s.status === 'ready' ? s : { status: 'error' })),
    );
    return () => {
      cancelled = true;
    };
  }, [mode, userId, enabled, key, attempt]);

  const setGoal = useCallback(
    async (cards: number) => {
      if (!isGoalChoice(cards)) return;
      setState((s) => (s.status === 'ready' ? { ...s, goal: goalFor(cards) } : s));
      if (mode === 'local') saveJson(GOAL_KEY, cards);
      else if (mode === 'account') await update({ dailyGoal: cards });
    },
    [mode, update],
  );

  return { state, setGoal, refresh };
}
