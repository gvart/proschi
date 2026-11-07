import { api, apiEnabled } from './api';
import type { FeatureAccess, FeatureId } from './featureContract';

/**
 * The plans and credits (backend/src/billing.ts, docs/design/paid-plans.md
 * P2, P10, P26). Polar hosts the checkout and the billing portal; the page
 * only asks the API for their addresses and sends the browser there. Off,
 * and every billing control hidden, unless the build sets VITE_BILLING=true
 * (and has the API, VITE_ACCOUNTS=true).
 */

export const billingEnabled = apiEnabled && import.meta.env.VITE_BILLING === 'true';

export type Product = 'pro_monthly' | 'pro_yearly' | 'max_monthly' | 'max_yearly' | 'credits_1000';

export type PlanId = 'free' | 'pro' | 'max';

/**
 * The prices on the pricing page, in euros (P26); Polar charges them, with
 * VAT where it applies. `pack` is the top-up's price under its old name, for
 * the admin panel's list prices.
 */
export const PRICES = { proMonthly: 12, proYearly: 99, maxMonthly: 29, maxYearly: 249, topup: 12, topupCredits: 1000, pack: 12 } as const;

/** The credits each plan gives: Free once at sign-up, Pro and Max every month (P26). */
export const PLAN_CREDITS = { free: 100, pro: 800, max: 2200 } as const;

/** The free plan's numbers, for the pricing page (backend/src/plans.ts). */
export const FREE = { documents: 5, versions: 20, sizeKiB: 64 } as const;

/** The paid plan a subscription product is for, and how often it bills; null for a top-up. */
export function productPlan(p: Product | null | undefined): { plan: 'pro' | 'max'; period: 'monthly' | 'yearly' } | null {
  if (p !== 'pro_monthly' && p !== 'pro_yearly' && p !== 'max_monthly' && p !== 'max_yearly') return null;
  return { plan: p.startsWith('max') ? 'max' : 'pro', period: p.endsWith('yearly') ? 'yearly' : 'monthly' };
}

/** GET /api/me/plan's `credits` (backend/README.md "Credits"): decimals with up to 3 places. */
export interface CreditBalance {
  /** Everything spendable now. */
  balance: number;
  /** Pro and Max: this month's allowance, what is left of it and when it resets (Unix ms). */
  monthly: { allowance: number; left: number; resetsAt: number } | null;
  /** Left of the credits given at sign-up. */
  signup: number;
  /** Bought top-ups, which never expire. */
  topup: number;
}

/** GET /api/me/plan. */
export interface PlanInfo {
  plan: PlanId | string;
  /** Whether the server has Polar set up. */
  billing: boolean;
  subscription: { status: string; product: Product | null; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean } | null;
  /** Whether the account has a Polar customer (bought something): the portal opens. */
  customer: boolean;
  limits: { documents: number | null; versionsPerDocument: number | null; documentBytes: number };
  credits: CreditBalance;
  /** Every paid feature's answer for the account (backend/src/features.ts); read through components/Feature.tsx. */
  features: Record<FeatureId, FeatureAccess>;
}

export const getPlan = (): Promise<PlanInfo> => api<PlanInfo>('/api/me/plan');

/**
 * A window event: the account's plan or credits changed (a purchase landed),
 * so usePlan, useFeatures and useCredits read GET /api/me/plan again. Its
 * `detail` is the new plan when that changed, for the header's badge
 * (practice/AccountMenu.tsx).
 */
export const PLAN_CHANGED = 'proschi:plan-changed';
export const announcePlanChanged = (plan?: string): void => void window.dispatchEvent(new CustomEvent(PLAN_CHANGED, { detail: plan }));

/** Sends the browser to Polar's checkout for `product`. */
export async function checkout(product: Product): Promise<void> {
  const { url } = await api<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { product } });
  window.location.assign(url);
}

/** Whether the account pays for a subscription now: a plan switch then changes it (changePlan), never a second checkout. */
export const hasSubscription = (plan: PlanInfo): boolean => ['active', 'trialing', 'past_due'].includes(plan.subscription?.status ?? '');

/**
 * Switches the account's subscription to `product` (Pro and Max, monthly and
 * yearly); Polar prorates. The webhook confirms it, so the browser then goes
 * to Settings as back from a checkout (CheckoutStatus.tsx waits for the plan).
 * `base` is the page's way to the site root.
 */
export async function changePlan(product: Product, base: string): Promise<void> {
  await api<{ ok: true; plan: string; effective: 'now' }>('/api/billing/change-plan', { method: 'POST', body: { product } });
  window.location.assign(`${base}practice/?${new URLSearchParams({ checkout: 'done', product })}#/me`);
}

const PRICE: Record<Product, number> = { pro_monthly: PRICES.proMonthly, pro_yearly: PRICES.proYearly, max_monthly: PRICES.maxMonthly, max_yearly: PRICES.maxYearly, credits_1000: PRICES.topup };
const monthlyPrice = (p: Product) => (p.endsWith('yearly') ? PRICE[p] / 12 : PRICE[p]);

/** A product's price as the pricing page says it: "€99 a year". */
export const priceText = (product: Product): string => (product === 'credits_1000' ? `€${PRICE[product]}` : `€${PRICE[product]} a ${product.endsWith('yearly') ? 'year' : 'month'}`);

/**
 * Buys a plan: Polar's checkout without a subscription; with one, a switch
 * of it after a one-line confirm (false when the person said no).
 */
export async function buyPlan(product: Product, plan: PlanInfo | undefined, base: string): Promise<boolean> {
  if (!plan || !hasSubscription(plan) || product === 'credits_1000') {
    await checkout(product);
    return true;
  }
  const to = productPlan(product)!;
  const name = `${to.plan === 'max' ? 'Max' : 'Pro'} ${to.period}`;
  const now = plan.subscription?.product;
  const up = !now || monthlyPrice(product) > monthlyPrice(now);
  const note = up ? 'Polar charges the difference for the rest of this period.' : 'Polar settles the difference for the rest of this period.';
  if (!window.confirm(`Switch to ${name}, ${priceText(product)}? ${note}`)) return false;
  await changePlan(product, base);
  return true;
}

/** Sends the browser to Polar's customer portal (invoices, payment method, cancel, switch plans). */
export async function openPortal(): Promise<void> {
  const { url } = await api<{ url: string }>('/api/billing/portal', { method: 'POST' });
  window.location.assign(url);
}

/** The pricing page, from a page `base` away from the site root. */
export const pricingHref = (base: string): string => `${base}pricing/`;
