import { MAX_REVIEW_BODY, reviewRequestProblem, SOURCE_TOO_LONG, type DesignReviewRequest, type ReviewUsage } from '../../frontend/src/review/contract';
import { AiError, aiEnabled, createClient } from './ai/client';
import { problemContext } from './ai/context';
import { aiReview, serverReviewRequest } from './ai/reviewer';
import type { User } from './auth';
import type { Ctx } from './context';
import type { Env } from './env';
import { requireFeature } from './features';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { refreshAfterReview } from './roadmap';
import { findProblem } from './verify';

/**
 * POST /api/review: an AI review of a design (backend/README.md, "Design
 * review"; docs/design/paid-plans.md P17). Pro only, at most
 * REVIEWS_PER_DAY a UTC day per user, counted in D1 (migration 0020). The
 * body is checked against the contract the page builds it from
 * (frontend/src/review/contract.ts), but only its source, problem id and,
 * for an editor diagram, the files it imports are used: the server parses, simulates and tests the design itself (P6,
 * src/ai/reviewer.ts). Without ANTHROPIC_API_KEY it answers 501 and the page
 * uses its rule reviewer (P10). The source is never logged.
 *
 * GET /api/review/usage: the signed-in Pro user's reviews today.
 *
 * A review also refreshes the AI roadmap's next steps when they are a day old
 * or missing (src/roadmap.ts), after the answer is sent.
 */

/** Pro's AI design reviews per UTC day (P17). */
export const REVIEWS_PER_DAY = 20;

const NO_STORE = { 'Cache-Control': 'no-store' };
const DAY_MS = 86_400_000;

const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
/** The next UTC midnight, in Unix milliseconds: when the count starts again. */
const resetAt = (at: number) => (Math.floor(at / DAY_MS) + 1) * DAY_MS;

const usageOf = (used: number, at: number): ReviewUsage => ({ limit: REVIEWS_PER_DAY, used, remaining: Math.max(0, REVIEWS_PER_DAY - used), resetAt: resetAt(at) });

/** Counts one review if today's count is under the cap; the new count, or undefined at the cap. One statement, so concurrent reviews cannot pass it. */
export async function takeReview(DB: D1Database, userId: string, at = Date.now(), cap = REVIEWS_PER_DAY): Promise<number | undefined> {
  const row = await DB.prepare(
    `INSERT INTO review_usage (user_id, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ?3
     RETURNING count`,
  )
    .bind(userId, utcDay(at), cap)
    .first<{ count: number }>();
  return row?.count;
}

/** Gives back a review whose model call failed. */
async function giveBack(DB: D1Database, userId: string, at: number): Promise<void> {
  await DB.prepare('UPDATE review_usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0').bind(userId, utcDay(at)).run();
}

async function usedToday(DB: D1Database, userId: string, at: number): Promise<number> {
  const row = await DB.prepare('SELECT count FROM review_usage WHERE user_id = ? AND day = ?').bind(userId, utcDay(at)).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function reviewDesign(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.REVIEW_LIMITER, ctx.ip, 'Too many reviews; wait a minute');
  const body = await readJson(request, MAX_REVIEW_BODY);
  const problem = reviewRequestProblem(body);
  if (problem) throw new HttpError(problem === SOURCE_TOO_LONG ? 413 : 400, problem);
  const page = body as unknown as DesignReviewRequest;
  if (!aiEnabled(env)) return json({ error: 'not_implemented' }, 501, NO_STORE);
  return reviewFor(request, ctx, page);
}

/** The review itself, past the body and the key: 401 signed out, 402 off a plan with ai_review (src/features.ts). */
const reviewFor = requireFeature('ai_review', async (_request: Request, ctx: Ctx, user: User, page: DesignReviewRequest): Promise<Response> => {
  const { env } = ctx;
  await rateLimit(env.AI_REVIEW_LIMITER, user.id, 'Too many reviews; wait a minute');
  const solved = page.problem ? findProblem(page.problem.id) : undefined;
  if (page.problem && !solved) throw new HttpError(404, 'Unknown problem');

  const at = Date.now();
  const used = await takeReview(env.DB, user.id, at);
  if (used === undefined) {
    const reset = resetAt(at);
    return json(
      { error: 'daily_limit', message: `You have used today's ${REVIEWS_PER_DAY} AI reviews`, usage: usageOf(REVIEWS_PER_DAY, at) },
      429,
      { ...NO_STORE, 'Retry-After': String(Math.ceil((reset - at) / 1000)) },
    );
  }

  try {
    const req = serverReviewRequest(page.source, solved, { path: page.path, imports: page.imports });
    const { review, usage } = await aiReview(createClient(env), req, solved ? problemContext(solved.id) : undefined);
    // The AI roadmap's next steps, at most once a day from a review (src/roadmap.ts); after the answer, and never failing it.
    ctx.exec.waitUntil(refreshAfterReview(env, user, solved?.id, review, ctx.requestId).catch((e: unknown) => log('warn', 'roadmap.failed', { requestId: ctx.requestId, error: errorText(e) })));
    log('info', 'review.done', { requestId: ctx.requestId, userId: user.id, problem: solved?.id, tokens: usage.reduce((n, u) => n + u.input_tokens + u.output_tokens + u.cache_creation_input_tokens, 0) });
    return json({ ...review, usage: usageOf(used, at) }, 200, NO_STORE);
  } catch (e) {
    await giveBack(env.DB, user.id, at);
    if (!(e instanceof AiError)) throw e;
    log('error', 'review.failed', { requestId: ctx.requestId, userId: user.id, kind: e.kind, error: errorText(e) });
    // Busy or unreachable: worth trying again (503, the page offers the rule review meanwhile); anything else failed outright.
    return e.retryable
      ? json({ error: 'ai_unavailable', message: 'The AI reviewer is busy; try again in a minute' }, 503, NO_STORE)
      : json({ error: 'review_failed', message: 'The AI review failed; try again' }, 502, NO_STORE);
  }
});

/** GET /api/review/usage: {limit, used, remaining, resetAt} for a Pro user; 402 off Pro, 501 without the key. */
export async function getReviewUsage(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  if (!aiEnabled(env)) return json({ error: 'not_implemented' }, 501, NO_STORE);
  return usageFor(request, ctx);
}

const usageFor = requireFeature('ai_review', async (_request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const at = Date.now();
  return json(usageOf(await usedToday(ctx.env.DB, user.id, at), at), 200, NO_STORE);
});

/** Days of review_usage kept: the cap only needs today; a week is enough to look back on. */
export const REVIEW_USAGE_DAYS = 7;

/** Deletes review_usage rows older than REVIEW_USAGE_DAYS; returns how many. For the daily cron. */
export async function pruneReviewUsage(env: Pick<Env, 'DB'>, at = Date.now()): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM review_usage WHERE day < ?').bind(utcDay(at - REVIEW_USAGE_DAYS * DAY_MS)).run();
  return meta.changes;
}

/** Download my data: AI reviews asked for, per UTC day. */
export async function exportReviewUsage(DB: D1Database, userId: string): Promise<{ day: string; count: number }[]> {
  return (await DB.prepare('SELECT day, count FROM review_usage WHERE user_id = ? ORDER BY day').bind(userId).all<{ day: string; count: number }>()).results;
}
