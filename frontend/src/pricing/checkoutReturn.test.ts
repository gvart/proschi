import { describe, expect, it } from 'vitest';
import type { PlanInfo, Product } from '../services/billing';
import { nextPollIn, onPlan, onTick, readCheckoutReturn, returnMessage, SLOW_AFTER, startReturn, withoutCheckoutReturn, type ReturnState } from './checkoutReturn';

const plan = (over: { plan?: string; status?: string; topup?: number; perMonth?: number; product?: Product } = {}): PlanInfo => ({
  plan: over.plan ?? 'free',
  billing: true,
  subscription: over.status ? { status: over.status, product: over.product ?? null, currentPeriodEnd: null, cancelAtPeriodEnd: false } : null,
  customer: true,
  limits: { documents: null, versionsPerDocument: null, documentBytes: 1 },
  credits: { balance: 0, monthly: over.perMonth ? { allowance: over.perMonth, left: over.perMonth, resetsAt: 0 } : null, signup: 0, topup: over.topup ?? 0 },
  features: {} as PlanInfo['features'],
});

const PRO = startReturn({ product: 'pro_yearly', checkoutId: null }, 0);
const MAX = startReturn({ product: 'max_monthly', checkoutId: null }, 0);
const TOPUP = startReturn({ product: 'credits_1000', checkoutId: null }, 0);

/** Every scheduled ask from the start, in ms. */
function schedule(s: ReturnState): number[] {
  const at: number[] = [];
  let now = 0;
  for (let wait = nextPollIn(s, now); wait !== null; wait = nextPollIn(s, now)) at.push((now += wait));
  return at;
}

describe('readCheckoutReturn', () => {
  it('reads the product and Polar’s checkout id', () => {
    expect(readCheckoutReturn('https://p.app/practice/?checkout=done&product=credits_1000&checkout_id=abc#/me')).toEqual({ product: 'credits_1000', checkoutId: 'abc' });
    expect(readCheckoutReturn('https://p.app/practice/?checkout=done&product=max_yearly#/me')).toEqual({ product: 'max_yearly', checkoutId: null });
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
    s = onPlan(s, plan({ plan: 'pro', status: 'active', perMonth: 800 }));
    expect(s.phase).toBe('done');
    expect(returnMessage(s)).toBe("You're on Pro: 800 credits a month, starting now.");
  });
  it('a switch from monthly to yearly is done once the subscription has the new product', () => {
    expect(onPlan(PRO, plan({ plan: 'pro', status: 'active', perMonth: 800, product: 'pro_monthly' })).phase).toBe('activating');
    expect(onPlan(PRO, plan({ plan: 'pro', status: 'active', perMonth: 800, product: 'pro_yearly' })).phase).toBe('done');
  });
  it('is not done by Max', () => {
    expect(onPlan(PRO, plan({ plan: 'max', status: 'active', perMonth: 2200 })).phase).toBe('activating');
  });
  it('is not done by an admin’s comp alone', () => {
    expect(onPlan(PRO, plan({ plan: 'pro' })).phase).toBe('activating');
  });
  it('still finishes from slow', () => {
    const slow = onTick(PRO, SLOW_AFTER);
    expect(returnMessage(slow)).toMatch(/^Polar hasn't confirmed the payment yet/);
    expect(onPlan(slow, plan({ plan: 'pro', status: 'trialing', perMonth: 800 })).phase).toBe('done');
  });
});

describe('Max', () => {
  it('is done once the plan is Max by a subscription, an upgrade from Pro too', () => {
    expect(returnMessage(MAX)).toBe('Payment received. Activating Max…');
    expect(onPlan(MAX, plan({ plan: 'pro', status: 'active', perMonth: 800 })).phase).toBe('activating');
    const s = onPlan(MAX, plan({ plan: 'max', status: 'active', perMonth: 2200 }));
    expect(s).toMatchObject({ phase: 'done', credits: 2200 });
    expect(returnMessage(s)).toBe("You're on Max: 2,200 credits a month, Deep mode and printable interview reports.");
  });
});

describe('a top-up', () => {
  it('is done once the top-up credits go up from the first answer', () => {
    let s = onPlan(TOPUP, plan({ topup: 200 }));
    expect(s).toMatchObject({ phase: 'activating', baseline: 200 });
    expect(returnMessage(s)).toBe('Payment received. Adding 1,000 credits…');
    s = onPlan(s, plan({ topup: 200 }));
    expect(s.phase).toBe('activating');
    s = onPlan(s, plan({ topup: 1200 }));
    expect(s).toMatchObject({ phase: 'done', credits: 1000 });
    expect(returnMessage(s)).toBe('1,000 credits added. They never expire.');
    expect(onPlan(s, plan({ topup: 2200 }))).toBe(s);
  });
  it('is not done by Pro', () => {
    expect(onPlan(onPlan(TOPUP, plan()), plan({ plan: 'pro', status: 'active' })).phase).toBe('activating');
  });
});
