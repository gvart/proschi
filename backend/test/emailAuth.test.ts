import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SESSION_COOKIE } from '../src/auth';
import { identityHash } from '../src/credits';
import { hmacSha256 } from '../src/crypto';
import type { Env } from '../src/env';
import worker from '../src/index';
import { hashPassword, passwordProblem, PBKDF2_ITERATIONS, verifyPassword } from '../src/password';
import { signupLedger } from '../src/signupCredits';
import { isDisposable, normalizeEmail } from '../src/signupChecks';
import { ORIGIN, resetDatabase, withinOneWindow, WINDOW_TIMEOUT } from './helpers';

// The ledger is metering's (src/credits.ts); here only whether and how it is called.
let granted: MockInstance<typeof signupLedger.grant>;

/**
 * Email and password sign-in (src/emailAuth.ts) and the sign-up credits'
 * checks (src/signupChecks.ts), with a fake send_email binding that keeps
 * what it was given.
 */

interface Sent {
  to: string;
  subject: string;
  text: string;
}

const SECRET = env.SESSION_SECRET as string;
const PASSWORD = 'a long passphrase 42';

function fakeEnv(extra: Partial<Env> = {}) {
  const sent: Sent[] = [];
  const EMAIL = {
    async send(message: Sent) {
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
  } as unknown as SendEmail;
  return { sent, env: { ...env, EMAIL, ...extra } as Env };
}

let mail = fakeEnv();

async function req(path: string, init: { method?: string; body?: unknown; token?: string; ip?: string; withEnv?: Env } = {}) {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const headers = new Headers({ 'CF-Connecting-IP': init.ip ?? `test-${crypto.randomUUID()}` });
  if (method !== 'GET') headers.set('Origin', ORIGIN);
  if (init.token) headers.set('Cookie', `${SESSION_COOKIE}=${init.token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), redirect: 'manual' });
  return worker.fetch!(request as Parameters<NonNullable<typeof worker.fetch>>[0], init.withEnv ?? mail.env, createExecutionContext());
}

const sessionOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.split(';')[0]
    .split('=')[1];

/** The token of the last email's link of `kind`. */
function lastLink(kind: 'confirm' | 'reset'): string {
  const text = mail.sent.at(-1)?.text ?? '';
  const match = new RegExp(`/signin/#${kind}=([A-Za-z0-9_%-]+)`).exec(text);
  if (!match) throw new Error(`No ${kind} link in: ${text.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

const signup = (email: string, password = PASSWORD, ip?: string) => req('/auth/email/signup', { body: { email, password }, ip });
const login = (email: string, password = PASSWORD, ip?: string) => req('/auth/email/login', { body: { email, password }, ip });
const confirm = (token: string) => req('/auth/email/confirm', { body: { token } });
const status = async (token: string) => (await req('/auth/email/status', { token })).json() as Promise<{ signedIn: boolean; email?: string | null; confirmed?: boolean; signupCredits: { outcome: string; reason: string } | null }>;

/** Signs up and confirms; returns the session token and the confirm answer. */
async function confirmedAccount(email: string, ip?: string) {
  expect((await signup(email, PASSWORD, ip)).status).toBe(202);
  const response = await confirm(lastLink('confirm'));
  expect(response.status).toBe(200);
  return { token: sessionOf(response)!, body: (await response.json()) as { signupCredits: { outcome: string; reason: string } } };
}

beforeEach(async () => {
  await resetDatabase();
  mail = fakeEnv();
  granted = vi.spyOn(signupLedger, 'grant').mockResolvedValue('granted');
});
afterEach(() => vi.restoreAllMocks());

describe('passwords', () => {
  it('hashes with PBKDF2-SHA256 at 100,000 iterations and a salt of its own, and verifies', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^pbkdf2\$sha256\$100000\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, a)).toBe(false);
    expect(await verifyPassword(PASSWORD, undefined)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });

  it('uses the most iterations Cloudflare allows, and refuses stored hashes above it', async () => {
    // Cloudflare's runtime refuses PBKDF2 above 100,000 iterations (the local workerd doesn't enforce it).
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    const stronger = (await hashPassword(PASSWORD)).replace('$100000$', '$100001$');
    expect(await verifyPassword(PASSWORD, stronger)).toBe(false);
  });

  it('refuses short, common and address-like passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('Password123')).toMatch(/too common/);
    expect(passwordProblem('qwertyuiop')).toMatch(/too common/);
    expect(passwordProblem('zzzzzzzzzzzz')).toMatch(/too common/);
    expect(passwordProblem('ada.lovelace', 'ada.lovelace@example.com')).toMatch(/email address/);
    expect(passwordProblem(PASSWORD)).toBeUndefined();
  });
});

describe('addresses', () => {
  it('normalizes: lowercase; Gmail without dots and +tag; other domains without +tag', () => {
    expect(normalizeEmail(' Ada.Lovelace+Proschi@GMail.com ')).toEqual({ email: 'ada.lovelace+proschi@gmail.com', normalized: 'adalovelace@gmail.com', domain: 'gmail.com' });
    expect(normalizeEmail('a.da@googlemail.com')?.normalized).toBe('ada@gmail.com');
    expect(normalizeEmail('first.last+tag@example.com')?.normalized).toBe('first.last@example.com');
    expect(normalizeEmail('x@Sub.Example.co')?.domain).toBe('sub.example.co');
    for (const bad of ['', 'no-at', 'a@b', '+tag@example.com', 'a b@example.com', 42, `${'a'.repeat(250)}@example.com`]) expect(normalizeEmail(bad)).toBeUndefined();
  });

  it('knows disposable domains and their subdomains', () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('eu.mailinator.com')).toBe(true);
    expect(isDisposable('gmail.com')).toBe(false);
    expect(isDisposable('example.com')).toBe(false);
  });
});

describe('email sign-up, confirmation and sign-in', () => {
  it('lists email among the providers, and the start link opens the sign-in page', async () => {
    expect(await (await req('/auth/email/status')).json()).toEqual({ signedIn: false });
    expect(await (await req('/auth/providers')).json()).toEqual({ providers: ['github', 'google', 'email'] });
    const start = await req('/auth/email/start?return=/practice/%23/me&link=1');
    expect(start.status).toBe(302);
    expect(start.headers.get('Location')).toBe('/signin/?return=%2Fpractice%2F%23%2Fme&link=1');
    expect((await req('/auth/email/start?return=//evil.example')).headers.get('Location')).toBe('/signin/?return=%2F');
  });

  it('signs up without signing in, signs in unconfirmed without credits, and the link confirms, signs in and grants once', async () => {
    const response = await signup('Ada@Example.com');
    expect(response.status).toBe(202);
    expect(sessionOf(response)).toBeUndefined();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'ada@example.com', subject: 'Confirm your Proschi account' });

    const early = await login('ada@example.com');
    expect(early.status).toBe(200);
    expect(await early.json()).toEqual({ confirmed: false });
    expect(await status(sessionOf(early)!)).toEqual({ signedIn: true, email: 'ada@example.com', confirmed: false, signupCredits: { outcome: 'pending', reason: 'unconfirmed' } });
    expect(granted).not.toHaveBeenCalled();

    const token = lastLink('confirm');
    const confirmed = await confirm(token);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ confirmed: true, signupCredits: { outcome: 'granted', reason: 'granted' } });
    const session = sessionOf(confirmed)!;
    expect((await req('/api/me', { token: session })).status).toBe(200);
    expect(granted).toHaveBeenCalledTimes(1);
    const user = await env.DB.prepare('SELECT user_id FROM email_logins').first<{ user_id: string }>();
    expect(granted).toHaveBeenCalledWith(expect.anything(), user!.user_id, 'ada@example.com');

    // Single use.
    expect((await confirm(token)).status).toBe(400);
    expect(granted).toHaveBeenCalledTimes(1);
    await expect((await req('/api/me', { token: session })).json()).resolves.toMatchObject({ user: { providers: ['email'] } });
  });

  it('puts the address and the credits decision in "Download my data", never the password hash', async () => {
    const { token } = await confirmedAccount('Ada@Example.com');
    const text = await (await req('/api/me/export', { token })).text();
    expect(JSON.parse(text).emailSignIn).toMatchObject({ login: { email: 'ada@example.com', normalized: 'ada@example.com', confirmedAt: expect.any(Number) }, signupCredits: { outcome: 'granted', reason: 'granted' } });
    expect(text).not.toContain('pbkdf2');
  });

  it('refuses bad addresses and weak passwords with a reason', async () => {
    expect(await (await signup('nope')).json()).toEqual({ error: 'Enter a valid email address' });
    expect((await signup('ada@example.com', 'password123')).status).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });

  it('answers sign-up and reset the same whether or not the address has an account', async () => {
    await confirmedAccount('taken@example.com');
    mail.sent.length = 0;
    const again = await signup('Taken@example.com', 'another long password');
    const fresh = await signup('fresh@example.com');
    expect(again.status).toBe(fresh.status);
    expect(await again.json()).toEqual(await fresh.json());
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
      ['taken@example.com', 'You already have a Proschi account'],
      ['fresh@example.com', 'Confirm your Proschi account'],
    ]);
    // The existing account's password is unchanged.
    expect((await login('taken@example.com', 'another long password')).status).toBe(401);

    const known = await req('/auth/email/reset-request', { body: { email: 'taken@example.com' } });
    const unknown = await req('/auth/email/reset-request', { body: { email: 'nobody@example.com' } });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
  });

  it('gives a wrong password and an unknown address the same error', async () => {
    await confirmedAccount('ada@example.com');
    const wrong = await login('ada@example.com', 'not the password');
    const unknown = await login('nobody@example.com');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('lets whoever owns the inbox set the password when someone signed up with their address first', async () => {
    await signup('victim@example.com', 'attacker password 1');
    const attacker = sessionOf(await login('victim@example.com', 'attacker password 1'))!;
    // The owner signs up too (a minute later: one link a minute); the address is still unconfirmed, so the new link carries their password.
    await env.DB.prepare('UPDATE email_tokens SET created_at = created_at - 120').run();
    await signup('victim@example.com', 'owner password 12');
    const confirmed = await confirm(lastLink('confirm'));
    expect(confirmed.status).toBe(200);
    expect((await req('/api/me', { token: attacker })).status).toBe(401);
    expect((await login('victim@example.com', 'attacker password 1')).status).toBe(401);
    expect((await login('victim@example.com', 'owner password 12')).status).toBe(200);
  });

  it('resends the confirmation at most once a minute', async () => {
    await signup('ada@example.com');
    const token = sessionOf(await login('ada@example.com'))!;
    mail.sent.length = 0;
    // The sign-up's email was just sent, so the first resend waits too.
    expect(await (await req('/auth/email/resend', { method: 'POST', token })).json()).toMatchObject({ sent: false });
    await env.DB.prepare('UPDATE email_tokens SET created_at = created_at - 120').run();
    expect(await (await req('/auth/email/resend', { method: 'POST', token })).json()).toMatchObject({ sent: true });
    expect(await (await req('/auth/email/resend', { method: 'POST', token })).json()).toMatchObject({ sent: false });
    expect(mail.sent).toHaveLength(1);
  });

  it('stops signing in once the email sign-in is unlinked', async () => {
    const { token } = await confirmedAccount('ada@example.com');
    const id = (await env.DB.prepare('SELECT user_id FROM email_logins').first<{ user_id: string }>())!.user_id;
    await env.DB.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('github', 'gh-ada', ?)").bind(id).run();
    expect((await req('/api/me/identities/email', { method: 'DELETE', token })).status).toBe(204);
    expect((await login('ada@example.com')).status).toBe(401);
  });
});

describe('sign-in backoff', () => {
  it(
    'locks an account after 5 failures, for everyone, while other accounts still sign in',
    async () => {
      await withinOneWindow(10_000);
      await confirmedAccount('ada@example.com');
      await confirmedAccount('bob@example.com');
      for (let i = 0; i < 5; i++) expect((await login('ada@example.com', `wrong password ${i}`)).status).toBe(401);
      const locked = await login('ada@example.com');
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(50);
      expect((await login('bob@example.com')).status).toBe(200);
      // Each further failure doubles the lock.
      await env.DB.prepare('UPDATE login_failures SET locked_until = 0').run();
      expect((await login('ada@example.com', 'wrong again 1234')).status).toBe(401);
      expect(Number((await login('ada@example.com')).headers.get('Retry-After'))).toBeGreaterThan(110);
    },
    WINDOW_TIMEOUT,
  );

  it('locks an IP after 20 failures, whichever addresses it tries', async () => {
    await confirmedAccount('ada@example.com');
    const ip = 'test-busy-ip';
    await env.DB.prepare('INSERT INTO login_failures (key, failures, locked_until, updated_at) VALUES (?, 19, 0, ?)')
      .bind(`ip:${await hmacSha256(ip, `${SECRET}/login-failures`)}`, Math.floor(Date.now() / 1000))
      .run();
    expect((await login('someone@example.com', 'wrong password', ip)).status).toBe(401);
    expect((await login('ada@example.com', PASSWORD, ip)).status).toBe(429);
    expect((await login('ada@example.com')).status).toBe(200);
  });

  it('a success clears the account’s failures', async () => {
    await confirmedAccount('ada@example.com');
    for (let i = 0; i < 4; i++) await login('ada@example.com', `wrong password ${i}`);
    expect((await login('ada@example.com')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login('ada@example.com', `wrong password ${i}`)).status).toBe(401);
    expect((await login('ada@example.com')).status).toBe(200);
  });
});

describe('password reset', () => {
  it('sets a new password once, ends every other session, signs in, and confirms the address', async () => {
    await signup('ada@example.com');
    const before = sessionOf(await login('ada@example.com'))!;
    expect((await req('/auth/email/reset-request', { body: { email: 'ADA@example.com' } })).status).toBe(202);
    expect(mail.sent.at(-1)?.subject).toBe('Reset your Proschi password');
    const token = lastLink('reset');

    // A refused password leaves the link usable.
    expect((await req('/auth/email/reset', { body: { token, password: 'short' } })).status).toBe(400);
    const done = await req('/auth/email/reset', { body: { token, password: 'a brand new password' } });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ reset: true, signupCredits: { outcome: 'granted', reason: 'granted' } });
    expect((await req('/api/me', { token: sessionOf(done)! })).status).toBe(200);
    expect((await req('/api/me', { token: before })).status).toBe(401);
    expect((await login('ada@example.com')).status).toBe(401);
    expect((await login('ada@example.com', 'a brand new password')).status).toBe(200);
    expect((await req('/auth/email/reset', { body: { token, password: 'yet another password' } })).status).toBe(400);
  });
});

describe('Turnstile', () => {
  const siteverify = (passing: string) => {
    const real = globalThis.fetch;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return real(input, init);
      const body = init?.body as FormData;
      expect(body.get('secret')).toBe('test-turnstile-secret');
      return Response.json(body.get('response') === passing ? { success: true, action: 'signup' } : { success: false, 'error-codes': ['invalid-input-response'] });
    });
  };

  it('is skipped without a secret, and serves the site key when on', async () => {
    expect((await signup('ada@example.com')).status).toBe(202);
    const on = fakeEnv({ TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' });
    expect(await (await req('/auth/providers', { withEnv: on.env })).json()).toMatchObject({ turnstileSiteKey: '1x00000000000000000000AA' });
  });

  it('lets a passing token through and refuses a failing or missing one', async () => {
    const fetch = siteverify('good-token');
    const on = fakeEnv({ TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'test-turnstile-secret' });
    const post = (body: Record<string, unknown>) => req('/auth/email/signup', { body: { email: 'ada@example.com', password: PASSWORD, ...body }, withEnv: on.env });
    expect((await post({})).status).toBe(400);
    expect((await post({ turnstile: 'bad-token' })).status).toBe(400);
    expect(on.sent).toHaveLength(0);
    expect((await post({ turnstile: 'good-token' })).status).toBe(202);
    expect(on.sent).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    // A token issued for another form (action) doesn't count.
    const loginWith = await req('/auth/email/login', { body: { email: 'ada@example.com', password: PASSWORD, turnstile: 'good-token' }, withEnv: on.env });
    expect(loginWith.status).toBe(400);
  });
});

describe('sign-up credits', () => {
  it('refuses disposable addresses, but the account works', async () => {
    const { token, body } = await confirmedAccount('throwaway@mailinator.com');
    expect(body.signupCredits).toEqual({ outcome: 'refused', reason: 'disposable' });
    expect(granted).not.toHaveBeenCalled();
    expect((await req('/api/me', { token })).status).toBe(200);
  });

  it('refuses an address whose account was deleted, however it is written', async () => {
    const first = await confirmedAccount('ada.lovelace@gmail.com');
    expect(first.body.signupCredits.outcome).toBe('granted');
    expect((await req('/api/me', { method: 'DELETE', token: first.token })).status).toBe(204);
    const second = await confirmedAccount('AdaLovelace+again@googlemail.com');
    expect(second.body.signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it('refuses an address tombstoned before these checks existed', async () => {
    await env.DB.prepare('INSERT INTO account_tombstones (identity_hash, trial_used) VALUES (?, 0)').bind(await identityHash(SECRET, 'email', 'ada@example.com')).run();
    expect((await confirmedAccount('ada+x@example.com')).body.signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
  });

  it(
    'grants at most 3 accounts per IP in a week',
    async () => {
      await withinOneWindow(15_000);
      const ip = 'test-shared-ip';
      for (const n of [1, 2, 3]) expect((await confirmedAccount(`user${n}@example.com`, ip)).body.signupCredits.outcome).toBe('granted');
      expect((await confirmedAccount('user4@example.com', ip)).body.signupCredits).toEqual({ outcome: 'refused', reason: 'ip_limit' });
      expect((await confirmedAccount('user5@example.com', 'test-other-ip')).body.signupCredits.outcome).toBe('granted');
      // Only an HMAC of the IP is stored.
      const stored = await env.DB.prepare('SELECT ip_hash FROM signup_ip_grants').all<{ ip_hash: string }>();
      expect(stored.results.every((r) => !r.ip_hash.includes('test-'))).toBe(true);
      // A week later the IP may again.
      await env.DB.prepare('UPDATE signup_ip_grants SET granted_at = granted_at - 8 * 86400').run();
      expect((await confirmedAccount('user6@example.com', ip)).body.signupCredits.outcome).toBe('granted');
    },
    WINDOW_TIMEOUT,
  );
});

describe('sign-up credits of GitHub and Google accounts', () => {
  function mockProviders(github: Record<string, unknown>, google: Record<string, unknown> = { sub: 'g-1', given_name: 'Grace' }, githubEmails: unknown[] = []) {
    const real = globalThis.fetch;
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-token' });
      if (url === 'https://api.github.com/user') return Response.json(github);
      if (url === 'https://api.github.com/user/emails') return Response.json(githubEmails);
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'g-token' });
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json(google);
      return real(input, init);
    });
  }

  async function oauth(provider: 'github' | 'google', ip = `test-${crypto.randomUUID()}`) {
    const start = await req(`/auth/${provider}/start?return=/`, { ip });
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const headers = new Headers({ Cookie: cookie, 'CF-Connecting-IP': ip });
    const request = new Request(`${ORIGIN}/auth/${provider}/callback?code=c&state=${state}`, { headers, redirect: 'manual' });
    const back = await worker.fetch!(request as Parameters<NonNullable<typeof worker.fetch>>[0], mail.env, createExecutionContext());
    return sessionOf(back)!;
  }

  it('grants a new GitHub account at once, with its identity as the claim, and only once', async () => {
    mockProviders({ id: 42, login: 'octocat' });
    const token = await oauth('github');
    expect(await status(token)).toEqual({ signedIn: true, email: null, confirmed: true, signupCredits: { outcome: 'granted', reason: 'granted' } });
    expect(granted).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'github\n42');
    await oauth('github');
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it('asks Google for the address and refuses one an email account already claimed', async () => {
    mockProviders({ id: 1 }, { sub: 'g-7', given_name: 'Ada', email: 'Ada.Lovelace@gmail.com', email_verified: true });
    await confirmedAccount('adalovelace@gmail.com');
    const start = await req('/auth/google/start?return=/');
    expect(new URL(start.headers.get('Location')!).searchParams.get('scope')).toBe('openid profile email');
    const token = await oauth('google');
    expect((await status(token)).signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
  });

  it('ignores an unverified Google address, and refuses a disposable GitHub one', async () => {
    mockProviders({ id: 9, login: 'temp' }, { sub: 'g-8', email: 'x@mailinator.com', email_verified: false }, [
      { email: 'other@example.com', primary: false, verified: true },
      { email: 'x@mailinator.com', primary: true, verified: true },
    ]);
    expect((await status(await oauth('google'))).signupCredits?.outcome).toBe('granted');
    expect((await status(await oauth('github'))).signupCredits).toEqual({ outcome: 'refused', reason: 'disposable' });
  });

  it('keys the credits by the verified address, so one inbox gets them once across GitHub, Google and a password', async () => {
    mockProviders({ id: 77, login: 'ada' }, { sub: 'g-77', given_name: 'Ada', email: 'Ada.Lovelace@gmail.com', email_verified: true }, [{ email: 'ada.lovelace+gh@gmail.com', primary: true, verified: true }]);
    const start = await req('/auth/github/start?return=/');
    expect(new URL(start.headers.get('Location')!).searchParams.get('scope')).toBe('user:email');
    expect((await status(await oauth('github'))).signupCredits?.outcome).toBe('granted');
    expect(granted).toHaveBeenCalledWith(expect.anything(), expect.any(String), 'adalovelace@gmail.com');
    expect((await status(await oauth('google'))).signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
    expect((await confirmedAccount('adalovelace@gmail.com')).body.signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
    expect(granted).toHaveBeenCalledTimes(1);
  });

  it('refuses a deleted GitHub account coming back', async () => {
    mockProviders({ id: 5, login: 'five' });
    const first = await oauth('github');
    expect((await req('/api/me', { method: 'DELETE', token: first })).status).toBe(204);
    expect((await status(await oauth('github'))).signupCredits).toEqual({ outcome: 'refused', reason: 'seen_before' });
  });
});
