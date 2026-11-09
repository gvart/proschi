import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE } from '../src/adminAuth';
import {
  buildMetric,
  calendarMonth,
  freeChecks,
  paidSubscription,
  parseAi,
  parseD1Storage,
  parseR2,
  parseWorkers,
  QUOTAS,
  statusOf,
  utcDay,
  type CfUsage,
} from '../src/cfUsage';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';
import { createPasskey } from './webauthn';

/** The admin's Cloudflare usage page (src/cfUsage.ts, P44): the maths, Cloudflare's answers, and the route. */

const SETUP_TOKEN = 'test-admin-setup-token-0123456789';
const TOKEN = 'cf-test-token-never-shown-0123456789';
const DAY = 86_400_000;
const quota = (plan: 'free' | 'paid', id: string) => QUOTAS[plan].find((q) => q.id === id)!;
const at = (s: string) => Date.parse(s);

describe('cf usage: periods', () => {
  it('a calendar month runs from the 1st 00:00 UTC to the next 1st, across a year end', () => {
    expect(calendarMonth(at('2026-11-30T23:59:59Z'))).toEqual({ start: at('2026-11-01T00:00:00Z'), end: at('2026-12-01T00:00:00Z') });
    expect(calendarMonth(at('2026-12-31T12:00:00Z'))).toEqual({ start: at('2026-12-01T00:00:00Z'), end: at('2027-01-01T00:00:00Z') });
    expect(calendarMonth(at('2028-02-10T00:00:00Z')).end).toBe(at('2028-03-01T00:00:00Z'));
  });

  it("Free's day resets at 00:00 UTC", () => {
    expect(utcDay(at('2026-11-07T00:00:00Z'))).toEqual({ start: at('2026-11-07T00:00:00Z'), end: at('2026-11-08T00:00:00Z') });
    expect(utcDay(at('2026-11-07T23:59:59Z')).end).toBe(at('2026-11-08T00:00:00Z'));
  });

  it("Workers Paid's subscription gives the plan and its renewal; a cancelled or other plan doesn't", () => {
    const sub = { rate_plan: { id: 'workers_paid' }, state: 'Paid', current_period_start: '2026-10-14T09:00:00Z', current_period_end: '2026-11-14T09:00:00Z' };
    expect(paidSubscription([{ rate_plan: { id: 'free' } }, sub])).toEqual({ start: at('2026-10-14T09:00:00Z'), end: at('2026-11-14T09:00:00Z') });
    expect(paidSubscription([{ ...sub, state: 'Cancelled' }])).toBeNull();
    expect(paidSubscription([{ ...sub, rate_plan: { id: 'pro' } }])).toBeNull();
    expect(paidSubscription([{ ...sub, current_period_end: 'nope' }])).toBeNull();
  });
});

