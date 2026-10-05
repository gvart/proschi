import { api, ApiError } from '../services/api';
import { parseDesignReview, type DesignReview, type DesignReviewRequest } from './contract';
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
  /** Rejects with ReviewUnavailableError when there is no review to give (yet), with another Error when it failed. */
  review(request: DesignReviewRequest): Promise<DesignReview>;
}

/** No reviewer behind this build or endpoint: not a failure, so the panel says so instead of showing an error. */
export class ReviewUnavailableError extends Error {
  constructor(message = 'AI review is not available yet') {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

/** Rules over the simulation and the tests (./rules.ts): on the page, instant and deterministic. */
export const ruleReviewer: DesignReviewer = {
  available: true,
  ai: false,
  review: async (request) => reviewDesign(request),
};

/** Answers that mean "no reviewer here": the stub endpoint (501), no API behind the page (404), or the service down (503). */
const UNAVAILABLE = new Set([404, 501, 503]);

/** `POST /api/review` (backend/README.md). The stub's 501, and an unreachable API, read as unavailable. */
export const apiReviewer: DesignReviewer = {
  available: true,
  ai: true,
  async review(request) {
    let data: unknown;
    try {
      data = await api<unknown>('/api/review', { method: 'POST', body: request });
    } catch (e) {
      if (e instanceof ApiError && UNAVAILABLE.has(e.status)) throw new ReviewUnavailableError();
      // fetch rejects with a TypeError when the network or the server is unreachable.
      if (e instanceof TypeError) throw new ReviewUnavailableError();
      throw e;
    }
    return parseDesignReview(data);
  },
};

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

/** Builds with VITE_AI_REVIEW=true ask the API first; every build has the rule reviewer. */
export const aiReviewEnabled = import.meta.env.VITE_AI_REVIEW === 'true';

export const defaultReviewer: DesignReviewer = aiReviewEnabled ? withFallback(apiReviewer, ruleReviewer) : ruleReviewer;
