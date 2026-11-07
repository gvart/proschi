import { PRICES, type PlanInfo, type Product } from '../services/billing';

/**
 * Back from Polar's checkout (backend/src/billing.ts success_url:
 * `?checkout=done&product=…&checkout_id=…#/me`). The plan changes only when
 * Polar's webhook arrives, so the account page asks GET /api/me/plan on a
 * schedule until it shows the purchase. The URL's product is only for the
 * message; what the account has comes from the API. Pure: the clock and the
 * fetching are the caller's (profile/PlanBilling.tsx).
 */

export interface CheckoutReturn {
  product: Product | null;
  /** Polar's checkout session id, for support. */
  checkoutId: string | null;
}

const PARAMS = ['checkout', 'product', 'checkout_id'];
const PRODUCTS: readonly string[] = ['pro_monthly', 'pro_yearly', 'pack_5'];

/** The return from a paid checkout in `href`, or null (no `checkout=done`: a normal visit, or Polar's back button to the pricing page). */
export function readCheckoutReturn(href: string): CheckoutReturn | null {
  const params = new URL(href).searchParams;
  if (params.get('checkout') !== 'done') return null;
  const product = params.get('product');
  const id = params.get('checkout_id');
  return {
    product: product && PRODUCTS.includes(product) ? (product as Product) : null,
    // Polar fills in {CHECKOUT_ID}; left as is, there is no id.
    checkoutId: id && !id.startsWith('{') ? id : null,
  };
}

/** `href` without the checkout's parameters, so a reload doesn't show the message again. */
export function withoutCheckoutReturn(href: string): string {
  const url = new URL(href);
  for (const p of PARAMS) url.searchParams.delete(p);
  return url.toString();
}

/** When to ask, in ms since the return: fast at first, then every 30 s up to 10 minutes. */
const FAST_POLLS = [1000, 2000, 4000, 8000, 15000, 30000, 60000];
export const SLOW_AFTER = 60_000;
const SLOW_EVERY = 30_000;
const GIVE_UP = 10 * 60_000;

export type Phase = 'activating' | 'slow' | 'done';

export interface ReturnState {
  kind: 'pro' | 'pack';
  phase: Phase;
  startedAt: number;
  /** Pack credits at the first answer; a pack shows once they go up. */
  baseline?: number;
  /** Done: the interviews the purchase gives (Pro's a month, or the pack's). */
  interviews?: number;
}

export function startReturn(ret: CheckoutReturn, now: number): ReturnState {
  return { kind: ret.product === 'pack_5' ? 'pack' : 'pro', phase: 'activating', startedAt: now };
}

const PAID = ['active', 'trialing'];

/** An answer from GET /api/me/plan. */
export function onPlan(s: ReturnState, plan: PlanInfo): ReturnState {
  if (s.phase === 'done') return s;
  if (s.kind === 'pro') {
    // A subscription, not Pro from an admin's comp alone.
    const pro = plan.plan === 'pro' && PAID.includes(plan.subscription?.status ?? '');
    return pro ? { ...s, phase: 'done', interviews: plan.limits.interviewsPerMonth } : s;
  }
  if (s.baseline === undefined) return { ...s, baseline: plan.credits.pack };
  return plan.credits.pack > s.baseline ? { ...s, phase: 'done', interviews: plan.credits.pack - s.baseline } : s;
}

/** The clock moved: still activating after SLOW_AFTER is slow. */
export function onTick(s: ReturnState, now: number): ReturnState {
  return s.phase === 'activating' && now - s.startedAt >= SLOW_AFTER ? { ...s, phase: 'slow' } : s;
}

/** Ms until the next scheduled ask, or null when done or after 10 minutes. */
export function nextPollIn(s: ReturnState, now: number): number | null {
  if (s.phase === 'done') return null;
  const elapsed = now - s.startedAt;
  const fast = FAST_POLLS.find((t) => t > elapsed);
  if (fast !== undefined) return fast - elapsed;
  const next = SLOW_AFTER + Math.floor((elapsed - SLOW_AFTER) / SLOW_EVERY + 1) * SLOW_EVERY;
  return next <= GIVE_UP ? next - elapsed : null;
}

/** The banner's text. */
export function returnMessage(s: ReturnState): string {
  if (s.phase === 'done') {
    if (s.kind === 'pack') return `${s.interviews} interviews added.`;
    return `You're on Pro: ${s.interviews} AI interviews this month.`;
  }
  if (s.phase === 'slow') {
    return "Polar hasn't confirmed the payment yet. It usually takes a few seconds; this page updates when it does. If it doesn't within a few minutes, contact support.";
  }
  return s.kind === 'pack' ? `Payment received. Adding ${PRICES.packInterviews} interviews…` : 'Payment received. Activating Pro…';
}
