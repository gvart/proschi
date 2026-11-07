import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE } from '../src/adminAuth';
import { TOKEN_CAP } from '../src/ai/budget';
import { hourlyCron } from '../src/cron';
import type { Env } from '../src/env';
import worker from '../src/index';
import { effectivePlan } from '../src/plans';
import { call, dailyRun, ORIGIN, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';
import { createPasskey } from './webauthn';

/**
 * The admin panel's paid-product routes (src/admin.ts, docs/design/paid-plans.md
 * P24): billing and credits, AI usage, the webhook log, live share links,
 * the health page's configuration, and the admin's credit grants and comps.
 */

const SETUP_TOKEN = 'test-admin-setup-token-0123456789';
const SECRET = 'polar_whs_test-secret';

function adminCall(path: string, admin: string | undefined, init: Parameters<typeof call>[1] = {}) {
  const headers = new Headers(init.headers);
  if (admin) headers.append('Cookie', `${ADMIN_COOKIE}=${admin}`);
  return call(path, { ...init, headers });
}

async function setUp(): Promise<string> {
  const passkey = await createPasskey();
  const options = (await (await call('/api/admin/setup/options', { method: 'POST', body: { setupToken: SETUP_TOKEN } })).json()) as { challenge: string; rp: { id: string } };
  const response = await call('/api/admin/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, name: 'Laptop', response: await passkey.register(options, ORIGIN) } });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!;
  return cookie.split(';')[0].split('=')[1];
}

async function audit(action: string): Promise<{ target: string; detail: Record<string, unknown>; passkey_id: string | null }[]> {
  const { results } = await env.DB.prepare('SELECT target, detail, passkey_id FROM admin_audit WHERE action = ? ORDER BY id').bind(action).all<{ target: string; detail: string; passkey_id: string | null }>();
  return results.map((r) => ({ ...r, detail: JSON.parse(r.detail) as Record<string, unknown> }));
}

let events = 0;
/** Polar's delivery of `event`, signed unless `sig` says otherwise, from a new IP unless `ip` is given. */
async function deliver(event: unknown, { id = `evt-admin-${++events}`, sig, ip }: { id?: string; sig?: string; ip?: string } = {}): Promise<Response> {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return call('/api/billing/webhook', { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig ?? `v1,${btoa(String.fromCharCode(...mac))}`, ...(ip ? { 'CF-Connecting-IP': ip } : {}) }, body: event });
}

const subscription = (userId: string, status: string, modified: string, product = 'prod-pro-monthly') => ({
  type: `subscription.${status === 'canceled' ? 'canceled' : 'updated'}`,
  data: { id: `sub-${userId}`, status, product_id: product, customer_id: `cus-${userId}`, customer: { id: `cus-${userId}`, external_id: userId }, current_period_end: '2026-12-06T00:00:00Z', modified_at: modified },
});
const paidPack = (userId: string, order: string) => ({ type: 'order.paid', data: { id: order, product_id: 'prod-pack-5', customer_id: `cus-${userId}`, customer: { external_id: userId } } });

const nowS = () => Math.floor(Date.now() / 1000);
const ref = () => crypto.randomUUID();

// GET /api/roadmap/next answers 501 without the AI key; it calls no model, so a fake key does.
const aiEnv = env as unknown as { ANTHROPIC_API_KEY?: string };

describe('admin: the paid product', () => {
  beforeEach(async () => {
    await resetDatabase();
    aiEnv.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete aiEnv.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('needs an admin session for every new route, and this site’s Origin for changes', async () => {
    const { id, token } = await signedInUser();
    const gets = ['/api/admin/billing', '/api/admin/ai', '/api/admin/trends', '/api/admin/webhooks', '/api/admin/document-shares', `/api/admin/users/${id}/credits`];
    const changes: [string, string, unknown][] = [
      ['POST', `/api/admin/users/${id}/credits`, { kind: 'grant', credits: 1, ref: ref(), reason: 'x' }],
      ['POST', `/api/admin/users/${id}/comp`, { until: nowS() + 86_400, reason: 'x' }],
      ['POST', `/api/admin/users/${id}/comp/end`, { reason: 'x' }],
      ['DELETE', '/api/admin/document-shares/AAAAAAAAAAAAAAAAAAAAAA', undefined],
    ];
    for (const path of gets) {
      expect((await call(path)).status, path).toBe(401);
      expect((await call(path, { token })).status, `${path} with a user's session`).toBe(401);
    }
    for (const [method, path, body] of changes) expect((await call(path, { method, body, token })).status, `${method} ${path}`).toBe(401);
    const admin = await setUp();
    for (const path of gets) expect((await adminCall(path, admin)).status, path).toBe(200);
    for (const [method, path, body] of changes) {
      expect((await adminCall(path, admin, { method, body, headers: { Origin: 'https://evil.test' } })).status, `${method} ${path} cross-site`).toBe(403);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action != 'admin.setup'").first()).toEqual({ n: 0 });
  });

  it('grants and revokes pack credits once per ref, with a reason, never below 0, in the audit log', async () => {
    const admin = await setUp();
    const { id } = await signedInUser();
    const path = `/api/admin/users/${id}/credits`;
    const grant = { kind: 'grant', credits: 3, ref: ref(), reason: 'Support: the interview crashed' };

    // A reason is required, and so are a sane amount and a ref.
    for (const bad of [{ ...grant, reason: '' }, { ...grant, reason: '   ' }, { ...grant, reason: undefined }, { ...grant, credits: 0 }, { ...grant, credits: 101 }, { ...grant, credits: 1.5 }, { ...grant, ref: 'x' }, { ...grant, kind: 'gift' }]) {
      expect((await adminCall(path, admin, { method: 'POST', body: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await audit('user.credits.grant')).toEqual([]);

    const granted = await adminCall(path, admin, { method: 'POST', body: grant });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ delta: 3, credits: { pack: 3, trial: 1, total: 4 } });
    // The same ref again: nothing more, and no second audit entry.
    expect(await (await adminCall(path, admin, { method: 'POST', body: grant })).json()).toMatchObject({ duplicate: true, delta: 3, credits: { pack: 3 } });
    const entries = await audit('user.credits.grant');
    expect(entries).toEqual([{ target: id, detail: { credits: 3, reason: grant.reason, ref: grant.ref }, passkey_id: expect.any(String) }]);

    // A revoke takes at most what is left: 5 asked, 3 there.
    const revoke = { kind: 'revoke', credits: 5, ref: ref(), reason: 'Granted by mistake' };
    expect(await (await adminCall(path, admin, { method: 'POST', body: revoke })).json()).toMatchObject({ delta: -3, credits: { pack: 0 } });
    expect(await audit('user.credits.revoke')).toEqual([{ target: id, detail: { credits: 3, reason: revoke.reason, ref: revoke.ref }, passkey_id: expect.any(String) }]);
    // Nothing left: 409, and no row.
    expect((await adminCall(path, admin, { method: 'POST', body: { ...revoke, ref: ref() } })).status).toBe(409);
    const ledger = (await (await adminCall(path, admin)).json()) as { total: number; entries: { kind: string; delta: number; bucket: string; refId: string }[] };
    expect(ledger.total).toBe(2);
    expect(ledger.entries.map((e) => [e.kind, e.bucket, e.delta])).toEqual([
      ['admin_revoke', 'pack', -3],
      ['admin_grant', 'pack', 3],
    ]);
    // A ref used for one account can't be replayed on another.
    const other = await signedInUser();
    expect((await adminCall(`/api/admin/users/${other.id}/credits`, admin, { method: 'POST', body: grant })).status).toBe(409);
  });

  it('comps Pro until a date without Polar, ends it early, and needs a reason for both', async () => {
    const admin = await setUp();
    const user = await signedInUser();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const path = `/api/admin/users/${user.id}/comp`;
    const until = nowS() + 30 * 86_400;
    for (const bad of [{ until }, { until, reason: ' ' }, { until: nowS() - 1, reason: 'x' }, { until: nowS() + 6 * 366 * 86_400, reason: 'x' }, { until: 'tomorrow', reason: 'x' }]) {
      expect((await adminCall(path, admin, { method: 'POST', body: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await adminCall(path, admin, { method: 'POST', body: { until, reason: 'Conference speaker' } })).status).toBe(204);
    expect(fetchSpy.mock.calls.some(([input]) => String(input instanceof Request ? input.url : input).includes('polar'))).toBe(false);
    expect(await audit('user.comp')).toEqual([{ target: user.id, detail: { until, reason: 'Conference speaker' }, passkey_id: expect.any(String) }]);
    const detail = (await (await adminCall(`/api/admin/users/${user.id}`, admin)).json()) as { user: { plan: string; effectivePlan: string; compUntil: number } };
    expect(detail.user).toMatchObject({ plan: 'free', effectivePlan: 'pro', compUntil: until });
    expect((await call('/api/roadmap/next', { token: user.token })).status).toBe(200);

    expect((await adminCall(`${path}/end`, admin, { method: 'POST', body: {} })).status).toBe(400);
    expect((await adminCall(`${path}/end`, admin, { method: 'POST', body: { reason: 'Talk cancelled' } })).status).toBe(204);
    expect(await audit('user.comp.end')).toEqual([{ target: user.id, detail: { reason: 'Talk cancelled' }, passkey_id: expect.any(String) }]);
    expect((await call('/api/roadmap/next', { token: user.token })).status).toBe(402);
    expect((await adminCall(`${path}/end`, admin, { method: 'POST', body: { reason: 'again' } })).status).toBe(409);
    expect((await adminCall('/api/admin/users/00000000-0000-4000-8000-000000000000/comp', admin, { method: 'POST', body: { until, reason: 'x' } })).status).toBe(404);
  });

  it('ending a comp leaves a subscription’s Pro as it is', async () => {
    const admin = await setUp();
    const user = await signedInUser();
    expect((await deliver(subscription(user.id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    await adminCall(`/api/admin/users/${user.id}/comp`, admin, { method: 'POST', body: { until: nowS() + 86_400, reason: 'x' } });
    await adminCall(`/api/admin/users/${user.id}/comp/end`, admin, { method: 'POST', body: { reason: 'y' } });
    expect((await call('/api/roadmap/next', { token: user.token })).status).toBe(200);
  });

  it('computes the effective plan in one place', () => {
    expect(effectivePlan('free', null, 100)).toBe('free');
    expect(effectivePlan('pro', null, 100)).toBe('pro');
    expect(effectivePlan('free', 101, 100)).toBe('pro');
    expect(effectivePlan('free', 100, 100)).toBe('free');
    expect(effectivePlan('pro', 50, 100)).toBe('pro');
  });

  it('shows an account’s subscription, effective plan and credit balance', async () => {
    const admin = await setUp();
    const user = await signedInUser();
    await deliver(subscription(user.id, 'past_due', '2026-11-06T10:00:00Z', 'prod-pro-yearly'));
    await deliver(paidPack(user.id, 'ord-1'));
    const detail = (await (await adminCall(`/api/admin/users/${user.id}`, admin)).json()) as Record<string, unknown>;
    expect(detail.user).toMatchObject({ plan: 'pro', effectivePlan: 'pro', compUntil: null });
    expect(detail.billing).toEqual({
      polarCustomerId: `cus-${user.id}`,
      polarSubscriptionId: `sub-${user.id}`,
      status: 'past_due',
      product: 'pro_yearly',
      currentPeriodEnd: Date.parse('2026-12-06T00:00:00Z') / 1000,
      cancelAtPeriodEnd: false,
      pastDue: true,
      updatedAt: expect.any(Number),
    });
    expect(detail.credits).toMatchObject({ monthly: 4, trial: 1, pack: 5, total: 10 });
    expect(detail.polarDashboard).toEqual({ server: 'sandbox', customers: 'https://sandbox.polar.sh/to/dashboard/customers', orders: 'https://sandbox.polar.sh/to/dashboard/sales' });
  });

  it('sums up billing: Pro accounts, subscribers, comps, pack orders and refunds', async () => {
    const admin = await setUp();
    const [monthly, yearly, comped, packer] = [await signedInUser('Mo'), await signedInUser('Yan'), await signedInUser('Cam'), await signedInUser('Pat')];
    await deliver(subscription(monthly.id, 'active', '2026-11-06T10:00:00Z'));
    await deliver(subscription(yearly.id, 'active', '2026-11-06T10:00:00Z', 'prod-pro-yearly'));
    await adminCall(`/api/admin/users/${comped.id}/comp`, admin, { method: 'POST', body: { until: nowS() + 86_400, reason: 'x' } });
    await deliver(paidPack(packer.id, 'ord-a'));
    await deliver(paidPack(packer.id, 'ord-b'));
    await deliver({ type: 'order.refunded', data: { id: 'ord-b' } });
    const billing = (await (await adminCall('/api/admin/billing', admin)).json()) as {
      counts: Record<string, number>;
      pro: { displayName: string; source: string }[];
      orders: { orderId: string; refunded: boolean }[];
      adjustments: { kind: string; delta: number }[];
      refundedOrders: { orderId: string; user: { displayName: string } }[];
    };
    expect(billing.counts).toEqual({ pro: 3, monthly: 1, yearly: 1, pastDue: 0, canceling: 0, comped: 1, packOrdersThisMonth: 2, packOrders: 2, refundedThisMonth: 1, refunded: 1 });
    expect(billing.pro.map((p) => [p.displayName, p.source])).toEqual([
      ['Cam', 'comp'],
      ['Mo', 'subscription'],
      ['Yan', 'subscription'],
    ]);
    expect(billing.orders.map((o) => [o.orderId, o.refunded])).toEqual([
      ['ord-b', true],
      ['ord-a', false],
    ]);
    expect(billing.adjustments.map((a) => [a.kind, a.delta])).toEqual([['revoke', -5]]);
    expect(billing.refundedOrders).toEqual([{ orderId: 'ord-b', refundedAt: expect.any(Number), user: { id: packer.id, displayName: 'Pat' } }]);
    // No amounts anywhere: D1 stores none.
    expect(JSON.stringify(billing)).not.toMatch(/amount|price|€|eur/i);
  });

  it('sums up AI usage for 30 days: interviews, refunds, reviews, cost, top users and the token cap', async () => {
    const admin = await setUp();
    const ada = await signedInUser('Ada');
    const bob = await signedInUser('Bob');
    const t = Date.now();
    const today = new Date(t).toISOString().slice(0, 10);
    const insert = (id: string, user: string, status: string, tokens: number, cost: number, at = t) =>
      env.DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, started_at, tokens, cost_usd) VALUES (?, ?, 'url-shortener', 45, ?, ?, ?, ?)").bind(id, user, status, at, tokens, cost);
    await env.DB.batch([
      insert('i1', ada.id, 'finished', TOKEN_CAP - 10_000, 1.5),
      insert('i2', ada.id, 'finished', 100_000, 0.5),
      insert('i3', bob.id, 'failed', 1_000, 0.01),
      insert('i4', bob.id, 'active', 2_000, 0.02),
      insert('old', bob.id, 'finished', 2_000, 9, t - 40 * 86_400_000),
      env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, delta, item, ref_id, created_at) VALUES (?, 'refund', 'trial', 1, 'interview', 'i3', ?)").bind(bob.id, t),
      env.DB.prepare('INSERT INTO review_usage (user_id, day, count) VALUES (?, ?, 7)').bind(ada.id, today),
    ]);
    const ai = (await (await adminCall('/api/admin/ai', admin)).json()) as {
      days: { day: string; started: number; finished: number; failed: number; refunded: number; reviews: number; tokens: number; costUsd: number }[];
      totals: Record<string, number | null>;
      topUsers: { displayName: string; costUsd: number }[];
    };
    expect(ai.days).toHaveLength(30);
    expect(ai.days.at(-1)).toEqual({ day: today, started: 4, finished: 2, failed: 1, refunded: 1, reviews: 7, tokens: TOKEN_CAP + 93_000, costUsd: expect.closeTo(2.03, 5) });
    expect(ai.totals).toMatchObject({ sessions: 4, finished: 2, capped: 1, cappedShare: 0.25, reviews: 7, avgCostPerFinished: 1 });
    expect(ai.topUsers.map((u) => u.displayName)).toEqual(['Ada', 'Bob']);
    const overview = (await (await adminCall('/api/admin/overview', admin)).json()) as { aiSpend: { day: string; costUsd: number }[] };
    expect(overview.aiSpend).toHaveLength(30);
    expect(overview.aiSpend.at(-1)!.costUsd).toBeCloseTo(2.03, 5);
  });

  it('gives the overview daily trends for 7, 30 or 90 days and the period before', async () => {
    const admin = await setUp();
    const ada = await signedInUser('Ada');
    const bob = await signedInUser('Bob');
    const t = Date.now();
    const s = Math.floor(t / 1000);
    const day = (n: number) => new Date(t - n * 86_400_000).toISOString().slice(0, 10);
    await env.DB.batch([
      // Ada signed up today; Bob 3 days ago, and reviewed a card 10 days ago.
      env.DB.prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(s, ada.id),
      env.DB.prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(s - 3 * 86_400, bob.id),
      env.DB.prepare("INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day) VALUES ('r1', ?, 'c1', 1, 3, ?, 1000, ?)").bind(bob.id, s - 10 * 86_400, day(10)),
      // An interview started 2 days ago and finished yesterday; a pack today.
      env.DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, started_at, ended_at, tokens, cost_usd) VALUES ('i1', ?, 'url-shortener', 45, 'finished', ?, ?, 1000, 0.5)").bind(
        ada.id,
        t - 2 * 86_400_000,
        t - 86_400_000,
      ),
      env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, delta, item, ref_id, created_at) VALUES (?, 'grant', 'pack', 5, 'pack_5', 'ord_1', ?)").bind(ada.id, t),
      // Bob subscribed 5 days ago; a bad signature today.
      env.DB.prepare("INSERT INTO billing (user_id, status, product, updated_at) VALUES (?, 'active', 'pro_monthly', ?)").bind(bob.id, t),
      env.DB.prepare("INSERT INTO billing_webhooks (received_at, webhook_id, type, outcome, user_id) VALUES (?, 'w1', 'subscription.active', 'applied', ?)").bind(t - 5 * 86_400_000, bob.id),
      env.DB.prepare("INSERT INTO billing_webhooks (received_at, webhook_id, type, outcome, user_id) VALUES (?, NULL, NULL, 'bad_signature', NULL)").bind(t),
      env.DB.prepare("INSERT INTO daily_counts (day, event, count) VALUES (?, 'editor_open', 4)").bind(day(0)),
    ]);

    expect((await adminCall('/api/admin/trends?days=14', admin)).status).toBe(400);
    for (const days of [7, 30, 90]) {
      const trends = (await (await adminCall(`/api/admin/trends?days=${days}`, admin)).json()) as { days: number; from: string; to: string; points: { day: string }[]; usage: { days: unknown[] } };
      expect(trends).toMatchObject({ days, from: day(2 * days - 1), to: day(0) });
      expect(trends.points).toHaveLength(2 * days);
      expect(trends.usage.days).toHaveLength(2 * days);
    }
    const trends = (await (await adminCall('/api/admin/trends?days=30', admin)).json()) as { points: Record<string, number | string>[]; usage: { days: { counts: Record<string, number> }[] } };
    const at = (n: number) => trends.points[trends.points.length - 1 - n];
    expect(at(0)).toEqual({ day: day(0), signups: 1, active: 2, interviewsStarted: 0, interviewsFinished: 0, aiCostUsd: 0, packOrders: 1, webhookFailures: 1, proSubscribers: 1 });
    expect(at(1)).toMatchObject({ interviewsFinished: 1 });
    expect(at(2)).toMatchObject({ interviewsStarted: 1, aiCostUsd: 0.5 });
    expect(at(3)).toMatchObject({ signups: 1, active: 1 });
    // Bob's review 10 days ago keeps him in the weekly count until 4 days ago.
    expect([at(10).active, at(4).active, at(9).active, at(11).active]).toEqual([1, 1, 1, 0]);
    // Pro counted back from today: Bob from 5 days ago, nobody before.
    expect([at(5).proSubscribers, at(6).proSubscribers]).toEqual([1, 0]);
    expect(trends.usage.days.at(-1)!.counts).toEqual({ editor_open: 4 });
  });

  it('logs every webhook delivery with its outcome, never the payload, and prunes after 90 days', async () => {
    const admin = await setUp();
    const user = await signedInUser();
    await deliver(subscription(user.id, 'active', '2026-11-06T10:00:00Z'), { id: 'evt-applied' });
    await deliver(subscription(user.id, 'active', '2026-11-06T10:00:00Z'), { id: 'evt-applied' });
    await deliver(subscription(user.id, 'canceled', '2026-11-05T10:00:00Z'), { id: 'evt-stale' });
    await deliver({ type: 'checkout.created', data: { id: 'chk-1', customer_email: 'ada@example.com' } }, { id: 'evt-ignored' });
    expect((await deliver(subscription(user.id, 'active', '2026-11-06T12:00:00Z'), { id: 'evt-forged', sig: 'v1,AAAA' })).status).toBe(403);
    const { results } = await env.DB.prepare('SELECT * FROM billing_webhooks ORDER BY id').all<Record<string, unknown>>();
    expect(results.map((r) => [r.webhook_id, r.type, r.outcome, r.user_id])).toEqual([
      ['evt-applied', 'subscription.updated', 'applied', user.id],
      ['evt-applied', 'subscription.updated', 'duplicate', user.id],
      ['evt-stale', 'subscription.canceled', 'stale', user.id],
      ['evt-ignored', 'checkout.created', 'ignored', null],
      ['evt-forged', null, 'bad_signature', null],
    ]);
    expect(Object.keys(results[0]).sort()).toEqual(['id', 'outcome', 'received_at', 'type', 'user_id', 'webhook_id']);
    expect(JSON.stringify(results)).not.toMatch(/ada@example|cus-|sub-|polar_whs|v1,/);

    const list = (await (await adminCall('/api/admin/webhooks', admin)).json()) as { deliveries: { webhookId: string; outcome: string; user: unknown }[]; counts: { outcome: string; n: number }[] };
    expect(list.deliveries.map((d) => d.outcome)).toEqual(['bad_signature', 'ignored', 'stale', 'duplicate', 'applied']);
    expect(list.counts).toContainEqual({ outcome: 'applied', n: 1 });
    const filtered = (await (await adminCall('/api/admin/webhooks?outcome=stale', admin)).json()) as { deliveries: { webhookId: string }[] };
    expect(filtered.deliveries.map((d) => d.webhookId)).toEqual(['evt-stale']);
    expect((await adminCall('/api/admin/webhooks?outcome=nope', admin)).status).toBe(400);

    // Download my data lists the account's deliveries; deleting it keeps the rows without the user id.
    const exported = (await (await call('/api/me/export', { token: user.token })).json()) as { billingWebhooks: { outcome: string }[]; user: { compUntil: unknown } };
    expect(exported.billingWebhooks.map((w) => w.outcome)).toEqual(['applied', 'duplicate', 'stale']);
    expect(exported.user.compUntil).toBeNull();

    await env.DB.prepare('UPDATE billing_webhooks SET received_at = ? WHERE webhook_id = ?').bind(Date.now() - 91 * 86_400_000, 'evt-forged').run();
    await hourlyCron(env, dailyRun());
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_webhooks').first<{ n: number }>())!.n).toBe(4);
    const health = (await (await adminCall('/api/admin/health', admin)).json()) as { cron: { runs: { job: string; detail: Record<string, number> }[] }; database: { tables: Record<string, number> } };
    expect(health.cron.runs.find((r) => r.job === 'billing_webhooks')!.detail.deleted).toBe(1);
    expect(health.database.tables).toMatchObject({ billing_webhooks: 4, billing: 1, billing_events: 3, credits: 0, ai_interviews: 0, document_shares: 0, refunded_orders: 0, review_usage: 0 });

    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n, COUNT(user_id) AS users FROM billing_webhooks').first()).toEqual({ n: 4, users: 0 });
  });

  it(
    'rate-limits the webhook per IP before the signature is checked, and logs at most one bad signature per IP a minute',
    async () => {
      await withinOneWindow(15_000);
      const ip = `test-flood-${crypto.randomUUID()}`;
      const forged = { type: 'subscription.updated', data: {} };
      for (let i = 0; i < 3; i++) expect((await deliver(forged, { sig: 'v1,AAAA', ip })).status).toBe(403);
      expect((await deliver(forged, { sig: 'v1,AAAA', ip: `${ip}-other` })).status).toBe(403);
      const rows = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM billing_webhooks WHERE outcome = 'bad_signature'").first<{ n: number }>())!.n;
      expect(await rows()).toBe(2);
      // 300 a minute per IP (wrangler.jsonc WEBHOOK_LIMITER): 297 more fill this one's window, then 429 before any read or write.
      for (let i = 0; i < 297; i++) expect((await deliver(forged, { sig: 'v1,AAAA', ip })).status).toBe(403);
      const limited = await deliver(forged, { sig: 'v1,AAAA', ip });
      expect(limited.status).toBe(429);
      expect(await rows()).toBe(2);
      expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_webhooks').first<{ n: number }>())!.n).toBe(2);
      // Polar's own deliveries from other addresses are unaffected.
      const user = await signedInUser();
      expect((await deliver(subscription(user.id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    },
    WINDOW_TIMEOUT,
  );

  it('lets an account that is Pro only by a comp subscribe; an active subscription still answers already_pro', async () => {
    const admin = await setUp();
    const user = await signedInUser();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://sandbox-api.polar.sh/')) return real(input, init);
      return Response.json({ url: 'https://sandbox.polar.sh/checkout/abc' }, { status: 201 });
    });
    await adminCall(`/api/admin/users/${user.id}/comp`, admin, { method: 'POST', body: { until: nowS() + 86_400, reason: 'Speaker' } });
    expect(((await (await call('/api/me/plan', { token: user.token })).json()) as { plan: string }).plan).toBe('pro');
    const checkout = await call('/api/billing/checkout', { method: 'POST', token: user.token, body: { product: 'pro_yearly' } });
    expect(checkout.status).toBe(200);
    expect(await checkout.json()).toEqual({ url: 'https://sandbox.polar.sh/checkout/abc' });

    expect((await deliver(subscription(user.id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    const again = await call('/api/billing/checkout', { method: 'POST', token: user.token, body: { product: 'pro_monthly' } });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'already_pro' });
    // past_due keeps Pro, so it is a subscription too.
    expect((await deliver(subscription(user.id, 'past_due', '2026-11-06T11:00:00Z'))).status).toBe(200);
    expect((await call('/api/billing/checkout', { method: 'POST', token: user.token, body: { product: 'pro_monthly' } })).status).toBe(409);
    // Once it is canceled, the comp alone keeps Pro, and subscribing is open again.
    expect((await deliver(subscription(user.id, 'canceled', '2026-11-06T12:00:00Z'))).status).toBe(200);
    expect((await call('/api/billing/checkout', { method: 'POST', token: user.token, body: { product: 'pro_monthly' } })).status).toBe(200);
  });

  it('reports whether each paid secret is set, never its value', async () => {
    const admin = await setUp();
    const values = {
      ANTHROPIC_API_KEY: 'sk-ant-SECRET-VALUE-1',
      AI_GATEWAY_URL: 'https://gateway.example/SECRET-VALUE-2',
      POLAR_ACCESS_TOKEN: 'polar_at_SECRET-VALUE-3',
    };
    const health = async (overrides: Partial<Env>) => {
      const exec = createExecutionContext();
      const request = new Request(`${ORIGIN}/api/admin/health`, { headers: { Cookie: `${ADMIN_COOKIE}=${admin}`, 'CF-Connecting-IP': `test-${crypto.randomUUID()}` } });
      const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, { ...env, ...overrides } as Env, exec);
      await waitOnExecutionContext(exec);
      return response.text();
    };
    const on = await health({ ...values, POLAR_SERVER: 'production' });
    expect(JSON.parse(on).config).toMatchObject({
      anthropicKey: true,
      aiGateway: true,
      polar: { accessToken: true, webhookSecret: true, productProMonthly: true, productProYearly: true, productPack5: true },
      polarServer: 'live',
      billing: true,
    });
    for (const secret of [...Object.values(values), SECRET, 'prod-pro-monthly', 'prod-pack-5', 'polar-test-token', SETUP_TOKEN, env.SESSION_SECRET as string]) {
      expect(on, secret).not.toContain(secret);
    }
    const off = JSON.parse(await health({ ANTHROPIC_API_KEY: '', AI_GATEWAY_URL: '', POLAR_WEBHOOK_SECRET: '', POLAR_SERVER: 'sandbox' })).config;
    expect(off).toMatchObject({ anthropicKey: false, aiGateway: false, polar: { webhookSecret: false, accessToken: true }, polarServer: 'sandbox', billing: false });
  });

  it('lists live share links and revokes one, in the audit log', async () => {
    const admin = await setUp();
    const owner = await signedInUser('Ada');
    const token = 'AbCdEfGhIjKlMnOpQrStUv';
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(owner.id),
      env.DB.prepare("INSERT INTO documents (id, user_id, name, source, updated_at, version) VALUES ('doc1', ?, 'checkout.proschi', 'title \"x\"', 1, 1)").bind(owner.id),
      env.DB.prepare("INSERT INTO document_shares (token, user_id, document_id, created_at) VALUES (?, ?, 'doc1', 1700000000000)").bind(token, owner.id),
    ]);
    expect((await call(`/api/share/${token}`)).status).toBe(200);
    const list = (await (await adminCall('/api/admin/document-shares', admin)).json()) as { total: number; links: unknown[] };
    expect(list.total).toBe(1);
    expect(list.links[0]).toEqual({
      token,
      url: `${ORIGIN}/share/${token}`,
      document: { id: 'doc1', name: 'checkout.proschi' },
      createdAt: 1_700_000_000,
      revokedAt: null,
      owner: { id: owner.id, displayName: 'Ada', blocked: false },
    });
    expect(((await (await adminCall('/api/admin/document-shares?q=checkout', admin)).json()) as { total: number }).total).toBe(1);
    expect(((await (await adminCall('/api/admin/document-shares?q=nothing', admin)).json()) as { total: number }).total).toBe(0);

    expect((await adminCall(`/api/admin/document-shares/${token}`, admin, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/share/${token}`)).status).toBe(404);
    expect(await audit('document_share.revoke')).toEqual([{ target: token, detail: { owner: owner.id }, passkey_id: expect.any(String) }]);
    expect((await adminCall(`/api/admin/document-shares/${token}`, admin, { method: 'DELETE' })).status).toBe(409);
    expect((await adminCall('/api/admin/document-shares/nope', admin, { method: 'DELETE' })).status).toBe(404);
    expect(((await (await adminCall('/api/admin/document-shares', admin)).json()) as { total: number }).total).toBe(0);
    const all = (await (await adminCall('/api/admin/document-shares?state=all', admin)).json()) as { links: { revokedAt: number | null }[] };
    expect(all.links[0].revokedAt).toEqual(expect.any(Number));
  });
});