describe('cf usage: quotas and projections', () => {
  const month = { start: at('2026-11-01T00:00:00Z'), end: at('2026-12-01T00:00:00Z') };
  const now = at('2026-11-16T00:00:00Z'); // half the month

  it('projects a flow in a straight line, says when it passes the quota and what that costs on Paid', () => {
    // 1B rows read on each of the 15 days so far: 15B, 30B by the month's end against 25B included.
    const points = Array.from({ length: 15 }, (_, i) => ({ t: month.start + i * DAY, value: 1e9 }));
    const m = buildMetric(quota('paid', 'd1.rowsRead'), points, month, now, 'paid');
    expect(m.used).toBe(15e9);
    expect(m.percent).toBeCloseTo(0.6);
    expect(m.projected).toBeCloseTo(30e9);
    expect(m.passesAt).toBe('2026-11-26T00:00:00.000Z');
    expect(m.overageUsd).toBe(5); // 5B past 25B at $0.001 a million
    expect(m.status).toBe('watch');
    expect(m.periodEnd).toBe('2026-12-01T00:00:00.000Z');
    expect(m.series).toHaveLength(30);
    expect(m.series.at(-1)).toEqual({ day: '2026-11-16', value: 0 });
    expect(m.series.at(-2)).toEqual({ day: '2026-11-15', value: 1e9 });
  });

  it('counts only the period: usage before its start is in the series, not in what is used', () => {
    const points = [
      { t: at('2026-10-31T12:00:00Z'), value: 500 },
      { t: at('2026-11-02T12:00:00Z'), value: 100 },
    ];
    const m = buildMetric(quota('paid', 'workers.requests'), points, month, now, 'paid');
    expect(m.used).toBe(100);
    expect(m.series.find((d) => d.day === '2026-10-31')?.value).toBe(500);
    expect(m.status).toBe('ok');
    expect(m.overageUsd).toBe(0);
    expect(m.passesAt).toBeNull();
  });

  it('a stock is its latest level, not projected', () => {
    const points = [
      { t: at('2026-11-14T00:00:00Z'), value: 6e9 },
      { t: at('2026-11-15T00:00:00Z'), value: 7e9 },
    ];
    const m = buildMetric(quota('paid', 'd1.storage'), points, month, now, 'paid');
    expect(m.used).toBe(7e9);
    expect(m.projected).toBe(7e9);
    expect(m.status).toBe('over');
    expect(m.overageUsd).toBe(1.5); // 2 GB at $0.75
  });

  it('projects a monthly flow at least an hour into its period', () => {
    const m = buildMetric(quota('paid', 'workers.requests'), [{ t: month.start, value: 1000 }], month, at('2026-11-01T00:01:00Z'), 'paid');
    expect(m.projected).toBeCloseTo(720_000); // 1000 an hour over 720 hours, not 1000 a minute
  });

  it("measures a daily quota's pace over at least 6 hours, and Free has no overage cost", () => {
    const now = at('2026-11-07T00:01:00Z');
    const m = buildMetric(quota('free', 'workers.requests'), [{ t: utcDay(now).start, value: 4000 }], utcDay(now), now, 'free');
    expect(m.projected).toBeCloseTo(4000 + (1439 / 360) * 4000); // the rest of the day at 4000 per 6 hours, not per minute
    expect(m.overageUsd).toBeNull();
    expect(m.status).toBe('ok');
    expect(m.periodEnd).toBe('2026-11-08T00:00:00.000Z');
  });

  it('at 00:03 UTC a little usage with no earlier days is no overage and no warning', () => {
    const now = at('2026-11-16T00:03:00Z');
    const q = quota('paid', 'ai.neurons');
    const m = buildMetric(q, [{ t: at('2026-11-16T00:00:00Z'), value: 823 }], utcDay(now), now, 'paid', month);
    expect(m.projected).toBeCloseTo(823 + (1437 / 360) * 823); // about 4,100, not 395,000
    expect(m.overageUsd).toBe(0);
    expect(m.passesAt).toBeNull();
    expect(m.status).toBe('ok');
    // With 30,000 a day before, the day's first minutes project about a typical day.
    const busy = [...Array.from({ length: 15 }, (_, i) => ({ t: month.start + i * DAY, value: 30_000 })), { t: at('2026-11-16T00:00:00Z'), value: 100 }];
    expect(buildMetric(q, busy, utcDay(now), now, 'paid', month).projected).toBeCloseTo(100 + (1437 / 360) * (100 + (357 / 1440) * 30_000));
  });

  it('status: over once used reaches the quota, watch from 80% projected', () => {
    expect(statusOf(100, 100, 100)).toBe('over');
    expect(statusOf(10, 80, 100)).toBe('watch');
    expect(statusOf(10, 79, 100)).toBe('ok');
  });

  it('Workers AI: 10,000 free neurons a day, reset at 00:00 UTC; Paid bills each day past them at $0.011 per 1,000', () => {
    const q = quota('paid', 'ai.neurons');
    expect(q).toMatchObject({ product: 'Workers AI', unit: 'neurons', period: 'day', included: 10_000, per: 1000, priceUsd: 0.011 });
    expect(quota('free', 'ai.neurons')).toMatchObject({ period: 'day', included: 10_000 });
    expect(quota('free', 'ai.neurons').priceUsd).toBeUndefined();
    // 15 days so far: 30,000 neurons each (20,000 past the allocation), and 6,000 by 06:00 today (24,000 projected: 14,000 past).
    const noon = at('2026-11-16T06:00:00Z');
    const points = [...Array.from({ length: 15 }, (_, i) => ({ t: month.start + i * DAY, value: 30_000 })), { t: at('2026-11-16T00:00:00Z'), value: 6000 }];
    const m = buildMetric(q, points, utcDay(noon), noon, 'paid', month);
    expect(m.used).toBe(6000);
    expect(m.projected).toBeCloseTo(24_000);
    expect(m.periodEnd).toBe('2026-11-17T00:00:00.000Z');
    expect(m.passesAt).toBe('2026-11-16T10:00:00.000Z');
    expect(m.status).toBe('watch');
    expect(m.series.at(-1)).toEqual({ day: '2026-11-16', value: 6000 });
    // (15 × 20,000 + 14,000) over 16 days, carried to 30: 588,750 neurons, at $0.011 per 1,000.
    expect(m.overageUsd).toBe(6.48);
    // Under the allocation every day: nothing to pay.
    const quiet = buildMetric(q, [{ t: at('2026-11-15T00:00:00Z'), value: 9000 }], utcDay(noon), noon, 'paid', month);
    expect(quiet.overageUsd).toBe(0);
    expect(buildMetric(quota('free', 'ai.neurons'), points, utcDay(noon), noon, 'free', month).overageUsd).toBeNull();
  });

  it("counts the days Free's daily limits were passed", () => {
    const series = Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, value: i >= 27 || i === 5 ? 150_000 : 1000 }));
    expect(freeChecks(new Map([['workers.requests', series]]))).toEqual([
      { id: 'workers.requests', label: 'Workers requests', included: 100_000, maxDay: 150_000, daysOver7: 3, daysOver30: 4 },
    ]);
  });
});

