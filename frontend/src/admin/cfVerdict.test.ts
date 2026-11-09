import { describe, expect, it } from 'vitest';
import type { CfMetric, CfUsage } from './api';
import { attention, compare, flagged, formatPrice, formatQuantity, resetLabel, verdict } from './cfVerdict';

const series = Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, value: 0 }));

function metric(over: Partial<CfMetric> = {}): CfMetric {
  return {
    id: 'workers.requests',
    product: 'Workers',
    label: 'Workers requests',
    unit: 'requests',
    kind: 'flow',
    period: 'month',
    included: 10e6,
    used: 1e6,
    percent: 0.1,
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    projected: 3e6,
    passesAt: null,
    overageUsd: 0,
    status: 'ok',
    series,
    ...over,
  };
}

function usage(over: Partial<CfUsage> = {}): CfUsage {
  return {
    plan: 'paid',
    planSource: 'subscription',
    period: { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z', source: 'subscription' },
    fetchedAt: '2026-11-07T12:00:00.000Z',
    cached: false,
    metrics: [metric()],
    freeTier: [{ id: 'workers.requests', label: 'Workers requests', included: 100_000, maxDay: 40_000, daysOver7: 0, daysOver30: 0 }],
    costs: { paidBaseUsd: 5, paidOverageUsd: 0, paidTotalUsd: 5 },
    errors: [],
    notes: [],
    ...over,
  };
}

const rowsRead = (over: Partial<CfMetric>) =>
  metric({ id: 'd1.rowsRead', product: 'D1', label: 'D1 rows read', unit: 'rows', included: 25e9, ...over });

describe('cf usage verdict', () => {
  it('says you are fine on Paid when every quota is projected under what is included', () => {
    expect(verdict(usage())).toEqual({ tone: 'ok', text: "You're fine on Workers Paid this period: every quota is projected under what's included. Resets Dec 1." });
  });

  it('names the quota that will pass, when, and what it costs', () => {
    const m = rowsRead({ used: 15e9, projected: 30e9, passesAt: '2026-11-24T06:00:00.000Z', overageUsd: 5, status: 'watch' });
    const v = verdict(usage({ metrics: [metric(), m], costs: { paidBaseUsd: 5, paidOverageUsd: 5, paidTotalUsd: 10 } }));
    expect(v).toEqual({ tone: 'watch', text: 'D1 rows read will pass the included 25B around Nov 24 — about $5.00 extra.' });
  });

  it('says a quota already over, and counts the others', () => {
    const over = rowsRead({ used: 26e9, projected: 40e9, overageUsd: 15, status: 'over' });
    const watch = metric({ projected: 9e6, status: 'watch' });
    const v = verdict(usage({ metrics: [watch, over], costs: { paidBaseUsd: 5, paidOverageUsd: 15, paidTotalUsd: 20 } }));
    expect(v.tone).toBe('over');
    expect(v.text).toBe('D1 rows read is past the included 25B (and 1 more quota) — about $15.00 extra by Dec 1.');
  });

  it('a watch under 100%: on course, nothing extra yet', () => {
    expect(verdict(usage({ metrics: [metric({ projected: 9e6, status: 'watch' })] })).text).toBe(
      'Workers requests is on course for 90% of the included 10M by Dec 1. Nothing extra yet.',
    );
  });

  it('on Free: how often a daily limit was hit this week, and the upgrade', () => {
    const v = verdict(
      usage({
        plan: 'free',
        metrics: [metric({ period: 'day', included: 100_000, overageUsd: null })],
        freeTier: [
          { id: 'workers.requests', label: 'Workers requests', included: 100_000, maxDay: 140_000, daysOver7: 3, daysOver30: 5 },
          { id: 'd1.rowsRead', label: 'D1 rows read', included: 5e6, maxDay: 6e6, daysOver7: 1, daysOver30: 1 },
        ],
      }),
    );
    expect(v).toEqual({ tone: 'over', text: 'Free plan: Workers requests hit 100K/day 3 times this week — upgrade to Paid ($5/mo).' });
  });

  it('on Free, fine: no daily limit hit this week', () => {
    expect(verdict(usage({ plan: 'free', metrics: [metric({ period: 'day', included: 100_000, overageUsd: null })] })).tone).toBe('ok');
  });

  it('on Free, today on course past a limit', () => {
    const m = metric({ period: 'day', included: 100_000, used: 60_000, projected: 120_000, overageUsd: null, status: 'watch' });
    expect(verdict(usage({ plan: 'free', metrics: [m] })).text).toBe("Free plan: Workers requests is on course for 120% of today's 100K. Watch it, or upgrade to Paid ($5/mo).");
  });
});

describe('cf usage: Free against Paid', () => {
  it('Free never holds this Worker (CPU limit, email), and lists the days it would have failed', () => {
    const { free, paid, recommend } = compare(
      usage({ freeTier: [{ id: 'workers.requests', label: 'Workers requests', included: 100_000, maxDay: 140_000, daysOver7: 0, daysOver30: 2 }] }),
    );
    expect(recommend).toBe('paid');
    expect(free.fits).toBe(false);
    expect(free.reasons[0]).toBe('Workers requests passed 100K/day on 2 days of the last 30 (peak 140K).');
    expect(free.reasons.some((r) => r.includes('cpu_ms'))).toBe(true);
    expect(paid).toMatchObject({ usd: 5, fits: true });
  });

  it("Paid's cost is the base plus the projected overage, itemised", () => {
    const m = rowsRead({ projected: 30e9, overageUsd: 5, status: 'watch' });
    const { paid } = compare(usage({ metrics: [m], costs: { paidBaseUsd: 5, paidOverageUsd: 5, paidTotalUsd: 10 } }));
    expect(paid.usd).toBe(10);
    expect(paid.reasons).toEqual(['D1 rows read: about $5.00 past 25B.']);
  });
});

describe('cf usage: needs attention and formatting', () => {
  it('flags watch and over quotas, over first', () => {
    const a = metric({ status: 'watch', projected: 9e6 });
    const b = rowsRead({ status: 'over', used: 26e9 });
    expect(flagged([metric(), a, b]).map((m) => m.id)).toEqual(['d1.rowsRead', 'workers.requests']);
    expect(attention(usage({ metrics: [a, b] }))).toEqual({ ok: false, detail: 'D1 rows read (over), Workers requests (watch)' });
    expect(attention(usage())).toEqual({ ok: true, detail: 'Every quota within Workers Paid' });
    expect(attention(usage({ errors: [{ product: 'R2', message: 'x' }] })).detail).toBe("Within Workers Paid's quotas (1 product not read)");
  });

  it('on Free, a limit hit this week is flagged even when today is fine', () => {
    const u = usage({ plan: 'free', freeTier: [{ id: 'd1.rowsRead', label: 'D1 rows read', included: 5e6, maxDay: 6e6, daysOver7: 2, daysOver30: 2 }] });
    expect(attention(u)).toEqual({ ok: false, detail: 'D1 rows read (limit hit twice this week)' });
  });

  it('formats quantities and resets', () => {
    expect(formatQuantity('rows', 25e9)).toBe('25B');
    expect(formatQuantity('ms', 30e6)).toBe('30M ms');
    expect(formatQuantity('neurons', 10_000)).toBe('10K');
    expect(formatPrice(0.3)).toBe('$0.30');
    expect(formatPrice(0.011)).toBe('$0.011');
    expect(formatPrice(4.5)).toBe('$4.50');
    expect(formatQuantity('bytes', 5e9)).toBe('5 GB');
    expect(formatQuantity('bytes', 12_345_678)).toBe('12 MB');
    expect(formatQuantity('bytes', 1010)).toBe('1 kB');
    expect(resetLabel({ period: 'day', periodEnd: '2026-11-08T00:00:00.000Z' })).toBe('Resets at 00:00 UTC');
    expect(resetLabel({ period: 'month', periodEnd: '2026-12-01T00:00:00.000Z' })).toBe('Resets Dec 1');
  });
});
