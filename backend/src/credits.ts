import { hmacSha256 } from './crypto';
import { secretOk, type Env } from './env';
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
 * 3. `pack`: bought credits (src/billing.ts grants 5 per pack), which never
 *    expire; a refunded or charged-back pack takes back what is left of them.
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

/**
 * The statement that takes back the pack credits of a refunded (or charged
 * back) order: the grant's credits, but no more than the pack balance has
 * left, so it never goes below 0 (credits already spent stay spent). Once
 * per order, also when its balance was 0 then; nothing when the order
 * granted no credits.
 */
export function revokeStatement(DB: D1Database, orderId: string, at = Date.now()): D1PreparedStatement {
  return DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
     SELECT g.user_id, 'revoke', 'pack', '', -MIN(g.delta, MAX(0, (SELECT COALESCE(SUM(c.delta), 0) FROM credits c WHERE c.user_id = g.user_id AND c.bucket = 'pack'))), g.item, g.ref_id, ?2
     FROM credits g WHERE g.kind = 'grant' AND g.ref_id = ?1
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(orderId, at);
}

// --- Deleted accounts and the trial --------------------------------------
//
// Deleting an account leaves one tombstone per identity it signed in with
// (migration 0022): an HMAC of the provider and its user id, and whether the
// trial interview was used. A new account made with a tombstoned identity
// starts with that trial already used, so deleting and signing up again
// doesn't give a fresh free interview. Nothing else about the account stays.

const tombstoneKey = (secret: string) => `${secret}/account-tombstone`;

/** The tombstone's key of an identity: HMAC-SHA256 of the provider and the provider's user id. */
export function identityHash(secret: string, provider: string, subject: string): Promise<string> {
  return hmacSha256(`${provider}\n${subject}`, tombstoneKey(secret));
}

/** The statements that leave the account's tombstones, to run with its deletion. None without a usable SESSION_SECRET (no one can sign in then). */
export async function tombstoneStatements(env: Pick<Env, 'DB' | 'SESSION_SECRET'>, userId: string): Promise<D1PreparedStatement[]> {
  if (!secretOk(env as Env)) return [];
  const { DB } = env;
  const [identities, trial] = await DB.batch([
    DB.prepare('SELECT provider, subject FROM identities WHERE user_id = ?').bind(userId),
    DB.prepare("SELECT COALESCE(-SUM(delta), 0) AS used FROM credits WHERE user_id = ? AND bucket = 'trial'").bind(userId),
  ]);
  const used = ((trial.results[0] as { used: number } | undefined)?.used ?? 0) > 0 ? 1 : 0;
  return Promise.all(
    (identities.results as { provider: string; subject: string }[]).map(async (i) =>
      DB.prepare('INSERT INTO account_tombstones (identity_hash, trial_used) VALUES (?1, ?2) ON CONFLICT (identity_hash) DO UPDATE SET trial_used = MAX(trial_used, excluded.trial_used)').bind(
        await identityHash(env.SESSION_SECRET as string, i.provider, i.subject),
        used,
      ),
    ),
  );
}

/**
 * The statement that marks a new account's trial as used when its identity's
 * earlier account used it (a 'spend' of the trial bucket with no session,
 * ref_id `prior:<user id>`); run in the batch that creates the account.
 */
export async function priorTrialStatement(env: Pick<Env, 'DB' | 'SESSION_SECRET'>, userId: string, provider: string, subject: string, at: number): Promise<D1PreparedStatement | undefined> {
  if (!secretOk(env as Env)) return undefined;
  return env.DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta, item, ref_id, created_at)
     SELECT ?1, 'spend', 'trial', '', -1, 'prior_account', 'prior:' || ?1, ?2 WHERE EXISTS (SELECT 1 FROM account_tombstones WHERE identity_hash = ?3 AND trial_used = 1)
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(userId, at, await identityHash(env.SESSION_SECRET as string, provider, subject));
}

/** The ledger in "Download my data". */
export async function exportCredits(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const { results } = await DB.prepare('SELECT kind, bucket, period, delta, item, ref_id, created_at FROM credits WHERE user_id = ? ORDER BY id').bind(userId).all<Record<string, string | number>>();
  return results.map((r) => ({ kind: r.kind, bucket: r.bucket, period: r.period || undefined, delta: r.delta, item: r.item, refId: r.ref_id, createdAt: r.created_at }));
}
