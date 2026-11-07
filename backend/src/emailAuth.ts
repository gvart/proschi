import { authenticate, requireUser, startWebSession } from './auth';
import type { Ctx } from './context';
import { hmacSha256, randomToken, sha256 } from './crypto';
import { emailConfigured, sendEmail } from './email';
import { alreadyRegisteredEmail, passwordResetEmail, signupConfirmEmail, type RenderedEmail } from './emails';
import { now, secretOk, type Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { hashPassword, passwordProblem, verifyPassword } from './password';
import { siteOrigin } from './reminders';
import { decideSignupCredits, emailClaim, normalizeEmail, recordPending, signupStatus } from './signupChecks';
import { verifyTurnstile } from './turnstile';

/**
 * Email and password sign-in (backend/README.md "Email sign-in"):
 *
 *   GET  /auth/email/start?return=[&link=1]  → the sign-in page, /signin/
 *   POST /auth/email/signup {email, password, turnstile, link?}   202, always the same answer
 *   POST /auth/email/confirm {token}          confirms the address, signs in
 *   POST /auth/email/login {email, password, turnstile}
 *   POST /auth/email/resend                   the confirmation again (signed in, unconfirmed)
 *   POST /auth/email/reset-request {email, turnstile}             202, always the same answer
 *   POST /auth/email/reset {token, password}  a new password; signs out everywhere else
 *   GET  /auth/email/status                   the address, whether confirmed, the sign-up credits
 *
 * No answer says whether an address has an account: sign-up and reset
 * always answer the same, and the email tells the owner what happened. A
 * wrong address and a wrong password are one error, and an unknown address
 * still costs a password hash. Sign-in failures back off per account and per
 * IP (login_failures). The account's identity is `identities` ('email',
 * normalized address), so deleting it leaves the tombstone every sign-in does.
 *
 * An email sign-in linked to a signed-in account (`link`) has no identity
 * until that account, signed in, opens its confirmation link: until then no
 * sign-in, reset or lookup finds it and it never gets a password from a
 * sign-up, and a sign-up of the same address deletes it (and its links) and
 * starts a fresh account. Otherwise a sign-up by the inbox's owner could
 * confirm them into the account that linked their address.
 */

const CONFIRM_TTL = 24 * 3600;
const RESET_TTL = 3600;
/** Emails of one kind to one account: at most one a minute and this many a day. */
const SENDS_PER_DAY = 5;
/** Failed sign-ins before the backoff starts, per account and per IP. */
const FREE_ACCOUNT_FAILURES = 5;
const FREE_IP_FAILURES = 20;
const MAX_LOCK = 3600;
/** Failures older than this are forgotten. */
const FAILURE_MEMORY = 86_400;

const GENERIC_SIGNUP = 'If that address can be used, we sent it a link. Check your inbox to finish signing up.';
const GENERIC_RESET = 'If that address is registered, we sent it a link to reset the password.';
const WRONG = 'Wrong email or password';

/** Whether email sign-in can work here: a usable SESSION_SECRET and the EMAIL binding for the links. */
export const emailSignInAvailable = (env: Env): boolean => secretOk(env) && emailConfigured(env);

function available(env: Env): asserts env is Env & { SESSION_SECRET: string } {
  if (!emailSignInAvailable(env)) throw new HttpError(404, 'Email sign-in is not configured');
}

/** Where the links point: the site, or this server in local development (no ENVIRONMENT). */
const linkOrigin = (request: Request, env: Env) => (env.ENVIRONMENT ? siteOrigin(env) : new URL(request.url).origin);

const isReturnPath = (path: string) => path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && !/[\u0000-\u001f]/.test(path);

/** GET /auth/email/start: the sign-in page, which has the forms (the providers' start links all look alike for the page). */
export function startEmailLogin(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = url.searchParams.get('return') ?? '/';
  const params = new URLSearchParams({ return: isReturnPath(returnTo) ? returnTo : '/' });
  if (url.searchParams.get('link') === '1') params.set('link', '1');
  return new Response(null, { status: 302, headers: { Location: `/signin/?${params}`, 'Cache-Control': 'no-store' } });
}

interface Login {
  user_id: string;
  email: string;
  normalized: string;
  password_hash: string;
  confirmed_at: number | null;
  blocked_at: number | null;
}

/** The email sign-in of a normalized address, only while its identity is linked (unlinking keeps the row until the next sign-up). */
function findLogin(DB: D1Database, normalized: string): Promise<Login | null> {
  return DB.prepare(
    `SELECT l.user_id, l.email, l.normalized, l.password_hash, l.confirmed_at, u.blocked_at FROM email_logins l
     JOIN identities i ON i.provider = 'email' AND i.subject = l.normalized AND i.user_id = l.user_id
     JOIN users u ON u.id = l.user_id WHERE l.normalized = ?`,
  )
    .bind(normalized)
    .first<Login>();
}

const loginOf = (DB: D1Database, userId: string) =>
  DB.prepare(
    `SELECT l.user_id, l.email, l.normalized, l.password_hash, l.confirmed_at, u.blocked_at FROM email_logins l
     JOIN identities i ON i.provider = 'email' AND i.subject = l.normalized AND i.user_id = l.user_id
     JOIN users u ON u.id = l.user_id WHERE l.user_id = ?`,
  )
    .bind(userId)
    .first<Login>();

/**
 * The email sign-in a signed-in account linked and has not confirmed yet: it
 * has no identity until its own link is opened by that account, so no
 * sign-in, reset or lookup finds it, and a sign-up of the address replaces it.
 */
const pendingLinkOf = (DB: D1Database, userId: string) =>
  DB.prepare(
    `SELECT l.user_id, l.email, l.normalized, l.password_hash, l.confirmed_at, u.blocked_at FROM email_logins l
     JOIN users u ON u.id = l.user_id
     WHERE l.user_id = ? AND l.confirmed_at IS NULL AND NOT EXISTS (SELECT 1 FROM identities i WHERE i.provider = 'email' AND i.subject = l.normalized)`,
  )
    .bind(userId)
    .first<Login>();

/** Deletes the email sign-ins without an identity (unlinked, or a pending link) of `where`, with their unused confirmation links. */
function dropUnlinked(DB: D1Database, where: 'normalized' | 'user_id', value: string): D1PreparedStatement[] {
  const rows = `SELECT user_id FROM email_logins WHERE ${where} = ?1 AND NOT EXISTS (SELECT 1 FROM identities WHERE provider = 'email' AND subject = email_logins.normalized)`;
  return [
    DB.prepare(`DELETE FROM email_tokens WHERE purpose = 'confirm' AND used_at IS NULL AND user_id IN (${rows})`).bind(value),
    DB.prepare(`DELETE FROM email_logins WHERE ${where} = ?1 AND NOT EXISTS (SELECT 1 FROM identities WHERE provider = 'email' AND subject = email_logins.normalized)`).bind(value),
  ];
}

/**
 * A new link for the account, or undefined when it got one of the kind in the
 * last minute or SENDS_PER_DAY today (then nothing is sent, and the answer is
 * the same: the limit says nothing about the address either).
 */
async function newToken(env: Env, userId: string, purpose: 'confirm' | 'reset', passwordHash: string | null = null): Promise<string | undefined> {
  const t = now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS day, SUM(created_at > ?3) AS minute FROM email_tokens WHERE user_id = ?1 AND purpose = ?2 AND created_at > ?4')
    .bind(userId, purpose, t - 60, t - 86_400)
    .first<{ day: number; minute: number | null }>();
  if ((recent?.minute ?? 0) > 0 || (recent?.day ?? 0) >= SENDS_PER_DAY) {
    log('info', 'Email sign-in link not sent: limit reached', { userId, purpose });
    return undefined;
  }
  const token = randomToken();
  await env.DB.prepare('INSERT INTO email_tokens (token_hash, user_id, purpose, password_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, purpose, passwordHash, t, t + (purpose === 'confirm' ? CONFIRM_TTL : RESET_TTL))
    .run();
  return token;
}

/** Sends, and only logs a failure: the answer must not differ by whether an email went out. */
async function send(ctx: Ctx, to: string, email: RenderedEmail): Promise<void> {
  try {
    await sendEmail(ctx.env, { to, ...email });
  } catch (e) {
    log('error', 'Sending a sign-in email failed', { requestId: ctx.requestId, error: errorText(e) });
  }
}

const link = (request: Request, env: Env, kind: 'confirm' | 'reset', token: string) => `${linkOrigin(request, env)}/signin/#${kind}=${encodeURIComponent(token)}`;

async function sendConfirmation(request: Request, ctx: Ctx, userId: string, email: string, passwordHash: string | null = null): Promise<boolean> {
  const token = await newToken(ctx.env, userId, 'confirm', passwordHash);
  if (token) await send(ctx, email, signupConfirmEmail(link(request, ctx.env, 'confirm', token)));
  return token !== undefined;
}

async function sendAlreadyRegistered(request: Request, ctx: Ctx, login: Login): Promise<void> {
  const token = await newToken(ctx.env, login.user_id, 'reset');
  if (token) await send(ctx, login.email, alreadyRegisteredEmail(`${linkOrigin(request, ctx.env)}/signin/`, link(request, ctx.env, 'reset', token)));
}

/** POST /auth/email/signup {email, password, turnstile, link?}: always 202 with the same message. */
export async function signup(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const body = await readJson(request, 4096);
  await verifyTurnstile(ctx, body.turnstile, 'signup');
  const address = normalizeEmail(body.email);
  if (!address) throw new HttpError(400, 'Enter a valid email address');
  const problem = passwordProblem(body.password, address.email);
  if (problem) throw new HttpError(400, problem);
  // Hashed whatever happens next, so a taken address answers as slowly as a new one.
  const passwordHash = await hashPassword(body.password as string);
  const linkTo = body.link === true ? await requireUser(request, ctx) : undefined;
  const t = now();

  const existing = await findLogin(env.DB, address.normalized);
  if (existing) {
    if (existing.confirmed_at === null && !linkTo) {
      // Still unconfirmed: whoever confirms from the inbox sets this password (email_tokens.password_hash).
      await sendConfirmation(request, ctx, existing.user_id, existing.email, passwordHash);
    } else await sendAlreadyRegistered(request, ctx, existing);
    return json({ message: GENERIC_SIGNUP }, 202);
  }
  // An address unlinked earlier, or linked by some account and not confirmed, has a row without an identity (findLogin ignores it):
  // it goes now with its links, so this sign-up starts fresh and no one else's pending link can be confirmed with this inbox.
  await env.DB.batch(dropUnlinked(env.DB, 'normalized', address.normalized));

  let userId: string;
  try {
    if (linkTo) {
      userId = linkTo.id;
      // A link gets no identity until the account confirms it from the inbox (confirm): until then it signs nothing in.
      await env.DB.batch([
        ...dropUnlinked(env.DB, 'user_id', userId),
        env.DB.prepare('INSERT INTO email_logins (user_id, email, normalized, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, address.email, address.normalized, passwordHash, t),
      ]);
    } else {
      userId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, display_name, public_profile, created_at) VALUES (?, ?, 0, ?)').bind(userId, 'Proschi user', t),
        env.DB.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('email', ?, ?)").bind(address.normalized, userId),
        env.DB.prepare('INSERT INTO email_logins (user_id, email, normalized, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, address.email, address.normalized, passwordHash, t),
        await recordPending(env, userId, ctx.ip),
      ]);
    }
  } catch (e) {
    // A parallel sign-up took the address, or (linking) the account has an email sign-in already.
    if (linkTo && (await loginOf(env.DB, linkTo.id))) throw new HttpError(409, 'This account already has an email sign-in; remove it first');
    log('info', 'Email sign-up lost a race for its address', { requestId: ctx.requestId, error: errorText(e) });
    return json({ message: GENERIC_SIGNUP }, 202);
  }
  await sendConfirmation(request, ctx, userId, address.email);
  return json({ message: GENERIC_SIGNUP }, 202);
}

/** Uses a link's token once; its user and the password it carries, or undefined when it is unknown, used or expired. */
async function consume(env: Env, token: unknown, purpose: 'confirm' | 'reset'): Promise<{ user_id: string; password_hash: string | null } | undefined> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const t = now();
  const row = await env.DB.prepare('UPDATE email_tokens SET used_at = ?1 WHERE token_hash = ?2 AND purpose = ?3 AND used_at IS NULL AND expires_at > ?1 RETURNING user_id, password_hash')
    .bind(t, await sha256(token), purpose)
    .first<{ user_id: string; password_hash: string | null }>();
  return row ?? undefined;
}

