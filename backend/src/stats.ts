import { SIM_VERSION } from '../../frontend/src/sim/version';
import type { Problem } from '../../frontend/src/practice/types';
import { authenticate } from './auth';
import type { Ctx } from './context';
import type { Env } from './env';
import { HttpError, json, rateLimit } from './http';
import { currentVersions, findProblem, problemIds } from './verify';

/**
 * Global practice statistics: per problem how many attempted and solved it,
 * the median number of test runs to the first solve, and the spread of the
 * solving designs' cost and p99; and the leaderboard of users who opted in.
 * Only progress on the current simulation and problem versions counts.
 */

/** Public answers are cached by browsers and, shared by the Worker's isolates (the Cache API), here for this long. */
const CACHE_SECONDS = 60;
const PUBLIC_CACHE = { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` };

/** The Cache API key of a shared answer; with the simulation version, so a deploy that changes it starts afresh. */
export function cacheKey(key: string): string {
  return `https://cache.internal/${key}?v=${SIM_VERSION}`;
}

/** `compute()`'s value, cached for CACHE_SECONDS in this data center. */
async function cached<T>(ctx: Ctx, key: string, compute: () => Promise<T>): Promise<T> {
  const url = cacheKey(key);
  const hit = await caches.default.match(url);
  if (hit) return (await hit.json()) as T;
  const value = await compute();
  ctx.exec.waitUntil(caches.default.put(url, Response.json(value, { headers: { 'Cache-Control': `s-maxage=${CACHE_SECONDS}` } })));
  return value;
}

/** Tests call this between cases. */
export async function clearStatsCache(): Promise<void> {
  const keys = ['stats', 'leaderboard', ...problemIds().map((id) => `problem/${id}`)];
  await Promise.all(keys.map((key) => caches.default.delete(cacheKey(key))));
}

/**
 * Joins `progress p` to the current versions: ?1 is currentVersions() as JSON,
 * ?2 SIM_VERSION. Progress on a problem that no longer exists drops out too.
 */
const CURRENT = `JOIN json_each(?1) j ON p.problem_id = json_extract(j.value, '$.id')
  AND p.problem_version = json_extract(j.value, '$.v') AND p.sim_version = ?2`;

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

/** Share of the others' values above the user's: "cheaper than x of the others". Null when there are no others. */
function share(above: number, others: number): number | null {
  return others < 1 ? null : above / others;
}

export interface ProblemSummary {
  attempted: number;
  solved: number;
  medianRunsToSolve: number | null;
}

