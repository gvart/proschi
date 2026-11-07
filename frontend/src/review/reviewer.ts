import type { DesignReview, DesignReviewRequest } from './contract';
import { reviewDesign } from './rules';

/**
 * Who reviews a design. Injected like the simulation (hld/engine.ts), so
 * tests can pass their own. The page's review is the automatic one, written
 * from the simulation and the tests; the conversation about a design, with
 * changes to accept, is Design partner's (src/partner, docs/design/paid-plans.md P29).
 */
export interface DesignReviewer {
  /** False when there is no reviewer at all: the panel then says so instead of offering feedback. */
  available: boolean;
  /** Rejects with ReviewUnavailableError when there is no review to give, and another Error when it failed. */
  review(request: DesignReviewRequest): Promise<DesignReview>;
}

/** No reviewer behind this build: not a failure, so the panel says so instead of showing an error. */
export class ReviewUnavailableError extends Error {
  constructor(message = 'No review is available') {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

/** Rules over the simulation and the tests (./rules.ts): on the page, instant and deterministic. */
export const ruleReviewer: DesignReviewer = {
  available: true,
  review: async (request) => reviewDesign(request),
};

export const defaultReviewer: DesignReviewer = ruleReviewer;
