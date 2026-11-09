import { requireUser } from './auth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { findProblem } from './verify';

/**
 * Known mistakes a failed run matched on a practice problem
 * (frontend/src/practice/mistakes.ts, migrations/0036_practice_mistakes.sql):
 * the browser keeps them (practice/hub/recentMistakes.ts) and, signed in,
 * sends them here, so "Your next steps" (learn/nextSteps.ts) offers "Retry
 * <problem>" on every device. One row per problem and mistake, the newest
 * MAX_KEPT_MISTAKES per account. Free on every plan.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
/** At most this many mistakes in one request. */
export const MAX_MISTAKES_PER_REQUEST = 50;
/** The newest this many are kept per account; older ones are dropped. */
export const MAX_KEPT_MISTAKES = 100;
/** A mistake may be dated at most this far ahead of the server's clock (seconds). */
const MAX_CLOCK_SKEW = 300;
/** Mistakes before this (2026-01-01) are refused: no client made them. */
const EARLIEST = 1_767_225_600;
const MISTAKE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_TITLE = 200;

interface IncomingMistake {
  problem: string;
  id: string;
  title: string;
  at: number;
}

function readMistake(raw: unknown, latest: number): IncomingMistake | undefined {
  const m = raw as Partial<IncomingMistake> | null;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  if (typeof m.problem !== 'string' || m.problem.length > 100) return undefined;
  if (typeof m.id !== 'string' || !MISTAKE_ID.test(m.id)) return undefined;
  if (typeof m.title !== 'string' || m.title.trim() === '' || m.title.length > MAX_TITLE) return undefined;
  if (!Number.isInteger(m.at) || (m.at as number) < EARLIEST || (m.at as number) > latest) return undefined;
  return { problem: m.problem, id: m.id, title: m.title, at: m.at as number };
}

/**
 * POST /api/me/mistakes {mistakes: [{problem, id, title, at}]}: keeps up to
 * 50 mistakes; one kept already is updated only when this one is newer, one
 * of a problem or wrong design this Worker does not have is skipped. Then
 * only the newest 100 of the account stay. Answers `{stored}`.
 */
export async function postMistakes(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const body = await readJson(request);
  const raw = body.mistakes;
  const latest = now() + MAX_CLOCK_SKEW;
  const mistakes = Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_MISTAKES_PER_REQUEST ? raw.map((m) => readMistake(m, latest)) : [];
  if (mistakes.length === 0 || mistakes.some((m) => m === undefined)) {
    throw new HttpError(400, `mistakes must be a list of 1 to ${MAX_MISTAKES_PER_REQUEST} {problem, id, title, at}`);
  }
  await rateLimit(ctx.env.STATS_LIMITER, `mistakes:${user.id}`, 'Too many requests; wait a minute');
  const known = (mistakes as IncomingMistake[]).filter((m) => findProblem(m.problem)?.wrong?.some((w) => w.name === m.id));
  if (known.length === 0) return json({ stored: 0 }, 200, NO_STORE);
  const { DB } = ctx.env;
  const [upsert] = await DB.batch([
    DB.prepare(
      `INSERT INTO practice_mistakes (user_id, problem_id, mistake_id, title, at)
       SELECT ?1, json_extract(value, '$.problem'), json_extract(value, '$.id'), json_extract(value, '$.title'), json_extract(value, '$.at')
       FROM json_each(?2) WHERE true
       ON CONFLICT (user_id, problem_id, mistake_id) DO UPDATE SET title = excluded.title, at = excluded.at WHERE excluded.at > practice_mistakes.at`,
    ).bind(user.id, JSON.stringify(known)),
    DB.prepare(
      `DELETE FROM practice_mistakes WHERE user_id = ?1 AND rowid NOT IN (
         SELECT rowid FROM practice_mistakes WHERE user_id = ?1 ORDER BY at DESC, problem_id, mistake_id LIMIT ?2)`,
    ).bind(user.id, MAX_KEPT_MISTAKES),
  ]);
  return json({ stored: upsert.meta.changes ?? 0 }, 200, NO_STORE);
}

interface MistakeRow {
  problem_id: string;
  mistake_id: string;
  title: string;
  at: number;
}

const toMistake = (r: MistakeRow) => ({ problem: r.problem_id, id: r.mistake_id, title: r.title, at: r.at });

/** GET /api/me/mistakes: the account's mistakes, newest first. */
export async function getMistakes(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.STATS_LIMITER, `mistakes:${user.id}`, 'Too many requests; wait a minute');
  const rows = await ctx.env.DB.prepare('SELECT problem_id, mistake_id, title, at FROM practice_mistakes WHERE user_id = ? ORDER BY at DESC, problem_id, mistake_id LIMIT ?')
    .bind(user.id, MAX_KEPT_MISTAKES)
    .all<MistakeRow>();
  return json({ mistakes: rows.results.map(toMistake) }, 200, NO_STORE);
}

/** The mistakes in "Download my data", oldest first. */
export async function exportMistakes(DB: D1Database, userId: string): Promise<{ problem: string; id: string; title: string; at: number }[]> {
  const rows = await DB.prepare('SELECT problem_id, mistake_id, title, at FROM practice_mistakes WHERE user_id = ? ORDER BY at, problem_id, mistake_id').bind(userId).all<MistakeRow>();
  return rows.results.map(toMistake);
}