/** GET /api/stats: every problem's summary, and how many users solved at least one. */
export async function getStats(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const body = await cached(ctx, 'stats', async () => {
    const versions = JSON.stringify(currentVersions());
    const [counts, runs, solvers] = await env.DB.batch([
      env.DB.prepare(`SELECT p.problem_id, COUNT(*) AS attempted, COUNT(p.solved_at) AS solved FROM progress p ${CURRENT} GROUP BY p.problem_id`).bind(
        versions,
        SIM_VERSION,
      ),
      env.DB.prepare(
        `SELECT p.problem_id, p.runs_to_solve FROM progress p ${CURRENT} WHERE p.runs_to_solve IS NOT NULL ORDER BY p.problem_id, p.runs_to_solve`,
      ).bind(versions, SIM_VERSION),
      env.DB.prepare(`SELECT COUNT(DISTINCT p.user_id) AS n FROM progress p ${CURRENT} WHERE p.solved_at IS NOT NULL`).bind(versions, SIM_VERSION),
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

async function loadProblemData(env: Env, problem: Problem): Promise<ProblemData> {
  const current = 'problem_id = ?1 AND problem_version = ?2 AND sim_version = ?3';
  const [counts, runs, costs, p99s] = await env.DB.batch(
    [
      `SELECT COUNT(*) AS attempted, COUNT(solved_at) AS solved FROM progress WHERE ${current}`,
      `SELECT runs_to_solve AS v FROM progress WHERE ${current} AND runs_to_solve IS NOT NULL ORDER BY v`,
      `SELECT best_cost_usd AS v FROM progress WHERE ${current} AND best_cost_usd IS NOT NULL ORDER BY v`,
      `SELECT best_p99_ms AS v FROM progress WHERE ${current} AND best_p99_ms IS NOT NULL ORDER BY v`,
    ].map((sql) => env.DB.prepare(sql).bind(problem.id, problem.version ?? 1, SIM_VERSION)),
  );
  const values = (r: D1Result) => (r.results as { v: number }[]).map((x) => x.v);
  const c = counts.results[0] as { attempted: number; solved: number };
  return { attempted: c.attempted, solved: c.solved, runs: values(runs), costs: values(costs), p99s: values(p99s) };
}

/**
 * GET /api/stats/<problem id>: the summary and the distribution of the
 * solving designs' cost and p99 (each user's best). Signed in, also where the
 * user's best designs fall among the other solvers' (`you`). That part is
 * read fresh, so it includes the run the page just recorded, even while the
 * distributions come from the cache.
 */
export async function getProblemStats(request: Request, ctx: Ctx, problemId: string): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const problem = findProblem(problemId);
  if (!problem) throw new HttpError(404, `No problem called ${problemId}`);
  const user = await authenticate(request, ctx);
  const data = await cached(ctx, `problem/${problemId}`, () => loadProblemData(env, problem));
  const stats: ProblemStats = {
    attempted: data.attempted,
    solved: data.solved,
    medianRunsToSolve: quantile(data.runs, 0.5) ?? null,
    costUsd: distribution(data.costs),
    p99Ms: distribution(data.p99s),
  };

  // Not cached by browsers either way: a page that signs in must not get its signed-out copy back.
  if (!user) return json(stats, 200, { 'Cache-Control': 'no-store' });
  // One row: the user's best designs, and how many other solvers' are dearer and slower.
  const mine = await env.DB.prepare(
    `SELECT m.runs_to_solve, m.best_cost_usd, m.best_p99_ms,
       COUNT(o.best_cost_usd) AS costs, COUNT(CASE WHEN o.best_cost_usd > m.best_cost_usd THEN 1 END) AS dearer,
       COUNT(o.best_p99_ms) AS p99s, COUNT(CASE WHEN o.best_p99_ms > m.best_p99_ms THEN 1 END) AS slower
     FROM progress m LEFT JOIN progress o ON o.problem_id = m.problem_id AND o.problem_version = m.problem_version
       AND o.sim_version = m.sim_version AND o.user_id <> m.user_id
     WHERE m.user_id = ? AND m.problem_id = ? AND m.problem_version = ? AND m.sim_version = ?
     GROUP BY m.user_id`,
  )
    .bind(user.id, problemId, problem.version ?? 1, SIM_VERSION)
    .first<{ runs_to_solve: number | null; best_cost_usd: number | null; best_p99_ms: number | null; costs: number; dearer: number; p99s: number; slower: number }>();
  const you =
    mine && mine.best_cost_usd !== null
      ? {
          costUsd: mine.best_cost_usd,
          p99Ms: mine.best_p99_ms,
          runsToSolve: mine.runs_to_solve,
          cheaperThan: share(mine.dearer, mine.costs),
          fasterThan: mine.best_p99_ms !== null ? share(mine.slower, mine.p99s) : null,
        }
      : null;
  return json({ ...stats, you }, 200, { 'Cache-Control': 'no-store' });
}

/** GET /api/leaderboard: users who chose to appear, by problems solved, then by who got there first. */
export async function getLeaderboard(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const body = await cached(ctx, 'leaderboard', async () => {
    const { results } = await env.DB.prepare(
      `SELECT u.display_name AS name, COUNT(*) AS solved, MAX(p.solved_at) AS last
       FROM users u JOIN progress p ON p.user_id = u.id ${CURRENT}
       WHERE u.public_profile = 1 AND p.solved_at IS NOT NULL
       GROUP BY u.id ORDER BY solved DESC, last ASC LIMIT 50`,
    )
      .bind(JSON.stringify(currentVersions()), SIM_VERSION)
      .all<{ name: string; solved: number; last: number }>();
    let rank = 0;
    return {
      problems: problemIds().length,
      entries: results.map((r, i) => {
        if (i === 0 || results[i - 1].solved !== r.solved) rank = i + 1;
        return { rank, displayName: r.name, solved: r.solved, lastSolvedAt: r.last };
      }),
    };
  });
  return json(body, 200, PUBLIC_CACHE);
}
