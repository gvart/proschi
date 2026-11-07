import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/crypto';
import { isPaidPath, PAID_ROUTES } from '../src/index';
import { CLI_SCOPES, PUBLIC, TOKEN_ROUTES, TOKEN_SCOPES, tokenRoute, type TokenScope } from '../src/scopes';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * App and CLI tokens (src/scopes.ts, docs/design/paid-plans.md P42): a bearer
 * token reaches only TOKEN_ROUTES, and of those only what its scopes name.
 * Every route that spends credits, bills, administers or changes the account
 * answers it 403, even with every scope, before any handler runs.
 */

let n = 0;
/** A signed-in account with a bearer access token of `scopes` (and its cookie). */
async function tokenFor(scopes: readonly TokenScope[]): Promise<{ id: string; bearer: string; cookie: string }> {
  const { id, token } = await signedInUser();
  const bearer = `scoped-${++n}-${id}`;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes) VALUES (?, ?, 4000000000, 0, 'app_access', ?, ?)")
    .bind(await sha256(bearer), id, `fam-${id}`, scopes.join(' '))
    .run();
  return { id, bearer, cookie: token };
}

/** Routes no token may reach: the account, sign-in, billing, credits, short links, feedback, admin and campaigns. The paid routes are added below. */
const DENIED: [method: string, path: string][] = [
  ['PATCH', '/api/me'],
  ['DELETE', '/api/me'],
  ['GET', '/api/me/export'],
  ['GET', '/api/me/apps'],
  ['GET', '/api/me/email'],
  ['PUT', '/api/me/email'],
  ['PATCH', '/api/me/email'],
  ['DELETE', '/api/me/email'],
  ['GET', '/api/me/news'],
  ['PUT', '/api/me/news'],
  ['GET', '/api/me/announcement'],
  ['POST', '/api/me/announcement/x/dismiss'],
  ['POST', '/api/me/announcement/x/click'],
  ['POST', '/api/me/sessions/revoke-all'],
  ['DELETE', '/api/me/identities/github'],
  ['DELETE', '/api/me/documents'],
  ['GET', '/api/me/plan'],
  ['GET', '/api/me/shares'],
  ['POST', '/api/billing/checkout'],
  ['POST', '/api/billing/change-plan'],
  ['POST', '/api/billing/portal'],
  ['POST', '/api/billing/webhook'],
  ['GET', '/api/credits/usage'],
  ['POST', '/api/shares'],
  ['DELETE', '/api/shares/x'],
  ['POST', '/api/feedback'],
  ['GET', '/api/metrics/summary'],
  ['GET', '/api/email/confirm'],
  ['GET', '/api/email/unsubscribe'],
  ['GET', '/api/news/unsubscribe'],
  ['GET', '/auth/github/start'],
  ['GET', '/auth/github/callback'],
  ['POST', '/auth/logout'],
  ['GET', '/auth/email/start'],
  ['POST', '/auth/email/signup'],
  ['POST', '/auth/email/login'],
  ['POST', '/auth/email/confirm'],
  ['POST', '/auth/email/resend'],
  ['POST', '/auth/email/reset-request'],
  ['POST', '/auth/email/reset'],
  ['GET', '/auth/email/status'],
  ['GET', '/api/admin/status'],
  ['POST', '/api/admin/login'],
  ['POST', '/api/admin/setup'],
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/users'],
  ['GET', '/api/admin/users/x'],
  ['PATCH', '/api/admin/users/x'],
  ['DELETE', '/api/admin/users/x'],
  ['POST', '/api/admin/users/x/credits'],
  ['POST', '/api/admin/users/x/comp'],
  ['GET', '/api/admin/billing'],
  ['GET', '/api/admin/campaigns'],
  ['POST', '/api/admin/campaigns'],
  ['POST', '/api/admin/campaigns/x/send'],
  ['GET', '/api/admin/feedback'],
  ['DELETE', '/api/admin/feedback/x'],
  ...PAID_ROUTES.map(([method, path]): [string, string] => [method, `/${path.replace(/\*/g, 'x')}`]),
];