describe("cf usage: Cloudflare's answers", () => {
  it('reads Workers requests and CPU (µs to ms), R2 by class, storage summed across databases', () => {
    const w = parseWorkers([{ sum: { requests: 10, cpuTimeUs: 2500 }, dimensions: { datetimeHour: '2026-11-07T03:00:00Z' } }]);
    expect(w['workers.requests']).toEqual([{ t: at('2026-11-07T03:00:00Z'), value: 10 }]);
    expect(w['workers.cpu'][0].value).toBe(2.5);
    const r2 = parseR2([
      { sum: { requests: 3 }, dimensions: { date: '2026-11-07', actionType: 'PutObject' } },
      { sum: { requests: 4 }, dimensions: { date: '2026-11-07', actionType: 'ListObjectsV2' } },
      { sum: { requests: 5 }, dimensions: { date: '2026-11-07', actionType: 'GetObject' } },
      { sum: { requests: 9 }, dimensions: { date: '2026-11-07', actionType: 'DeleteObject' } },
    ]);
    expect(r2['r2.classA'].map((p) => p.value)).toEqual([3, 4]);
    // aiInferenceAdaptiveGroups: neurons by UTC day, all models.
    expect(parseAi([{ sum: { totalNeurons: 412.5 }, dimensions: { date: '2026-11-07' } }])['ai.neurons']).toEqual([{ t: at('2026-11-07T00:00:00Z'), value: 412.5 }]);
    expect(r2['r2.classB'].map((p) => p.value)).toEqual([5]);
    const s = parseD1Storage([
      { max: { databaseSizeBytes: 100 }, dimensions: { date: '2026-11-07', databaseId: 'a' } },
      { max: { databaseSizeBytes: 50 }, dimensions: { date: '2026-11-07', databaseId: 'b' } },
      { max: { databaseSizeBytes: 90 }, dimensions: { date: '2026-11-06', databaseId: 'a' } },
    ]);
    expect(s['d1.storage'].sort((x, y) => x.t - y.t)).toEqual([
      { t: at('2026-11-06T00:00:00Z'), value: 90 },
      { t: at('2026-11-07T00:00:00Z'), value: 150 },
    ]);
  });
});

// --- The route ---------------------------------------------------------------

const cfEnv = env as unknown as Record<string, string | undefined>;
let accounts = 0;

function adminCall(path: string, admin?: string) {
  return call(path, { headers: admin ? { Cookie: `${ADMIN_COOKIE}=${admin}` } : {} });
}