/** The sign-up credits' checks for an email account that has just proved its address. */
async function decideFor(env: Env & { SESSION_SECRET: string }, login: Login) {
  const claim = await emailClaim(env, login.normalized);
  return decideSignupCredits(env, { userId: login.user_id, identityKey: login.normalized, claims: [claim], domain: login.normalized.split('@')[1] });
}

const signupCreditsBody = async (DB: D1Database, userId: string) => {
  const status = await signupStatus(DB, userId);
  return status && { outcome: status.outcome, reason: status.reason };
};

/** The account of an unused, unexpired confirmation link, without using it. */
async function peek(env: Env, token: unknown): Promise<string | undefined> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
  const row = await env.DB.prepare("SELECT user_id FROM email_tokens WHERE token_hash = ? AND purpose = 'confirm' AND used_at IS NULL AND expires_at > ?")
    .bind(await sha256(token), now())
    .first<{ user_id: string }>();
  return row?.user_id;
}

const EXPIRED_CONFIRM = 'This link has expired or was already used. Sign in to get a new one.';

/**
 * Confirms an email sign-in linked to a signed-in account: only that
 * account, signed in, can (else 400, the link kept), so an inbox's owner who
 * opens a link someone else asked for is never signed in to their account.
 * The address gets its identity now; a link never sets a password.
 */
