import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, ORIGIN, resetDatabase } from './helpers';

const RETURN = `${ORIGIN}/practice/#/url-shortener`;

/** Answers the provider's token and profile endpoints. */
function mockProviders(profile: Record<string, unknown> = { id: 42, login: 'octocat' }) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('code') !== 'good-code' || !body.get('code_verifier')) return Response.json({ error: 'bad_verification_code' });
      return Response.json({ access_token: 'gh-token' });
    }
    if (url === 'https://api.github.com/user') return Response.json(profile);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-token' });
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: 'g-1', given_name: 'Grace', name: 'Grace Hopper' });
    return real(input, init);
  });
}

/** Starts a sign-in and returns the redirect to the provider and the state cookie. */
const NONCE = 'page-nonce-0123456789';

async function start(provider = 'github', returnTo = RETURN, nonce = NONCE) {
  const response = await call(`/auth/${provider}/start?${new URLSearchParams({ return: returnTo, nonce })}`, { redirect: 'manual' });
  const cookie = (response.headers.get('Set-Cookie') ?? '').split(';')[0];
  return { response, cookie, location: new URL(response.headers.get('Location') ?? 'about:blank') };
}

async function callback(provider: string, params: Record<string, string>, cookie: string) {
  return call(`/auth/${provider}/callback?${new URLSearchParams(params)}`, { redirect: 'manual', headers: { Cookie: cookie } });
}

/** The full sign-in: start, the provider's redirect back, the code exchange. */
async function signIn(provider = 'github') {
  const { cookie, location } = await start(provider);
  const back = await callback(provider, { code: 'good-code', state: location.searchParams.get('state')! }, cookie);
  const code = new URL(back.headers.get('Location')!).searchParams.get('login')!;
  const session = await call('/auth/session', { method: 'POST', body: { code, nonce: NONCE } });
  return { back, code, session, body: (await session.json()) as { token: string; expiresAt: number } };
}

describe('sign-in', () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  it('lists the configured providers', async () => {
    expect(await (await call('/auth/providers')).json()).toEqual({ providers: ['github', 'google'] });
  });

  it('redirects to GitHub with state and a PKCE challenge, and sets a signed state cookie', async () => {
    const { response, cookie, location } = await start();
    expect(response.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('gh-client');
    expect(location.searchParams.get('redirect_uri')).toBe('https://api.test/auth/github/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toMatch(/^[\w-]{20,}$/);
    expect(cookie).toMatch(/^proschi_oauth=.+\..+$/);
    expect(response.headers.get('Set-Cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  });

  it('refuses to return to a page on another origin', async () => {
    for (const bad of ['https://evil.example/practice/', 'javascript:alert(1)', '']) {
      const { response } = await start('github', bad);
      expect(response.status).toBe(400);
    }
  });

  it('signs in with GitHub: one-time code, then a session that reads /api/me', async () => {
    mockProviders();
    const { back, code, session, body } = await signIn();
    expect(back.status).toBe(302);
    const target = new URL(back.headers.get('Location')!);
    expect(`${target.origin}${target.pathname}${target.hash}`).toBe(RETURN);
    expect(back.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    expect(session.status).toBe(200);
    expect(body.token).toMatch(/^[\w-]{40,}$/);

    const me = (await (await call('/api/me', { token: body.token })).json()) as { user: { id: string } };
    expect(me).toMatchObject({ user: { displayName: 'octocat', publicProfile: false, providers: ['github'] }, progress: {} });

    // The code works once.
    expect((await call('/auth/session', { method: 'POST', body: { code, nonce: NONCE } })).status).toBe(401);
    // Signing in again finds the same user.
    const again = await signIn();
    expect(await (await call('/api/me', { token: again.body.token })).json()).toMatchObject({ user: { id: me.user.id } });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1);
  });

  it('signs in with Google', async () => {
    mockProviders();
    const { body } = await signIn('google');
    expect(await (await call('/api/me', { token: body.token })).json()).toMatchObject({ user: { displayName: 'Grace', providers: ['google'] } });
  });

  it('needs a nonce to start, and the same nonce to exchange the code, which a wrong one uses up', async () => {
    expect((await start('github', RETURN, '')).response.status).toBe(400);
    expect((await start('github', RETURN, 'short')).response.status).toBe(400);

    mockProviders();
    const { cookie, location } = await start();
    const back = await callback('github', { code: 'good-code', state: location.searchParams.get('state')! }, cookie);
    const code = new URL(back.headers.get('Location')!).searchParams.get('login')!;
    // Someone else's browser, with the code from a link but not the nonce.
    const stolen = await call('/auth/session', { method: 'POST', body: { code, nonce: 'another-browser-nonce' } });
    expect(stolen.status).toBe(401);
    expect((await call('/auth/session', { method: 'POST', body: { code, nonce: NONCE } })).status).toBe(401);
    expect((await call('/auth/session', { method: 'POST', body: { code } })).status).toBe(400);
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    mockProviders();
    const { cookie } = await start();
    expect((await callback('github', { code: 'good-code', state: 'forged' }, cookie)).status).toBe(400);
    expect((await callback('github', { code: 'good-code', state: 'x' }, '')).status).toBe(400);
  });

  it('rejects a state cookie from another provider', async () => {
    const { cookie, location } = await start('github');
    expect((await callback('google', { code: 'good-code', state: location.searchParams.get('state')! }, cookie)).status).toBe(400);
  });

  it('sends the user back with an error when they cancel or the provider fails', async () => {
    mockProviders();
    const first = await start();
    const cancelled = await callback('github', { error: 'access_denied', state: first.location.searchParams.get('state')! }, first.cookie);
    expect(new URL(cancelled.headers.get('Location')!).searchParams.get('login_error')).toBe('cancelled');
    const second = await start();
    const failed = await callback('github', { code: 'bad-code', state: second.location.searchParams.get('state')! }, second.cookie);
    expect(new URL(failed.headers.get('Location')!).searchParams.get('login_error')).toBe('failed');
  });

  it('logs out', async () => {
    mockProviders();
    const { body } = await signIn();
    expect((await call('/auth/logout', { method: 'POST', token: body.token })).status).toBe(204);
    expect((await call('/api/me', { token: body.token })).status).toBe(401);
  });

  it('answers CORS preflights for allowed origins only', async () => {
    const ok = await call('/api/me', { method: 'OPTIONS' });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    const bad = await call('/api/me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
  });
});
