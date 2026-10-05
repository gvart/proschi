import { MAX_REVIEW_BODY, reviewRequestProblem, SOURCE_TOO_LONG } from '../../frontend/src/review/contract';
import type { Ctx } from './context';
import { HttpError, json, rateLimit, readJson } from './http';

/**
 * POST /api/review: an AI review of a design (backend/README.md, "Design
 * review"). A stub: it checks the body against the contract the page builds
 * it from (frontend/src/review/contract.ts) and answers 501 until an LLM is
 * wired in. No sign-in needed; limited per IP, since each real review will
 * cost an LLM call.
 */
export async function reviewDesign(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.REVIEW_LIMITER, ctx.ip, 'Too many reviews; wait a minute');
  const body = await readJson(request, MAX_REVIEW_BODY);
  const problem = reviewRequestProblem(body);
  if (problem) throw new HttpError(problem === SOURCE_TOO_LONG ? 413 : 400, problem);

  // `body` is now a DesignReviewRequest.
  // TODO(ai-review): call the LLM here and answer 200 with a DesignReview
  // ({summary, strengths, issues: [{severity, title, detail, nodeId?}],
  // suggestions}), checked with parseDesignReview from the same contract
  // before it is sent. The call will need an API key: add it to Env
  // (src/env.ts) as an optional secret, set with `npx wrangler secret put`
  // (wrangler.jsonc lists the secrets), keep answering 501 while it is unset,
  // and never log the request's source. `body.problem` names the practice
  // problem, when there is one; findProblem (src/verify.ts) gives its
  // statement for the prompt.
  return json({ error: 'not_implemented' }, 501, { 'Cache-Control': 'no-store' });
}
