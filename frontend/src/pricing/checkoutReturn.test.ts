import { describe, expect, it } from 'vitest';
import type { PlanInfo } from '../services/billing';
import { nextPollIn, onPlan, onTick, readCheckoutReturn, returnMessage, SLOW_AFTER, startReturn, withoutCheckoutReturn, type ReturnState } from './checkoutReturn';

const plan = (over: { plan?: string; status?: string; pack?: number; perMonth?: number } = {}): PlanInfo => ({
  plan: over.plan ?? 'free',
  billing: true,
  subscription: over.status ? { status: over.status, product: 'pro_monthly', currentPeriodEnd: null, cancelAtPeriodEnd: false } : null,
  customer: true,
  limits: { documents: null, versionsPerDocument: null, documentBytes: 1, interviewsPerMonth: over.perMonth ?? 0 },
  credits: { total: 0, monthly: 0, trial: 0, pack: over.pack ?? 0, period: '2026-11' },
  features: {} as PlanInfo['features'],
});

const PRO = startReturn({ product: 'pro_yearly', checkoutId: null }, 0);
const PACK = startReturn({ product: 'pack_5', checkoutId: null }, 0);

/** Every scheduled ask from the start, in ms. */
function schedule(s: ReturnState): number[] {
  const at: number[] = [];
  let now = 0;
  for (let wait = nextPollIn(s, now); wait !== null; wait = nextPollIn(s, now)) at.push((now += wait));
  return at;
}

describe('readCheckoutReturn', () => {
  it('reads the product and Polar’s checkout id', () => {
    expect(readCheckoutReturn('https://p.app/practice/?checkout=done&product=pack_5&checkout_id=abc#/me')).toEqual({ product: 'pack_5', checkoutId: 'abc' });
  });
  it('is null without checkout=done, and ignores an unknown product or an unfilled id', () => {
    expect(readCheckoutReturn('https://p.app/practice/#/me')).toBeNull();
    expect(readCheckoutReturn('https://p.app/pricing/?checkout=canceled')).toBeNull();
    expect(readCheckoutReturn('https://p.app/practice/?checkout=done&product=gold&checkout_id={CHECKOUT_ID}#/me')).toEqual({ product: null, checkoutId: null });
  });
  it('takes its parameters off the address, keeping the rest', () => {
    expect(withoutCheckoutReturn('https://p.app/practice/?a=1&checkout=done&product=pro_monthly&checkout_id=x#/me')).toBe('https://p.app/practice/?a=1#/me');
  });
});

describe('the schedule', () => {
  it('asks at 1, 2, 4, 8, 15, 30 and 60 s, then every 30 s up to 10 minutes', () => {
    const at = schedule(PRO);
    expect(at.slice(0, 8)).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 60000, 90000]);
    expect(at.at(-1)).toBe(600000);
    expect(at).toHaveLength(7 + 18);
  });
  it('from the middle of a wait, waits for the next slot', () => {
    expect(nextPollIn(PRO, 2500)).toBe(1500);
    expect(nextPollIn(PRO, 75000)).toBe(15000);
    expect(nextPollIn(PRO, 600001)).toBeNull();
  });
  it('stops when done', () => {
    expect(nextPollIn({ ...PRO, phase: 'done' }, 0)).toBeNull();
  });
  it('turns slow after a minute of activating, not before', () => {
    expect(onTick(PRO, SLOW_AFTER - 1).phase).toBe('activating');
    expect(onTick(PRO, SLOW_AFTER).phase).toBe('slow');
    expect(onTick({ ...PRO, phase: 'done' }, SLOW_AFTER).phase).toBe('done');
  });
});

describe('Pro', () => {
  it('is done once the plan is Pro by a subscription', () => {
    let s = onPlan(PRO, plan());
    expect(s.phase).toBe('activating');
    expect(returnMessage(s)).toBe('Payment received. Activating Pro…');
    s = onPlan(s, plan({ plan: 'pro', status: 'active', perMonth: 4 }));
    expect(s.phase).toBe('done');
    expect(returnMessage(s)).toBe("You're on Pro: 4 AI interviews this month.");
  });
  it('is not done by an admin’s comp alone', () => {
    expect(onPlan(PRO, plan({ plan: 'pro' })).phase).toBe('activating');
  });
  it('still finishes from slow', () => {
    const slow = onTick(PRO, SLOW_AFTER);
    expect(returnMessage(slow)).toMatch(/^Polar hasn't confirmed the payment yet/);
    expect(onPlan(slow, plan({ plan: 'pro', status: 'trialing', perMonth: 4 })).phase).toBe('done');
  });
});

describe('a pack', () => {
  it('is done once the pack credits go up from the first answer', () => {
    let s = onPlan(PACK, plan({ pack: 2 }));
    expect(s).toMatchObject({ phase: 'activating', baseline: 2 });
    expect(returnMessage(s)).toBe('Payment received. Adding 5 interviews…');
    s = onPlan(s, plan({ pack: 2 }));
    expect(s.phase).toBe('activating');
    s = onPlan(s, plan({ pack: 7 }));
    expect(s).toMatchObject({ phase: 'done', interviews: 5 });
    expect(returnMessage(s)).toBe('5 interviews added.');
    expect(onPlan(s, plan({ pack: 12 }))).toBe(s);
  });
  it('is not done by Pro', () => {
    expect(onPlan(onPlan(PACK, plan()), plan({ plan: 'pro', status: 'active' })).phase).toBe('activating');
  });
});
