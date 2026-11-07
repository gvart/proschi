import { identityHash } from './credits';
import { hmacSha256 } from './crypto';
import { DISPOSABLE_DOMAINS } from './disposableDomains';
import { now, secretOk, type Env } from './env';
import { errorText, log } from './log';
import { signupLedger } from './signupCredits';

/**
 * Who gets the free sign-up credits (docs/design/paid-plans.md P26).
 * Only an account that passes every check, once:
 *
 *  1. its address is confirmed: an email account after its confirmation link
 *     or password reset, a GitHub or Google account at once;
 *  2. the address's domain is not a disposable one (src/disposableDomains.ts);
 *  3. none of its identities was seen before: the provider's user id, and
 *     the normalized address (normalizeEmail), as the same HMACs as
 *     `account_tombstones`, kept in `signup_claims` even after the account is
 *     deleted;
 *  4. its sign-up IP (an HMAC of it; of its /64 for IPv6) got credits for at
 *     most 2 other accounts in the last 7 days.
 *
 * An account that fails one still exists and can buy credits; the decision
 * and why is in `signup_checks` for the page and the admin panel.
 *
 * `signup_claims` is not the ledger's `signup_identities` (src/credits.ts):
 * claims are every identity ever checked, granted or refused, taken before
 * the grant and with no account id; `signup_identities` is only the
 * identities that were granted, which grantSignupCredits checks itself so
 * the ledger is once per identity on its own.
 */

export const IP_GRANTS_PER_WEEK = 3;
const WEEK = 7 * 86_400;

export type SignupReason = 'unconfirmed' | 'granted' | 'disposable' | 'seen_before' | 'ip_limit';

/** An address: as stored (trimmed, lowercased), the form the checks compare, and its domain. Undefined when it isn't one. */
export function normalizeEmail(value: unknown): { email: string; normalized: string; domain: string } | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[a-z0-9-]{2,}$/.test(email)) return undefined;
  const at = email.lastIndexOf('@');
  let local = email.slice(0, at);
  let domain = email.slice(at + 1).replace(/\.$/, '');
  if (domain === 'googlemail.com') domain = 'gmail.com';
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return undefined;
  return { email, normalized: `${local}@${domain}`, domain };
}

let disposable: Set<string> | undefined;

/** Whether the domain, or a domain it is under, is a disposable one. */
export function isDisposable(domain: string): boolean {
  disposable ??= new Set(DISPOSABLE_DOMAINS.split('\n'));
  const labels = domain.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) if (disposable.has(labels.slice(i).join('.'))) return true;
  return false;
}

/**
 * What the IP limit counts: an IPv4 address as it is, an IPv6 address by its
 * /64 (one customer's network gets a whole /64, so its addresses rotate
 * freely); an IPv4-mapped IPv6 address is its IPv4 one.
 */
