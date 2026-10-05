import { SIM_VERSION } from '../../frontend/src/sim/version';
import type { Problem } from '../../frontend/src/practice/types';
import { daysBetween, isDay } from '../../frontend/src/learn/review';
import { isGoalChoice, GOAL_CHOICES } from '../../frontend/src/learn/streak';
import { cleanName, requireUser, sessionCookie } from './auth';
import type { Ctx } from './context';
import { now, type Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { rejectName } from './moderation';
import { findProblem, problemIds, verify, type Verdict } from './verify';

/** The signed-in user's account and practice progress. */

export const MAX_SOURCE = 64 * 1024;
/** POST /api/me/import: every problem's design fits. */
const MAX_IMPORT_BODY = 512 * 1024;

export interface ProgressEntry {
  status: 'attempted' | 'solved';
  runs: number;
  source?: string;
  solvedAt?: number;
  /** The user's local date of the first verified solve, YYYY-MM-DD. */
  solvedDay?: string;
  runsToSolve?: number;
  bestCostUsd?: number;
  bestP99Ms?: number;
}

interface ProgressRow {
  problem_id: string;
  runs: number;
  source: string | null;
  solved_at: number | null;
  solved_day: string | null;
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
    ...(row.solved_at !== null && row.solved_day !== null ? { solvedDay: row.solved_day } : {}),
    ...(row.runs_to_solve !== null ? { runsToSolve: row.runs_to_solve } : {}),
    ...(row.best_cost_usd !== null ? { bestCostUsd: row.best_cost_usd } : {}),
    ...(row.best_p99_ms !== null ? { bestP99Ms: row.best_p99_ms } : {}),
  };
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** GET /api/me */
export async function getMe(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const [rows, identities] = await DB.batch([
    DB.prepare(
      'SELECT problem_id, runs, source, solved_at, solved_day, runs_to_solve, best_cost_usd, best_p99_ms FROM progress WHERE user_id = ? ORDER BY problem_id',
    ).bind(user.id),
    DB.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').bind(user.id),
  ]);
  const progress: Record<string, ProgressEntry> = {};
  for (const row of rows.results as unknown as ProgressRow[]) progress[row.problem_id] = entryOf(row);
  return json({ user: { ...user, providers: (identities.results as { provider: string }[]).map((r) => r.provider) }, progress }, 200, NO_STORE);
}

/** PATCH /api/me {displayName?, publicProfile?, dailyGoal?} */
export async function updateMe(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request);
  let displayName = user.displayName;
  let publicProfile = user.publicProfile;
  let dailyGoal = user.dailyGoal;
  if (body.displayName !== undefined) {
    const name = typeof body.displayName === 'string' ? cleanName(body.displayName) : undefined;
    if (!name) throw new HttpError(400, 'displayName must be a non-empty string');
    // The current name stays allowed, e.g. the "Proschi user" given to an account whose provider name was refused.
    const refused = name !== user.displayName ? rejectName(name) : undefined;
    if (refused) throw new HttpError(400, refused);
    displayName = name;
  }
  if (body.publicProfile !== undefined) {
    if (typeof body.publicProfile !== 'boolean') throw new HttpError(400, 'publicProfile must be true or false');
    publicProfile = body.publicProfile;
  }
  if (body.dailyGoal !== undefined) {
    if (!isGoalChoice(body.dailyGoal)) throw new HttpError(400, `dailyGoal must be one of ${GOAL_CHOICES.join(', ')}`);
    dailyGoal = body.dailyGoal;
  }
  await ctx.env.DB.prepare('UPDATE users SET display_name = ?, public_profile = ?, daily_goal = ? WHERE id = ?')
    .bind(displayName, publicProfile ? 1 : 0, dailyGoal, user.id)
    .run();
  return json({ user: { id: user.id, displayName, publicProfile, dailyGoal } }, 200, NO_STORE);
}

/** DELETE /api/me: the account, its identities, sessions (apps' tokens and sign-in codes too), progress, card reviews and achievements (ON DELETE CASCADE). */
export async function deleteMe(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
  ctx.setCookies = [sessionCookie('', 0)];
  return new Response(null, { status: 204 });
}

/**
 * GET /api/me/export: everything stored about the user, as a JSON download.
 * Session tokens are stored only as hashes, and those stay out of it too.
 */
