import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../src/auth';
import { call, ORIGIN, resetDatabase } from './helpers';

const RETURN = '/practice/?a=1#/url-shortener';

/** Answers the providers' token and profile endpoints. */
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

/** `name=value` of the Set-Cookie for `name`. */
function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** Starts a sign-in and returns the redirect to the provider and the state cookie. */
async function start(provider = 'github', returnTo = RETURN) {
  const response = await call(`/auth/${provider}/start?${new URLSearchParams({ return: returnTo })}`, { redirect: 'manual' });
  const cookie = (setCookie(response, 'proschi_oauth') ?? '').split(';')[0];
  return { response, cookie, location: new URL(response.headers.get('Location') ?? 'about:blank') };
}

async function callback(provider: string, params: Record<string, string>, cookie: string) {
  return call(`/auth/${provider}/callback?${new URLSearchParams(params)}`, { redirect: 'manual', headers: { Cookie: cookie } });
}

/** The full sign-in: start, the provider's redirect back; returns the callback response and the session token. */
async function signIn(provider = 'github') {
  const { cookie, location } = await start(provider);
  const back = await callback(provider, { code: 'good-code', state: location.searchParams.get('state')! }, cookie);
  const session = setCookie(back, SESSION_COOKIE);
  return { back, session, token: session?.split(';')[0].split('=')[1] ?? '' };
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
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/github/callback`);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toMatch(/^[\w-]{20,}$/);
    expect(cookie).toMatch(/^proschi_oauth=.+\..+$/);
    expect(setCookie(response, 'proschi_oauth')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
  });

  it('only returns to a path on this site', async () => {
    for (const bad of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'practice/']) {
      expect((await start('github', bad)).response.status, bad).toBe(400);
    }
  });

  it('signs in with GitHub: back to the page with an HttpOnly session cookie that reads /api/me', async () => {
    mockProviders();
    const { back, session, token } = await signIn();
    expect(back.status).toBe(302);
    expect(back.headers.get('Location')).toBe(RETURN);
    expect(session).toMatch(new RegExp(`^${SESSION_COOKIE}=[\\w-]{40,}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$`));
    expect(setCookie(back, 'proschi_oauth')).toMatch(/Max-Age=0/);

    const me = (await (await call('/api/me', { token })).json()) as { user: { id: string } };
    expect(me).toMatchObject({ user: { displayName: 'octocat', publicProfile: false, providers: ['github'] }, progress: {} });

    // Signing in again finds the same user.
    const again = await signIn();
    expect(await (await call('/api/me', { token: again.token })).json()).toMatchObject({ user: { id: me.user.id } });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1);
  });

  it('counts each sign-in in the daily usage counts, and nothing about who', async () => {
    mockProviders();
    await signIn();
    await signIn();
    const { results } = await env.DB.prepare('SELECT event, count FROM daily_counts').all();
    expect(results).toEqual([{ event: 'sign_in', count: 2 }]);
  });

  it('signs in with Google', async () => {
    mockProviders();
    const { token } = await signIn('google');
    expect(await (await call('/api/me', { token })).json()).toMatchObject({ user: { displayName: 'Grace', providers: ['google'] } });
  });

  it('rejects a callback without the state cookie of the browser that started the sign-in', async () => {
    mockProviders();
    const { cookie, location } = await start();
    const forged = await callback('github', { code: 'good-code', state: 'forged' }, cookie);
    expect(forged.status).toBe(400);
    expect(setCookie(forged, SESSION_COOKIE)).toBeUndefined();
    // Someone else's callback link, opened in a browser that started no sign-in.
    expect((await callback('github', { code: 'good-code', state: location.searchParams.get('state')! }, '')).status).toBe(400);
  });

  it('rejects a state cookie from another provider', async () => {
    const { cookie, location } = await start('github');
    expect((await callback('google', { code: 'good-code', state: location.searchParams.get('state')! }, cookie)).status).toBe(400);
  });

  it('sends the user back with an error when they cancel or the provider fails', async () => {
    mockProviders();
    const first = await start();
    const cancelled = await callback('github', { error: 'access_denied', state: first.location.searchParams.get('state')! }, first.cookie);
    expect(cancelled.headers.get('Location')).toBe('/practice/?a=1&login_error=cancelled#/url-shortener');
    const second = await start();
    const failed = await callback('github', { code: 'bad-code', state: second.location.searchParams.get('state')! }, second.cookie);
    expect(failed.headers.get('Location')).toBe('/practice/?a=1&login_error=failed#/url-shortener');
    expect(setCookie(failed, SESSION_COOKIE)).toBeUndefined();
  });

  it('logs out: ends the session and clears the cookie', async () => {
    mockProviders();
    const { token } = await signIn();
    const out = await call('/auth/logout', { method: 'POST', token });
    expect(out.status).toBe(204);
    expect(setCookie(out, SESSION_COOKIE)).toMatch(/Max-Age=0/);
    expect((await call('/api/me', { token })).status).toBe(401);
  });

  it('refuses changes requested from another site', async () => {
    mockProviders();
    const { token } = await signIn();
    for (const [path, method] of [
      ['/auth/logout', 'POST'],
      ['/api/me', 'DELETE'],
      ['/api/me', 'PATCH'],
    ]) {
      const response = await call(path, { method, token, headers: { Origin: 'https://evil.example' }, body: {} });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    expect((await call('/api/me', { token })).status).toBe(200);
  });
});

describe('linking sign-ins', () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  /** Signed in with `token`, adds `provider`: start with link=1, then the provider's redirect back. */
  async function link(provider: string, token: string, callbackToken = token) {
    const response = await call(`/auth/${provider}/start?${new URLSearchParams({ return: '/practice/', link: '1' })}`, { token, redirect: 'manual' });
    expect(response.status).toBe(302);
    const state = new URL(response.headers.get('Location')!).searchParams.get('state')!;
    const cookie = `${(setCookie(response, 'proschi_oauth') ?? '').split(';')[0]}; ${SESSION_COOKIE}=${callbackToken}`;
    return callback(provider, { code: 'good-code', state }, cookie);
  }

  const providers = async (token: string) => ((await (await call('/api/me', { token })).json()) as { user: { providers: string[] } }).user.providers;

  it('adds a provider to the signed-in account, without a new session', async () => {
    mockProviders();
    const { token } = await signIn('github');
    const back = await link('google', token);
    expect(back.headers.get('Location')).toBe('/practice/?linked=google');
    expect(setCookie(back, SESSION_COOKIE)).toBeUndefined();
    expect(await providers(token)).toEqual(['github', 'google']);
    // Signing in with either finds the same account.
    const viaGoogle = await signIn('google');
    expect(await (await call('/api/me', { token: viaGoogle.token })).json()).toMatchObject({ user: { providers: ['github', 'google'] } });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!.n).toBe(1);
    // Linking it again changes nothing.
    expect((await link('google', token)).headers.get('Location')).toBe('/practice/?linked=google');
  });

  it('needs a session, the same one at the callback', async () => {
    mockProviders();
    expect((await call('/auth/google/start?return=/&link=1', { redirect: 'manual' })).status).toBe(401);
    const { token } = await signIn('github');
    const other = await signIn('google');
    const back = await link('google', token, other.token);
    expect(back.headers.get('Location')).toBe('/practice/?login_error=failed');
  });

  it('refuses an identity that signs in to another account', async () => {
    mockProviders();
    await signIn('google');
    const { token } = await signIn('github');
    expect((await link('google', token)).headers.get('Location')).toBe('/practice/?login_error=identity_in_use');
    expect(await providers(token)).toEqual(['github']);
  });

  it('refuses a second identity with the same provider', async () => {
    mockProviders();
    const { token } = await signIn('github');
    vi.restoreAllMocks();
    mockProviders({ id: 43, login: 'other-octocat' });
    expect((await link('github', token)).headers.get('Location')).toBe('/practice/?login_error=provider_linked');
    expect(await providers(token)).toEqual(['github']);
  });

  it('unlinks a provider, but not the only one left', async () => {
    mockProviders();
    const { token } = await signIn('github');
    await link('google', token);
    expect((await call('/api/me/identities/google', { method: 'DELETE', token })).status).toBe(204);
    expect(await providers(token)).toEqual(['github']);
    const last = await call('/api/me/identities/github', { method: 'DELETE', token });
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: "Can't remove your only sign-in" });
    expect((await call('/api/me/identities/google', { method: 'DELETE', token })).status).toBe(404);
    expect(await providers(token)).toEqual(['github']);
  });
});
