import { requireUser } from './auth';
import type { Ctx } from './context';
import { timingSafeEqual } from './crypto';
import { balance, grantStatement, revokeStatement } from './credits';
import type { Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { log } from './log';
import { limitsFor, planName, UNLIMITED } from './plans';

/**
 * The Pro plan and interview packs through Polar, the merchant of record
 * (docs/design/paid-plans.md P1–P3, P10; backend/README.md "Billing and
 * credits"). Polar hosts the checkout and the customer portal; its signed
 * webhook is the only thing that changes `users.plan` or adds pack credits.
 * Proschi never sees card data. Without the Polar secrets every billing
 * route but GET /api/me/plan answers 501.
 */

export type Product = 'pro_monthly' | 'pro_yearly' | 'pack_5';
const PRODUCTS: readonly Product[] = ['pro_monthly', 'pro_yearly', 'pack_5'];
/** Interview credits in one pack. */
export const PACK_CREDITS = 5;
/** Subscription statuses that keep Pro: past_due too, while Polar retries the payment. */
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
/** A webhook whose timestamp is further than this from now is refused (Standard Webhooks). */
const WEBHOOK_TOLERANCE_S = 5 * 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

type Configured = Env & Required<Pick<Env, 'POLAR_ACCESS_TOKEN' | 'POLAR_WEBHOOK_SECRET' | 'POLAR_PRODUCT_PRO_MONTHLY' | 'POLAR_PRODUCT_PRO_YEARLY' | 'POLAR_PRODUCT_PACK_5'>>;

/** Whether every Polar secret is set (P10: billing is off otherwise). */
export function billingConfigured(env: Env): env is Configured {
  return !!(env.POLAR_ACCESS_TOKEN && env.POLAR_WEBHOOK_SECRET && env.POLAR_PRODUCT_PRO_MONTHLY && env.POLAR_PRODUCT_PRO_YEARLY && env.POLAR_PRODUCT_PACK_5);
}

function configured(env: Env): Configured {
  if (!billingConfigured(env)) throw new HttpError(501, 'Billing is not set up on this server');
  return env;
}

const productIds = (env: Configured): Record<Product, string> => ({
  pro_monthly: env.POLAR_PRODUCT_PRO_MONTHLY,
  pro_yearly: env.POLAR_PRODUCT_PRO_YEARLY,
  pack_5: env.POLAR_PRODUCT_PACK_5,
});

function productOf(env: Configured, polarId: unknown): Product | undefined {
  const ids = productIds(env);
  return PRODUCTS.find((p) => ids[p] === polarId);
}

const apiBase = (env: Env): string => (env.POLAR_SERVER === 'sandbox' ? 'https://sandbox-api.polar.sh' : 'https://api.polar.sh');

async function polar<T>(env: Configured, path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    log('error', 'Polar API failed', { path, status: response.status, body: (await response.text()).slice(0, 500) });
    throw new HttpError(502, 'The payment provider did not answer; try again in a minute');
  }
  return (await response.json()) as T;
}

interface BillingRow {
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  status: string | null;
  product: string | null;
  current_period_end: number | null;
  cancel_at_period_end: number;
}

async function billingRow(DB: D1Database, userId: string): Promise<BillingRow | null> {
  return DB.prepare('SELECT polar_customer_id, polar_subscription_id, status, product, current_period_end, cancel_at_period_end FROM billing WHERE user_id = ?')
    .bind(userId)
    .first<BillingRow>();
}

/**
 * POST /api/billing/checkout {product: pro_monthly|pro_yearly|pack_5}: a
 * Polar checkout for the signed-in user, {url} to send the browser to.
 * 409 already_pro for a second subscription (the portal changes plans).
 */
