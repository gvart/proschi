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
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `${response.status} ${response.statusText}`);
  return data as T;
}

/** Where the sign-in button goes: the provider's page, then back to `returnTo` (a path on this site), signed in. */
export function loginUrl(provider: ProviderId, returnTo: string): string {
  return `/auth/${provider}/start?${new URLSearchParams({ return: returnTo })}`;
}

export interface User {
  id: string;
  displayName: string;
  publicProfile: boolean;
  providers?: ProviderId[];
}

/** A problem's progress as the server keeps it. */
export interface ServerProgress {
  status: 'attempted' | 'solved';
  runs: number;
  source?: string;
  solvedAt?: number;
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