export async function exportMe(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const [account, identities, sessions, progress, cardReviews, cardStates, achievements] = await DB.batch([
    DB.prepare('SELECT created_at, daily_goal FROM users WHERE id = ?').bind(user.id),
    DB.prepare('SELECT provider, subject FROM identities WHERE user_id = ? ORDER BY provider').bind(user.id),
    DB.prepare('SELECT kind, created_at, expires_at, used_at FROM sessions WHERE user_id = ? ORDER BY created_at, rowid').bind(user.id),
    DB.prepare(
      `SELECT problem_id, runs, source, first_run_at, updated_at, solved_at, solved_day, runs_to_solve, best_cost_usd, best_p99_ms, sim_version, problem_version
       FROM progress WHERE user_id = ? ORDER BY problem_id`,
    ).bind(user.id),
    DB.prepare('SELECT id, card_id, card_version, rating, reviewed_at, duration_ms, day FROM card_reviews WHERE user_id = ? ORDER BY reviewed_at, id').bind(user.id),
    DB.prepare(
      'SELECT card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at FROM card_state WHERE user_id = ? ORDER BY card_id',
    ).bind(user.id),
    DB.prepare('SELECT achievement_id, earned_at, seen_at FROM achievements WHERE user_id = ? ORDER BY earned_at, achievement_id').bind(user.id),
  ]);
  type Row = Record<string, string | number | null>;
  const body = {
    exportedAt: now(),
    user: {
      id: user.id,
      displayName: user.displayName,
      publicProfile: user.publicProfile,
      dailyGoal: (account.results[0] as Row).daily_goal,
      createdAt: (account.results[0] as Row).created_at,
    },
    identities: (identities.results as Row[]).map((r) => ({ provider: r.provider, subject: r.subject })),
    // kind: web (the site's cookie), app_access or app_refresh (an app's tokens; rotatedAt once a refresh token was used).
    sessions: (sessions.results as Row[]).map((r) => ({
      kind: r.kind,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      ...(r.kind === 'app_refresh' ? { rotatedAt: r.used_at } : {}),
    })),
    progress: (progress.results as Row[]).map((r) => ({
      problemId: r.problem_id,
      runs: r.runs,
      source: r.source,
      firstRunAt: r.first_run_at,
      updatedAt: r.updated_at,
      solvedAt: r.solved_at,
      solvedDay: r.solved_day,
      runsToSolve: r.runs_to_solve,
      bestCostUsd: r.best_cost_usd,
      bestP99Ms: r.best_p99_ms,
      simVersion: r.sim_version,
      problemVersion: r.problem_version,
    })),
    cardReviews: (cardReviews.results as Row[]).map((r) => ({
      id: r.id,
      cardId: r.card_id,
      cardVersion: r.card_version,
      rating: r.rating,
      reviewedAt: r.reviewed_at,
      durationMs: r.duration_ms,
      day: r.day,
    })),
    cardStates: (cardStates.results as Row[]).map((r) => ({
      cardId: r.card_id,
      cardVersion: r.card_version,
      dueAt: r.due_at,
      stability: r.stability,
      difficulty: r.difficulty,
      reps: r.reps,
      lapses: r.lapses,
      lastReviewAt: r.last_review_at,
    })),
    achievements: (achievements.results as Row[]).map((r) => ({ achievementId: r.achievement_id, earnedAt: r.earned_at, seenAt: r.seen_at })),
  };
  return json(body, 200, { ...NO_STORE, 'Content-Disposition': 'attachment; filename="proschi-data.json"' });
}

/**
 * The upsert of one run of `source` on `problem`. Progress carries the
 * simulation's and the problem's version: a (not imported) run after either
 * changed starts the problem's runs, solve and best designs over, since they
 * were measured against what no longer exists. `day` (the user's local date)
 * is kept as the day of the first verified solve, for the streak; it is
 * history, so a version change does not reset it, and imported solves have
 * none.
 */
function upsertProgress(
  env: Env,
  userId: string,
  problem: Problem,
  source: string,
  verdict: Verdict | undefined,
  imported: boolean,
  day?: string,
): D1PreparedStatement {
  const solved = verdict?.solved === true;
  const t = now();
  const stale = '(NOT ?10 AND (sim_version <> excluded.sim_version OR problem_version <> excluded.problem_version))';
  return env.DB.prepare(
    `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms, sim_version, problem_version, solved_day)
     VALUES (?1, ?2, 1, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?11, ?12, ?13)
     ON CONFLICT (user_id, problem_id) DO UPDATE SET
       runs = CASE WHEN ${stale} THEN 1 ELSE runs + ?9 END,
       source = CASE WHEN ?10 THEN COALESCE(source, excluded.source) ELSE excluded.source END,
       first_run_at = CASE WHEN ${stale} THEN excluded.first_run_at ELSE first_run_at END,
       updated_at = excluded.updated_at,
       runs_to_solve = CASE WHEN ${stale} THEN excluded.runs_to_solve
         WHEN solved_at IS NULL AND excluded.solved_at IS NOT NULL AND NOT ?10 THEN runs + 1 ELSE runs_to_solve END,
       solved_at = CASE WHEN ${stale} THEN excluded.solved_at ELSE COALESCE(solved_at, excluded.solved_at) END,
       solved_day = CASE WHEN solved_at IS NULL THEN COALESCE(solved_day, excluded.solved_day) ELSE solved_day END,
       best_cost_usd = CASE WHEN ${stale} THEN excluded.best_cost_usd
         ELSE MIN(COALESCE(best_cost_usd, excluded.best_cost_usd), COALESCE(excluded.best_cost_usd, best_cost_usd)) END,
       best_p99_ms = CASE WHEN ${stale} THEN excluded.best_p99_ms
         ELSE MIN(COALESCE(best_p99_ms, excluded.best_p99_ms), COALESCE(excluded.best_p99_ms, best_p99_ms)) END,
       sim_version = CASE WHEN ${stale} THEN excluded.sim_version ELSE sim_version END,
       problem_version = CASE WHEN ${stale} THEN excluded.problem_version ELSE problem_version END
     RETURNING runs, source, solved_at, solved_day, runs_to_solve, best_cost_usd, best_p99_ms`,
  ).bind(
    userId,
    problem.id,
    source,
    t,
    solved ? t : null,
    solved && !imported ? 1 : null,
    solved ? (verdict.costUsd ?? null) : null,
    solved ? (verdict.p99Ms ?? null) : null,
    imported ? 0 : 1,
    imported ? 1 : 0,
    SIM_VERSION,
    problem.version ?? 1,
    solved && !imported ? (day ?? utcDay(t)) : null,
  );
}

