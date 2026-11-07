import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { productPlan } from './billing';
import { formatCredits, formatRange, interviewEstimate, isLow, noCredits, TYPICAL_COSTS } from './credits';

describe('formatCredits', () => {
  it('shows whole credits from 10 up and one decimal below', () => {
    expect(formatCredits(2200)).toBe('2,200');
    expect(formatCredits(47.6)).toBe('48');
    expect(formatCredits(0.42)).toBe('0.4');
    expect(formatCredits(3)).toBe('3');
  });
  it('floors a balance, so it never shows more than can be spent', () => {
    expect(formatCredits(47.6, { floor: true })).toBe('47');
    expect(formatCredits(0.99, { floor: true })).toBe('0.9');
  });
});

describe('estimates', () => {
  it('reads as an "about" range', () => {
    expect(formatRange({ min: 45, max: 60 })).toBe('about 45–60');
    expect(formatRange({ min: 50, max: 50.2 })).toBe('about 50');
  });
  it('scales the 45-minute interview to the chosen length, to the nearest 5', () => {
    expect(interviewEstimate(TYPICAL_COSTS, 45)).toEqual({ min: 45, max: 60 });
    expect(interviewEstimate(TYPICAL_COSTS, 30)).toEqual({ min: 30, max: 40 });
    expect(interviewEstimate(TYPICAL_COSTS, 60)).toEqual({ min: 60, max: 80 });
  });
  it('adds what a Deep verdict costs beyond the ordinary one, whatever the length', () => {
    const e = { ...TYPICAL_COSTS, verdict: { min: 15, max: 50 }, deepMultiplier: 2 };
    expect(interviewEstimate(e, 45, true)).toEqual({ min: 60, max: 110 });
    expect(interviewEstimate(e, 30, true)).toEqual({ min: 45, max: 90 });
    // Without the server's verdict range, the typical one.
    expect(interviewEstimate({ ...e, verdict: undefined }, 45, true)).toEqual({ min: 60, max: 115 });
  });
});

describe('isLow', () => {
  it('is under 10% of the monthly allowance, or of the sign-up credits on Free', () => {
    expect(isLow({ balance: 79, monthly: { allowance: 800, left: 79, resetsAt: 0 }, signup: 0, topup: 0 })).toBe(true);
    expect(isLow({ balance: 80, monthly: { allowance: 800, left: 80, resetsAt: 0 }, signup: 0, topup: 0 })).toBe(false);
    expect(isLow({ balance: 9, monthly: null, signup: 9, topup: 0 })).toBe(true);
    expect(isLow({ balance: 60, monthly: null, signup: 60, topup: 0 })).toBe(false);
  });
});

describe('noCredits', () => {
  it('reads the 402 no_credits answer and nothing else', () => {
    expect(noCredits(new ApiError(402, 'no_credits', undefined, { error: 'no_credits', needed: 45, balance: 12.5 }))).toEqual({ needed: 45, balance: 12.5 });
    expect(noCredits(new ApiError(402, 'plan_required', undefined, { error: 'plan_required' }))).toBeNull();
    expect(noCredits(new ApiError(500, 'x'))).toBeNull();
    expect(noCredits(new Error('x'))).toBeNull();
  });
});

describe('productPlan', () => {
  it('names the plan and period of a subscription, and nothing for a top-up', () => {
    expect(productPlan('max_yearly')).toEqual({ plan: 'max', period: 'yearly' });
    expect(productPlan('pro_monthly')).toEqual({ plan: 'pro', period: 'monthly' });
    expect(productPlan('credits_1000')).toBeNull();
    expect(productPlan(null)).toBeNull();
  });
});