export async function createCheckout(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  const user = await requireUser(request, ctx);
  await rateLimit(env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request, 1024);
  const product = body.product;
  if (typeof product !== 'string' || !PRODUCTS.includes(product as Product)) throw new HttpError(400, `product must be one of ${PRODUCTS.join(', ')}`);
  if (product !== 'pack_5' && planName(user.plan) === 'pro') return json({ error: 'already_pro', message: 'You are on Pro already; change or cancel it in the billing portal' }, 409, NO_STORE);
  const origin = new URL(request.url).origin;
  const row = await billingRow(env.DB, user.id);
  const checkout = await polar<{ url: string }>(env, '/v1/checkouts/', {
    products: [productIds(env)[product as Product]],
    ...(row?.polar_customer_id ? { customer_id: row.polar_customer_id } : { external_customer_id: user.id }),
    metadata: { user_id: user.id, product },
    success_url: `${origin}/practice/?checkout=done#/me`,
    return_url: `${origin}/pricing/`,
  });
  return json({ url: checkout.url }, 200, NO_STORE);
}

/** POST /api/billing/portal: {url} of Polar's customer portal (invoices, payment method, cancel). 404 before a first purchase. */
export async function createPortal(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  const user = await requireUser(request, ctx);
  await rateLimit(env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const row = await billingRow(env.DB, user.id);
  if (!row?.polar_customer_id) throw new HttpError(404, 'Nothing has been bought with this account yet');
  const session = await polar<{ customer_portal_url: string }>(env, '/v1/customer-sessions/', {
    customer_id: row.polar_customer_id,
    return_url: `${new URL(request.url).origin}/practice/#/me`,
  });
  return json({ url: session.customer_portal_url }, 200, NO_STORE);
}

/**
 * GET /api/me/plan: the plan, the subscription's state and renewal, the
 * plan's limits (null where unlimited) and the interview credits. Works
 * without billing set up (everyone is on free), so the AI interview can
 * read credits; `billing` says whether checkout is on.
 */
export async function getPlan(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const plan = planName(user.plan);
  const limits = limitsFor(user.plan);
  const row = await billingRow(ctx.env.DB, user.id);
  const credits = await balance(ctx.env, user.id);
  const cap = (n: number) => (n >= UNLIMITED ? null : n);
  return json(
    {
      plan,
      billing: billingConfigured(ctx.env),
      subscription: row?.status
        ? { status: row.status, product: row.product, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end === 1 }
        : null,
      customer: !!row?.polar_customer_id,
      limits: { documents: cap(limits.documents), versionsPerDocument: cap(limits.versionsPerDocument), documentBytes: limits.documentBytes, interviewsPerMonth: limits.interviewsPerMonth },
      credits,
    },
    200,
    NO_STORE,
  );
}

// --- The webhook ------------------------------------------------------------

const encoder = new TextEncoder();

function base64Bytes(text: string): Uint8Array | undefined {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function hmacBase64(key: Uint8Array, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, encoder.encode(message)));
  return btoa(String.fromCharCode(...mac));
}

/**
 * Standard Webhooks (standardwebhooks.com), as Polar signs: HMAC-SHA256 of
 * `${webhook-id}.${webhook-timestamp}.${body}`, base64, in `webhook-signature`
 * as space-separated `v1,<signature>`. Polar's key is the secret's UTF-8
 * bytes as shown; a `whsec_<base64>` secret is also tried the standard way.
 * The timestamp must be within 5 minutes of now.
 */
export async function verifyWebhook(secret: string, headers: Headers, body: string, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signatures = headers.get('webhook-signature');
  if (!id || !timestamp || !signatures || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowS - Number(timestamp)) > WEBHOOK_TOLERANCE_S) return false;
  const keys = [encoder.encode(secret)];
  const standard = secret.startsWith('whsec_') ? base64Bytes(secret.slice('whsec_'.length)) : undefined;
  if (standard?.length) keys.push(standard);
  const given = signatures
    .split(' ')
    .filter((s) => s.startsWith('v1,'))
    .map((s) => s.slice(3));
  const message = `${id}.${timestamp}.${body}`;
  let ok = false;
  for (const key of keys) {
    const expected = await hmacBase64(key, message);
    for (const sig of given) ok = timingSafeEqual(sig, expected) || ok;
  }
  return ok;
}

