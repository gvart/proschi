import { FEATURE_IDS, type FeatureAccess, type FeatureId } from '../../frontend/src/services/featureContract';
import { requireUser, type User } from './auth';
import { billingConfigured } from './billing';
import type { Ctx } from './context';
import type { Env } from './env';
import { json } from './http';
import { planName, type Plan } from './plans';

export type { FeatureAccess, FeatureId, FeatureReason } from '../../frontend/src/services/featureContract';

/**
 * Which plans get each paid feature (docs/design/paid-plans.md P1, P22, P26;
 * backend/README.md "Adding a paid feature"): the one place a route asks
 * whether an account may use something. How much of it (diagrams, interview
 * credits) is a number in src/plans.ts; whether the server can run it at all
 * (ANTHROPIC_API_KEY, 501) is the route's own check, made before this one.
 * The ids are shared with the page (frontend/src/services/featureContract.ts),
 * which reads the answers from GET /api/me/plan.
 */
export const FEATURES: Readonly<Record<FeatureId, { plans: readonly Plan[]; description: string }>> = {
  ai_interview: { plans: ['free', 'pro', 'max'], description: 'Mock interviews are on every plan; the credits decide how many' },
  /** Deprecated: design_partner replaces it (P29); POST /api/review now needs design_partner. Kept while the page reads it. */
  ai_review: { plans: ['pro', 'max'], description: 'The in-depth review is part of Pro' },
  interview_history: { plans: ['pro', 'max'], description: 'Every mock interview verdict and the trend per skill are part of Pro; other plans see the latest verdict' },
  ai_roadmap: { plans: ['pro', 'max'], description: 'Your next steps are part of Pro' },
  share_links: { plans: ['pro', 'max'], description: 'Live share links are part of Pro' },
  design_partner: { plans: ['free', 'pro', 'max'], description: 'Design partner is for every signed-in account; the credits decide how much' },
  deep_mode: { plans: ['max'], description: 'Deep mode is part of Max' },
  interview_report: { plans: ['max'], description: 'The printable interview report is part of Max' },
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

/** A route handler over its path's `*` parts. */
export type Route<A extends unknown[] = string[]> = (request: Request, ctx: Ctx, ...args: A) => Promise<Response>;

/** A route made by requireFeature, which says the feature it needs; src/index.ts dispatches the paid paths only to these and to openRoute's. */
export type FeatureRoute<A extends unknown[] = string[]> = Route<A> & { readonly feature: FeatureId };

/** A route under a paid path that is open on purpose, with why (say, revoking a share link after a downgrade). */
export type OpenRoute<A extends unknown[] = string[]> = Route<A> & { readonly open: string };

/**
 * A route that needs `feature`, the only way into one (backend/README.md
 * "Adding a paid feature"): `before` first, if given (what must answer
 * before sign-in: a 501 without the AI key, a bad body), then 401 signed out
 * (requireUser, which reads the account and its plan from D1 on every
 * request, whatever the credential: cookie or app/CLI token), then 402
 * `{error: 'plan_required', feature}` off a plan that has it, else `handler`
 * with the user and what `before` returned. A Response from `before` is
 * answered as is.
 */
export function requireFeature<P = undefined, A extends unknown[] = []>(
  feature: FeatureId,
  handler: (request: Request, ctx: Ctx, user: User, pre: P, ...args: A) => Promise<Response>,
  before?: (request: Request, ctx: Ctx, ...args: A) => Promise<P | Response> | P | Response,
): FeatureRoute<A> {
  const route = async (request: Request, ctx: Ctx, ...args: A): Promise<Response> => {
    const pre = before ? await before(request, ctx, ...args) : (undefined as P);
    if (pre instanceof Response) return pre;
    const user = await requireUser(request, ctx);
    return can(user, feature, ctx.env).ok ? handler(request, ctx, user, pre, ...args) : planRequired(feature);
  };
  return Object.assign(route, { feature });
}

/** Marks a route under a paid path as open on purpose: `why` is for the reader and the route table's test. */
export function openRoute<A extends unknown[]>(why: string, route: Route<A>): OpenRoute<A> {
  return Object.assign(route, { open: why });
}
