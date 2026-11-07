import { describe, expect, it } from 'vitest';
import type { PolarDashboard } from './api';
import { polarCustomerUrl, polarOrderUrl, polarSubscriptionUrl } from './polarLinks';

/** What backend/src/admin.ts polarDashboard sends (pinned there by test/adminPaid.test.ts). */
const dashboard = (server: 'sandbox' | 'live'): PolarDashboard => {
  const base = server === 'sandbox' ? 'https://sandbox.polar.sh' : 'https://polar.sh';
  return { server, customers: `${base}/to/dashboard/customers`, orders: `${base}/to/dashboard/sales`, subscriptions: `${base}/to/dashboard/sales/subscriptions` };
};

describe('Polar deep links', () => {
  it('open the customer, order and subscription pages, live and sandbox', () => {
    const id = '992fae2a-2a17-4b7a-8d9d-e287cf90131b';
    expect(polarCustomerUrl(dashboard('live'), id)).toBe(`https://polar.sh/to/dashboard/customers/${id}`);
    expect(polarOrderUrl(dashboard('live'), id)).toBe(`https://polar.sh/to/dashboard/sales/${id}`);
    expect(polarSubscriptionUrl(dashboard('live'), id)).toBe(`https://polar.sh/to/dashboard/sales/subscriptions/${id}`);
    expect(polarCustomerUrl(dashboard('sandbox'), id)).toBe(`https://sandbox.polar.sh/to/dashboard/customers/${id}`);
    expect(polarOrderUrl(dashboard('sandbox'), id)).toBe(`https://sandbox.polar.sh/to/dashboard/sales/${id}`);
    expect(polarSubscriptionUrl(dashboard('sandbox'), id)).toBe(`https://sandbox.polar.sh/to/dashboard/sales/subscriptions/${id}`);
  });

  it('escape an id', () => {
    expect(polarOrderUrl(dashboard('live'), 'a/b?c')).toBe('https://polar.sh/to/dashboard/sales/a%2Fb%3Fc');
  });
});