interface PolarCustomer {
  id?: string;
  external_id?: string | null;
}

interface PolarObject {
  id?: string;
  status?: string;
  product_id?: string;
  customer_id?: string;
  customer?: PolarCustomer;
  metadata?: Record<string, unknown>;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  modified_at?: string | null;
  created_at?: string;
  /** A refund's or dispute's order. */
  order_id?: string;
}

const msOf = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** The account a Polar object belongs to: the external id the checkout set, its metadata, or a customer seen before. */
async function userOf(DB: D1Database, data: PolarObject): Promise<string | undefined> {
  const candidates = [data.customer?.external_id, data.metadata?.user_id].filter((v): v is string => typeof v === 'string' && v.length > 0);
  for (const id of candidates) {
    if (await DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first()) return id;
  }
  const customerId = data.customer_id ?? data.customer?.id;
  if (!customerId) return undefined;
  return (await DB.prepare('SELECT user_id FROM billing WHERE polar_customer_id = ?').bind(customerId).first<{ user_id: string }>())?.user_id;
}

/**
 * POST /api/billing/webhook: Polar's signed events (403 on a bad signature).
 * Each delivery is applied once, by its `webhook-id`: a replay answers 200
 * {duplicate: true}. Handled:
 *
 * - `subscription.created|updated|active|canceled|uncanceled|revoked`: the
 *   subscription's state is stored (a late event older than what is stored
 *   is not applied), and `users.plan` follows it: pro while active, trialing
 *   or past_due, else free. A downgrade keeps every diagram; those past the
 *   free limit turn read-only (src/documents.ts).
 * - `order.paid` for the pack: 5 credits, once per order.
 * - `order.refunded`, a succeeded `refund.created|updated`, or a lost
 *   `dispute.*` (a chargeback) of a pack order: its credits are taken back,
 *   what is left of them (the balance never goes below 0), once per order.
 *
 * Everything else is acknowledged and ignored.
 */