async function confirmLink(request: Request, ctx: Ctx, env: Env & { SESSION_SECRET: string }, token: unknown, userId: string): Promise<Response> {
  const pending = await pendingLinkOf(env.DB, userId);
  if (!pending) throw new HttpError(400, EXPIRED_CONFIRM);
  const viewer = await authenticate(request, ctx);
  if (viewer?.id !== userId) throw new HttpError(400, 'Sign in to the account you are adding this address to, then open the link again.');
  if (pending.blocked_at !== null) throw new HttpError(403, 'This account is blocked');
  if (!(await consume(env, token, 'confirm'))) throw new HttpError(400, EXPIRED_CONFIRM);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('email', ?, ?)").bind(pending.normalized, userId),
      env.DB.prepare('UPDATE email_logins SET confirmed_at = ? WHERE user_id = ? AND confirmed_at IS NULL').bind(now(), userId),
    ]);
  } catch (e) {
    log('info', 'Email link lost its address before it was confirmed', { requestId: ctx.requestId, error: errorText(e) });
    throw new HttpError(400, EXPIRED_CONFIRM);
  }
  await decideFor(env, { ...pending, confirmed_at: now() });
  await startWebSession(ctx, userId);
  return json({ confirmed: true, signupCredits: await signupCreditsBody(env.DB, userId) });
}

