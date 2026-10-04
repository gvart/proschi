import { authenticate } from './auth';
import type { Env } from './env';
import { HttpError, json } from './http';
import { findProblem, problemIds } from './verify';

/**
 * Global practice statistics: per problem how many attempted and solved it,
 * the median number of test runs to the first solve, and the spread of the
 * solving designs' cost and p99; and the leaderboard of users who opted in.
 */

/** Public answers are cached by browsers and, per isolate, here for this long. */
const CACHE_SECONDS = 60;
const PUBLIC_CACHE = { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` };

const memo = new Map<string, { at: number; value: unknown }>();

async function memoized<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < CACHE_SECONDS * 1000) return hit.value as T;
  const value = await compute();
  memo.set(key, { at: Date.now(), value });
  return value;
}

/** Tests call this between cases. */
export function clearStatsCache(): void {
  memo.clear();
}

/** The q-quantile (0..1) of ascending `sorted`, interpolated; undefined when empty. */
export function quantile(sorted: number[], q: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export interface Distribution {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export function distribution(sorted: number[]): Distribution | null {
  if (sorted.length === 0) return null;
  return {
    count: sorted.length,
    min: sorted[0],
    p25: quantile(sorted, 0.25)!,
    median: quantile(sorted, 0.5)!,
    p75: quantile(sorted, 0.75)!,
    max: sorted[sorted.length - 1],
  };
}

/** Share of the other values in `sorted` strictly greater than `mine`: "cheaper than x of the others". Null when there are no others. */
export function shareAbove(sorted: number[], mine: number): number | null {
  const others = sorted.length - 1;
  if (others < 1) return null;
  return sorted.filter((v) => v > mine).length / others;
}

export interface ProblemSummary {
  attempted: number;
  solved: number;
  medianRunsToSolve: number | null;
}

/** GET /api/stats: every problem's summary, and how many users solved at least one. */
export async function getStats(env: Env): Promise<Response> {
  const body = await memoized('stats', async () => {
    const [counts, runs, solvers] = await env.DB.batch([
      env.DB.prepare('SELECT problem_id, COUNT(*) AS attempted, COUNT(solved_at) AS solved FROM progress GROUP BY problem_id'),
      env.DB.prepare('SELECT problem_id, runs_to_solve FROM progress WHERE runs_to_solve IS NOT NULL ORDER BY problem_id, runs_to_solve'),
      env.DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM progress WHERE solved_at IS NOT NULL'),
    ]);
    const runsBy = new Map<string, number[]>();
    for (const r of runs.results as { problem_id: string; runs_to_solve: number }[]) {
      if (!runsBy.has(r.problem_id)) runsBy.set(r.problem_id, []);
      runsBy.get(r.problem_id)!.push(r.runs_to_solve);
    }
    const countsBy = new Map((counts.results as { problem_id: string; attempted: number; solved: number }[]).map((r) => [r.problem_id, r]));
    const problems: Record<string, ProblemSummary> = {};
    for (const id of problemIds()) {
      const c = countsBy.get(id);
      problems[id] = { attempted: c?.attempted ?? 0, solved: c?.solved ?? 0, medianRunsToSolve: quantile(runsBy.get(id) ?? [], 0.5) ?? null };
    }
    return { problems, solvers: (solvers.results[0] as { n: number } | undefined)?.n ?? 0 };
  });
  return json(body, 200, PUBLIC_CACHE);
}

interface ProblemStats extends ProblemSummary {
  costUsd: Distribution | null;
  p99Ms: Distribution | null;
}

interface ProblemData {
  attempted: number;
  solved: number;
  runs: number[];
  costs: number[];
  p99s: number[];
}

async function loadProblemData(env: Env, problemId: string): Promise<ProblemData> {
  const [counts, runs, costs, p99s] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS attempted, COUNT(solved_at) AS solved FROM progress WHERE problem_id = ?').bind(problemId),
    env.DB.prepare('SELECT runs_to_solve AS v FROM progress WHERE problem_id = ? AND runs_to_solve IS NOT NULL ORDER BY v').bind(problemId),
    env.DB.prepare('SELECT best_cost_usd AS v FROM progress WHERE problem_id = ? AND best_cost_usd IS NOT NULL ORDER BY v').bind(problemId),
    env.DB.prepare('SELECT best_p99_ms AS v FROM progress WHERE problem_id = ? AND best_p99_ms IS NOT NULL ORDER BY v').bind(problemId),
  ]);
  const values = (r: D1Result) => (r.results as { v: number }[]).map((x) => x.v);
  const c = counts.results[0] as { attempted: number; solved: number };
  return { attempted: c.attempted, solved: c.solved, runs: values(runs), costs: values(costs), p99s: values(p99s) };
}

/**
 * GET /api/stats/<problem id>: the summary and the distribution of the
 * solving designs' cost and p99 (each user's best). Signed in, also where the
 * user's best designs fall in it (`you`); that answer is read fresh, so it
 * includes the run the page just recorded, and is not cached.
 */
export async function getProblemStats(request: Request, env: Env, problemId: string): Promise<Response> {
  if (!findProblem(problemId)) throw new HttpError(404, `No problem called ${problemId}`);
  const user = await authenticate(request, env);
  const data = user ? await loadProblemData(env, problemId) : await memoized(`problem:${problemId}`, () => loadProblemData(env, problemId));
  const stats: ProblemStats = {
    attempted: data.attempted,
    solved: data.solved,
    medianRunsToSolve: quantile(data.runs, 0.5) ?? null,
    costUsd: distribution(data.costs),
    p99Ms: distribution(data.p99s),
  };

  // Not cached by browsers either way: a page that signs in must not get its signed-out copy back.
  if (!user) return json(stats, 200, { 'Cache-Control': 'no-store' });
  const mine = await env.DB.prepare('SELECT runs_to_solve, best_cost_usd, best_p99_ms FROM progress WHERE user_id = ? AND problem_id = ?')
    .bind(user.id, problemId)
    .first<{ runs_to_solve: number | null; best_cost_usd: number | null; best_p99_ms: number | null }>();
  const you =
    mine && mine.best_cost_usd !== null
      ? {
          costUsd: mine.best_cost_usd,
          p99Ms: mine.best_p99_ms,
          runsToSolve: mine.runs_to_solve,
          cheaperThan: shareAbove(data.costs, mine.best_cost_usd),
          fasterThan: mine.best_p99_ms !== null ? shareAbove(data.p99s, mine.best_p99_ms) : null,
        }
      : null;
  return json({ ...stats, you }, 200, { 'Cache-Control': 'no-store' });
}

/** GET /api/leaderboard: users who chose to appear, by problems solved, then by who got there first. */
export async function getLeaderboard(env: Env): Promise<Response> {
  const body = await memoized('leaderboard', async () => {
    const ids = problemIds();
    const { results } = await env.DB.prepare(
      `SELECT u.display_name AS name, COUNT(*) AS solved, MAX(p.solved_at) AS last
       FROM users u JOIN progress p ON p.user_id = u.id
       WHERE u.public_profile = 1 AND p.solved_at IS NOT NULL AND p.problem_id IN (SELECT value FROM json_each(?))
       GROUP BY u.id ORDER BY solved DESC, last ASC LIMIT 50`,
    )
      .bind(JSON.stringify(ids))
      .all<{ name: string; solved: number; last: number }>();
    let rank = 0;
    return {
      problems: ids.length,
      entries: results.map((r, i) => {
        if (i === 0 || results[i - 1].solved !== r.solved) rank = i + 1;
        return { rank, displayName: r.name, solved: r.solved, lastSolvedAt: r.last };
      }),
    };
  });
  return json(body, 200, PUBLIC_CACHE);
}