describe('token scopes', () => {
  beforeEach(resetDatabase);

  it('no route a token may reach is a paid, admin, billing or account route', () => {
    for (const [, path] of TOKEN_ROUTES) {
      const parts = path.split('/');
      expect(isPaidPath(parts), path).toBe(false);
      expect(parts[1], path).not.toBe('admin');
      expect(parts[1], path).not.toBe('billing');
    }
    for (const [method, path] of DENIED) expect(tokenRoute(method, path.split('/').filter(Boolean)), `${method} ${path}`).toBeUndefined();
  });

  it('a token with every scope gets 403 insufficient_scope on every denied route, and nothing changes', async () => {
    const who = await tokenFor(TOKEN_SCOPES);
    for (const [method, path] of DENIED) {
      const res = await call(path, { method, bearer: who.bearer, body: method === 'GET' ? undefined : {} });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.headers.get('WWW-Authenticate'), `${method} ${path}`).toBe('Bearer error="insufficient_scope"');
    }
    // The account, its sessions and the token are all still there.
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(who.id).first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(who.id).first('n')).toBe(2);
  }, 60_000);

  it('the cookie still reaches the account routes', async () => {
    const who = await tokenFor(TOKEN_SCOPES);
    expect((await call('/api/me/plan', { token: who.cookie })).status).toBe(200);
    expect((await call('/api/me/export', { token: who.cookie })).status).toBe(200);
  });

  it('each scoped route needs its scope; a token without it gets 403 naming the scope', async () => {
    for (const scope of TOKEN_SCOPES) {
      const others = await tokenFor(TOKEN_SCOPES.filter((s) => s !== scope));
      const own = await tokenFor([scope]);
      for (const [method, path, need] of TOKEN_ROUTES) {
        if (need !== scope) continue;
        const url = `/${path.replace(/\*/g, 'x')}`;
        const body = method === 'GET' || method === 'DELETE' ? undefined : {};
        const refused = await call(url, { method, bearer: others.bearer, body });
        expect(refused.status, `${method} ${path} without ${scope}`).toBe(403);
        expect(refused.headers.get('WWW-Authenticate')).toBe(`Bearer error="insufficient_scope", scope="${scope}"`);
        const allowed = await call(url, { method, bearer: own.bearer, body });
        expect([401, 403], `${method} ${path} with ${scope}: ${allowed.status}`).not.toContain(allowed.status);
      }
    }
  }, 60_000);

  it('public routes answer a token without scopes, and an unknown one', async () => {
    const who = await tokenFor([]);
    for (const [method, path, need] of TOKEN_ROUTES) {
      if (need !== PUBLIC || method !== 'GET' || path.startsWith('auth/') || path.includes('*')) continue;
      for (const bearer of [who.bearer, 'not-a-token']) {
        const res = await call(`/${path}`, { bearer });
        expect([401, 403], `${method} ${path}: ${res.status}`).not.toContain(res.status);
      }
    }
  }, 60_000);

  it('the tokens from before scopes keep what the CLI uses (migration 0030)', async () => {
    // A token issued before the migration, then given its scopes as the migration does.
    const { id } = await signedInUser();
    const bearer = 'pre-scope-token';
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id) VALUES (?, ?, 4000000000, 0, 'app_access', 'old')").bind(await sha256(bearer), id).run();
    expect((await call('/api/me', { bearer })).status).toBe(403);
    await env.DB.prepare("UPDATE sessions SET scopes = 'profile:read documents:read' WHERE kind IN ('app_access', 'app_refresh')").run();
    expect(CLI_SCOPES.join(' ')).toBe('profile:read documents:read');
    expect((await call('/api/me', { bearer })).status).toBe(200);
    expect((await call('/api/me/documents', { bearer })).status).toBe(200);
    expect((await call('/api/me/versions/resolve?name=a&tag=latest', { bearer })).status).toBe(404);
    expect((await call('/api/cards/state', { bearer })).status).toBe(403);
  });

  it('GET /api/me/apps lists the running app sign-ins with their scopes', async () => {
    const { id, token } = await signedInUser();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, used_at, scopes) VALUES ('h1', ?, 4000000000, 100, 'app_refresh', 'cli', 150, 'profile:read documents:read')").bind(id),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes) VALUES ('h2', ?, 4000000000, 150, 'app_refresh', 'cli', 'profile:read documents:read')").bind(id),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes) VALUES ('h3', ?, 1, 50, 'app_refresh', 'gone', 'progress')").bind(id),
    ]);
    const res = await call('/api/me/apps', { token });
    expect(await res.json()).toEqual({ apps: [{ id: 'cli', scopes: ['profile:read', 'documents:read'], createdAt: 100, refreshedAt: 150, expiresAt: 4000000000 }] });
  });
});
