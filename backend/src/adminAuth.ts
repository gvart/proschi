import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Ctx } from './context';
import { fromBase64url, randomToken, sha256, timingSafeEqual } from './crypto';
import { now, type Env } from './env';
import { recordEvent } from './events';
import { errorResponse, HttpError, json, rateLimit, readCookie, readJson } from './http';
import { errorText, log } from './log';

/**
 * Sign-in to the admin panel (/admin/) with passkeys (WebAuthn), and no
 * username or password. The first passkey is registered with the one-time
 * setup token (the ADMIN_SETUP_TOKEN secret), and only while there is no
 * passkey yet; more are added from inside the panel. A passkey sign-in
 * starts an admin session: its own cookie, separate from users' sessions,
 * SameSite=Strict, 30 minutes idle and 12 hours at most.
 *
 *   GET    /api/admin/status                      {passkeys: bool, setupAvailable: bool, signedIn: bool}
 *   POST   /api/admin/setup/options {setupToken}  registration options for the first passkey
 *   POST   /api/admin/setup {setupToken, name, response}   registers it and signs in
 *   POST   /api/admin/login/options               authentication options
 *   POST   /api/admin/login {response}            signs in
 *   POST   /api/admin/logout
 *   GET    /api/admin/passkeys                    the passkeys (signed in)
 *   POST   /api/admin/passkeys/options            registration options for another passkey (signed in)
 *   POST   /api/admin/passkeys {name, response}   adds it (signed in)
 *   DELETE /api/admin/passkeys/<id>               removes one, never the last (signed in)
 *   POST   /api/admin/sessions/revoke-all         ends every admin session, this one too (signed in)
 */

/** `__Host-`: only this exact host, Secure, Path=/. */
export const ADMIN_COOKIE = '__Host-proschi_admin';
export const ADMIN_IDLE = 30 * 60;
export const ADMIN_MAX_AGE = 12 * 3600;
const CHALLENGE_TTL = 5 * 60;
const MAX_PASSKEYS = 10;
const MAX_PASSKEY_NAME = 60;
/** Shorter setup tokens are refused: the secret is all that guards the first registration. */
export const MIN_SETUP_TOKEN = 16;
const RP_NAME = 'Proschi admin';

export interface Admin {
  passkeyId: string;
}

