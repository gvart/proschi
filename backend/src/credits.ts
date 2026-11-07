import { hmacSha256 } from './crypto';
import { secretOk, type Env } from './env';
import { effectivePlan, limitsFor, MC, planName, SIGNUP_CREDITS } from './plans';

/**
 * The credit ledger in D1 (table `credits`, migration 0024;
 * docs/design/paid-plans.md P26). Amounts are millicredits (mc, thousandths
 * of a credit). Nothing stores a balance: it is summed from the rows, so a
 * charge and a grant can't drift apart. Holds and charges are src/meter.ts.
 *
 * An account has three buckets, spent in this order:
 *
 * 1. `monthly`: its plan's `monthlyCredits` (Pro 800, Max 2,200) for the
 *    current UTC month. The month's grant is written the first time the
 *    balance is read in it (monthlyGrantStatement); it doesn't roll over. An
 *    upgrade mid-month adds the difference to the new plan's allowance.
 * 2. `signup`: 100 credits once per account and identity (grantSignupCredits),
 *    on any plan, once the sign-up's checks pass.
 * 3. `topup`: bought credits (src/billing.ts grants 1,000 per order), which
 *    never expire; a refunded or charged-back order takes back what is left.
 *
 * Every write is one statement or one batch, which D1 runs atomically.
 */

export type Bucket = 'monthly' | 'signup' | 'topup';

/** The buckets in millicredits; `held` is what unexpired holds keep back (src/meter.ts). */
export interface Buckets {
  monthly: number;
  signup: number;
  topup: number;
  held: number;
}

/** The credits object of GET /api/me/plan (docs/impl/design-partner.md), in credits with up to 3 decimals. */
export interface CreditsView {
  /** What can be spent now: the buckets less what is held. */
  balance: number;
  monthly: { allowance: number; left: number; resetsAt: number } | null;
  signup: number;
  topup: number;
}

/** The UTC month of `at` (Unix ms), YYYY-MM: the monthly allowance's period. */
export const periodOf = (at: number): string => new Date(at).toISOString().slice(0, 7);

