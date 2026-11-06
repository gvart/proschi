import { FEATURE_IDS, type FeatureAccess, type FeatureId } from '../../frontend/src/services/featureContract';
import { requireUser, type User } from './auth';
import { billingConfigured } from './billing';
import type { Ctx } from './context';
import type { Env } from './env';
import { json } from './http';
import { planName, type Plan } from './plans';

export type { FeatureAccess, FeatureId, FeatureReason } from '../../frontend/src/services/featureContract';

/**
 * Which plans get each paid feature (docs/design/paid-plans.md P1, P22;
 * backend/README.md "Adding a paid feature"): the one place a route asks
 * whether an account may use something. How much of it (diagrams, interview
 * credits) is a number in src/plans.ts; whether the server can run it at all
 * (ANTHROPIC_API_KEY, 501) is the route's own check, made before this one.
 * The ids are shared with the page (frontend/src/services/featureContract.ts),
 * which reads the answers from GET /api/me/plan.
 */
export const FEATURES: Readonly<Record<FeatureId, { plans: readonly Plan[]; description: string }>> = {
  ai_interview: { plans: ['free', 'pro'], description: 'AI mock interviews are on every plan; the credits decide how many' },
  ai_review: { plans: ['pro'], description: 'AI design review is part of Pro' },
  interview_history: { plans: ['pro'], description: 'Every AI verdict and the trend per skill are part of Pro; other plans see the latest verdict' },
  ai_roadmap: { plans: ['pro'], description: 'AI next steps are part of Pro' },
  share_links: { plans: ['pro'], description: 'Live share links are part of Pro' },
};

/**
 * Whether `user` may use `feature`. An unknown plan counts as free
 * (src/plans.ts planName).
 *
 * `billing_off` only names why: the account's plan lacks the feature and
 * this server has no Polar secrets (src/billing.ts billingConfigured), so no
 * plan can be bought here. It refuses exactly what `needs_pro` refuses, and
 * an account on Pro (set by hand, say) keeps its features with billing off:
 * the routes decided by plan alone before this registry, and still do.
 */
export function can(user: Pick<User, 'plan'> | null, feature: FeatureId, env: Env): FeatureAccess {
  if (!user) return { ok: false, reason: 'signed_out' };
  if (FEATURES[feature].plans.includes(planName(user.plan) as Plan)) return { ok: true };
  return { ok: false, reason: billingConfigured(env) ? 'needs_pro' : 'billing_off' };
}

/** Every feature's answer for `user`, for GET /api/me/plan. */
export function featureMap(user: Pick<User, 'plan'>, env: Env): Record<FeatureId, FeatureAccess> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, can(user, id, env)])) as Record<FeatureId, FeatureAccess>;
}

/** The 402 a signed-in account gets for a feature its plan lacks. */
export const planRequired = (feature: FeatureId): Response =>
  json({ error: 'plan_required', feature, message: FEATURES[feature].description }, 402, { 'Cache-Control': 'no-store' });

/**
 * A route that needs `feature`: 401 signed out (requireUser's answer), 402
 * `{error: 'plan_required', feature}` off a plan that has it, else `handler`
 * with the user. Checks that must come first (a 501 without the AI key, the
 * body) go around it.
 */
export function requireFeature<A extends unknown[]>(
  feature: FeatureId,
  handler: (request: Request, ctx: Ctx, user: User, ...args: A) => Promise<Response>,
): (request: Request, ctx: Ctx, ...args: A) => Promise<Response> {
  return async (request, ctx, ...args) => {
    const user = await requireUser(request, ctx);
    return can(user, feature, ctx.env).ok ? handler(request, ctx, user, ...args) : planRequired(feature);
  };
}
