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
  /** The answer's JSON body, e.g. the attempt kept with a 409. */
  readonly body?: unknown;
  constructor(status: number, message: string, retryAfter?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.body = body;
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
    throw new ApiError(response.status, data.error ?? `${response.status} ${response.statusText}`, Number.isFinite(retryAfter) ? retryAfter : undefined, data);
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
  entries: { rank: number; displayName: string; solved: number; lastSolvedAt: number }[];
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

/** One card of a daily challenge attempt, graded by the server (src/learn/challenge.ts). */
export interface ChallengeCardOutcome {
  cardId: string;
  answer: number | string[] | null;
  ms: number;
  correct: boolean;
  points: number;
  bonus: number;
}

/** A daily challenge attempt as the server keeps it, with its rank among the day's. */
export interface ChallengeAttempt {
  day: string;
  score: number;
  maxScore: number;
  correct: number;
  perfect: boolean;
  totalMs: number;
  results: ChallengeCardOutcome[];
  rank: number;
  players: number;
  submittedAt: number;
}

export interface ChallengeStreakAnswer {
  current: number;
  longest: number;
  todayDone: boolean;
}

/** GET /api/challenge/today: the day's cards; signed in, your attempt (null before playing) and challenge streak. */
export interface ChallengeToday {
  day: string;
  cardIds: string[];
  endsAt: number;
  maxScore: number;
  attempt?: ChallengeAttempt | null;
  /** Signed in: when the first card was shown (POST /api/challenge/today/start), null before. */
  startedAt?: number | null;
  streak?: ChallengeStreakAnswer;
}

/** POST /api/challenge/today/attempt: the attempt kept and the challenge streak; a 409 (played already) carries them too. */
export interface ChallengeAttemptAnswer {
  attempt: ChallengeAttempt;
  streak: ChallengeStreakAnswer;
}

/** GET /api/challenge/leaderboard?day=: the day's best who opted in, ranked among everyone; signed in, `you`. */
export interface ChallengeLeaderboard {
  day: string;
  players: number;
  maxScore: number;
  entries: { rank: number; displayName: string; score: number; correct: number }[];
  you?: { rank: number; score: number; correct: number; players: number } | null;
}

/** GET /api/me/activity?day=: each day's activity over the last 400 days, the goal, the streak as of `day` and last week's recap. */
export interface ActivityAnswer {
  day: string;
  goal: DailyGoal;
  days: DayActivity[];
  streak: Streak;
  recap: WeeklyRecap;
}