export function ipKey(ip: string): string {
  const v6 = ip.trim().toLowerCase();
  if (!v6.includes(':')) return ip;
  const mapped = /^[0:]*:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
  if (mapped) return mapped[1];
  const [head, tail] = v6.split('%')[0].split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

/** The HMAC of an IP the checks store (of its /64 for IPv6, ipKey): never the IP itself. */
export function ipHash(env: Env & { SESSION_SECRET: string }, ip: string): Promise<string> {
  return hmacSha256(ipKey(ip), `${env.SESSION_SECRET}/signup-ip`);
}

/** The claim of an address: the tombstone HMAC of ('email', the normalized address), like an identity's. */
export const emailClaim = (env: Env & { SESSION_SECRET: string }, normalized: string) => identityHash(env.SESSION_SECRET, 'email', normalized);

/** Notes a new email account that is waiting for its confirmation. */
export async function recordPending(env: Env & { SESSION_SECRET: string }, userId: string, ip: string): Promise<D1PreparedStatement> {
  return env.DB.prepare("INSERT INTO signup_checks (user_id, outcome, reason, ip_hash, created_at) VALUES (?, 'pending', 'unconfirmed', ?, ?) ON CONFLICT DO NOTHING").bind(
    userId,
    await ipHash(env, ip),
    now(),
  );
}

export interface SignupIdentity {
  userId: string;
  /** The ledger's identity (src/signupCredits.ts): the normalized verified address, else `${provider}\n${subject}`. */
  identityKey: string;
  /** Every claim of the account: the HMACs of its identity and of its address. */
  claims: string[];
  /** The address's domain, when there is one. */
  domain?: string;
  /** For a new OAuth account; an email account's sign-up IP is in its pending row. */
  ip?: string;
}

/**
 * Decides an account's sign-up credits, once: an account already decided
 * keeps its answer. Returns the outcome; undefined when the account has no
 * pending row (it was made before these checks, or got its email sign-in by
 * linking).
 */
export async function decideSignupCredits(env: Env, who: SignupIdentity): Promise<{ outcome: 'granted' | 'refused'; reason: SignupReason } | undefined> {
  if (!secretOk(env)) return undefined;
  const { DB } = env;
  const t = now();
  if (who.ip !== undefined) {
    await DB.prepare("INSERT INTO signup_checks (user_id, outcome, reason, ip_hash, created_at) VALUES (?, 'pending', 'unconfirmed', ?, ?) ON CONFLICT DO NOTHING")
      .bind(who.userId, await ipHash(env, who.ip), t)
      .run();
  }
  const row = await DB.prepare('SELECT outcome, reason, ip_hash FROM signup_checks WHERE user_id = ?').bind(who.userId).first<{ outcome: string; reason: SignupReason; ip_hash: string }>();
  if (!row) return undefined;
  if (row.outcome !== 'pending') return { outcome: row.outcome as 'granted' | 'refused', reason: row.reason };

  const reason = await check(DB, who, row.ip_hash, t);
  if (reason === 'granted') {
    try {
      await signupLedger.grant(env, who.userId, who.identityKey);
    } catch (e) {
      // Stays pending: the claims are taken, so the admin grants by hand (the event says whose).
      log('error', 'Granting sign-up credits failed', { userId: who.userId, error: errorText(e) });
      return undefined;
    }
  }
  const outcome = reason === 'granted' ? 'granted' : 'refused';
  await DB.prepare("UPDATE signup_checks SET outcome = ?, reason = ?, decided_at = ? WHERE user_id = ? AND outcome = 'pending'").bind(outcome, reason, t, who.userId).run();
  log('info', 'Decided sign-up credits', { userId: who.userId, outcome, reason });
  return { outcome, reason };
}

async function check(DB: D1Database, who: SignupIdentity, ip: string, t: number): Promise<SignupReason> {
  if (who.domain && isDisposable(who.domain)) {
    // Claimed anyway, so the same address on another account is "seen before" too.
    await claim(DB, who.claims, t);
    return 'disposable';
  }
  const placeholders = who.claims.map(() => '?').join(', ');
  const tombstoned = await DB.prepare(`SELECT 1 FROM account_tombstones WHERE identity_hash IN (${placeholders}) LIMIT 1`)
    .bind(...who.claims)
    .first();
  // Claiming is the check: of two accounts racing with one address, only one inserts it.
  const fresh = await claim(DB, who.claims, t);
  if (tombstoned || !fresh) return 'seen_before';
  // One statement, so parallel confirmations from one IP can't pass the count together.
  const { meta } = await DB.prepare('INSERT INTO signup_ip_grants (ip_hash, granted_at) SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM signup_ip_grants WHERE ip_hash = ?1 AND granted_at > ?3) < ?4')
    .bind(ip, t, t - WEEK, IP_GRANTS_PER_WEEK)
    .run();
  return meta.changes > 0 ? 'granted' : 'ip_limit';
}

/** Inserts the claims; whether every one of them was new. */
async function claim(DB: D1Database, claims: string[], t: number): Promise<boolean> {
  const results = await DB.batch(claims.map((c) => DB.prepare('INSERT INTO signup_claims (identity_hash, claimed_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(c, t)));
  return results.every((r) => r.meta.changes > 0);
}

/** The account's decision for the page: null for an account made before the checks. */
export async function signupStatus(DB: D1Database, userId: string): Promise<{ outcome: string; reason: SignupReason } | null> {
  return DB.prepare('SELECT outcome, reason FROM signup_checks WHERE user_id = ?').bind(userId).first<{ outcome: string; reason: SignupReason }>();
}

/** Deletes the per-IP grants older than the week they count for; returns how many (the daily cron). */
export async function pruneSignupIpGrants(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM signup_ip_grants WHERE granted_at <= ?').bind(now() - WEEK).run();
  return meta.changes;
}
