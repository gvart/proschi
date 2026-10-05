import type { CardState } from '../learn/fsrs';
import type { DayCounts } from '../learn/review';
import type { DailyGoal, DayActivity, Streak, WeeklyRecap } from '../learn/streak';

/**
 * The Proschi API (backend/): sign-in and practice stats, under /api and
 * /auth on the site's own origin (proschi.app), with the session in an
 * HttpOnly cookie. Builds without VITE_ACCOUNTS=true (GitHub Pages, the e2e
 * tests) have no API, and the practice page keeps progress in the browser only.
 */

export const apiEnabled = import.meta.env.VITE_ACCOUNTS === 'true';

export type ProviderId = 'github' | 'google';

export class ApiError extends Error {
  readonly status: number;
  /** Seconds to wait before retrying, from a 429's Retry-After. */
  readonly retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? NaN);
    throw new ApiError(response.status, data.error ?? `${response.status} ${response.statusText}`, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  return data as T;
}

/**
 * Where the sign-in button goes: the provider's page, then back to
 * `returnTo` (a path on this site), signed in. With `link`, the provider's
 * sign-in is added to the signed-in account instead.
 */
export function loginUrl(provider: ProviderId, returnTo: string, link = false): string {
  return `/auth/${provider}/start?${new URLSearchParams({ return: returnTo, ...(link ? { link: '1' } : {}) })}`;
}

export interface User {
  id: string;
  displayName: string;
  publicProfile: boolean;
  /** Cards a day the user aims for (GOAL_CHOICES in src/learn/streak.ts). */
  dailyGoal?: number;
  providers?: ProviderId[];
  /** Unix seconds: when the account was made (GET /api/me). */
  createdAt?: number;
}

/** A problem's progress as the server keeps it. */
export interface ServerProgress {
  status: 'attempted' | 'solved';
  runs: number;
  source?: string;
  solvedAt?: number;
  /** The local date of the first verified solve. */
  solvedDay?: string;
  runsToSolve?: number;
  bestCostUsd?: number;
  bestP99Ms?: number;
}

export interface Me {
  user: User;
  progress: Record<string, ServerProgress>;
}

export interface Verdict {
  solved: boolean;
  passed: number;
  total: number;
  costUsd?: number;
  p99Ms?: number;
}

export interface RunRecord {
  progress: ServerProgress;
  verdict?: Verdict;
}

export interface ProblemSummary {
  attempted: number;
  solved: number;
  medianRunsToSolve: number | null;
}

export interface StatsSummary {
  problems: Record<string, ProblemSummary>;
  solvers: number;
}

export interface Distribution {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface ProblemStats extends ProblemSummary {
  costUsd: Distribution | null;
  p99Ms: Distribution | null;
  /** Signed in: where the user's best solving designs fall; null before they solve it. */
  you?: {
    costUsd: number;
    p99Ms: number | null;
    runsToSolve: number | null;
    cheaperThan: number | null;
    fasterThan: number | null;
  } | null;
}

export interface Leaderboard {
  problems: number;
  /** `id`: the user's public id, for their profile (`#/u/<id>`, GET /api/users/<id>/profile). */
  entries: { rank: number; id: string; displayName: string; solved: number; lastSolvedAt: number }[];
}

/**
 * GET /api/users/<id>/profile: what a user who opted in shows everyone
 * (backend/src/profile.ts; docs/PRIVACY.md lists the same). Shares are 0 to 1
 * in whole percent; times are Unix seconds at the start of a UTC day.
 */
export interface PublicProfile {
  id: string;
  displayName: string;
  memberSince: number;
  solved: { id: string; difficulty: 'easy' | 'medium' | 'hard' }[];
  streak: { current: number; longest: number };
  readiness: number;
  topics: { topic: string; mastery: number }[];
  badges: { id: string; earnedAt: number }[];
}

/** GET /api/cards/state: the signed-in user's card states by card id, and with `?day=` that day's counts. */
export interface CardStatesAnswer {
  states: Record<string, CardState>;
  today?: DayCounts;
}

/** POST /api/cards/reviews: how many reviews were new to the server, those it skipped and why, and their cards' states. */
export interface CardReviewsAnswer {
  accepted: number;
  skipped: { id: string; cardId: string; reason: string }[];
  states: Record<string, CardState>;
}

/** GET /api/me/activity?day=: each day's activity over the last 400 days, the goal, the streak as of `day` and last week's recap. */
export interface ActivityAnswer {
  day: string;
  goal: DailyGoal;
  days: DayActivity[];
  streak: Streak;
  recap: WeeklyRecap;
}
