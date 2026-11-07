import type { Ctx } from './context';
import { randomToken, sha256, timingSafeEqual } from './crypto';
import { now, type Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { requireUser } from './auth';
import { log } from './log';
import { parseScopes, scopesFor, type TokenScope } from './scopes';

/**
 * Sign-in for native apps (backend/README.md, "Mobile apps"). An app opens
 * /auth/<provider>/start?client=app in the system browser; the callback sends
 * it back to its `redirect_uri` with a one-time code, which it exchanges here,
 * with its PKCE verifier, for bearer tokens:
 *
 *   POST /auth/token  {grant_type: authorization_code, code, code_verifier}
 *                     {grant_type: refresh_token, refresh_token}
 *   POST /auth/revoke {token}
 *
 * Codes, access and refresh tokens are stored only as their SHA-256. Access
 * and refresh tokens are rows of `sessions` (kind app_access / app_refresh),
 * so signing out everywhere, deleting the account and the export cover them.
 * A refresh rotates both tokens; presenting a rotated refresh token again
 * means it was copied, and revokes the whole family (every token descended
 * from that sign-in).
 *
 * Every token carries scopes (src/scopes.ts, docs/design/paid-plans.md P42):
 * the CLI's only read the account's name and its diagrams, an app's also
 * practice progress and diagram sync; neither reaches billing, credits, the
 * AI features, the admin panel or account changes. A refresh keeps them.
 */

export const APP_CODE_TTL = 60;
export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 60 * 24 * 3600;

/** The public native client of the `proschi` CLI (RFC 8252): loopback redirect URIs on any port, no allow-list. */
export const CLI_CLIENT = 'proschi-cli';
export type AppClient = 'app' | typeof CLI_CLIENT;

/** What /start?client=app (or client=proschi-cli) asked for, kept in the signed state cookie until the callback. */
export interface AppLogin {
  /** The CLI's sign-in; absent for an app's (and in state cookies from before the CLI client). */
  client?: typeof CLI_CLIENT;
  redirectUri: string;
  /** base64url SHA-256 of the app's code_verifier. */
  challenge: string;
  /** The app's own state, echoed back to it. */
  state?: string;
}

/** Schemes an allow-listed redirect must never have, whatever the configuration says. */
const UNSAFE_SCHEMES = /^(javascript|data|vbscript|file|blob):/i;

/** The configured APP_REDIRECT_URIS: exact URIs with a scheme and no fragment. */
export function appRedirectUris(env: Env): string[] {
  return (env.APP_REDIRECT_URIS ?? '')
    .split(/[\s,]+/)
    .filter((uri) => /^[a-z][a-z0-9+.-]*:[^\s#]+$/i.test(uri) && !UNSAFE_SCHEMES.test(uri));
}

/** Whether `uri` is exactly one of APP_REDIRECT_URIS. Nothing else is ever redirected to. */
export function isAppRedirectUri(env: Env, uri: string): boolean {
  return appRedirectUris(env).includes(uri);
}

/**
 * The CLI's redirect URIs (RFC 8252 7.3): `http://127.0.0.1:<port>/callback`
 * or `http://[::1]:<port>/callback`, the port any from 1 to 65535 (no
 * leading zero), the host and path exact: no `localhost`, query, fragment,
 * userinfo or trailing slash. Matched on the string as sent, never a parsed
 * and normalised URL.
 */
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/callback$/;

export function isLoopbackRedirectUri(uri: string): boolean {
  const port = LOOPBACK.exec(uri)?.[1];
  return port !== undefined && Number(port) <= 65535;
}

/** Whether `client` may be sent back to `uri`: a loopback URI for the CLI, one of APP_REDIRECT_URIS exactly for an app. */
export function isRedirectUriFor(env: Env, client: AppClient, uri: string): boolean {
  return client === CLI_CLIENT ? isLoopbackRedirectUri(uri) : isAppRedirectUri(env, uri);
}

/** `uri` (allow-listed) with `params` added to its query. */
export function appRedirect(uri: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, value);
  return `${uri}${uri.includes('?') ? '&' : '?'}${query}`;
}

/** A PKCE S256 challenge: base64url of 32 bytes. */
export const isChallenge = (text: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(text);
/** A PKCE code_verifier (RFC 7636): 43 to 128 unreserved characters. */
const isVerifier = (text: string): boolean => /^[A-Za-z0-9._~-]{43,128}$/.test(text);
/** The app's state: up to 256 printable ASCII characters. */
export const isAppState = (text: string): boolean => /^[\x21-\x7e]{1,256}$/.test(text);

/** Stores a one-time code for the signed-in user (60 seconds, bound to the challenge and redirect URI, with the client's scopes) and returns it. */
export async function issueAppCode(env: Env, userId: string, app: AppLogin): Promise<string> {
  const code = randomToken();
  const t = now();
  await env.DB.prepare('INSERT INTO app_auth_codes (code_hash, user_id, challenge, redirect_uri, expires_at, created_at, scopes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(code), userId, app.challenge, app.redirectUri, t + APP_CODE_TTL, t, scopesFor(app.client).join(' '))
    .run();
  return code;
}

/** An OAuth error answer (RFC 6749 5.2). The description never repeats what the client sent. */
function oauthError(status: number, error: string, description: string): Response {
  return json({ error, error_description: description }, status, { 'Cache-Control': 'no-store', Pragma: 'no-cache' });
}

const MAX_TOKEN_BODY = 4096;

/** The body as JSON or, as OAuth client libraries send it, form-encoded; only its string fields. */
async function readParams(request: Request): Promise<Record<string, string>> {
  let body: Record<string, unknown>;
  if ((request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_TOKEN_BODY) throw new HttpError(413, 'Request body too large');
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_TOKEN_BODY) throw new HttpError(413, 'Request body too large');
    const text = new TextDecoder().decode(bytes);
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    body = await readJson(request, MAX_TOKEN_BODY);
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) if (typeof value === 'string') params[key] = value;
  return params;
}

/** New access and refresh tokens in `familyId` with `scopes`; inserted only while `whileExists` (a token hash) is still stored, when given. */
async function issueTokens(env: Env, userId: string, familyId: string, scopes: readonly TokenScope[], whileExists?: string): Promise<Response | undefined> {
  const access = randomToken();
  const refresh = randomToken();
  const t = now();
  const scope = scopes.join(' ');
  const insert = (hash: string, kind: string, ttl: number) =>
    whileExists
      ? env.DB.prepare(
          `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?)`,
        ).bind(hash, userId, t + ttl, t, kind, familyId, scope, whileExists)
      : env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
          hash,
          userId,
          t + ttl,
          t,
          kind,
          familyId,
          scope,
        );
  const results = await env.DB.batch([
    // The family's earlier access tokens end with the rotation.
    env.DB.prepare("DELETE FROM sessions WHERE family_id = ? AND kind = 'app_access'").bind(familyId),
    insert(await sha256(access), 'app_access', ACCESS_TTL),
    insert(await sha256(refresh), 'app_refresh', REFRESH_TTL),
  ]);
  // The family was revoked between the rotation and now (a concurrent reuse): nothing was issued.
  if (results[1].meta.changes === 0 || results[2].meta.changes === 0) return undefined;
  return json(
    { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope },
    200,
    { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  );
}

/** Deletes every token of `familyId`. */
async function revokeFamily(env: Env, familyId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE family_id = ?').bind(familyId).run();
}

/** POST /auth/token: a one-time code (with its PKCE verifier) or a refresh token for new tokens. */
export async function token(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const params = await readParams(request);
  if (params.grant_type === 'authorization_code') return exchangeCode(ctx, params);
  if (params.grant_type === 'refresh_token') return refreshTokens(ctx, params);
  return oauthError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

async function exchangeCode(ctx: Ctx, params: Record<string, string>): Promise<Response> {
  const { env } = ctx;
  const { code, code_verifier: verifier } = params;
  if (!code || !verifier) return oauthError(400, 'invalid_request', 'code and code_verifier are required');
  if (!isVerifier(verifier)) return oauthError(400, 'invalid_request', 'code_verifier must be 43 to 128 unreserved characters');
  // Deleted as it is read: a code works once, whatever the outcome.
  const row = await env.DB.prepare('DELETE FROM app_auth_codes WHERE code_hash = ? RETURNING user_id, challenge, redirect_uri, expires_at, scopes')
    .bind(await sha256(code))
    .first<{ user_id: string; challenge: string; redirect_uri: string; expires_at: number; scopes: string | null }>();
  const verified = row !== null && timingSafeEqual(await sha256(verifier), row.challenge);
  if (!row || !verified || row.expires_at <= now() || (params.redirect_uri !== undefined && params.redirect_uri !== row.redirect_uri)) {
    return oauthError(400, 'invalid_grant', 'The code is invalid, expired or already used, or the verifier does not match');
  }
  ctx.userId = row.user_id;
  return (await issueTokens(env, row.user_id, crypto.randomUUID(), parseScopes(row.scopes))) ?? oauthError(400, 'invalid_grant', 'The code is invalid');
}

async function refreshTokens(ctx: Ctx, params: Record<string, string>): Promise<Response> {
  const { env } = ctx;
  const refresh = params.refresh_token;
  if (!refresh) return oauthError(400, 'invalid_request', 'refresh_token is required');
  const hash = await sha256(refresh);
  const t = now();
  // Conditional, so of two requests with the same token only one rotates it.
  const row = await env.DB.prepare(
    `UPDATE sessions SET used_at = ? WHERE token_hash = ? AND kind = 'app_refresh' AND used_at IS NULL AND expires_at > ?
     RETURNING user_id, family_id, scopes`,
  )
    .bind(t, hash, t)
    .first<{ user_id: string; family_id: string; scopes: string | null }>();
  if (!row) {
    const used = await env.DB.prepare("SELECT user_id, family_id FROM sessions WHERE token_hash = ? AND kind = 'app_refresh' AND used_at IS NOT NULL")
      .bind(hash)
      .first<{ user_id: string; family_id: string }>();
    if (used) {
      // Rotated once already: someone else holds a copy. End the whole sign-in.
      await revokeFamily(env, used.family_id);
      log('warn', 'Refresh token reused; its sign-in was revoked', { requestId: ctx.requestId, userId: used.user_id });
    }
    return oauthError(400, 'invalid_grant', 'The refresh token is invalid, expired or revoked');
  }
  ctx.userId = row.user_id;
  return (await issueTokens(env, row.user_id, row.family_id, parseScopes(row.scopes), hash)) ?? oauthError(400, 'invalid_grant', 'The refresh token was revoked');
}

/**
 * POST /auth/revoke {token}: ends the app sign-in an access or refresh token
 * belongs to, both tokens with it. Answers 200 whether or not the token was
 * known (RFC 7009), so it tells a caller nothing.
 */
export async function revoke(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.AUTH_LIMITER, ctx.ip, 'Too many sign-in attempts; wait a minute');
  const params = await readParams(request);
  if (!params.token) return oauthError(400, 'invalid_request', 'token is required');
  await env.DB.prepare(
    "DELETE FROM sessions WHERE family_id = (SELECT family_id FROM sessions WHERE token_hash = ? AND kind IN ('app_access', 'app_refresh'))",
  )
    .bind(await sha256(params.token))
    .run();
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * GET /api/me/apps: the account's app and CLI sign-ins still running (a
 * refresh token not yet expired), each with its scopes, for Settings. The
 * site's only: no token's scopes reach it (src/scopes.ts).
 */
export async function listAppSignIns(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const rows = await ctx.env.DB.prepare(
    `SELECT family_id, MIN(created_at) AS created_at, MAX(created_at) AS refreshed_at,
            MAX(CASE WHEN used_at IS NULL THEN expires_at END) AS expires_at, MAX(CASE WHEN used_at IS NULL THEN scopes END) AS scopes
     FROM sessions WHERE user_id = ? AND kind = 'app_refresh' AND family_id IS NOT NULL
     GROUP BY family_id HAVING MAX(CASE WHEN used_at IS NULL THEN expires_at END) > ? ORDER BY created_at DESC`,
  )
    .bind(user.id, now())
    .all<{ family_id: string; created_at: number; refreshed_at: number; expires_at: number; scopes: string | null }>();
  return json(
    { apps: rows.results.map((r) => ({ id: r.family_id, scopes: parseScopes(r.scopes), createdAt: r.created_at, refreshedAt: r.refreshed_at, expiresAt: r.expires_at })) },
    200,
    { 'Cache-Control': 'no-store' },
  );
}
