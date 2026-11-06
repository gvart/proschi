import { api, apiEnabled } from './api';

/**
 * Pro and interview packs (backend/src/billing.ts, docs/design/paid-plans.md
 * P1, P2, P10). Polar hosts the checkout and the billing portal; the page
 * only asks the API for their addresses and sends the browser there. Off,
 * and every billing control hidden, unless the build sets VITE_BILLING=true
 * (and has the API, VITE_ACCOUNTS=true).
 */

export const billingEnabled = apiEnabled && import.meta.env.VITE_BILLING === 'true';

export type Product = 'pro_monthly' | 'pro_yearly' | 'pack_5';

/** The prices on the pricing page, in euros (P1); Polar charges them, with VAT where it applies. */
export const PRICES = { proMonthly: 12, proYearly: 89, pack: 15, packInterviews: 5, proInterviews: 4 } as const;

/** The free plan's numbers, for the pricing page (backend/src/plans.ts). */
export const FREE = { documents: 5, versions: 20, sizeKiB: 64, interviews: 1 } as const;

/** GET /api/me/plan. */
export interface PlanInfo {
  plan: 'free' | 'pro' | string;
  /** Whether the server has Polar set up. */
  billing: boolean;
  subscription: { status: string; product: Product | null; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean } | null;
  /** Whether the account has a Polar customer (bought something): the portal opens. */
  customer: boolean;
  limits: { documents: number | null; versionsPerDocument: number | null; documentBytes: number; interviewsPerMonth: number };
  credits: { total: number; monthly: number; trial: number; pack: number; period: string };
}

export const getPlan = (): Promise<PlanInfo> => api<PlanInfo>('/api/me/plan');

/** Sends the browser to Polar's checkout for `product`. */
export async function checkout(product: Product): Promise<void> {
  const { url } = await api<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { product } });
  window.location.assign(url);
}

/** Sends the browser to Polar's customer portal (invoices, payment method, cancel). */
export async function openPortal(): Promise<void> {
  const { url } = await api<{ url: string }>('/api/billing/portal', { method: 'POST' });
  window.location.assign(url);
}

/** The pricing page, from a page `base` away from the site root. */
export const pricingHref = (base: string): string => `${base}pricing/`;