/** The UTC date of a Unix time, YYYY-MM-DD. */
const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The client's local date of a run: `day` when it is within a day of the
 * server's UTC date (time zones run from UTC−12 to UTC+14), the UTC date
 * otherwise (no `day`, or a device clock far off). 400 when it is not a date.
 */
function runDay(day: unknown, t: number): string {
  if (day === undefined) return utcDay(t);
  if (!isDay(day)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
  return Math.abs(daysBetween(utcDay(t), day)) <= 1 ? day : utcDay(t);
}

/**
 * POST /api/problems/<id>/runs {source, solved, imported?, day?}: records a
 * test run of `source`. When the page says it solved the problem, the server
 * runs the tests itself and records the solve only if they all pass.
 * `imported` marks progress uploaded from the browser on first sign-in: it
 * does not count as a run, does not replace a design already stored, and its
 * solve is left out of the attempts-to-solve statistic and the streak. `day`
 * is the client's local date, kept as the day of the first solve.
 */
export async function recordRun(request: Request, ctx: Ctx, problemId: string): Promise<Response> {
  const user = await requireUser(request, ctx);
  const problem = findProblem(problemId);
  if (!problem) throw new HttpError(404, `No problem called ${problemId}`);
  const body = await readJson(request);
  if (typeof body.source !== 'string') throw new HttpError(400, 'source must be a string');
  if (body.source.length > MAX_SOURCE) throw new HttpError(413, 'source is too long');
  if (typeof body.solved !== 'boolean') throw new HttpError(400, 'solved must be true or false');
  const imported = body.imported === true;
  const day = runDay(body.day, now());

  await rateLimit(ctx.env.RUN_LIMITER, user.id, 'Too many test runs; wait a minute');

  const verdict: Verdict | undefined = body.solved ? verify(problem, body.source) : undefined;
  const row = await upsertProgress(ctx.env, user.id, problem, body.source, verdict, imported, day).first<Omit<ProgressRow, 'problem_id'>>();
  if (!row) throw new Error('progress upsert returned no row');
  return json({ progress: entryOf(row), ...(verdict ? { verdict } : {}) }, 200, NO_STORE);
}

/**
 * POST /api/me/import {items: [{problemId, source, solved}]}: the browser's
 * progress on first sign-in, in one request, imported as recordRun does with
 * `imported`. Unknown problems are skipped and listed in `skipped`.
 */
export async function importProgress(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const body = await readJson(request, MAX_IMPORT_BODY);
  const items = body.items;
  if (!Array.isArray(items)) throw new HttpError(400, 'items must be a list');
  if (items.length > problemIds().length) throw new HttpError(413, `At most ${problemIds().length} items`);
  const valid: { problemId: string; source: string; solved: boolean }[] = [];
  for (const item of items as Record<string, unknown>[]) {
    if (!item || typeof item.problemId !== 'string' || typeof item.source !== 'string' || typeof item.solved !== 'boolean') {
      throw new HttpError(400, 'Each item must be {problemId, source, solved}');
    }
    if (item.source.length > MAX_SOURCE) throw new HttpError(413, `The source for ${item.problemId} is too long`);
    valid.push({ problemId: item.problemId, source: item.source, solved: item.solved });
  }

  await rateLimit(ctx.env.IMPORT_LIMITER, user.id, 'Too many uploads; wait a minute');

  const statements: D1PreparedStatement[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const { problemId, source, solved } of valid) {
    const problem = findProblem(problemId);
    if (!problem || seen.has(problemId)) {
      skipped.push(problemId);
      continue;
    }
    seen.add(problemId);
    statements.push(upsertProgress(ctx.env, user.id, problem, source, solved ? verify(problem, source) : undefined, true));
  }
  if (statements.length) await ctx.env.DB.batch(statements);
  return json({ imported: statements.length, skipped }, 200, NO_STORE);
}
