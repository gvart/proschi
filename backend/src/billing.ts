import { auditStatement } from './adminAuth';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { timingSafeEqual } from './crypto';
import { creditsView, monthlyGrantStatement, planOf, refundedOrderStatement, revokeStatement, topupStatement, upgradeGrantStatement, upgradeRevokeStatement } from './credits';
import type { Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { log } from './log';
import { featureMap } from './features';
import { limitsFor, MC, planName, UNLIMITED } from './plans';

/**
 * Pro, Max and credit top-ups through Polar, the merchant of record
 * (docs/design/paid-plans.md P1–P3, P10, P26; backend/README.md "Billing and
 * credits"). Polar hosts the checkout and the customer portal; its signed
 * webhook is the only thing that changes `users.plan` or adds top-up credits.
 * Proschi never sees card data. Without the Polar secrets every billing
 * route but GET /api/me/plan answers 501.
 */

export type Product = 'pro_monthly' | 'pro_yearly' | 'max_monthly' | 'max_yearly' | 'credits_1000';
const PRODUCTS: readonly Product[] = ['pro_monthly', 'pro_yearly', 'max_monthly', 'max_yearly', 'credits_1000'];
/** The subscription products, and the plan each gives. */
const SUBSCRIPTIONS: Readonly<Partial<Record<Product, 'pro' | 'max'>>> = { pro_monthly: 'pro', pro_yearly: 'pro', max_monthly: 'max', max_yearly: 'max' };
const isSubscription = (p: Product | undefined): p is Product => p !== undefined && SUBSCRIPTIONS[p] !== undefined;
/** Credits in one top-up order. */
export const TOPUP_CREDITS = 1000;
/** Subscription statuses that keep Pro: past_due too, while Polar retries the payment. */
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
/** A webhook whose timestamp is further than this from now is refused (Standard Webhooks). */
const WEBHOOK_TOLERANCE_S = 5 * 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

const PRODUCT_ENV = ['POLAR_PRODUCT_PRO_MONTHLY', 'POLAR_PRODUCT_PRO_YEARLY', 'POLAR_PRODUCT_MAX_MONTHLY', 'POLAR_PRODUCT_MAX_YEARLY', 'POLAR_PRODUCT_CREDITS_1000'] as const;

type Configured = Env & Required<Pick<Env, 'POLAR_ACCESS_TOKEN' | 'POLAR_WEBHOOK_SECRET' | (typeof PRODUCT_ENV)[number]>>;

/** Whether every Polar secret and product id is set (P10: billing is off otherwise). */
export function billingConfigured(env: Env): env is Configured {
  return !!(env.POLAR_ACCESS_TOKEN && env.POLAR_WEBHOOK_SECRET && PRODUCT_ENV.every((k) => env[k]));
}

function configured(env: Env): Configured {
  if (!billingConfigured(env)) throw new HttpError(501, 'Billing is not set up on this server');
  return env;
}

const productIds = (env: Configured): Record<Product, string> => ({
  pro_monthly: env.POLAR_PRODUCT_PRO_MONTHLY,
  pro_yearly: env.POLAR_PRODUCT_PRO_YEARLY,
  max_monthly: env.POLAR_PRODUCT_MAX_MONTHLY,
  max_yearly: env.POLAR_PRODUCT_MAX_YEARLY,
  credits_1000: env.POLAR_PRODUCT_CREDITS_1000,
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
 * POST /api/billing/checkout {product}: a Polar checkout for the signed-in
 * user, {url} to send the browser to. A subscription product with an active
 * subscription answers 409 has_subscription (POST /api/billing/change-plan
 * switches it); credits_1000 always goes through checkout.
 */
export async function createCheckout(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  const user = await requireUser(request, ctx);
  await rateLimit(env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request, 1024);
  const product = body.product;
  if (typeof product !== 'string' || !PRODUCTS.includes(product as Product)) throw new HttpError(400, `product must be one of ${PRODUCTS.join(', ')}`);
  const row = await billingRow(env.DB, user.id);
  // A second subscription is refused; Pro from the admin's comp alone (src/plans.ts effectivePlan) can still subscribe.
  if (isSubscription(product as Product) && PRO_STATUSES.includes(row?.status ?? '')) {
    return json({ error: 'has_subscription', message: 'You have a subscription already; switch plans instead of buying a second one' }, 409, NO_STORE);
  }
  const origin = new URL(request.url).origin;
  const checkout = await polar<{ url: string }>(env, '/v1/checkouts/', {
    products: [productIds(env)[product as Product]],
    ...(row?.polar_customer_id ? { customer_id: row.polar_customer_id } : { external_customer_id: user.id }),
    metadata: { user_id: user.id, product },
    // product and checkout_id (Polar fills in {CHECKOUT_ID}) are for the page's message only; entitlements come from the webhook.
    success_url: `${origin}/practice/?checkout=done&product=${product}&checkout_id={CHECKOUT_ID}#/me`,
    return_url: `${origin}/pricing/`,
  });
  return json({ url: checkout.url }, 200, NO_STORE);
}

/**
 * POST /api/billing/change-plan {product}: switches the account's current
 * Polar subscription to another subscription product (Pro↔Max,
 * monthly↔yearly), at once; Polar invoices the prorated difference
 * (`proration_behavior: invoice`). Never opens a second subscription: 409
 * no_subscription without an active one, 409 canceling while it is set to
 * end (Polar refuses changes then), 409 same_plan for the product it has.
 * The webhook that follows sets `users.plan`, as for every subscription
 * change. Audited (`billing.change_plan`).
 */
export async function changePlan(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  const user = await requireUser(request, ctx);
  await rateLimit(env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request, 1024);
  const product = body.product as Product;
  if (typeof body.product !== 'string' || !PRODUCTS.includes(product) || !isSubscription(product)) {
    throw new HttpError(400, `product must be one of ${PRODUCTS.filter((p) => isSubscription(p)).join(', ')}`);
  }
  const row = await billingRow(env.DB, user.id);
  if (!row?.polar_subscription_id || !PRO_STATUSES.includes(row.status ?? '')) return json({ error: 'no_subscription', message: 'There is no active subscription to change' }, 409, NO_STORE);
  if (row.cancel_at_period_end === 1) return json({ error: 'canceling', message: 'The subscription is set to end; resume it in the billing portal first' }, 409, NO_STORE);
  if (row.product === product) return json({ error: 'same_plan', message: 'You are on that plan already' }, 409, NO_STORE);
  await polar(env, `/v1/subscriptions/${encodeURIComponent(row.polar_subscription_id)}`, { product_id: productIds(env)[product], proration_behavior: 'invoice' }, 'PATCH');
  await env.DB.batch([auditStatement(env, undefined, 'billing.change_plan', user.id, { from: row.product, to: product })]);
  return json({ ok: true, plan: SUBSCRIPTIONS[product], effective: 'now' }, 200, NO_STORE);
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
 * plan's limits (null where unlimited), the credits (src/credits.ts
 * creditsView) and every paid feature's answer (src/features.ts can:
 * {ok, reason?}). Works without billing set up (everyone is on free), so the
 * paid features can read credits; `billing` says whether checkout is on.
 */
export async function getPlan(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const plan = planName(user.plan);
  const limits = limitsFor(user.plan);
  const row = await billingRow(ctx.env.DB, user.id);
  const credits = await creditsView(ctx.env, user.id);
  const cap = (n: number) => (n >= UNLIMITED ? null : n);
  return json(
    {
      plan,
      billing: billingConfigured(ctx.env),
      subscription: row?.status
        ? { status: row.status, product: row.product, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end === 1 }
        : null,
      customer: !!row?.polar_customer_id,
      limits: { documents: cap(limits.documents), versionsPerDocument: cap(limits.versionsPerDocument), documentBytes: limits.documentBytes },
      credits,
      features: featureMap(user, ctx.env),
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
  /** An order's reason: purchase, subscription_create, subscription_cycle or subscription_update (a plan change's proration invoice). */
  billing_reason?: string;
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
 *   is not applied, nor a cancel or revoke of a subscription other than the
 *   current active one), and `users.plan` follows it: pro or max (by the
 *   product) while active, trialing or past_due, else free. A product change
 *   (Pro↔Max) moves the plan with it. A downgrade keeps every diagram; those
 *   past the free limit turn read-only (src/documents.ts).
 * - `order.paid` for credits_1000: 1,000 credits, once per order.
 * - `order.paid` of a plan change to Max (`billing_reason`
 *   `subscription_update`, the proration invoice): the month's credits get
 *   Max's allowance less the month's base, prorated to what is left of the
 *   month, once per order (P35). A subscription event that leaves the
 *   account off Max takes back what is unspent of it.
 * - `order.refunded`, a succeeded `refund.created|updated`, or a lost
 *   `dispute.*` (a chargeback) of a top-up order: its credits are taken back,
 *   what is left of them (the balance never goes below 0), once per order.
 *   A refund that arrives before the order's `order.paid` keeps it from granting.
 *
 * Everything else is acknowledged and ignored. Every delivery gets a row in
 * `billing_webhooks` (the admin's webhook log, migration 0023): when, its id
 * and type, the outcome and the account, never the payload. Requests are
 * rate-limited per IP before the signature is checked (WEBHOOK_LIMITER, 429
 * unlogged), and a bad signature is logged at most once per IP a minute
 * (WEBHOOK_LOG_LIMITER).
 */
export async function webhook(request: Request, ctx: Ctx): Promise<Response> {
  const env = configured(ctx.env);
  // Before anything is read or written: a flood answers 429 and isn't logged (Polar retries a 429).
  await rateLimit(env.WEBHOOK_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  // Every delivery is logged (billing_webhooks), however it ends: an error unless the handler says otherwise.
  const delivery: Delivery = { webhookId: request.headers.get('webhook-id')?.slice(0, 100) || null, type: null, outcome: 'error', userId: null };
  try {
    return await applyWebhook(request, env, delivery);
  } finally {
    // A bad signature is anyone's request: at most one is logged per IP a minute.
    if (delivery.outcome !== 'bad_signature' || (await env.WEBHOOK_LOG_LIMITER.limit({ key: ctx.ip })).success) await logDelivery(env.DB, delivery);
  }
}

/** What happened to a webhook delivery, for the admin's webhook log. */
export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored' | 'bad_signature' | 'stale' | 'error';

interface Delivery {
  webhookId: string | null;
  type: string | null;
  outcome: WebhookOutcome;
  userId: string | null;
}

/** Webhook deliveries are kept this long (the daily cron). */
export const WEBHOOK_LOG_RETENTION_DAYS = 90;

/** Writes the delivery's row: when, its id and type, the outcome and the account. Never the payload or a header's secret. A failure is logged, not thrown. */
async function logDelivery(DB: D1Database, d: Delivery): Promise<void> {
  try {
    await DB.prepare('INSERT INTO billing_webhooks (received_at, webhook_id, type, outcome, user_id) VALUES (?, ?, ?, ?, ?)')
      .bind(Date.now(), d.webhookId, d.type, d.outcome, d.userId)
      .run();
  } catch (e) {
    log('error', 'Logging a Polar webhook delivery failed', { outcome: d.outcome, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Deletes webhook log rows older than WEBHOOK_LOG_RETENTION_DAYS (the daily cron); returns how many. */
export async function pruneBillingWebhooks(env: Pick<Env, 'DB'>): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM billing_webhooks WHERE received_at < ?').bind(Date.now() - WEBHOOK_LOG_RETENTION_DAYS * 86_400_000).run();
  return meta.changes;
}

/** The account's webhook deliveries in "Download my data". */
export async function exportBillingWebhooks(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const { results } = await DB.prepare('SELECT received_at, type, outcome FROM billing_webhooks WHERE user_id = ? ORDER BY id')
    .bind(userId)
    .all<{ received_at: number; type: string | null; outcome: string }>();
  return results.map((r) => ({ receivedAt: r.received_at, type: r.type, outcome: r.outcome }));
}

async function applyWebhook(request: Request, env: Configured, delivery: Delivery): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? 0) > 256 * 1024) throw new HttpError(413, 'Request body too large');
  const body = await request.text();
  if (body.length > 256 * 1024) throw new HttpError(413, 'Request body too large');
  if (!(await verifyWebhook(env.POLAR_WEBHOOK_SECRET, request.headers, body))) {
    delivery.outcome = 'bad_signature';
    throw new HttpError(403, 'Invalid signature');
  }
  let event: { type?: unknown; data?: PolarObject };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    throw new HttpError(400, 'The body must be JSON');
  }
  const type = typeof event.type === 'string' ? event.type : '';
  const data = event.data ?? {};
  delivery.type = type.slice(0, 64) || null;
  const eventId = request.headers.get('webhook-id') as string;
  const { DB } = env;
  const t = Date.now();
  // Which statement's change says whether the event did anything (the first, billing_events, always runs).
  let effect: number | undefined;
  const statements: D1PreparedStatement[] = [DB.prepare('INSERT INTO billing_events (id, type, received_at) VALUES (?, ?, ?)').bind(eventId, type.slice(0, 64), t)];

  const userId = type.startsWith('subscription.') || type === 'order.paid' ? await userOf(DB, data) : undefined;
  const customerId = data.customer_id ?? data.customer?.id ?? null;
  delivery.userId = userId ?? null;
  const product = productOf(env, data.product_id);
  if (userId && type.startsWith('subscription.') && isSubscription(product)) {
    // The month's base grant is the plan before this event, so a plan change can't turn it into the new plan's (P35).
    statements.push(monthlyGrantStatement(DB, userId, (await planOf(DB, userId)) ?? 'free', t));
    effect = statements.length;
    const modified = msOf(data.modified_at) ?? msOf(data.created_at) ?? t;
    const pro = PRO_STATUSES.map((s) => `'${s}'`).join(', ');
    const newer = 'billing.subscription_modified_at IS NULL OR excluded.subscription_modified_at >= billing.subscription_modified_at';
    statements.push(
      // The stored subscription is the account's current one. Its own events apply when not older than what is stored. Another
      // subscription's event replaces it only when that one keeps Pro (a newer subscription) or the stored one doesn't: a late
      // cancel or revoke of an old subscription never downgrades an account with a newer active one.
      DB.prepare(
        `INSERT INTO billing (user_id, polar_customer_id, polar_subscription_id, status, product, current_period_end, cancel_at_period_end, subscription_modified_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (user_id) DO UPDATE SET
           polar_customer_id = COALESCE(excluded.polar_customer_id, billing.polar_customer_id),
           polar_subscription_id = excluded.polar_subscription_id, status = excluded.status, product = excluded.product,
           current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
           subscription_modified_at = excluded.subscription_modified_at, updated_at = excluded.updated_at
         WHERE CASE
           WHEN billing.polar_subscription_id IS NULL OR billing.polar_subscription_id = excluded.polar_subscription_id THEN ${newer}
           WHEN COALESCE(billing.status, '') NOT IN (${pro}) THEN excluded.status IN (${pro}) OR ${newer}
           ELSE excluded.status IN (${pro}) AND (${newer})
         END`,
      ).bind(userId, customerId, data.id ?? null, data.status ?? null, product, msOf(data.current_period_end), data.cancel_at_period_end ? 1 : 0, modified, t),
      // The plan follows what is stored, so a late, older event can't flip it back. A plan set by hand (not free, pro or max) stays.
      DB.prepare(
        `UPDATE users SET plan = CASE WHEN (SELECT status FROM billing WHERE user_id = ?1) IN (${pro})
           THEN (CASE WHEN (SELECT product FROM billing WHERE user_id = ?1) IN ('max_monthly', 'max_yearly') THEN 'max' ELSE 'pro' END) ELSE 'free' END
         WHERE id = ?1 AND plan IN ('free', 'pro', 'max')`,
      ).bind(userId),
      // Off Max now: what this month's upgrades gave goes back, as far as it is unspent (P35).
      upgradeRevokeStatement(DB, userId, eventId, t),
    );
  } else if (userId && type === 'order.paid' && data.billing_reason === 'subscription_update' && (product === 'max_monthly' || product === 'max_yearly') && data.id) {
    // An upgrade's proration invoice, paid (P35): the month's base is the plan before it, then the prorated difference.
    effect = statements.length + 1;
    statements.push(monthlyGrantStatement(DB, userId, (await planOf(DB, userId)) ?? 'free', t), upgradeGrantStatement(DB, userId, 'max', data.id, t));
  } else if (userId && type === 'order.paid' && product === 'credits_1000' && data.id) {
    effect = statements.length + 1;
    statements.push(
      DB.prepare(
        `INSERT INTO billing (user_id, polar_customer_id, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id) DO UPDATE SET polar_customer_id = COALESCE(billing.polar_customer_id, excluded.polar_customer_id), updated_at = excluded.updated_at`,
      ).bind(userId, customerId, t),
      topupStatement(DB, userId, TOPUP_CREDITS * MC, 'credits_1000', data.id, t),
    );
  }

  // A top-up's money back: order.refunded (the order), refund.created|updated (a succeeded refund of it) or a chargeback (a dispute lost).
  const refundedOrder =
    type === 'order.refunded'
      ? data.id
      : (type === 'refund.created' || type === 'refund.updated') && data.status === 'succeeded'
        ? data.order_id
        : type.startsWith('dispute.') && (data.status === 'lost' || data.status === 'charge_back')
          ? data.order_id
          : undefined;
  // Marked first, so an order.paid that arrives later grants nothing.
  if (refundedOrder) {
    effect = statements.length;
    statements.push(refundedOrderStatement(DB, refundedOrder, t), revokeStatement(DB, refundedOrder, t));
    delivery.userId = (await DB.prepare("SELECT user_id FROM credits WHERE kind = 'topup' AND ref_id = ?").bind(refundedOrder).first<{ user_id: string }>())?.user_id ?? null;
  }

  let results: D1Result[];
  try {
    results = await DB.batch(statements);
  } catch (e) {
    // The event's row is first in the batch: a replay fails on it and the whole batch rolls back.
    if (e instanceof Error && /UNIQUE constraint failed: billing_events\.id/.test(e.message)) {
      delivery.outcome = 'duplicate';
      return json({ ok: true, duplicate: true }, 200, NO_STORE);
    }
    throw e;
  }
  // A subscription event older than what is stored (or another subscription's that may not replace it) changes nothing: stale.
  // A top-up's grant that adds nothing (a refund came first) or an event nothing handles: ignored.
  if (effect === undefined) delivery.outcome = 'ignored';
  else if (results[effect].meta.changes > 0 || refundedOrder) delivery.outcome = 'applied';
  else delivery.outcome = type.startsWith('subscription.') ? 'stale' : 'ignored';
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