interface PasskeyRow {
  id: string;
  public_key: ArrayBuffer | Uint8Array | number[];
  counter: number;
  transports: string | null;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

function adminCookie(value: string, maxAge: number): string {
  return `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

/** The relying party: this host, so a passkey made on proschi.app works only there (and one made on localhost only there). */
function relyingParty(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

/** Admin requests that change something must carry this site's Origin (browsers send it on every fetch POST and DELETE). */
function assertAdminOrigin(request: Request): void {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Cross-site request refused');
}

function setupTokenOk(env: Env, given: unknown): boolean {
  const expected = env.ADMIN_SETUP_TOKEN ?? '';
  return expected.length >= MIN_SETUP_TOKEN && typeof given === 'string' && timingSafeEqual(given, expected);
}

async function passkeyCount(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_passkeys').first<{ n: number }>())?.n ?? 0;
}

async function storeChallenge(env: Env, challenge: string, kind: 'register' | 'login'): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_challenges WHERE expires_at <= ?').bind(t),
    env.DB.prepare('INSERT INTO admin_challenges (challenge, kind, expires_at) VALUES (?, ?, ?)').bind(challenge, kind, t + CHALLENGE_TTL),
  ]);
}

/** Uses up a challenge: true only the first time, for its kind, before it expires. */
async function consumeChallenge(env: Env, challenge: string, kind: 'register' | 'login'): Promise<boolean> {
  const row = await env.DB.prepare('DELETE FROM admin_challenges WHERE challenge = ? AND kind = ? AND expires_at > ? RETURNING challenge')
    .bind(challenge, kind, now())
    .first();
  return row !== null;
}

/** The challenge in a WebAuthn response's clientDataJSON, to use it up even when verification fails. */
function challengeOf(response: { response?: { clientDataJSON?: unknown } }): string | undefined {
  const data = typeof response.response?.clientDataJSON === 'string' ? fromBase64url(response.response.clientDataJSON) : undefined;
  if (!data) return undefined;
  try {
    const challenge = (JSON.parse(new TextDecoder().decode(data)) as { challenge?: unknown }).challenge;
    return typeof challenge === 'string' ? challenge : undefined;
  } catch {
    return undefined;
  }
}

function asResponse<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string' || typeof (value as { response?: unknown }).response !== 'object') {
    throw new HttpError(400, 'response must be a WebAuthn credential (JSON)');
  }
  return value as T;
}

function passkeyName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PASSKEY_NAME) : '';
  return name || 'Passkey';
}

const toBytes = (key: PasskeyRow['public_key']): Uint8Array<ArrayBuffer> => (key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key as ArrayBuffer));

const transportsOf = (row: Pick<PasskeyRow, 'transports'>): string[] | undefined => (row.transports ? (JSON.parse(row.transports) as string[]) : undefined);

/** Starts an admin session for a passkey and queues its cookie. */
async function startSession(ctx: Ctx, passkeyId: string): Promise<void> {
  const token = randomToken();
  const t = now();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(t),
    ctx.env.DB.prepare('INSERT INTO admin_sessions (token_hash, passkey_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), passkeyId, t, t + ADMIN_IDLE),
    ctx.env.DB.prepare('UPDATE admin_passkeys SET last_used_at = ? WHERE id = ?').bind(t, passkeyId),
  ]);
  ctx.setCookies.push(adminCookie(token, ADMIN_MAX_AGE));
}

/** The signed-in admin, or undefined. The session slides: each use extends it by ADMIN_IDLE, up to ADMIN_MAX_AGE after sign-in. */
export async function authenticateAdmin(request: Request, ctx: Ctx): Promise<Admin | undefined> {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token) return undefined;
  const hash = await sha256(token);
  const t = now();
  const row = await ctx.env.DB.prepare('SELECT passkey_id, created_at, expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, t)
    .first<{ passkey_id: string; created_at: number; expires_at: number }>();
  if (!row) return undefined;
  const expires = Math.min(row.created_at + ADMIN_MAX_AGE, t + ADMIN_IDLE);
  if (expires - row.expires_at >= 60) {
    await ctx.env.DB.prepare('UPDATE admin_sessions SET expires_at = ? WHERE token_hash = ?').bind(expires, hash).run();
  }
  return { passkeyId: row.passkey_id };
}

/** The signed-in admin; 401 without a session, 403 for a cross-site change. */
export async function requireAdmin(request: Request, ctx: Ctx): Promise<Admin> {
  assertAdminOrigin(request);
  const admin = await authenticateAdmin(request, ctx);
  if (!admin) throw new HttpError(401, 'Admin sign-in required');
  return admin;
}

/** One line in the audit log (`admin_audit`); written with the action, so a change and its record go together where the caller batches them. */
export function auditStatement(env: Env, admin: Admin | undefined, action: string, target?: string, detail?: Record<string, unknown>): D1PreparedStatement {
  return env.DB.prepare('INSERT INTO admin_audit (at, passkey_id, action, target, detail) VALUES (?, ?, ?, ?, ?)').bind(
    now(),
    admin?.passkeyId ?? null,
    action,
    target ?? null,
    detail ? JSON.stringify(detail) : null,
  );
}

/** GET /api/admin/status: what the page should show (set up, sign in, or the panel). */
export async function adminStatus(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.ADMIN_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const passkeys = await passkeyCount(ctx.env);
  const signedIn = passkeys > 0 && (await authenticateAdmin(request, ctx)) !== undefined;
  const setupAvailable = passkeys === 0 && (ctx.env.ADMIN_SETUP_TOKEN?.length ?? 0) >= MIN_SETUP_TOKEN;
  return json({ passkeys: passkeys > 0, setupAvailable, signedIn }, 200, { 'Cache-Control': 'no-store' });
}

/** The first passkey's gate: no passkey yet and the right setup token, else 403 (both cases look the same). */
async function assertSetupAllowed(ctx: Ctx, token: unknown): Promise<void> {
  if (!setupTokenOk(ctx.env, token) || (await passkeyCount(ctx.env)) > 0) {
    await recordEvent(ctx.env, 'warn', 'admin_sign_in_failed', 'Admin setup refused', { requestId: ctx.requestId });
    throw new HttpError(403, 'Setup is not available: the setup token is wrong, or the admin is already set up');
  }
}

async function registrationOptions(request: Request, env: Env): Promise<Response> {
  const { rpID } = relyingParty(request);
  const existing = (await env.DB.prepare('SELECT id, transports FROM admin_passkeys').all<Pick<PasskeyRow, 'id' | 'transports'>>()).results;
  if (existing.length >= MAX_PASSKEYS) throw new HttpError(409, `At most ${MAX_PASSKEYS} passkeys`);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: 'admin',
    userDisplayName: 'Proschi admin',
    // One admin: every passkey is for the same WebAuthn user.
    userID: new Uint8Array(new TextEncoder().encode('proschi-admin')),
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  await storeChallenge(env, options.challenge, 'register');
  return json(options, 200, { 'Cache-Control': 'no-store' });
}

/** Verifies a registration and stores the passkey; answers its id. */
async function registerPasskey(request: Request, env: Env, body: Record<string, unknown>): Promise<string> {
  const response = asResponse<RegistrationResponseJSON>(body.response);
  const { rpID, origin } = relyingParty(request);
  const challenge = challengeOf(response);
  if (!challenge || !(await consumeChallenge(env, challenge, 'register'))) throw new HttpError(400, 'The passkey request expired; try again');
  let info;
  try {
    const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    if (!result.verified) throw new Error('not verified');
    info = result.registrationInfo;
  } catch (e) {
    log('warn', 'Admin passkey registration failed', { error: errorText(e) });
    throw new HttpError(400, 'The passkey could not be verified');
  }
  const { credential } = info;
  const { meta } = await env.DB.prepare(
    'INSERT INTO admin_passkeys (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
  )
    .bind(credential.id, credential.publicKey, credential.counter, credential.transports?.length ? JSON.stringify(credential.transports) : null, passkeyName(body.name), now())
    .run();
  if (meta.changes === 0) throw new HttpError(409, 'That passkey is already registered');
  return credential.id;
}

/** POST /api/admin/setup/options {setupToken} */
export async function setupOptions(request: Request, ctx: Ctx): Promise<Response> {
  assertAdminOrigin(request);
  await rateLimit(ctx.env.ADMIN_LIMITER, ctx.ip, 'Too many attempts; wait a minute');
  const body = await readJson(request);
  await assertSetupAllowed(ctx, body.setupToken);
  return registrationOptions(request, ctx.env);
}

/** POST /api/admin/setup {setupToken, name, response}: the first passkey, then signed in. */
export async function setup(request: Request, ctx: Ctx): Promise<Response> {
  assertAdminOrigin(request);
  await rateLimit(ctx.env.ADMIN_LIMITER, ctx.ip, 'Too many attempts; wait a minute');
  const body = await readJson(request);
  await assertSetupAllowed(ctx, body.setupToken);
  const id = await registerPasskey(request, ctx.env, body);
  // Checked again: of two setups racing, only the first passkey stored stays.
  const { meta } = await ctx.env.DB.prepare('DELETE FROM admin_passkeys WHERE id = ? AND rowid > (SELECT MIN(rowid) FROM admin_passkeys)').bind(id).run();
  if (meta.changes > 0) throw new HttpError(403, 'The admin is already set up');
  await ctx.env.DB.batch([auditStatement(ctx.env, { passkeyId: id }, 'admin.setup', id)]);
  await recordEvent(ctx.env, 'info', 'admin_setup', 'First admin passkey registered', { requestId: ctx.requestId });
  await startSession(ctx, id);
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
}

/** POST /api/admin/login/options */
export async function loginOptions(request: Request, ctx: Ctx): Promise<Response> {
  assertAdminOrigin(request);
  await rateLimit(ctx.env.ADMIN_LIMITER, ctx.ip, 'Too many attempts; wait a minute');
  if (!(await passkeyCount(ctx.env))) return errorResponse(409, 'No admin passkey yet: set one up first');
  // No allowCredentials: the passkeys are discoverable (residentKey: 'required'), so the browser offers them itself
  // and nobody who asks for options learns their ids.
  const options = await generateAuthenticationOptions({ rpID: relyingParty(request).rpID, userVerification: 'required' });
  await storeChallenge(ctx.env, options.challenge, 'login');
  return json(options, 200, { 'Cache-Control': 'no-store' });
}

/** POST /api/admin/login {response} */
export async function login(request: Request, ctx: Ctx): Promise<Response> {
  assertAdminOrigin(request);
  const { env } = ctx;
  await rateLimit(env.ADMIN_LIMITER, ctx.ip, 'Too many attempts; wait a minute');
  const body = await readJson(request);
  const response = asResponse<AuthenticationResponseJSON>(body.response);
  const fail = async (reason: string): Promise<never> => {
    await recordEvent(env, 'warn', 'admin_sign_in_failed', `Admin sign-in failed: ${reason}`, { requestId: ctx.requestId });
    throw new HttpError(401, 'The passkey was not accepted');
  };
  const challenge = challengeOf(response);
  if (!challenge || !(await consumeChallenge(env, challenge, 'login'))) return fail('unknown or expired challenge');
  const row = await env.DB.prepare('SELECT * FROM admin_passkeys WHERE id = ?').bind(response.id).first<PasskeyRow>();
  if (!row) return fail('unknown passkey');
  const { rpID, origin } = relyingParty(request);
  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: row.id, publicKey: toBytes(row.public_key), counter: row.counter, transports: transportsOf(row) },
      requireUserVerification: true,
    });
    if (!result.verified) return fail('signature not verified');
    newCounter = result.authenticationInfo.newCounter;
  } catch (e) {
    log('warn', 'Admin passkey sign-in failed', { error: errorText(e) });
    return fail('verification error');
  }
  await env.DB.prepare('UPDATE admin_passkeys SET counter = ? WHERE id = ?').bind(newCounter, row.id).run();
  await startSession(ctx, row.id);
  await recordEvent(env, 'info', 'admin_sign_in', 'Admin signed in', { passkey: row.name, requestId: ctx.requestId });
  return json({ ok: true }, 200, { 'Cache-Control': 'no-store' });
}

/** POST /api/admin/logout */
export async function adminLogout(request: Request, ctx: Ctx): Promise<Response> {
  assertAdminOrigin(request);
  const token = readCookie(request, ADMIN_COOKIE);
  if (token) await ctx.env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  ctx.setCookies.push(adminCookie('', 0));
  return new Response(null, { status: 204 });
}

/** GET /api/admin/passkeys */
export async function listPasskeys(request: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const [passkeys, sessions] = await ctx.env.DB.batch([
    ctx.env.DB.prepare('SELECT id, name, transports, created_at, last_used_at FROM admin_passkeys ORDER BY created_at, rowid'),
    ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at > ?').bind(now()),
  ]);
  return json(
    {
      passkeys: (passkeys.results as unknown as PasskeyRow[]).map((p) => ({
        id: p.id,
        name: p.name,
        transports: transportsOf(p) ?? [],
        createdAt: p.created_at,
        lastUsedAt: p.last_used_at,
        current: p.id === admin.passkeyId,
      })),
      sessions: (sessions.results[0] as { n: number }).n,
    },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

/** POST /api/admin/passkeys/options */
export async function addPasskeyOptions(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  return registrationOptions(request, ctx.env);
}

/** POST /api/admin/passkeys {name, response} */
export async function addPasskey(request: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const body = await readJson(request);
  const id = await registerPasskey(request, ctx.env, body);
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'passkey.add', id, { name: passkeyName(body.name) })]);
  return json({ id }, 201, { 'Cache-Control': 'no-store' });
}

/** DELETE /api/admin/passkeys/<id>: never the last one, so the admin cannot lock themselves out. */
export async function deletePasskey(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const [deleted] = await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM admin_passkeys WHERE id = ?1 AND (SELECT COUNT(*) FROM admin_passkeys) > 1').bind(id),
  ]);
  if (deleted.meta.changes === 0) {
    const exists = await ctx.env.DB.prepare('SELECT 1 FROM admin_passkeys WHERE id = ?').bind(id).first();
    throw exists ? new HttpError(409, "Can't remove the last passkey") : new HttpError(404, 'No such passkey');
  }
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'passkey.delete', id)]);
  // Its sessions went with it (ON DELETE CASCADE), this one too if it was signed in with it.
  if (id === admin.passkeyId) ctx.setCookies.push(adminCookie('', 0));
  return new Response(null, { status: 204 });
}

/** POST /api/admin/sessions/revoke-all */
export async function revokeAdminSessions(request: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await ctx.env.DB.batch([ctx.env.DB.prepare('DELETE FROM admin_sessions'), auditStatement(ctx.env, admin, 'admin.sessions.revoke_all')]);
  ctx.setCookies.push(adminCookie('', 0));
  return new Response(null, { status: 204 });
}

/** Deletes expired admin sessions and challenges (the daily cron). */
export async function purgeAdminSessions(env: Env): Promise<number> {
  const t = now();
  const [sessions] = await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').bind(t),
    env.DB.prepare('DELETE FROM admin_challenges WHERE expires_at <= ?').bind(t),
  ]);
  return sessions.meta.changes;
}

