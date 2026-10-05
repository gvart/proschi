import { api, ApiError } from '../services/api';
import { parseDesignReview, type DesignReview, type DesignReviewRequest } from './contract';

/**
 * Who reviews a design. Injected like the simulation (hld/engine.ts), so
 * tests and builds without the API can pass their own.
 */
export interface DesignReviewer {
  /** False for the placeholder: the panel says the review is coming soon instead of offering feedback. */
  available: boolean;
  /** Rejects with ReviewUnavailableError when there is no review to give (yet), with another Error when it failed. */
  review(request: DesignReviewRequest): Promise<DesignReview>;
}

/** No reviewer behind this build or endpoint: not a failure, so the panel shows "coming soon", not an error. */
export class ReviewUnavailableError extends Error {
  constructor(message = 'AI review is not available yet') {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

/** The default: gives no feedback at all, real or made up. */
export const placeholderReviewer: DesignReviewer = {
  available: false,
  review: () => Promise.reject(new ReviewUnavailableError()),
};

/** `POST /api/review` (backend/README.md). A 501 from the stub endpoint reads as unavailable. */
export const apiReviewer: DesignReviewer = {
  available: true,
  async review(request) {
    try {
      return parseDesignReview(await api<unknown>('/api/review', { method: 'POST', body: request }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) throw new ReviewUnavailableError();
      throw e;
    }
  },
};

/** Builds with VITE_AI_REVIEW=true call the API; every other build gets the placeholder. */
export const aiReviewEnabled = import.meta.env.VITE_AI_REVIEW === 'true';

export const defaultReviewer: DesignReviewer = aiReviewEnabled ? apiReviewer : placeholderReviewer;