/** POST /auth/email/confirm {token}: confirms the address and signs in. 400 for a used, expired or unknown link. */
export async function confirm(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const body = await readJson(request, 4096);
  const owner = await peek(env, body.token);
  if (owner && !(await loginOf(env.DB, owner))) return confirmLink(request, ctx, env, body.token, owner);
  const used = await consume(env, body.token, 'confirm');
  const login = used && (await loginOf(env.DB, used.user_id));
  if (!used || !login) throw new HttpError(400, EXPIRED_CONFIRM);
  if (login.blocked_at !== null) throw new HttpError(403, 'This account is blocked');
  const statements = [env.DB.prepare('UPDATE email_logins SET confirmed_at = COALESCE(confirmed_at, ?) WHERE user_id = ?').bind(now(), login.user_id)];
  if (used.password_hash) {
    // A sign-up's password: the inbox's owner chose it, so sessions made with an earlier one end.
    statements.push(env.DB.prepare('UPDATE email_logins SET password_hash = ? WHERE user_id = ?').bind(used.password_hash, login.user_id));
    statements.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(login.user_id));
    statements.push(env.DB.prepare('DELETE FROM app_auth_codes WHERE user_id = ?').bind(login.user_id));
  }
  await env.DB.batch(statements);
  await decideFor(env, login);
  await startWebSession(ctx, login.user_id);
  return json({ confirmed: true, signupCredits: await signupCreditsBody(env.DB, login.user_id) });
}

