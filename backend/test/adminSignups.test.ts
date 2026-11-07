import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_COOKIE } from '../src/adminAuth';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';
import { createPasskey } from './webauthn';

/** The admin panel's sign-in and sign-up credits view (src/adminSignups.ts). */

const SETUP_TOKEN = 'test-admin-setup-token-0123456789';

async function setUp(): Promise<string> {
  const passkey = await createPasskey();
  const options = (await (await call('/api/admin/setup/options', { method: 'POST', body: { setupToken: SETUP_TOKEN } })).json()) as { challenge: string; rp: { id: string } };
  const response = await call('/api/admin/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, name: 'Laptop', response: await passkey.register(options, ORIGIN) } });
  return response.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!.split(';')[0].split('=')[1];
}

const adminGet = (path: string, admin?: string) => call(path, { headers: admin ? { Cookie: `${ADMIN_COOKIE}=${admin}` } : {} });
const t = () => Math.floor(Date.now() / 1000);

describe('admin: sign-in methods and sign-up credits', () => {
  beforeEach(resetDatabase);

  it('needs the admin', async () => {
    expect((await adminGet('/api/admin/signups')).status).toBe(401);
    expect((await adminGet('/api/admin/users/x/sign-in')).status).toBe(401);
  });

  it('shows each account’s methods, whether it is confirmed, and why it got or did not get credits', async () => {
    const admin = await setUp();
    const oauth = await signedInUser();
    await env.DB.prepare("INSERT INTO signup_checks (user_id, outcome, reason, ip_hash, created_at, decided_at) VALUES (?, 'granted', 'granted', 'h', ?, ?)").bind(oauth.id, t(), t()).run();
    expect(await (await adminGet(`/api/admin/users/${oauth.id}/sign-in`, admin)).json()).toEqual({
      methods: ['github'],
      confirmed: true,
      confirmedAt: null,
      signupCredits: { outcome: 'granted', reason: 'granted', decidedAt: expect.any(Number) },
    });

    const email = await signedInUser();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('email', 'ada@example.com', ?)").bind(email.id),
      env.DB.prepare("INSERT INTO email_logins (user_id, email, normalized, password_hash, created_at) VALUES (?, 'ada@example.com', 'ada@example.com', 'x', 0)").bind(email.id),
      env.DB.prepare("INSERT INTO signup_checks (user_id, outcome, reason, ip_hash, created_at) VALUES (?, 'pending', 'unconfirmed', 'h', 0)").bind(email.id),
    ]);
    expect(await (await adminGet(`/api/admin/users/${email.id}/sign-in`, admin)).json()).toMatchObject({
      methods: ['email', 'github'],
      confirmed: false,
      signupCredits: { outcome: 'pending', reason: 'unconfirmed', decidedAt: null },
    });
    expect((await adminGet('/api/admin/users/nobody/sign-in', admin)).status).toBe(404);
  });

  it('counts the sign-ups refused free credits today, by reason', async () => {
    const admin = await setUp();
    const rows: [string, number][] = [
      ['disposable', t()],
      ['seen_before', t()],
      ['seen_before', t()],
      ['ip_limit', t() - 2 * 86_400],
    ];
    for (const [reason, at] of rows) {
      const { id } = await signedInUser();
      await env.DB.prepare("INSERT INTO signup_checks (user_id, outcome, reason, ip_hash, created_at, decided_at) VALUES (?, 'refused', ?, 'h', ?, ?)").bind(id, reason, at, at).run();
    }
    expect(await (await adminGet('/api/admin/signups', admin)).json()).toEqual({
      refusedToday: 3,
      byReason: [
        { reason: 'seen_before', n: 2 },
        { reason: 'disposable', n: 1 },
      ],
    });
  });
});
