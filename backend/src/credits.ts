import type { Env } from './env';
import { limitsFor } from './plans';

/**
 * AI interview credits: a ledger in D1 (table `credits`, migration 0017;
 * docs/design/paid-plans.md P3). Nothing stores a balance: it is summed from
 * the rows each time, so a spend and a refund can't drift apart.
 *
 * An account has three buckets, spent in this order:
 *
 * 1. `monthly`: its plan's `interviewsPerMonth` (Pro: 4) for the current UTC
 *    month. A new month starts at its full allowance; unused ones don't roll over.
 * 2. `trial`: `interviewsLifetime` (1) for the account's whole life, on any plan.
 * 3. `pack`: bought credits (src/billing.ts grants 5 per pack), which never expire.
 *
 * The API the AI interview calls:
 *
 *   balance(env, userId)              → {total, monthly, trial, pack, period}
 *   spend(env, userId, kind, refId)   → {ok: true, bucket} | {ok: false, reason: 'no_credits'}
 *   refund(env, refId)                → {refunded: boolean}
 *
 * `refId` is the caller's id of what the credit pays for (an interview
 * session's id) and is unique across accounts: spending twice with one refId
 * debits once and answers ok both times, and refunding it twice gives back
 * one credit. The refund policy (P3: the session failed in its first 5
 * minutes) is the caller's to decide; refund() only gives the credit back to
 * the bucket it came from (a monthly one to its month).
 *
 * Every write is one conditional INSERT, which D1 runs atomically, so two
 * interviews started at once can't both take the last credit.
 */

export type Bucket = 'monthly' | 'trial' | 'pack';

/** What a credit is spent on. */
export type CreditUse = 'interview';

export interface Balance {
  /** Interviews the account can start now: the three buckets together. */
  total: number;
  /** Left of this month's plan allowance. */
  monthly: number;
  /** Left of the lifetime allowance. */
  trial: number;
  /** Bought credits left. */
  pack: number;
  /** The month `monthly` is for, YYYY-MM (UTC). */
  period: string;
}

export type SpendResult = { ok: true; bucket: Bucket } | { ok: false; reason: 'no_credits' };

/** The UTC month of `at` (Unix ms), YYYY-MM: the monthly allowance's period. */
export const periodOf = (at: number): string => new Date(at).toISOString().slice(0, 7);

async function planOf(DB: D1Database, userId: string): Promise<string | undefined> {
  return (await DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first<{ plan: string }>())?.plan;
}

/** What the account can spend now. `at` (Unix ms) picks the month; the tests move it. */
export async function balance(env: Pick<Env, 'DB'>, userId: string, at = Date.now()): Promise<Balance> {
  const { DB } = env;
  const period = periodOf(at);
  const limits = limitsFor(await planOf(DB, userId));
  const row = await DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN bucket = 'monthly' AND period = ?2 THEN -delta END), 0) AS monthly_used,
       COALESCE(SUM(CASE WHEN bucket = 'trial' THEN -delta END), 0) AS trial_used,
       COALESCE(SUM(CASE WHEN bucket = 'pack' THEN delta END), 0) AS pack
     FROM credits WHERE user_id = ?1`,
  )
    .bind(userId, period)
    .first<{ monthly_used: number; trial_used: number; pack: number }>();
  const monthly = Math.max(0, limits.interviewsPerMonth - (row?.monthly_used ?? 0));
  const trial = Math.max(0, limits.interviewsLifetime - (row?.trial_used ?? 0));
  const pack = Math.max(0, row?.pack ?? 0);
  return { total: monthly + trial + pack, monthly, trial, pack, period };
}

/**
 * Debits one credit for `refId`, from the first bucket that has one. Atomic;
 * `{ok: false, reason: 'no_credits'}` when every bucket is empty. Idempotent
 * by `refId`.
 */
export async function spend(env: Pick<Env, 'DB'>, userId: string, kind: CreditUse, refId: string, at = Date.now()): Promise<SpendResult> {
  const { DB } = env;
  const earlier = async () =>
    DB.prepare("SELECT bucket FROM credits WHERE kind = 'spend' AND ref_id = ? AND user_id = ?").bind(refId, userId).first<{ bucket: Bucket }>();
  const before = await earlier();
  if (before) return { ok: true, bucket: before.bucket };
  const period = periodOf(at);
  const limits = limitsFor(await planOf(DB, userId));
  // Each: one debit row, only while its bucket has a credit left (a statement is atomic in D1).
  const attempts: [Bucket, string, string, number][] = [
    ['monthly', period, "bucket = 'monthly' AND period = ?2", limits.interviewsPerMonth],
    ['trial', '', "bucket = 'trial'", limits.interviewsLifetime],
  ];
  for (const [bucket, p, which, allowance] of attempts) {
    if (allowance <= 0) continue;
    const row = await DB.prepare(
      `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
       SELECT ?1, 'spend', '${bucket}', ?2, -1, ?3, ?4, ?5 WHERE (SELECT COALESCE(-SUM(delta), 0) FROM credits WHERE user_id = ?1 AND ${which}) < ?6
       ON CONFLICT (kind, ref_id) DO NOTHING RETURNING bucket`,
    )
      .bind(userId, p, kind, refId, at, allowance)
      .first<{ bucket: Bucket }>();
    if (row) return { ok: true, bucket: row.bucket };
  }
  const pack = await DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
     SELECT ?1, 'spend', 'pack', '', -1, ?2, ?3, ?4 WHERE (SELECT COALESCE(SUM(delta), 0) FROM credits WHERE user_id = ?1 AND bucket = 'pack') >= 1
     ON CONFLICT (kind, ref_id) DO NOTHING RETURNING bucket`,
  )
    .bind(userId, kind, refId, at)
    .first<{ bucket: Bucket }>();
  if (pack) return { ok: true, bucket: 'pack' };
  // A concurrent spend with the same refId may have won the race.
  const after = await earlier();
  return after ? { ok: true, bucket: after.bucket } : { ok: false, reason: 'no_credits' };
}

/** Gives back the credit spent for `refId`, to the bucket it came from. Once per refId; false when nothing was spent for it or it was refunded already. */
export async function refund(env: Pick<Env, 'DB'>, refId: string, at = Date.now()): Promise<{ refunded: boolean }> {
  const row = await env.DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
     SELECT user_id, 'refund', bucket, period, 1, item, ref_id, ?2 FROM credits WHERE kind = 'spend' AND ref_id = ?1
     ON CONFLICT (kind, ref_id) DO NOTHING RETURNING id`,
  )
    .bind(refId, at)
    .first();
  return { refunded: row !== null };
}

/** The statement that adds `credits` pack credits for a paid order (src/billing.ts batches it with the webhook's other writes). Once per order. */
export function grantStatement(DB: D1Database, userId: string, credits: number, item: string, orderId: string, at = Date.now()): D1PreparedStatement {
  return DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at) VALUES (?1, 'grant', 'pack', '', ?2, ?3, ?4, ?5)
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(userId, credits, item, orderId, at);
}

/** The ledger in "Download my data". */
export async function exportCredits(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const { results } = await DB.prepare('SELECT kind, bucket, period, delta, item, ref_id, created_at FROM credits WHERE user_id = ? ORDER BY id').bind(userId).all<Record<string, string | number>>();
  return results.map((r) => ({ kind: r.kind, bucket: r.bucket, period: r.period || undefined, delta: r.delta, item: r.item, refId: r.ref_id, createdAt: r.created_at }));
}