async function setUp(): Promise<string> {
  const passkey = await createPasskey();
  const options = (await (await call('/api/admin/setup/options', { method: 'POST', body: { setupToken: SETUP_TOKEN } })).json()) as { challenge: string; rp: { id: string } };
  const response = await call('/api/admin/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, name: 'Laptop', response: await passkey.register(options, ORIGIN) } });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!;
  return cookie.split(';')[0].split('=')[1];
}

const today = () => new Date().toISOString().slice(0, 10);
const hour = () => `${new Date().toISOString().slice(0, 13)}:00:00Z`;
const gql = (rows: unknown[]) => Response.json({ data: { viewer: { accounts: [{ rows }], zones: [{ rows }] } }, errors: null });

/** Cloudflare's API, answering from fixtures; `fail` names datasets that answer with a GraphQL error. */
function mockCloudflare({ fail = [] as string[], subscriptions = 403 as number | unknown[] } = {}) {
  const real = globalThis.fetch;
  const calls: { url: string; auth: string | null; query?: string }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.cloudflare.com/')) return real(input, init);
    const auth = new Headers(init?.headers).get('Authorization');
    if (url.endsWith('/subscriptions')) {
      calls.push({ url, auth });
      return typeof subscriptions === 'number' ? Response.json({ success: false }, { status: subscriptions }) : Response.json({ success: true, result: subscriptions });
    }
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    calls.push({ url, auth, query });
    const dataset = /rows: (\w+)/.exec(query)![1];
    if (fail.includes(dataset)) return Response.json({ data: null, errors: [{ message: `not authorized for ${dataset}` }] });
    switch (dataset) {
      case 'workersInvocationsAdaptive':
        return gql([{ sum: { requests: 1200, cpuTimeUs: 3_000_000 }, dimensions: { datetimeHour: hour() } }]);
      case 'aiInferenceAdaptiveGroups':
        return gql([{ sum: { totalNeurons: 823 }, dimensions: { date: today() } }]);
      case 'd1AnalyticsAdaptiveGroups':
        return gql([{ sum: { rowsRead: 40_000, rowsWritten: 300 }, dimensions: { date: today() } }]);
      case 'd1StorageAdaptiveGroups':
        return gql([{ max: { databaseSizeBytes: 12_000_000 }, dimensions: { date: today(), databaseId: 'db' } }]);
      case 'r2OperationsAdaptiveGroups':
        return gql([{ sum: { requests: 7 }, dimensions: { date: today(), actionType: 'PutObject' } }]);
      case 'r2StorageAdaptiveGroups':
        return gql([{ max: { payloadSize: 1000, metadataSize: 10 }, dimensions: { date: today(), bucketName: 'proschi-feedback' } }]);
      case 'emailSendingAdaptiveGroups':
        return gql([{ count: 12, dimensions: { date: today() } }]);
    }
    return Response.json({ errors: [{ message: 'unknown' }] });
  });
  return { spy, calls };
}

