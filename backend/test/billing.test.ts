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
    expect(billingConfigured({ ...env, POLAR_PRODUCT_PACK_5: '' } as Env)).toBe(false);
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
    expect(await (await call('/api/me/plan', { token })).json()).toMatchObject({ plan: 'free', billing: true, subscription: null, credits: { total: 1, trial: 1 } });
    expect((await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    expect(await planOf(id)).toBe('pro');
    expect(await (await call('/api/me/plan', { token })).json()).toMatchObject({
      plan: 'pro',
      subscription: { status: 'active', product: 'pro_monthly', currentPeriodEnd: Date.parse('2026-12-06T00:00:00Z'), cancelAtPeriodEnd: false },
      customer: true,
      limits: { documents: null, versionsPerDocument: null, interviewsPerMonth: 4 },
      credits: { monthly: 4, trial: 1 },
    });
    expect(await (await call('/api/me/limits', { token })).json()).toMatchObject({ plan: 'pro', limits: { documents: 1000 } });
  });

  it('applies a replayed delivery once', async () => {
    const { id } = await signedInUser();
    const order = { type: 'order.paid', data: { id: 'ord-1', product_id: 'prod-pack-5', customer_id: 'cus-9', customer: { id: 'cus-9', external_id: id } } };
    const first = await deliver(order, { id: 'evt-replay' });
    expect(await first.json()).toEqual({ ok: true });
    const again = await deliver(order, { id: 'evt-replay' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    // A second delivery of the same order under a new event id doesn't grant twice either.
    await deliver(order);
    const sum = await env.DB.prepare('SELECT SUM(delta) AS s FROM credits WHERE user_id = ?').bind(id).first<{ s: number }>();
    expect(sum?.s).toBe(5);
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
    expect(sent[0].body.success_url).toBe('https://proschi.test/practice/?checkout=done#/me');

    expect((await call('/api/billing/portal', { method: 'POST', token })).status).toBe(404);
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    expect(await (await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'pro_monthly' } })).json()).toMatchObject({ error: 'already_pro' });
    // Packs can be bought on Pro, by the known customer.
    expect((await call('/api/billing/checkout', { method: 'POST', token, body: { product: 'pack_5' } })).status).toBe(200);
    expect(sent[1].body).toMatchObject({ products: ['prod-pack-5'], customer_id: 'cus-1' });
    const portal = await call('/api/billing/portal', { method: 'POST', token });
    expect(await portal.json()).toEqual({ url: 'https://sandbox.polar.sh/portal/xyz' });
    expect(sent[2].body).toEqual({ customer_id: 'cus-1', return_url: 'https://proschi.test/practice/#/me' });
  });

  it('exports billing data, and revokes the subscription and deletes it with the account', async () => {
    const { id, token } = await signedInUser();
    await deliver(subscription(id, 'active', '2026-11-06T10:00:00Z'));
    await deliver({ type: 'order.paid', data: { id: 'ord-2', product_id: 'prod-pack-5', customer: { id: 'cus-1', external_id: id } } });
    const data = (await (await call('/api/me/export', { token })).json()) as { billing: unknown; credits: unknown[] };
    expect(data.billing).toMatchObject({ polarCustomerId: 'cus-1', polarSubscriptionId: 'sub-1', status: 'active', product: 'pro_monthly' });
    expect(data.credits).toMatchObject([{ kind: 'grant', bucket: 'pack', delta: 5, refId: 'ord-2' }]);

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
