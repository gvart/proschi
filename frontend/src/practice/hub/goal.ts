import { useSyncExternalStore } from 'react';
import { loadJson, saveJson } from '../../services/storage';

/**
 * What someone is on the practice page for, asked once on the home and
 * changeable there and in Settings › Learning. It decides what the home shows
 * beside the problem list: interview prep adds the roadmap's next step and the
 * mock interview, a daily habit the streak and today's review, challenge and
 * Arcade run; solving problems (or no answer) adds nothing. The streak can also
 * be switched on or off by itself. Kept in this browser
 * (`proschi.practice.goal`, listed in docs/PRIVACY.md) and, signed in, with
 * the account too (`practiceGoal` of GET and PATCH /api/me,
 * docs/design/paid-plans.md P43): the account's wins on sign-in, an account
 * without one gets this browser's, and every change is sent to it.
 */

export type Goal = 'solve' | 'interview' | 'habit';

export const GOALS: { id: Goal; label: string; short: string }[] = [
  { id: 'solve', label: 'Solve problems', short: 'Solving problems' },
  { id: 'interview', label: 'Prepare for an interview', short: 'Interview prep' },
  { id: 'habit', label: 'Build a daily habit', short: 'Daily habit' },
];

export const GOAL_KEY = 'proschi.practice.goal';

export interface GoalState {
  goals: Goal[];
  /** Answered or skipped: the question is not asked again. */
  asked: boolean;
  /** The streak and daily nudges, switched on or off by hand; follows the daily habit goal when absent. */
  streak?: boolean;
}

const EMPTY: GoalState = { goals: [], asked: false };

export function parseGoal(raw: unknown): GoalState {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const { goals, asked, streak } = raw as Record<string, unknown>;
  const known = new Set(GOALS.map((g) => g.id));
  return {
    goals: Array.isArray(goals) ? GOALS.map((g) => g.id).filter((id) => goals.includes(id) && known.has(id)) : [],
    asked: asked === true,
    ...(typeof streak === 'boolean' ? { streak } : {}),
  };
}

/** Whether the streak and the daily nudges show: switched on by hand, or wanted as a daily habit. */
export const wantsStreak = (g: GoalState) => g.streak ?? g.goals.includes('habit');
export const wantsInterview = (g: GoalState) => g.goals.includes('interview');

/** Whether the signed-in announcement (announcements/Announcement.tsx) is still loading, on the page, or not there (none, dismissed, or signed out). */
export type AnnouncementState = 'loading' | 'shown' | 'none';

/**
 * Whether the home asks "What are you here for?": not once answered, and only
 * one card above the list at a time, the announcement first. Signed in, it
 * waits until the announcement is known to be absent (none or dismissed);
 * while the account is still loading, it waits too, so it never flashes up and
 * gives way to an announcement.
 */
export function asksGoal(goal: GoalState, account: 'off' | 'loading' | 'signed-out' | 'signed-in', announcement: AnnouncementState): boolean {
  if (goal.asked || account === 'loading') return false;
  return account !== 'signed-in' || announcement === 'none';
}

let current: GoalState | undefined;
const listeners = new Set<() => void>();

function read(): GoalState {
  current ??= parseGoal(loadJson<unknown>(GOAL_KEY, undefined));
  return current;
}

/** Signed in: where each change goes too (PracticeApp sets it while signed in). */
let push: ((g: GoalState) => void) | undefined;

export function onGoalChange(send: ((g: GoalState) => void) | undefined): void {
  push = send;
}

function store(goal: GoalState): void {
  current = goal;
  saveJson(GOAL_KEY, current);
  for (const l of listeners) l();
}

export function setGoal(update: (g: GoalState) => GoalState): void {
  store(parseGoal(update(read())));
  push?.(read());
}

/**
 * On sign-in, with the account's goal (`user.practiceGoal`; undefined from a
 * Worker without it): the account's replaces this browser's; an account
 * without one (null) gets this browser's, if it has anything to keep, which
 * is returned to send. Once sent, the account has one, so it happens once.
 */
export function mergeAccountGoal(remote: unknown): GoalState | undefined {
  if (remote === undefined) return undefined;
  if (remote !== null) {
    store(parseGoal(remote));
    return undefined;
  }
  const local = read();
  return local.asked || local.goals.length > 0 || local.streak !== undefined ? local : undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== GOAL_KEY) return;
    current = undefined;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The goal, kept in step with every other reader on the page (and other tabs). */
export function useGoal(): GoalState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
