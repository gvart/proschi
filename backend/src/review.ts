import { MAX_REVIEW_BODY, reviewRequestProblem, SOURCE_TOO_LONG, type DesignReviewRequest, type ReviewUsage } from '../../frontend/src/review/contract';
import { AiError, aiEnabled, createClient, SONNET } from './ai/client';
import { problemContext } from './ai/context';
import { aiReview, serverReviewRequest } from './ai/reviewer';
import type { User } from './auth';
import type { Ctx } from './context';
import { credits, nextPeriodAt } from './credits';
import { requireFeature } from './features';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { balanceMc, estimateMc, hold, noCredits, release, settle } from './meter';
import { refreshAfterReview } from './roadmap';
import { findProblem } from './verify';

/**
 * POST /api/review: an in-depth review of a design (backend/README.md,
 * "Design review"; docs/design/paid-plans.md P17, P26, P27). Behind the
 * design_partner feature, which replaces it (P29): anyone signed in, paid
 * in credits (src/meter.ts), with no daily cap. Its worst case is held
 * before the model is called (402 no_credits when the balance can't cover
 * it), its real cost charged after, and a failed review is charged nothing;
 * when the first answer didn't validate and was asked for again, only the
 * second is charged. The body is checked against the contract the page
 * builds it from (frontend/src/review/contract.ts), but only its source,
 * problem id and, for an editor diagram, the files it imports are used: the
 * server parses, simulates and tests the design itself (P6,
 * src/ai/reviewer.ts). Without ANTHROPIC_API_KEY it answers 501 and the page
 * uses its rule reviewer (P10). The source is never logged.
 *
 * GET /api/review/usage: how many reviews the balance covers now, in the
 * old {limit, used, remaining, resetAt} shape the page still reads.
 *
 * A review also refreshes the AI roadmap's next steps when they are a day old
 * or missing (src/roadmap.ts), after the answer is sent.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
/** The reviewer's max_tokens (src/ai/reviewer.ts). */
const REVIEW_MAX_OUTPUT = 16_000;
/** The system prompt and a problem's context, roughly, in tokens. */
const REVIEW_BASE_INPUT = 12_000;

/** What a review of `page` holds: Sonnet's worst case with its input guessed from the characters sent (about 3 a token). */
function reviewHoldMc(ctx: Ctx, page: Pick<DesignReviewRequest, 'source' | 'imports'>): number {
  const chars = page.source.length + Object.values(page.imports ?? {}).reduce((n, s) => n + s.length, 0);
  return estimateMc(SONNET, REVIEW_MAX_OUTPUT, REVIEW_BASE_INPUT + Math.ceil(chars / 3), ctx.env);
}

/** Before sign-in is read: the per-IP limit, the body (400, 413), then 501 without the key. */
async function reviewBody(request: Request, ctx: Ctx): Promise<DesignReviewRequest | Response> {
  await rateLimit(ctx.env.REVIEW_LIMITER, ctx.ip, 'Too many reviews; wait a minute');
  const body = await readJson(request, MAX_REVIEW_BODY);
  const problem = reviewRequestProblem(body);
  if (problem) throw new HttpError(problem === SOURCE_TOO_LONG ? 413 : 400, problem);
  if (!aiEnabled(ctx.env)) return json({ error: 'not_implemented' }, 501, NO_STORE);
  return body as unknown as DesignReviewRequest;
}

/** POST /api/review: the design_partner feature (src/features.ts), 401 signed out, 402 no_credits without enough credits. */
export const reviewDesign = requireFeature('design_partner', async (_request: Request, ctx: Ctx, user: User, page: DesignReviewRequest): Promise<Response> => {
  const { env } = ctx;
  await rateLimit(env.AI_REVIEW_LIMITER, user.id, 'Too many reviews; wait a minute');
  const solved = page.problem ? findProblem(page.problem.id) : undefined;
  if (page.problem && !solved) throw new HttpError(404, 'Unknown problem');

  const held = await hold(env, user.id, reviewHoldMc(ctx, page), `review:${crypto.randomUUID()}`);
  if (!held.ok) return noCredits(held.neededMc, held.balanceMc);

  try {
    const req = serverReviewRequest(page.source, solved, { path: page.path, imports: page.imports });
    const { review, usage } = await aiReview(createClient(env), req, solved ? problemContext(solved.id) : undefined);
    // Only the answer that validated is charged (P27): a malformed first one was the reviewer's retry.
    const charged = await settle(env, held.holdId, usage.slice(-1).map((u) => ({ model: SONNET, ...u })), 'design_partner', false);
    // The AI roadmap's next steps, at most once a day from a review (src/roadmap.ts); after the answer, and never failing it.
    ctx.exec.waitUntil(refreshAfterReview(env, user, solved?.id, review, ctx.requestId).catch((e: unknown) => log('warn', 'roadmap.failed', { requestId: ctx.requestId, error: errorText(e) })));
    log('info', 'review.done', { requestId: ctx.requestId, userId: user.id, problem: solved?.id, chargedMc: charged.chargedMc });
    return json({ ...review, credits: { charged: credits(charged.chargedMc), balance: credits(charged.balanceMc) } }, 200, NO_STORE);
  } catch (e) {
    await release(env, held.holdId);
    if (!(e instanceof AiError)) throw e;
    log('error', 'review.failed', { requestId: ctx.requestId, userId: user.id, kind: e.kind, error: errorText(e) });
    // Busy or unreachable: worth trying again (503, the page offers the rule review meanwhile); anything else failed outright.
    return e.retryable
      ? json({ error: 'ai_unavailable', message: 'The in-depth review is busy; try again in a minute' }, 503, NO_STORE)
      : json({ error: 'review_failed', message: 'The in-depth review failed; try again' }, 502, NO_STORE);
  }
}, reviewBody);

/** 501 without ANTHROPIC_API_KEY, before sign-in is read. */
const notImplemented = (_request: Request, ctx: Ctx): Response | undefined => (aiEnabled(ctx.env) ? undefined : json({ error: 'not_implemented' }, 501, NO_STORE));

/**
 * GET /api/review/usage: {limit, used, remaining, resetAt} as before the
 * credits, for the page that still reads it: `remaining` (and `limit`) is
 * how many reviews of a typical editor diagram the balance can hold now,
 * `resetAt` when the monthly allowance comes again. 501 without the key.
 */
export const getReviewUsage = requireFeature(
  'design_partner',
  async (_request: Request, ctx: Ctx, user: User): Promise<Response> => {
    const at = Date.now();
    const remaining = Math.floor((await balanceMc(ctx.env, user.id)) / reviewHoldMc(ctx, { source: 'x'.repeat(4096) }));
    const usage: ReviewUsage = { limit: remaining, used: 0, remaining, resetAt: nextPeriodAt(at) };
    return json(usage, 200, NO_STORE);
  },
  notImplemented,
);
