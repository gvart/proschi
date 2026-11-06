import { api, ApiError } from '../services/api';
import { billingEnabled } from '../services/billing';
import { parseDesignReview, parseReviewUsage, type DesignReview, type DesignReviewRequest, type ReviewUsage } from './contract';
import { reviewDesign } from './rules';

/**
 * Who reviews a design. Injected like the simulation (hld/engine.ts), so
 * tests and builds without the API can pass their own.
 */
export interface DesignReviewer {
  /** False when there is no reviewer at all: the panel then says so instead of offering feedback. */
  available: boolean;
  /** An LLM writes the review (it can be wrong); false for the rule reviewer. */
  ai: boolean;
  /**
   * Rejects with ReviewUnavailableError when there is no review to give
   * (yet), DailyLimitError past the day's AI reviews, and another Error when
   * it failed. The API's review comes with the usage after it.
   */
  review(request: DesignReviewRequest): Promise<DesignReview & { usage?: ReviewUsage }>;
}

/** No reviewer behind this build or endpoint: not a failure, so the panel says so instead of showing an error. */
export class ReviewUnavailableError extends Error {
  constructor(message = 'AI review is not available yet') {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

/** 429 `daily_limit`: today's AI reviews are used up, until `usage.resetAt`. */
export class DailyLimitError extends Error {
  readonly usage?: ReviewUsage;
  constructor(usage?: ReviewUsage) {
    super('You have used today’s AI reviews');
    this.name = 'DailyLimitError';
    this.usage = usage;
  }
}

/** Rules over the simulation and the tests (./rules.ts): on the page, instant and deterministic. */
export const ruleReviewer: DesignReviewer = {
  available: true,
  ai: false,
  review: async (request) => reviewDesign(request),
};

/** Answers that mean "no reviewer here": no API key (501), no API behind the page (404), the reviewer busy (503), or the account off Pro (402). */
const UNAVAILABLE = new Set([402, 404, 501, 503]);

/** `POST /api/review` (backend/README.md, "Design review"): Pro only, 20 a day. */
export const apiReviewer: DesignReviewer = {
  available: true,
  ai: true,
  async review(request) {
    let data: unknown;
    try {
      data = await api<unknown>('/api/review', { method: 'POST', body: request });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429 && (e.body as { error?: string } | undefined)?.error === 'daily_limit') {
        throw new DailyLimitError(parseReviewUsage((e.body as { usage?: unknown }).usage));
      }
      if (e instanceof ApiError && UNAVAILABLE.has(e.status)) throw new ReviewUnavailableError();
      // fetch rejects with a TypeError when the network or the server is unreachable.
      if (e instanceof TypeError) throw new ReviewUnavailableError();
      throw e;
    }
    const usage = parseReviewUsage((data as { usage?: unknown } | null)?.usage);
    return { ...parseDesignReview(data), ...(usage ? { usage } : {}) };
  },
};

/** GET /api/review/usage: the Pro user's AI reviews today; undefined when there is no AI review for them (no key, not Pro, no API). */
export async function getReviewUsage(): Promise<ReviewUsage | undefined> {
  try {
    return parseReviewUsage(await api<unknown>('/api/review/usage'));
  } catch {
    return undefined;
  }
}

/** `primary`, or `fallback` when `primary` has no review to give (ReviewUnavailableError). */
export function withFallback(primary: DesignReviewer, fallback: DesignReviewer): DesignReviewer {
  return {
    available: primary.available || fallback.available,
    ai: primary.ai,
    async review(request) {
      try {
        return await primary.review(request);
      } catch (e) {
        if (e instanceof ReviewUnavailableError) return fallback.review(request);
        throw e;
      }
    },
  };
}

/**
 * AI review is a Pro feature of the hosted site (docs/design/paid-plans.md
 * P10, P17): builds with paid plans (VITE_BILLING=true, with the API) offer
 * it to Pro accounts. Every build has the rule reviewer, the one free
 * accounts, signed-out visitors and builds without the API get.
 */
export const aiReviewEnabled = billingEnabled;

export const defaultReviewer: DesignReviewer = ruleReviewer;
