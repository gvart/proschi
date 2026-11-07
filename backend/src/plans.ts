/**
 * What an account may keep and use, per plan (`users.plan`, backend/README.md
 * "Plans and limits"; docs/design/paid-plans.md P1, P26). The signed Polar
 * webhook (src/billing.ts) moves an account between `free`, `pro` and `max`;
 * this is the one place a plan's numbers live.
 */

/** The plans an account can be on (`users.plan`); src/features.ts says which get each paid feature. */
export type Plan = 'free' | 'pro' | 'max';

/** Millicredits in one credit: amounts are stored and charged in thousandths (P26). */
export const MC = 1000;

/** Sign-up credits, once per account and identity, on any plan (src/credits.ts grantSignupCredits). */
export const SIGNUP_CREDITS = 100;

export interface Limits {
  /** Live (not deleted) synced diagrams (src/documents.ts). */
  documents: number;
  /** Live (not deleted) versions of one diagram (src/versions.ts). */
  versionsPerDocument: number;
  /** A diagram's source plus its imports (as JSON), in characters. */
  documentBytes: number;
  /** Credits a UTC calendar month (src/credits.ts); they don't roll over. */
  monthlyCredits: number;
}

export const FREE_LIMITS: Readonly<Limits> = Object.freeze({ documents: 5, versionsPerDocument: 20, documentBytes: 64 * 1024, monthlyCredits: 0 });

/**
 * Pro: "unlimited" diagrams and versions are fair-use caps no one designing
 * by hand reaches, so a runaway script can't fill D1. A diagram is at most
 * 512 KiB: with imports as JSON it stays under D1's 2 MB row even in UTF-8.
 */
export const PRO_LIMITS: Readonly<Limits> = Object.freeze({ documents: 1000, versionsPerDocument: 1000, documentBytes: 512 * 1024, monthlyCredits: 800 });

/** Max: Pro's caps with more credits a month (P26). */
export const MAX_LIMITS: Readonly<Limits> = Object.freeze({ ...PRO_LIMITS, monthlyCredits: 2200 });

/** At or past this many, a limit is shown as unlimited (the Pro caps above). */
export const UNLIMITED = 1000;

/** Every plan by its `users.plan` value. Exported for the tests, which add one to check a plan's limits apply. */
export const PLANS: Record<string, Readonly<Limits>> = { free: FREE_LIMITS, pro: PRO_LIMITS, max: MAX_LIMITS };

/** The plan's limits; an unknown plan gets the free plan's. */
export function limitsFor(plan: string | null | undefined): Readonly<Limits> {
  return (plan && Object.prototype.hasOwnProperty.call(PLANS, plan) ? PLANS[plan] : undefined) ?? FREE_LIMITS;
}

/** The plan as the API reports it: an unknown one is reported as free, since that is what it gets. */
export function planName(plan: string | null | undefined): string {
  return plan && Object.prototype.hasOwnProperty.call(PLANS, plan) ? plan : 'free';
}

/**
 * The plan an account gets now: the one place a comp counts
 * (docs/design/paid-plans.md P24). Pro while the subscription keeps
 * `users.plan` on 'pro' (src/billing.ts) OR while the admin's comp
 * (`users.comp_until`, Unix seconds) is in the future; else `users.plan`.
 * A comp never lowers a plan: Max with a comp stays Max.
 * src/auth.ts reads it into `User.plan` on every request, so can() and
 * limitsFor see it; src/credits.ts reads it for the monthly allowance.
 */
export function effectivePlan(plan: string | null | undefined, compUntil: number | null | undefined, at = Math.floor(Date.now() / 1000)): string {
  return compUntil != null && compUntil > at && plan !== 'max' ? 'pro' : (plan ?? 'free');
}

/** effectivePlan as SQL over the users row `u`, `at` the parameter that holds now in Unix seconds (e.g. '?2'), for a query that checks the plan itself. */
export const effectivePlanSql = (u: string, at: string): string => `(CASE WHEN ${u}.comp_until > ${at} AND ${u}.plan <> 'max' THEN 'pro' ELSE ${u}.plan END)`;
