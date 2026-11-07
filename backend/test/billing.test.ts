import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { billingConfigured, verifyWebhook } from '../src/billing';
import type { Env } from '../src/env';
import { call, resetDatabase, signedInUser } from './helpers';

/** Billing through Polar (src/billing.ts): checkout, the portal, the webhook, GET /api/me/plan and downgrades. */

const SECRET = 'polar_whs_test-secret';
const encoder = new TextEncoder();

async function signature(secret: Uint8Array, id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${id}.${ts}.${body}`)));
  return btoa(String.fromCharCode(...mac));
}

let events = 0;

/** Polar's delivery of `event`, signed with the test secret unless `sig` says otherwise. */
async function deliver(event: unknown, { id = `evt-${++events}`, ts = String(Math.floor(Date.now() / 1000)), sig }: { id?: string; ts?: string; sig?: string } = {}) {
  const body = JSON.stringify(event);
  const s = sig ?? `v1,${await signature(encoder.encode(SECRET), id, ts, body)}`;
  return call('/api/billing/webhook', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': s, 'Content-Type': 'application/json' },
    body: event,
  });
}

const subscription = (userId: string, status: string, modified: string, extra: Record<string, unknown> = {}) => ({
  type: `subscription.${status === 'canceled' ? 'canceled' : 'updated'}`,
  data: {
    id: 'sub-1',
    status,
    product_id: 'prod-pro-monthly',
    customer_id: 'cus-1',
    customer: { id: 'cus-1', external_id: userId },
    current_period_end: '2026-12-06T00:00:00Z',
    cancel_at_period_end: false,
    modified_at: modified,
    ...extra,
  },
});

const planOf = async (id: string) => (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(id).first<{ plan: string }>())?.plan;

describe('billing', () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  it('is off without the Polar secrets', () => {
    expect(billingConfigured({} as Env)).toBe(false);
    expect(billingConfigured(env)).toBe(true);
    expect(billingConfigured({ ...env, POLAR_PRODUCT_CREDITS_1000: '' } as Env)).toBe(false);
  });

  it('verifies Standard Webhooks signatures', async () => {
    const t = 1_800_000_000;
    const body = '{"type":"x"}';
    const headers = async (sig: string, ts = String(t)) => new Headers({ 'webhook-id': 'm1', 'webhook-timestamp': ts, 'webhook-signature': sig });
    const good = await signature(encoder.encode(SECRET), 'm1', String(t), body);
    expect(await verifyWebhook(SECRET, await headers(`v1,${good}`), body, t)).toBe(true);
    // Several signatures (a rotated secret): any one matching passes.
    expect(await verifyWebhook(SECRET, await headers(`v1,AAAA v1,${good}`), body, t)).toBe(true);
    expect(await verifyWebhook(SECRET, await headers(`v1,${good}`), body + ' ', t)).toBe(false);
    expect(await verifyWebhook('other-secret', await headers(`v1,${good}`), body, t)).toBe(false);
    expect(await verifyWebhook(SECRET, await headers(`v1,${good}`), body, t + 301)).toBe(false);
    expect(await verifyWebhook(SECRET, new Headers(), body, t)).toBe(false);
    // A standard whsec_ secret: its base64 part is the key.
    const raw = crypto.getRandomValues(new Uint8Array(24));
    const whsec = `whsec_${btoa(String.fromCharCode(...raw))}`;
    expect(await verifyWebhook(whsec, await headers(`v1,${await signature(raw, 'm1', String(t), body)}`), body, t)).toBe(true);
  });

  it('refuses a webhook with a bad signature, and changes nothing', async () => {
    const { id } = await signedInUser();
    const response = await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'), { sig: 'v1,bm9wZQ==' });
    expect(response.status).toBe(403);
    expect(await planOf(id)).toBe('free');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM billing_events').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('upgrades on an active subscription and reports the plan', async () => {
    const { id, token } = await signedInUser();
    expect(await (await call('/api/me/plan', { token })).json()).toMatchObject({ plan: 'free', billing: true, subscription: null, credits: { balance: 0, monthly: null, signup: 0, topup: 0 } });
    expect((await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    expect(await planOf(id)).toBe('pro');
    expect(await (await call('/api/me/plan', { token })).json()).toMatchObject({
      plan: 'pro',
      subscription: { status: 'active', product: 'pro_monthly', currentPeriodEnd: Date.parse('2026-12-06T00:00:00Z'), cancelAtPeriodEnd: false },
      customer: true,
      limits: { documents: null, versionsPerDocument: null },
      credits: { balance: 800, monthly: { allowance: 800, left: 800 }, signup: 0, topup: 0 },
    });
    expect(await (await call('/api/me/limits', { token })).json()).toMatchObject({ plan: 'pro', limits: { documents: 1000 } });
  });

  it('moves between Pro and Max with the product, and tops the month up to the new allowance', async () => {
    const { id, token } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    expect((await (await call('/api/me/plan', { token })).json()) as object).toMatchObject({ plan: 'pro', credits: { balance: 800 } });
    await deliver(subscription(id, 'active', '2026-11-07T10:00:00Z', { product_id: 'prod-max-yearly' }));
    expect(await planOf(id)).toBe('max');
    const max = (await (await call('/api/me/plan', { token })).json()) as { plan: string; subscription: { product: string }; credits: unknown; features: Record<string, { ok: boolean }> };
    expect(max).toMatchObject({ plan: 'max', subscription: { product: 'max_yearly' }, credits: { balance: 2200, monthly: { allowance: 2200, left: 2200 } } });
    expect(max.features.deep_mode).toEqual({ ok: true });
    expect(max.features.interview_report).toEqual({ ok: true });
    expect(max.features.share_links).toEqual({ ok: true });
    // Back to Pro: the month's credits stay; the plan follows.
    await deliver(subscription(id, 'active', '2026-11-08T10:00:00Z'));
    expect(await planOf(id)).toBe('pro');
    expect((await (await call('/api/me/plan', { token })).json()) as object).toMatchObject({ plan: 'pro', credits: { balance: 2200 }, features: { deep_mode: { ok: false, reason: 'needs_pro' } } });
    await deliver(subscription(id, 'canceled', '2026-11-09T10:00:00Z', { status: 'canceled' }));
    expect(await planOf(id)).toBe('free');
  });

  it('switches the active subscription’s product at Polar, never opening a second one', async () => {
    const { id, token } = await signedInUser();
    const sent: { method: string; url: string; body: Record<string, unknown> }[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://sandbox-api.polar.sh/')) return real(input, init);
      sent.push({ method: String(init?.method), url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return Response.json({ id: 'sub-1', status: 'active' });
    });
    const change = (product: unknown) => call('/api/billing/change-plan', { method: 'POST', token, body: { product } });
    expect((await call('/api/billing/change-plan', { method: 'POST', body: { product: 'max_monthly' } })).status).toBe(401);
    expect((await change('credits_1000')).status).toBe(400);
    expect(await (await change('max_monthly')).json()).toMatchObject({ error: 'no_subscription' });
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    expect(await (await change('pro_monthly')).json()).toMatchObject({ error: 'same_plan' });
    // A checkout for another subscription is refused with one active; a top-up still goes through.
    const second = await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'max_monthly' } });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: 'has_subscription' });
    const switched = await change('max_monthly');
    expect(switched.status).toBe(200);
    expect(await switched.json()).toEqual({ ok: true, plan: 'max', effective: 'now' });
    expect(sent).toEqual([{ method: 'PATCH', url: 'https://sandbox-api.polar.sh/v1/subscriptions/sub-1', body: { product_id: 'prod-max-monthly', proration_behavior: 'invoice' } }]);
    // The webhook sets the plan, not the switch.
    expect(await planOf(id)).toBe('pro');
    const audit = await env.DB.prepare("SELECT target, detail FROM admin_audit WHERE action = 'billing.change_plan'").first<{ target: string; detail: string }>();
    expect(audit).toEqual({ target: id, detail: JSON.stringify({ from: 'pro_monthly', to: 'max_monthly' }) });
    // A subscription set to end can't be changed.
    await deliver(subscription(id, 'active', '2026-11-07T10:00:00Z', { cancel_at_period_end: true }));
    expect(await (await change('max_yearly')).json()).toMatchObject({ error: 'canceling' });
    expect(sent).toHaveLength(1);
  });

  it('applies a replayed delivery once', async () => {
    const { id } = await signedInUser();
    const order = { type: 'order.paid', data: { id: 'ord-1', product_id: 'prod-credits-1000', customer_id: 'cus-9', customer: { id: 'cus-9', external_id: id } } };
    const first = await deliver(order, { id: 'evt-replay' });
    expect(await first.json()).toEqual({ ok: true });
    const again = await deliver(order, { id: 'evt-replay' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    // A second delivery of the same order under a new event id doesn't grant twice either.
    await deliver(order);
    const sum = await env.DB.prepare('SELECT SUM(delta_mc) AS s FROM credits WHERE user_id = ?').bind(id).first<{ s: number }>();
    expect(sum?.s).toBe(1_000_000);
  });

  it('takes back a refunded or charged-back top-up, once', async () => {
    const { id, token } = await signedInUser();
    const paid = (order: string) => deliver({ type: 'order.paid', data: { id: order, product_id: 'prod-credits-1000', customer: { id: 'cus-r', external_id: id } } });
    await paid('ord-r1');
    await paid('ord-r2');
    await paid('ord-r3');
    const topup = async () => ((await (await call('/api/me/plan', { token })).json()) as { credits: { topup: number } }).credits.topup;
    expect(await topup()).toBe(3000);
    await deliver({ type: 'order.refunded', data: { id: 'ord-r1', product_id: 'prod-credits-1000', status: 'refunded', customer: { id: 'cus-r', external_id: id } } });
    // The same refund, told again as refund.updated: nothing more.
    await deliver({ type: 'refund.updated', data: { id: 'ref-1', order_id: 'ord-r1', status: 'succeeded' } });
    expect(await topup()).toBe(2000);
    // A pending refund takes nothing; a succeeded one does.
    await deliver({ type: 'refund.created', data: { id: 'ref-2', order_id: 'ord-r2', status: 'pending' } });
    expect(await topup()).toBe(2000);
    await deliver({ type: 'refund.updated', data: { id: 'ref-2', order_id: 'ord-r2', status: 'succeeded' } });
    expect(await topup()).toBe(1000);
    // A chargeback lost.
    await deliver({ type: 'dispute.updated', data: { id: 'dis-1', order_id: 'ord-r3', status: 'lost' } });
    expect(await topup()).toBe(0);
  });

  it('grants nothing for a top-up whose refund arrived before its order.paid', async () => {
    const { id, token } = await signedInUser();
    await deliver({ type: 'refund.updated', data: { id: 'ref-e', order_id: 'ord-early', status: 'succeeded' } });
    await deliver({ type: 'order.paid', data: { id: 'ord-early', product_id: 'prod-credits-1000', customer: { id: 'cus-e', external_id: id } } });
    const credits = (await (await call('/api/me/plan', { token })).json()) as { credits: { topup: number } };
    expect(credits.credits.topup).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credits WHERE ref_id = 'ord-early'").first<{ n: number }>()).toEqual({ n: 0 });
    // Another order still grants.
    await deliver({ type: 'order.paid', data: { id: 'ord-other', product_id: 'prod-credits-1000', customer: { id: 'cus-e', external_id: id } } });
    expect(((await (await call('/api/me/plan', { token })).json()) as { credits: { topup: number } }).credits.topup).toBe(1000);
  });

  it('keeps a top-up’s used credits after its refund: the balance never goes below 0', async () => {
    const { id, token } = await signedInUser();
    await deliver({ type: 'order.paid', data: { id: 'ord-u', product_id: 'prod-credits-1000', customer: { id: 'cus-u', external_id: id } } });
    await env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, delta_mc, item, ref_id, created_at) VALUES (?, 'settle', 'topup', -600000, 'design_partner', ?, 0)").bind(id, 's1:topup').run();
    await env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, delta_mc, item, ref_id, created_at) VALUES (?, 'settle', 'topup', -300000, 'design_partner', ?, 0)").bind(id, 's2:topup').run();
    await deliver({ type: 'order.refunded', data: { id: 'ord-u', product_id: 'prod-credits-1000', status: 'refunded' } });
    const left = await env.DB.prepare("SELECT SUM(delta_mc) AS n FROM credits WHERE user_id = ? AND bucket = 'topup'").bind(id).first<{ n: number }>();
    expect(left).toEqual({ n: 0 });
    expect(((await (await call('/api/me/plan', { token })).json()) as { credits: { topup: number } }).credits.topup).toBe(0);
  });

  it('does not downgrade on a late cancel of an old subscription after a new active one', async () => {
    const { id } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-01T10:00:00Z'));
    await deliver(subscription(id, 'active', '2026-11-05T10:00:00Z', { id: 'sub-2' }));
    expect(await planOf(id)).toBe('pro');
    // The old one's revoke, later than the new one's last change.
    await deliver({ ...subscription(id, 'canceled', '2026-11-06T10:00:00Z'), type: 'subscription.revoked' });
    await deliver(subscription(id, 'canceled', '2026-11-06T11:00:00Z'));
    expect(await planOf(id)).toBe('pro');
    expect(await env.DB.prepare('SELECT polar_subscription_id, status FROM billing WHERE user_id = ?').bind(id).first()).toEqual({ polar_subscription_id: 'sub-2', status: 'active' });
    // The current one's own cancel still downgrades.
    await deliver({ ...subscription(id, 'canceled', '2026-11-07T10:00:00Z', { id: 'sub-2' }), type: 'subscription.revoked' });
    expect(await planOf(id)).toBe('free');
    // And a new subscription after that replaces it, even when its event carries an older time.
    await deliver(subscription(id, 'active', '2026-11-06T12:00:00Z', { id: 'sub-3' }));
    expect(await planOf(id)).toBe('pro');
  });

  it('ignores a late, older subscription event', async () => {
    const { id } = await signedInUser();
    await deliver(subscription(id, 'canceled', '2026-11-06T12:00:00Z'));
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    expect(await planOf(id)).toBe('free');
  });

  it('keeps Pro until a canceled subscription ends', async () => {
    const { id, token } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    await deliver(subscription(id, 'active', '2026-11-06T11:00:00Z', { cancel_at_period_end: true }));
    expect(await planOf(id)).toBe('pro');
    expect(await (await call('/api/me/plan', { token })).json()).toMatchObject({ subscription: { cancelAtPeriodEnd: true } });
    await deliver({ ...subscription(id, 'canceled', '2026-12-06T00:00:01Z'), type: 'subscription.revoked' });
    expect(await planOf(id)).toBe('free');
  });

  it('makes diagrams past the free limit read-only after a downgrade', async () => {
    const { id, token } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    const put = (doc: string, baseVersion: number, source = 'a') => call(`/api/me/documents/${doc}`, { method: 'PUT', token, body: { name: `${doc}.proschi`, source, baseVersion } });
    for (let i = 0; i < 7; i++) expect((await put(`d${i}`, 0)).status).toBe(200);
    await deliver(subscription(id, 'canceled', '2026-11-06T11:00:00Z'));
    expect(await planOf(id)).toBe('free');
    // Every diagram is kept.
    expect(await (await call('/api/me/documents', { token })).json()).toMatchObject({ limit: 5, used: 7 });
    // The 5 most recently saved stay writable, the 2 oldest are read-only.
    expect((await put('d6', 1, 'b')).status).toBe(200);
    const old = await put('d0', 1, 'b');
    expect(old.status).toBe(409);
    expect(await old.json()).toMatchObject({ error: 'document_limit', readOnly: true, limit: 5, used: 7 });
    expect((await put('new', 0)).status).toBe(409);
    // Deleting one lets the next oldest be saved again.
    expect((await call('/api/me/documents/d5', { method: 'DELETE', token })).status).toBe(200);
    expect((await put('d1', 1, 'b')).status).toBe(200);
    expect((await put('d0', 1, 'b')).status).toBe(409);
    // A read-only diagram takes no new versions; a writable one does.
    const tag = (doc: string, documentVersion: number) => call(`/api/me/documents/${doc}/versions`, { method: 'POST', token, body: { tag: 'v1', documentVersion } });
    const refused = await tag('d0', 1);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'document_limit', readOnly: true, limit: 5 });
    expect((await tag('d6', 2)).status).toBe(201);
  });

  it('creates a checkout and a portal session at Polar', async () => {
    const { id, token } = await signedInUser();
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://sandbox-api.polar.sh/')) return real(input, init);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer polar-test-token');
      sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (url.endsWith('/v1/checkouts/')) return Response.json({ url: 'https://sandbox.polar.sh/checkout/abc' }, { status: 201 });
      return Response.json({ customer_portal_url: 'https://sandbox.polar.sh/portal/xyz' }, { status: 201 });
    });
    expect((await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'gold' } })).status).toBe(400);
    expect((await call('/api/billing/checkout', { method: 'POST', body: { product: 'pro_monthly' } })).status).toBe(401);
    const checkout = await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'pro_yearly' } });
    expect(await checkout.json()).toEqual({ url: 'https://sandbox.polar.sh/checkout/abc' });
    expect(sent[0].body).toMatchObject({ products: ['prod-pro-yearly'], external_customer_id: id, metadata: { user_id: id, product: 'pro_yearly' } });
    expect(sent[0].body.success_url).toBe('https://proschi.test/practice/?checkout=done&product=pro_yearly&checkout_id={CHECKOUT_ID}#/me');

    expect((await call('/api/billing/portal', { method: 'POST', token })).status).toBe(404);
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    expect(await (await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'pro_monthly' } })).json()).toMatchObject({ error: 'has_subscription' });
    // Top-ups can be bought on Pro, by the known customer.
    expect((await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'credits_1000' } })).status).toBe(200);
    expect(sent[1].body).toMatchObject({ products: ['prod-credits-1000'], customer_id: 'cus-1' });
    const portal = await call('/api/billing/portal', { method: 'POST', token });
    expect(await portal.json()).toEqual({ url: 'https://sandbox.polar.sh/portal/xyz' });
    expect(sent[2].body).toEqual({ customer_id: 'cus-1', return_url: 'https://proschi.test/practice/#/me' });
  });

  it('exports billing data, and revokes the subscription and deletes it with the account', async () => {
    const { id, token } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    await deliver({ type: 'order.paid', data: { id: 'ord-2', product_id: 'prod-credits-1000', customer: { id: 'cus-1', external_id: id } } });
    const data = (await (await call('/api/me/export', { token })).json()) as { billing: unknown; credits: unknown[] };
    expect(data.billing).toMatchObject({ polarCustomerId: 'cus-1', polarSubscriptionId: 'sub-1', status: 'active', product: 'pro_monthly' });
    expect(data.credits).toMatchObject([{ kind: 'topup', bucket: 'topup', credits: 1000, refId: 'ord-2' }]);


    const revoked: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://sandbox-api.polar.sh/')) return real(input, init);
      revoked.push(`${init?.method} ${url}`);
      return Response.json({ id: 'sub-1', status: 'canceled' });
    });
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(revoked).toEqual(['DELETE https://sandbox-api.polar.sh/v1/subscriptions/sub-1']);
    for (const table of ['billing', 'credits']) {
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(id).first<{ n: number }>()).toEqual({ n: 0 });
    }
  });
});