/** When the month of `at` ends (the next UTC month's first instant), Unix ms. */
export function nextPeriodAt(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Millicredits as credits (3 decimals at most). */
export const credits = (mc: number): number => Math.round(mc) / MC;

/** The account's effective plan (a comp counts, src/plans.ts); undefined without the account. */
export async function planOf(DB: D1Database, userId: string): Promise<string | undefined> {
  const row = await DB.prepare('SELECT plan, comp_until FROM users WHERE id = ?').bind(userId).first<{ plan: string; comp_until: number | null }>();
  return row ? planName(effectivePlan(row.plan, row.comp_until)) : undefined;
}

/**
 * The statement that grants this month's allowance of `plan`, if not granted
 * yet: the allowance less what this month's grants already gave (an upgrade
 * adds the difference, a downgrade takes nothing back). Once per month and
 * plan (its ref).
 */
export function monthlyGrantStatement(DB: D1Database, userId: string, plan: string, at: number): D1PreparedStatement {
  const period = periodOf(at);
  const allowance = limitsFor(plan).monthlyCredits * MC;
  return DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
     SELECT ?1, 'monthly_grant', 'monthly', ?2, ?3 - granted, ?4, 'monthly:' || ?1 || ':' || ?2 || ':' || ?4, ?5
     FROM (SELECT COALESCE(SUM(delta_mc), 0) AS granted FROM credits WHERE user_id = ?1 AND kind = 'monthly_grant' AND period = ?2)
     WHERE ?3 - granted > 0
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(userId, period, allowance, plan, at);
}

/** SQL over `credits` for the user ?1 at month ?2: the sum of every bucket that counts (another month's monthly rows don't). */
export const LEDGER_TOTAL_SQL = "(SELECT COALESCE(SUM(delta_mc), 0) FROM credits WHERE user_id = ?1 AND (bucket <> 'monthly' OR period = ?2))";

/** The buckets now, after granting the month's allowance when due. `at` (Unix ms) picks the month; the tests move it. */
export async function buckets(env: Pick<Env, 'DB'>, userId: string, at = Date.now()): Promise<Buckets> {
  const { DB } = env;
  const plan = (await planOf(DB, userId)) ?? 'free';
  const [, sums] = await DB.batch([
    monthlyGrantStatement(DB, userId, plan, at),
    DB.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN bucket = 'monthly' AND period = ?2 THEN delta_mc END), 0) AS monthly,
         COALESCE(SUM(CASE WHEN bucket = 'signup' THEN delta_mc END), 0) AS signup,
         COALESCE(SUM(CASE WHEN bucket = 'topup' THEN delta_mc END), 0) AS topup,
         (SELECT COALESCE(SUM(amount_mc), 0) FROM credit_holds WHERE user_id = ?1 AND expires_at > ?3) AS held
       FROM credits WHERE user_id = ?1`,
    ).bind(userId, periodOf(at), at),
  ]);
  const r = (sums.results[0] ?? {}) as Partial<Buckets>;
  return { monthly: r.monthly ?? 0, signup: r.signup ?? 0, topup: r.topup ?? 0, held: r.held ?? 0 };
}

/** What can be held now, in millicredits: the buckets less the holds, never below 0. */
export const spendable = (b: Buckets): number => Math.max(0, b.monthly + b.signup + b.topup - b.held);

/** The credits object of GET /api/me/plan and the interview routes. */
export async function creditsView(env: Pick<Env, 'DB'>, userId: string, at = Date.now()): Promise<CreditsView> {
  const b = await buckets(env, userId, at);
  const allowance = limitsFor(await planOf(env.DB, userId)).monthlyCredits;
  return {
    balance: credits(spendable(b)),
    monthly: allowance > 0 ? { allowance, left: credits(Math.max(0, b.monthly)), resetsAt: nextPeriodAt(at) } : null,
    signup: credits(Math.max(0, b.signup)),
    topup: credits(Math.max(0, b.topup)),
  };
}

// --- Top-ups (src/billing.ts) ---------------------------------------------

/**
 * The statement that adds `amountMc` top-up credits for a paid order (batched with the webhook's other writes).
 * Once per order, and never for an order already refunded (a refund that arrived before its order.paid, `refunded_orders`).
 */
export function topupStatement(DB: D1Database, userId: string, amountMc: number, item: string, orderId: string, at = Date.now()): D1PreparedStatement {
  return DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
     SELECT ?1, 'topup', 'topup', '', ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM refunded_orders WHERE order_id = ?4)
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(userId, amountMc, item, orderId, at);
}

/** The statement that marks an order refunded, so a grant arriving after it adds nothing. */
export function refundedOrderStatement(DB: D1Database, orderId: string, at = Date.now()): D1PreparedStatement {
  return DB.prepare('INSERT INTO refunded_orders (order_id, refunded_at) VALUES (?, ?) ON CONFLICT (order_id) DO NOTHING').bind(orderId, at);
}

/**
 * The statement that takes back the top-up of a refunded (or charged back)
 * order: what it granted, but no more than the top-up balance has left, so
 * it never goes below 0 (credits already spent stay spent). Once per order;
 * nothing when the order granted nothing.
 */
export function revokeStatement(DB: D1Database, orderId: string, at = Date.now()): D1PreparedStatement {
  return DB.prepare(
    `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
     SELECT g.user_id, 'topup_revoke', 'topup', '', -MIN(g.delta_mc, MAX(0, (SELECT COALESCE(SUM(c.delta_mc), 0) FROM credits c WHERE c.user_id = g.user_id AND c.bucket = 'topup'))), g.item, g.ref_id, ?2
     FROM credits g WHERE g.kind = 'topup' AND g.ref_id = ?1
     ON CONFLICT (kind, ref_id) DO NOTHING`,
  ).bind(orderId, at);
}

// --- Sign-up credits and deleted accounts ----------------------------------
//
// Sign-up credits come once per account AND once per identity: an HMAC of
// the identity is kept in `signup_identities` when they are given, and that
// row outlives the account. Deleting an account also leaves one tombstone
// per identity it signed in with (migration 0022), saying whether it got the
// sign-up credits, for accounts made before 0024.
//
// `signup_identities` is not `signup_claims` (src/signupChecks.ts), though
// both hold identity HMACs that outlive the account. A claim is taken when
// an account is *checked*, before any grant and also when it is refused
// (disposable, seen before), with no account id, so the ledger can't tell
// its own fresh claim from another account's. `signup_identities` is the
// ledger's own guard: taken only by a grant, keyed by the one identity key
// the credits went to, so grantSignupCredits stays once per identity
// whoever calls it.

const tombstoneKey = (secret: string) => `${secret}/account-tombstone`;

/** The HMAC-SHA256 of an identity key, as `account_tombstones` and `signup_identities` keep it. */
const keyHash = (secret: string, identityKey: string): Promise<string> => hmacSha256(identityKey, tombstoneKey(secret));

/** The tombstone's key of a provider identity: the HMAC of `${provider}\n${subject}` (its identityKey for grantSignupCredits). */
export function identityHash(secret: string, provider: string, subject: string): Promise<string> {
  return keyHash(secret, `${provider}\n${subject}`);
}

/**
 * Gives the account its 100 sign-up credits (P26), when the sign-up's checks
 * have passed (the caller's: a confirmed email, not disposable, the per-IP
 * limit). `identityKey` names who signed up: `${provider}\n${subject}` for a
 * GitHub or Google sign-in (as identityHash), a normalized email for an email
 * sign-up. Once per account and once per identity key, also after the
 * account is deleted and made again: 'already' then, and nothing is added.
 * 'already' without a usable SESSION_SECRET (no one can sign in then).
 */
export async function grantSignupCredits(env: Pick<Env, 'DB' | 'SESSION_SECRET'>, userId: string, identityKey: string, at = Date.now()): Promise<'granted' | 'already'> {
  if (!secretOk(env as Env)) return 'already';
  const { DB } = env;
  const hash = await keyHash(env.SESSION_SECRET as string, identityKey);
  const [granted] = await DB.batch([
    DB.prepare(
      `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
       SELECT ?1, 'signup_grant', 'signup', '', ?2, 'signup', 'signup:' || ?1, ?3
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)
         AND NOT EXISTS (SELECT 1 FROM signup_identities WHERE identity_hash = ?4)
         AND NOT EXISTS (SELECT 1 FROM account_tombstones WHERE identity_hash = ?4 AND trial_used = 1)
       ON CONFLICT (kind, ref_id) DO NOTHING`,
    ).bind(userId, SIGNUP_CREDITS * MC, at, hash),
    // Taken either way: an identity whose account already had its credits gets none on another account later.
    DB.prepare('INSERT INTO signup_identities (identity_hash, granted_at) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?3) ON CONFLICT (identity_hash) DO NOTHING').bind(hash, at, userId),
  ]);
  return granted.meta.changes > 0 ? 'granted' : 'already';
}

/** The statements that leave the account's tombstones, to run with its deletion. None without a usable SESSION_SECRET (no one can sign in then). */
export async function tombstoneStatements(env: Pick<Env, 'DB' | 'SESSION_SECRET'>, userId: string): Promise<D1PreparedStatement[]> {
  if (!secretOk(env as Env)) return [];
  const { DB } = env;
  const [identities, signup] = await DB.batch([
    DB.prepare('SELECT provider, subject FROM identities WHERE user_id = ?').bind(userId),
    DB.prepare("SELECT COUNT(*) AS n FROM credits WHERE user_id = ? AND kind = 'signup_grant'").bind(userId),
  ]);
  const used = ((signup.results[0] as { n: number } | undefined)?.n ?? 0) > 0 ? 1 : 0;
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
 * Superseded by grantSignupCredits, which checks the identity itself: nothing
 * is granted at account creation any more, so there is nothing to mark.
 * Kept so the sign-up batch (src/auth.ts) needs no change; always undefined.
 */
export async function priorTrialStatement(_env: Pick<Env, 'DB' | 'SESSION_SECRET'>, _userId: string, _provider: string, _subject: string, _at: number): Promise<D1PreparedStatement | undefined> {
  return undefined;
}

/** The ledger and the charges in "Download my data". */
export async function exportCredits(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const { results } = await DB.prepare('SELECT kind, bucket, period, delta_mc, item, ref_id, created_at FROM credits WHERE user_id = ? ORDER BY id').bind(userId).all<Record<string, string | number>>();
  return results.map((r) => ({ kind: r.kind, bucket: r.bucket, period: r.period || undefined, credits: credits(r.delta_mc as number), item: r.item, refId: r.ref_id, createdAt: r.created_at }));
}
