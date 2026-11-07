import { TYPICAL_COSTS, type CreditEstimates, type Range } from '../services/estimates';

/**
 * What a number of credits is worth in things people do: mock interviews
 * first, Design partner second (docs/design/paid-plans.md P47). Every count
 * comes from the credit estimates (GET /api/credits/estimates, or
 * TYPICAL_COSTS), so the plan copy follows when they change. Pure.
 */

/** How many of an action fit, low to high: at its typical high cost, and at its typical low one. */
export interface Count {
  lo: number;
  hi: number;
}

/** How many times `cost` fits in `credits`, never rounding up: a count the credits really cover. */
export const howMany = (credits: number, { min, max }: Range): Count => ({ lo: Math.floor(credits / max), hi: Math.floor(credits / min) });

/** "14–21", or "2" when the two meet. */
export const formatCount = ({ lo, hi }: Count): string => (lo === hi ? `${lo}` : `${lo}–${hi}`);

const noun = ({ hi }: Count, one: string, many: string) => (hi === 1 ? one : many);

/** What `credits` cover: 45-minute mock interviews (verdict included), Design partner reviews, systems built from a description, and changes to a design. */
export interface PlanValue {
  interviews: Count;
  reviews: Count;
  builds: Count;
  changes: Count;
}

export function planValue(credits: number, estimates: CreditEstimates = TYPICAL_COSTS): PlanValue {
  return {
    interviews: howMany(credits, estimates.mock_interview),
    reviews: howMany(credits, estimates.partner_review),
    builds: howMany(credits, estimates.partner_build),
    changes: howMany(credits, estimates.partner_turn),
  };
}

/** "about 14–21 mock interviews". */
export function interviewsText(credits: number, estimates: CreditEstimates = TYPICAL_COSTS): string {
  const n = howMany(credits, estimates.mock_interview);
  return `about ${formatCount(n)} ${noun(n, 'mock interview', 'mock interviews')}`;
}

/** "about 65–95 design reviews or 38–61 systems built". */
export function partnerText(credits: number, estimates: CreditEstimates = TYPICAL_COSTS): string {
  const { reviews, builds } = planValue(credits, estimates);
  return `about ${formatCount(reviews)} ${noun(reviews, 'design review', 'design reviews')} or ${formatCount(builds)} ${noun(builds, 'system built', 'systems built')}`;
}