const lockSeconds = (failures: number, free: number) => (failures < free ? 0 : Math.min(60 * 2 ** (failures - free), MAX_LOCK));

/** The failure keys of a sign-in: the account (an HMAC of the address, whether or not it exists) and the IP. */
async function failureKeys(env: Env & { SESSION_SECRET: string }, normalized: string, ip: string): Promise<[string, string]> {
  const key = `${env.SESSION_SECRET}/login-failures`;
  return [`account:${await hmacSha256(normalized, key)}`, `ip:${await hmacSha256(ip, key)}`];
}

async function lockedFor(DB: D1Database, keys: string[], t: number): Promise<number> {
  const placeholders = keys.map(() => '?').join(', ');
  const row = await DB.prepare(`SELECT MAX(locked_until) AS until FROM login_failures WHERE key IN (${placeholders}) AND updated_at > ?`)
    .bind(...keys, t - FAILURE_MEMORY)
    .first<{ until: number | null }>();
  return Math.max(0, (row?.until ?? 0) - t);
}

async function noteFailure(DB: D1Database, key: string, free: number, t: number): Promise<void> {
  const row = await DB.prepare('SELECT failures, updated_at FROM login_failures WHERE key = ?').bind(key).first<{ failures: number; updated_at: number }>();
  const failures = row && row.updated_at > t - FAILURE_MEMORY ? row.failures + 1 : 1;
  const lock = lockSeconds(failures, free);
  await DB.prepare('INSERT INTO login_failures (key, failures, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (key) DO UPDATE SET failures = ?2, locked_until = ?3, updated_at = ?4')
    .bind(key, failures, lock ? t + lock : 0, t)
    .run();
}

function tooMany(seconds: number): HttpError {
  const minutes = Math.ceil(seconds / 60);
  return new HttpError(429, `Too many failed sign-ins. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}, or reset your password.`, { 'Retry-After': String(seconds) });
}