export async function webhook(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  if (Number(request.headers.get('Content-Length') ?? 0) > 256 * 1024) throw new HttpError(413, 'Request body too large');
  const body = await request.text();
  if (body.length > 256 * 1024) throw new HttpError(413, 'Request body too large');
  if (!(await verifyWebhook(env.POLAR_WEBHOOK_SECRET, request.headers, body))) throw new HttpError(403, 'Invalid signature');
  let event: { type?: unknown; data?: PolarObject };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    throw new HttpError(400, 'The body must be JSON');
  }
  const type = typeof event.type === 'string' ? event.type : '';
  const data = event.data ?? {};
  const eventId = request.headers.get('webhook-id') as string;
  const { DB } = env;
  const t = Date.now();
  const statements: D1PreparedStatement[] = [DB.prepare('INSERT INTO billing_events (id, type, received_at) VALUES (?, ?, ?)').bind(eventId, type.slice(0, 64), t)];

  const userId = type.startsWith('subscription.') || type === 'order.paid' ? await userOf(DB, data) : undefined;
  const customerId = data.customer_id ?? data.customer?.id ?? null;
  const product = productOf(env, data.product_id);
  if (userId && type.startsWith('subscription.') && (product === 'pro_monthly' || product === 'pro_yearly')) {
    const modified = msOf(data.modified_at) ?? msOf(data.created_at) ?? t;
    statements.push(
      DB.prepare(
        `INSERT INTO billing (user_id, polar_customer_id, polar_subscription_id, status, product, current_period_end, cancel_at_period_end, subscription_modified_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (user_id) DO UPDATE SET
           polar_customer_id = COALESCE(excluded.polar_customer_id, billing.polar_customer_id),
           polar_subscription_id = excluded.polar_subscription_id, status = excluded.status, product = excluded.product,
           current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
           subscription_modified_at = excluded.subscription_modified_at, updated_at = excluded.updated_at
         WHERE billing.subscription_modified_at IS NULL OR excluded.subscription_modified_at >= billing.subscription_modified_at`,
      ).bind(userId, customerId, data.id ?? null, data.status ?? null, product, msOf(data.current_period_end), data.cancel_at_period_end ? 1 : 0, modified, t),
      // The plan follows what is stored, so a late, older event can't flip it back. A plan set by hand (not free or pro) stays.
      DB.prepare(
        `UPDATE users SET plan = CASE WHEN (SELECT status FROM billing WHERE user_id = ?1) IN (${PRO_STATUSES.map((s) => `'${s}'`).join(', ')}) THEN 'pro' ELSE 'free' END
         WHERE id = ?1 AND plan IN ('free', 'pro')`,
      ).bind(userId),
    );
  } else if (userId && type === 'order.paid' && product === 'pack_5' && data.id) {
    statements.push(
      DB.prepare(
        `INSERT INTO billing (user_id, polar_customer_id, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET polar_customer_id = COALESCE(billing.polar_customer_id, excluded.polar_customer_id), updated_at = excluded.updated_at`,
      ).bind(userId, customerId, t),
      grantStatement(DB, userId, PACK_CREDITS, 'pack_5', data.id, t),
    );
  }

  // A pack's money back: order.refunded (the order), refund.created|updated (a succeeded refund of it) or a chargeback (a dispute lost).
  const refundedOrder =
    type === 'order.refunded'
      ? data.id
      : (type === 'refund.created' || type === 'refund.updated') && data.status === 'succeeded'
        ? data.order_id
        : type.startsWith('dispute.') && (data.status === 'lost' || data.status === 'charge_back')
          ? data.order_id
          : undefined;
  if (refundedOrder) statements.push(revokeStatement(DB, refundedOrder, t));

  try {
    await DB.batch(statements);
  } catch (e) {
    // The event's row is first in the batch: a replay fails on it and the whole batch rolls back.
    if (e instanceof Error && /UNIQUE constraint failed: billing_events\.id/.test(e.message)) return json({ ok: true, duplicate: true }, 200, NO_STORE);
    throw e;
  }
  if (!userId && (type.startsWith('subscription.') || type === 'order.paid')) log('warn', 'Polar event for no known account', { type, eventId });
  return json({ ok: true }, 200, NO_STORE);
}

/**
 * Before an account is deleted: a subscription still billing is revoked at
 * Polar at once, so a deleted account is never charged again. Throws 502
 * (and the account stays) when Polar can't be reached. Without billing set
 * up there is nothing to revoke.
 */
export async function revokeOnDelete(env: Env, userId: string): Promise<void> {
  if (!billingConfigured(env)) return;
  const row = await billingRow(env.DB, userId);
  if (!row?.polar_subscription_id || !PRO_STATUSES.includes(row.status ?? '')) return;
  await polar(env, `/v1/subscriptions/${encodeURIComponent(row.polar_subscription_id)}`, undefined, 'DELETE');
}

/** The billing data in "Download my data" (the ledger comes from src/credits.ts). */
export async function exportBilling(DB: D1Database, userId: string): Promise<Record<string, unknown> | null> {
  const row = await DB.prepare(
    'SELECT polar_customer_id, polar_subscription_id, status, product, current_period_end, cancel_at_period_end, updated_at FROM billing WHERE user_id = ?',
  )
    .bind(userId)
    .first<BillingRow & { updated_at: number }>();
  if (!row) return null;
  return {
    polarCustomerId: row.polar_customer_id,
    polarSubscriptionId: row.polar_subscription_id,
    status: row.status,
    product: row.product,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    updatedAt: row.updated_at,
  };
}
