import { cleanName, requireUser } from './auth';
import { now, type Env } from './env';
import { HttpError, json, readJson } from './http';
import { findProblem, verify, type Verdict } from './verify';

/** The signed-in user's account and practice progress. */

export const MAX_SOURCE = 64 * 1024;

export interface ProgressEntry {
  status: 'attempted' | 'solved';
  runs: number;
  source?: string;
  solvedAt?: number;
  runsToSolve?: number;
  bestCostUsd?: number;
  bestP99Ms?: number;
}

interface ProgressRow {
  problem_id: string;
  runs: number;
  source: string | null;
  solved_at: number | null;
  runs_to_solve: number | null;
  best_cost_usd: number | null;
  best_p99_ms: number | null;
}

function entryOf(row: Omit<ProgressRow, 'problem_id'>): ProgressEntry {
  return {
    status: row.solved_at !== null ? 'solved' : 'attempted',
    runs: row.runs,
    ...(row.source !== null ? { source: row.source } : {}),
    ...(row.solved_at !== null ? { solvedAt: row.solved_at } : {}),
    ...(row.runs_to_solve !== null ? { runsToSolve: row.runs_to_solve } : {}),
    ...(row.best_cost_usd !== null ? { bestCostUsd: row.best_cost_usd } : {}),
    ...(row.best_p99_ms !== null ? { bestP99Ms: row.best_p99_ms } : {}),
  };
}

/** GET /api/me */
export async function getMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const [rows, identities] = await env.DB.batch([
    env.DB.prepare(
      'SELECT problem_id, runs, source, solved_at, runs_to_solve, best_cost_usd, best_p99_ms FROM progress WHERE user_id = ? ORDER BY problem_id',
    ).bind(user.id),
    env.DB.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').bind(user.id),
  ]);
  const progress: Record<string, ProgressEntry> = {};
  for (const row of rows.results as unknown as ProgressRow[]) progress[row.problem_id] = entryOf(row);
  return json(
    { user: { ...user, providers: (identities.results as { provider: string }[]).map((r) => r.provider) }, progress },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

/** PATCH /api/me {displayName?, publicProfile?} */
export async function updateMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  let displayName = user.displayName;
  let publicProfile = user.publicProfile;
  if (body.displayName !== undefined) {
    const name = typeof body.displayName === 'string' ? cleanName(body.displayName) : undefined;
    if (!name) throw new HttpError(400, 'displayName must be a non-empty string');
    displayName = name;
  }
  if (body.publicProfile !== undefined) {
    if (typeof body.publicProfile !== 'boolean') throw new HttpError(400, 'publicProfile must be true or false');
    publicProfile = body.publicProfile;
  }
  await env.DB.prepare('UPDATE users SET display_name = ?, public_profile = ? WHERE id = ?')
    .bind(displayName, publicProfile ? 1 : 0, user.id)
    .run();
  return json({ user: { id: user.id, displayName, publicProfile } }, 200, { 'Cache-Control': 'no-store' });
}

/** DELETE /api/me: the account, its sessions and its progress. */
export async function deleteMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  return new Response(null, { status: 204 });
}

/**
 * POST /api/problems/<id>/runs {source, solved, imported?}: records a test
 * run of `source`. When the page says it solved the problem, the server runs
 * the tests itself and records the solve only if they all pass. `imported`
 * marks progress uploaded from the browser on first sign-in: it does not
 * count as a run, does not replace a design already stored, and its solve is
 * left out of the attempts-to-solve statistic.
 */
export async function recordRun(request: Request, env: Env, problemId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const problem = findProblem(problemId);
  if (!problem) throw new HttpError(404, `No problem called ${problemId}`);
  const body = await readJson(request);
  if (typeof body.source !== 'string') throw new HttpError(400, 'source must be a string');
  if (body.source.length > MAX_SOURCE) throw new HttpError(413, 'source is too long');
  if (typeof body.solved !== 'boolean') throw new HttpError(400, 'solved must be true or false');
  const imported = body.imported === true;

  const { success } = await env.RUN_LIMITER.limit({ key: user.id });
  if (!success) throw new HttpError(429, 'Too many test runs; wait a minute');

  const verdict: Verdict | undefined = body.solved ? verify(problem, body.source) : undefined;
  const solved = verdict?.solved === true;
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms)
     VALUES (?1, ?2, 1, ?3, ?4, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT (user_id, problem_id) DO UPDATE SET
       runs = runs + ?9,
       source = CASE WHEN ?10 THEN COALESCE(source, excluded.source) ELSE excluded.source END,
       updated_at = excluded.updated_at,
       runs_to_solve = CASE WHEN solved_at IS NULL AND excluded.solved_at IS NOT NULL AND NOT ?10 THEN runs + 1 ELSE runs_to_solve END,
       solved_at = COALESCE(solved_at, excluded.solved_at),
       best_cost_usd = MIN(COALESCE(best_cost_usd, excluded.best_cost_usd), COALESCE(excluded.best_cost_usd, best_cost_usd)),
       best_p99_ms = MIN(COALESCE(best_p99_ms, excluded.best_p99_ms), COALESCE(excluded.best_p99_ms, best_p99_ms))
     RETURNING runs, source, solved_at, runs_to_solve, best_cost_usd, best_p99_ms`,
  )
    .bind(
      user.id,
      problemId,
      body.source,
      t,
      solved ? t : null,
      solved && !imported ? 1 : null,
      solved ? (verdict.costUsd ?? null) : null,
      solved ? (verdict.p99Ms ?? null) : null,
      imported ? 0 : 1,
      imported ? 1 : 0,
    )
    .first<Omit<ProgressRow, 'problem_id'>>();
  if (!row) throw new Error('progress upsert returned no row');
  return json({ progress: entryOf(row), ...(verdict ? { verdict } : {}) }, 200, { 'Cache-Control': 'no-store' });
}
