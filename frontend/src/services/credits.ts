import { api, ApiError } from './api';
import { PLAN_CREDITS, type CreditBalance } from './billing';

/**
 * Metered credits on the page (docs/design/paid-plans.md P26–P28, the
 * contract in docs/impl/design-partner.md): what an action is likely to
 * cost, what was spent, and the 402 a call answers without enough credits.
 * 1 credit is €0.01. The balance itself comes with the plan
 * (services/useCredits.ts).
 */

export interface Range {
  min: number;
  max: number;
}

/** GET /api/credits/estimates. */
export interface CreditEstimates {
  /** A 45-minute mock interview, verdict included. */
  mock_interview: Range;
  partner_review: Range;
  partner_build: Range;
  partner_turn: Range;
  /** Deep mode (Max) costs about this many times as much. */
  deepMultiplier: number;
}

/** The typical costs, shown signed out and until the server's estimates arrive (P26). */
export const TYPICAL_COSTS: CreditEstimates = {
  mock_interview: { min: 45, max: 60 },
  partner_review: { min: 5, max: 15 },
  partner_build: { min: 20, max: 40 },
  partner_turn: { min: 1, max: 5 },
  deepMultiplier: 5,
};

/** The interview length the mock interview's estimate is for. */
export const ESTIMATE_MINUTES = 45;

export const getEstimates = (): Promise<CreditEstimates> => api<CreditEstimates>('/api/credits/estimates');

export type UsageAction = 'mock_interview' | 'design_partner' | 'verdict' | 'next_steps';

export interface UsageItem {
  /** Unix ms. */
  at: number;
  action: UsageAction;
  ref: string;
  credits: number;
  deep: boolean;
}

export const USAGE_LABEL: Record<UsageAction, string> = {
  mock_interview: 'Mock interview',
  design_partner: 'Design partner',
  verdict: 'Verdict',
  next_steps: 'Your next steps',
};

/** GET /api/credits/usage: the latest charges, newest first. */
export const getUsage = (limit = 50): Promise<{ items: UsageItem[] }> => api<{ items: UsageItem[] }>(`/api/credits/usage?limit=${limit}`);

/** A call refused for want of credits: `402 { error: 'no_credits', needed, balance }`; null for anything else. */
export function noCredits(e: unknown): { needed: number; balance: number } | null {
  if (!(e instanceof ApiError) || e.status !== 402) return null;
  const body = e.body as { error?: unknown; needed?: unknown; balance?: unknown } | undefined;
  if (body?.error !== 'no_credits') return null;
  return { needed: typeof body.needed === 'number' ? body.needed : 0, balance: typeof body.balance === 'number' ? body.balance : 0 };
}

/**
 * A number of credits for people: whole credits from 10 up, one decimal
 * below (a short turn can cost 0.4). `floor` for a balance, so it never
 * shows more than can be spent.
 */
export function formatCredits(n: number, { floor = false }: { floor?: boolean } = {}): string {
  const places = Math.abs(n) < 10 ? 1 : 0;
  const scale = 10 ** places;
  const value = floor ? Math.floor(n * scale) / scale : Math.round(n * scale) / scale;
  return value.toLocaleString('en-GB', { maximumFractionDigits: places });
}

/** "about 45–60", or "about 50" when the two meet. */
export const formatRange = ({ min, max }: Range): string => (Math.round(min) === Math.round(max) ? `about ${Math.round(min)}` : `about ${Math.round(min)}–${Math.round(max)}`);

/** The mock interview's estimate for an interview of `minutes`: the 45-minute one in proportion, to the nearest 5. */
export function interviewEstimate(estimates: CreditEstimates, minutes: number): Range {
  const scale = (n: number) => Math.max(5, Math.round((n * minutes) / ESTIMATE_MINUTES / 5) * 5);
  return { min: scale(estimates.mock_interview.min), max: scale(estimates.mock_interview.max) };
}

/** What the monthly or sign-up allowance is, to measure the balance against. */
export const allowanceOf = (credits: CreditBalance): number => credits.monthly?.allowance ?? PLAN_CREDITS.free;

/** Under about 10% of the allowance: the header's chip asks for attention. */
export const isLow = (credits: CreditBalance): boolean => credits.balance < allowanceOf(credits) * 0.1;