describe('GET /api/admin/cf-usage', () => {
  beforeEach(async () => {
    await resetDatabase();
    // A new account each test: its own cache entry.
    cfEnv.CF_ACCOUNT_ID = `acct-${++accounts}-${crypto.randomUUID()}`;
    cfEnv.CF_API_TOKEN = TOKEN;
  });
  afterEach(() => {
    cfEnv.CF_API_TOKEN = '';
    cfEnv.CF_ACCOUNT_ID = '';
    cfEnv.CF_ZONE_ID = '';
    cfEnv.CF_PLAN = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('is for the admin only: 401 without an admin session, also with a user’s', async () => {
    const { calls } = mockCloudflare();
    expect((await adminCall('/api/admin/cf-usage')).status).toBe(401);
    const { token } = await signedInUser();
    expect((await call('/api/admin/cf-usage', { token })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('answers 501 with what to add when it is not configured', async () => {
    const admin = await setUp();
    cfEnv.CF_API_TOKEN = '';
    const response = await adminCall('/api/admin/cf-usage', admin);
    expect(response.status).toBe(501);
    expect(((await response.json()) as { error: string }).error).toContain('add CF_API_TOKEN');
  });

  it('reports each quota on Paid (CF_PLAN default), sends the token only to Cloudflare, never back, and caches the answer', async () => {
    // Just after 00:00 UTC, when a straight line through today's 823 neurons would be over 10,000.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-08T00:03:00Z'));
    const admin = await setUp();
    cfEnv.CF_ZONE_ID = 'zone-1';
    const { calls } = mockCloudflare();
    const response = await adminCall('/api/admin/cf-usage', admin);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(TOKEN);
    const body = JSON.parse(text) as CfUsage;
    expect(body).toMatchObject({ plan: 'paid', planSource: 'CF_PLAN', cached: false, errors: [], period: { source: 'calendar' }, fetchedAt: '2026-11-08T00:03:00.000Z' });
    expect(body.metrics.map((m) => m.id)).toEqual(QUOTAS.paid.map((q) => q.id));
    const byId = Object.fromEntries(body.metrics.map((m) => [m.id, m]));
    expect(byId['workers.requests'].used).toBe(1200);
    expect(byId['workers.cpu'].used).toBe(3000);
    expect(byId['d1.rowsRead'].used).toBe(40_000);
    expect(byId['d1.storage'].used).toBe(12_000_000);
    expect(byId['r2.classA'].used).toBe(7);
    expect(byId['r2.storage'].used).toBe(1010);
    expect(byId['email.sent'].used).toBe(12);
    expect(byId['ai.neurons']).toMatchObject({ product: 'Workers AI', used: 823, included: 10_000, per: 1000, priceUsd: 0.011, period: 'day', overageUsd: 0 });
    expect(calls.find((c) => c.query?.includes('aiInferenceAdaptiveGroups'))?.query).toMatch(/sum \{ totalNeurons \} dimensions \{ date \}/);
    expect(body.costs).toEqual({ paidBaseUsd: 5, paidOverageUsd: 0, paidTotalUsd: 5 });
    expect(body.freeTier.map((f) => f.id)).toEqual(['workers.requests', 'ai.neurons', 'd1.rowsRead', 'd1.rowsWritten']);
    expect(calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
    const fetched = calls.length;
    expect(fetched).toBe(8); // subscriptions, six account datasets and the zone's email

    const again = (await (await adminCall('/api/admin/cf-usage', admin)).json()) as CfUsage;
    expect(again.cached).toBe(true);
    expect(again.metrics).toEqual(body.metrics);
    expect(calls).toHaveLength(fetched);
  });

  it('takes the plan and period from Workers Paid’s subscription when the token can read it', async () => {
    const admin = await setUp();
    cfEnv.CF_PLAN = 'free';
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 27 * 86_400_000).toISOString();
    mockCloudflare({ subscriptions: [{ rate_plan: { id: 'workers_paid' }, state: 'Paid', current_period_start: start, current_period_end: end }] });
    const body = (await (await adminCall('/api/admin/cf-usage', admin)).json()) as CfUsage;
    expect(body).toMatchObject({ plan: 'paid', planSource: 'subscription', period: { start, end, source: 'subscription' } });
    expect(body.metrics.find((m) => m.id === 'workers.requests')!.periodEnd).toBe(end);
  });

  it('uses Free’s daily limits with CF_PLAN=free, resetting at the next 00:00 UTC', async () => {
    const admin = await setUp();
    cfEnv.CF_PLAN = 'free';
    mockCloudflare();
    const body = (await (await adminCall('/api/admin/cf-usage', admin)).json()) as CfUsage;
    expect(body.plan).toBe('free');
    expect(body.metrics.map((m) => m.id)).toEqual(QUOTAS.free.map((q) => q.id));
    const requests = body.metrics.find((m) => m.id === 'workers.requests')!;
    expect(requests).toMatchObject({ included: 100_000, period: 'day', overageUsd: null });
    expect(requests.periodEnd).toBe(new Date(Date.parse(`${today()}T00:00:00Z`) + 86_400_000).toISOString());
  });

  it('degrades when Cloudflare refuses a dataset: the rest still shows, the failure is named', async () => {
    const admin = await setUp();
    mockCloudflare({ fail: ['d1AnalyticsAdaptiveGroups'] });
    const response = await adminCall('/api/admin/cf-usage', admin);
    expect(response.status).toBe(200);
    const body = (await response.json()) as CfUsage;
    expect(body.errors).toEqual([{ product: 'D1', message: 'not authorized for d1AnalyticsAdaptiveGroups' }]);
    expect(body.metrics.some((m) => m.id === 'd1.rowsRead')).toBe(false);
    expect(body.metrics.some((m) => m.id === 'workers.requests')).toBe(true);
    expect(body.metrics.some((m) => m.id === 'ai.neurons')).toBe(true);
    expect(body.notes.some((n) => n.includes('CF_ZONE_ID'))).toBe(true);
  });

  it('degrades when Cloudflare is down', async () => {
    const admin = await setUp();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.startsWith('https://api.cloudflare.com/') ? new Response('bad gateway', { status: 502 }) : real(input, init);
    });
    const response = await adminCall('/api/admin/cf-usage', admin);
    expect(response.status).toBe(200);
    const body = (await response.json()) as CfUsage;
    expect(body.metrics).toEqual([]);
    expect(body.errors).toHaveLength(6);
    expect(body.errors[0].message).toBe('Cloudflare API answered 502');
  });

  it('Health says whether the Cloudflare secrets are set, never their values', async () => {
    const admin = await setUp();
    cfEnv.CF_ZONE_ID = '';
    const text = await (await adminCall('/api/admin/health', admin)).text();
    expect(text).not.toContain(TOKEN);
    const health = JSON.parse(text) as { config: { cloudflare: unknown } };
    expect(health.config.cloudflare).toEqual({ apiToken: true, accountId: true, zoneId: false, plan: 'paid' });
  });
});
