import { describe, expect, it } from 'vitest';
import { PLAN_CREDITS, PRICES } from '../services/billing';
import { TYPICAL_COSTS } from '../services/estimates';
import { formatCount, howMany, interviewsText, partnerText, planValue } from './planValue';

describe('planValue', () => {
  it('counts only what the credits really cover: the high cost for the low end, the low cost for the high end', () => {
    expect(howMany(100, { min: 40, max: 60 })).toEqual({ lo: 1, hi: 2 });
    expect(howMany(120, { min: 40, max: 60 })).toEqual({ lo: 2, hi: 3 });
    expect(formatCount({ lo: 3, hi: 3 })).toBe('3');
    expect(formatCount({ lo: 14, hi: 21 })).toBe('14–21');
  });

  it('follows the estimate constants (TYPICAL_COSTS): a plan covers floor(credits / cost) at both ends of the typical range', () => {
    for (const credits of [PLAN_CREDITS.free, PLAN_CREDITS.pro, PLAN_CREDITS.max, PRICES.topupCredits]) {
      const v = planValue(credits);
      expect(v.interviews).toEqual({ lo: Math.floor(credits / TYPICAL_COSTS.mock_interview.max), hi: Math.floor(credits / TYPICAL_COSTS.mock_interview.min) });
      expect(v.reviews).toEqual({ lo: Math.floor(credits / TYPICAL_COSTS.partner_review.max), hi: Math.floor(credits / TYPICAL_COSTS.partner_review.min) });
      expect(v.builds).toEqual({ lo: Math.floor(credits / TYPICAL_COSTS.partner_build.max), hi: Math.floor(credits / TYPICAL_COSTS.partner_build.min) });
      expect(v.changes).toEqual({ lo: Math.floor(credits / TYPICAL_COSTS.partner_turn.max), hi: Math.floor(credits / TYPICAL_COSTS.partner_turn.min) });
    }
  });

  // The copy on the pricing page, Settings and the checkout return today. When an estimate changes, these change with it.
  it('pins the plans copy to today’s estimates', () => {
    expect(interviewsText(PLAN_CREDITS.free)).toBe('about 1–2 mock interviews');
    expect(interviewsText(PLAN_CREDITS.pro)).toBe('about 14–21 mock interviews');
    expect(interviewsText(PLAN_CREDITS.max)).toBe('about 38–59 mock interviews');
    expect(interviewsText(PRICES.topupCredits)).toBe('about 17–26 mock interviews');
    expect(partnerText(PLAN_CREDITS.free)).toBe('about 8–11 design reviews or 4–7 systems built');
    expect(partnerText(PLAN_CREDITS.pro)).toBe('about 65–95 design reviews or 38–61 systems built');
    expect(partnerText(PLAN_CREDITS.max)).toBe('about 180–263 design reviews or 106–169 systems built');
    expect(partnerText(PRICES.topupCredits)).toBe('about 82–119 design reviews or 48–76 systems built');
  });

  it('says one, not ones', () => {
    expect(interviewsText(50, TYPICAL_COSTS)).toBe('about 0–1 mock interview');
    expect(interviewsText(60, { ...TYPICAL_COSTS, mock_interview: { min: 50, max: 55 } })).toBe('about 1 mock interview');
  });
});