/** POST /auth/email/login {email, password, turnstile} */
export async function login(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const body = await readJson(request, 4096);
  await verifyTurnstile(ctx, body.turnstile, 'login');
  const address = normalizeEmail(body.email);
  if (!address || typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new HttpError(401, WRONG);
  const t = now();
  const keys = await failureKeys(env, address.normalized, ctx.ip);
  const wait = await lockedFor(env.DB, keys, t);
  if (wait > 0) throw tooMany(wait);
  const found = await findLogin(env.DB, address.normalized);
  if (!(await verifyPassword(body.password, found?.password_hash))) {
    await noteFailure(env.DB, keys[0], FREE_ACCOUNT_FAILURES, t);
    await noteFailure(env.DB, keys[1], FREE_IP_FAILURES, t);
    throw new HttpError(401, WRONG);
  }
  const account = found!;
  await env.DB.prepare('DELETE FROM login_failures WHERE key = ?').bind(keys[0]).run();
  if (account.blocked_at !== null) throw new HttpError(403, 'This account is blocked. If you think that is a mistake, open an issue at github.com/gvart/proschi.');
  await startWebSession(ctx, account.user_id);
  return json({ confirmed: account.confirmed_at !== null });
}

/** POST /auth/email/resend: the confirmation email again, for the signed-in account. 202 whether or not the limit let it go. */
export async function resend(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  const user = await requireUser(request, ctx);
  await rateLimit(env.EMAIL_LIMITER, user.id, 'Too many confirmation emails; wait a minute');
  const login = (await loginOf(env.DB, user.id)) ?? (await pendingLinkOf(env.DB, user.id));
  if (!login) throw new HttpError(404, 'This account has no email sign-in');
  if (login.confirmed_at !== null) return json({ confirmed: true });
  const sent = await sendConfirmation(request, ctx, user.id, login.email);
  return json({ sent, message: sent ? `We sent a new link to ${login.email}.` : 'We sent a link recently; check your inbox (and spam folder), or try again later.' }, 202);
}

/** POST /auth/email/reset-request {email, turnstile}: always 202 with the same message. */
export async function resetRequest(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const body = await readJson(request, 4096);
  await verifyTurnstile(ctx, body.turnstile, 'reset');
  const address = normalizeEmail(body.email);
  if (!address) throw new HttpError(400, 'Enter a valid email address');
  const found = await findLogin(env.DB, address.normalized);
  if (found) {
    const token = await newToken(env, found.user_id, 'reset');
    if (token) await send(ctx, found.email, passwordResetEmail(link(request, env, 'reset', token)));
  } else await sha256(randomToken()); // About the same work either way.
  return json({ message: GENERIC_RESET }, 202);
}

/** POST /auth/email/reset {token, password}: sets the password, confirms the address, ends every other session and signs in. */
export async function reset(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  available(env);
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const body = await readJson(request, 4096);
  // Checked before the link is used up, so a refused password can be fixed and sent again.
  const problem = passwordProblem(body.password);
  if (problem) throw new HttpError(400, problem);
  const used = await consume(env, body.token, 'reset');
  const login = used && (await loginOf(env.DB, used.user_id));
  if (!used || !login) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.');
  const emailProblem = passwordProblem(body.password, login.email);
  if (emailProblem) throw new HttpError(400, emailProblem);
  if (login.blocked_at !== null) throw new HttpError(403, 'This account is blocked');
  const t = now();
  const [accountKey] = await failureKeys(env, login.normalized, ctx.ip);
  await env.DB.batch([
    env.DB.prepare('UPDATE email_logins SET password_hash = ?, confirmed_at = COALESCE(confirmed_at, ?) WHERE user_id = ?').bind(await hashPassword(body.password as string), t, login.user_id),
    env.DB.prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(t, login.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(login.user_id),
    env.DB.prepare('DELETE FROM app_auth_codes WHERE user_id = ?').bind(login.user_id),
    env.DB.prepare('DELETE FROM login_failures WHERE key = ?').bind(accountKey),
  ]);
  // The reset proved the inbox, like the confirmation link.
  await decideFor(env, login);
  await startWebSession(ctx, login.user_id);
  return json({ reset: true, signupCredits: await signupCreditsBody(env.DB, login.user_id) });
}

/**
 * GET /auth/email/status: the signed-in account's address, whether it is
 * confirmed, and its sign-up credits' decision; `{signedIn: false}` signed
 * out (200, so the sign-in page's first look isn't an error).
 */
export async function emailStatus(request: Request, ctx: Ctx): Promise<Response> {
  const user = await authenticate(request, ctx);
  if (!user) return json({ signedIn: false }, 200, { 'Cache-Control': 'no-store' });
  const login = (await loginOf(ctx.env.DB, user.id)) ?? (await pendingLinkOf(ctx.env.DB, user.id));
  return json(
    { signedIn: true, email: login?.email ?? null, confirmed: login ? login.confirmed_at !== null : true, signupCredits: await signupCreditsBody(ctx.env.DB, user.id) },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

/** Deletes old links and forgotten failures; returns how many (the daily cron). */
export async function pruneEmailAuth(env: Env): Promise<number> {
  const t = now();
  const [tokens, failures] = await env.DB.batch([
    env.DB.prepare('DELETE FROM email_tokens WHERE expires_at <= ? AND created_at <= ?').bind(t, t - 2 * 86_400),
    env.DB.prepare('DELETE FROM login_failures WHERE updated_at <= ?').bind(t - FAILURE_MEMORY),
  ]);
  return tokens.meta.changes + failures.meta.changes;
}

/** "Download my data": the email sign-in (never the password hash) and the sign-up credits' decision. */
export async function exportEmailSignIn(DB: D1Database, userId: string) {
  const [login, check] = await DB.batch([
    DB.prepare('SELECT email, normalized, confirmed_at, created_at FROM email_logins WHERE user_id = ?').bind(userId),
    DB.prepare('SELECT outcome, reason, decided_at FROM signup_checks WHERE user_id = ?').bind(userId),
  ]);
  const l = login.results[0] as { email: string; normalized: string; confirmed_at: number | null; created_at: number } | undefined;
  const c = check.results[0] as { outcome: string; reason: string; decided_at: number | null } | undefined;
  return {
    login: l ? { email: l.email, normalized: l.normalized, confirmedAt: l.confirmed_at, createdAt: l.created_at } : null,
    signupCredits: c ? { outcome: c.outcome, reason: c.reason, decidedAt: c.decided_at } : null,
  };
}
