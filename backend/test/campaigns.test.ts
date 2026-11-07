import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COOKIE } from '../src/adminAuth';
import { SESSION_COOKIE } from '../src/auth';
import { renderMarkdown } from '../src/campaignMarkdown';
import { countAudience, readUnsubscribeToken, runCampaigns, unsubscribeUrl, UNSUBSCRIBE_TTL } from '../src/campaigns';
import { saveContactEmail } from '../src/contactEmail';
import { buckets } from '../src/credits';
import type { Env } from '../src/env';
import worker from '../src/index';
import { call, ORIGIN, resetDatabase, signedInUser } from './helpers';
import { createPasskey } from './webauthn';

/**
 * Admin campaigns (src/campaigns.ts): audiences and their counts, credit
 * grants and emails once per account (also on retry and resume), opt-outs,
 * the unsubscribe link, test sends, the daily cap, the audit log, in-app
 * announcements, and the Markdown kept safe.
 */

const SETUP_TOKEN = 'test-admin-setup-token-0123456789';

interface Sent {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

function fakeMail({ failFor }: { failFor?: string } = {}) {
  const sent: Sent[] = [];
  const EMAIL = {
    async send(message: Sent) {
      if (message.to === failFor) throw new Error(`refused ${message.to}`);
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
  } as unknown as SendEmail;
  return { sent, env: { ...env, EMAIL, ADMIN_EMAIL: 'admin@example.com' } as Env };
}

/** A request to the Worker with `withEnv`, waiting for its background work (the send's waitUntil). */
async function callWith(withEnv: Env, path: string, init: { method?: string; admin?: string; token?: string; body?: unknown; origin?: string | null } = {}) {
  const method = init.method ?? 'GET';
  const headers = new Headers();
  if (method !== 'GET' && init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  headers.set('CF-Connecting-IP', `test-${crypto.randomUUID()}`);
  const cookies = [init.admin ? `${ADMIN_COOKIE}=${init.admin}` : '', init.token ? `${SESSION_COOKIE}=${init.token}` : ''].filter(Boolean);
  if (cookies.length) headers.set('Cookie', cookies.join('; '));
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const exec = createExecutionContext();
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const response = await worker.fetch!(request as Parameters<NonNullable<typeof worker.fetch>>[0], withEnv, exec);
  await waitOnExecutionContext(exec);
  return response;
}

async function setUpAdmin(): Promise<string> {
  const passkey = await createPasskey();
  const options = (await (await call('/api/admin/setup/options', { method: 'POST', body: { setupToken: SETUP_TOKEN } })).json()) as { challenge: string; rp: { id: string } };
  const response = await call('/api/admin/setup', { method: 'POST', body: { setupToken: SETUP_TOKEN, name: 'Laptop', response: await passkey.register(options, ORIGIN) } });
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_COOKIE}=`))!;
  return cookie.split(';')[0].split('=')[1];
}

const nowS = () => Math.floor(Date.now() / 1000);

/** A confirmed (or not) email sign-in address for the account. */
async function emailLogin(userId: string, email: string, confirmed = true) {
  await env.DB.prepare('INSERT INTO email_logins (user_id, email, normalized, password_hash, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, 0)')
    .bind(userId, email, email, 'x', confirmed ? 1 : null)
    .run();
}

async function user(name: string, { email, contact, optOut, plan, createdAt, lastSeen }: { email?: string; contact?: string; optOut?: boolean; plan?: string; createdAt?: number; lastSeen?: string } = {}) {
  const u = await signedInUser(name);
  if (email) await emailLogin(u.id, email);
  if (contact) await saveContactEmail(env as Env, u.id, 'github', contact);
  if (optOut) await env.DB.prepare("INSERT INTO news_optouts (user_id, at, via) VALUES (?, 1, 'settings')").bind(u.id).run();
  if (plan) await env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, u.id).run();
  if (createdAt !== undefined) await env.DB.prepare('UPDATE users SET created_at = ? WHERE id = ?').bind(createdAt, u.id).run();
  if (lastSeen) await env.DB.prepare('UPDATE users SET last_seen_day = ? WHERE id = ?').bind(lastSeen, u.id).run();
  return u;
}

const draft = (over: Record<string, unknown> = {}) => ({
  audience: { type: 'all' },
  credits: 150,
  email: true,
  inapp: true,
  subject: 'New on Proschi',
  body: 'Hi {{name}}, **{{credits}} credits** are on your account.',
  ...over,
});

async function create(m: ReturnType<typeof fakeMail>, admin: string, over: Record<string, unknown> = {}): Promise<string> {
  const response = await callWith(m.env, '/api/admin/campaigns', { method: 'POST', admin, body: draft(over) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

const send = (m: ReturnType<typeof fakeMail>, admin: string, id: string, reason = 'Launch gift') =>
  callWith(m.env, `/api/admin/campaigns/${id}/send`, { method: 'POST', admin, body: { reason } });

async function recipients(id: string) {
  return (await env.DB.prepare('SELECT user_id, granted, email_status, done_at FROM campaign_recipients WHERE campaign_id = ?').bind(id).all<{ user_id: string; granted: number; email_status: string | null; done_at: number | null }>()).results;
}

const campaignGrants = async () => (await env.DB.prepare("SELECT user_id, delta_mc, bucket, ref_id FROM credits WHERE kind = 'admin_grant'").all<{ user_id: string; delta_mc: number; bucket: string; ref_id: string }>()).results;

async function audit(action: string) {
  return (await env.DB.prepare('SELECT target, detail, passkey_id FROM admin_audit WHERE action = ? ORDER BY id').bind(action).all<{ target: string | null; detail: string | null; passkey_id: string | null }>()).results;
}

describe('admin campaigns', () => {
  let admin: string;
  beforeEach(async () => {
    await resetDatabase();
    admin = await setUpAdmin();
  });

  it('needs an admin session for every route (a user session is not one), and this site’s Origin for changes', async () => {
    const m = fakeMail();
    const { token } = await signedInUser();
    const routes: [string, string][] = [
      ['GET', '/api/admin/campaigns'],
      ['POST', '/api/admin/campaigns'],
      ['GET', '/api/admin/campaigns/x'],
      ['PUT', '/api/admin/campaigns/x'],
      ['POST', '/api/admin/campaigns/audience'],
      ['POST', '/api/admin/campaigns/preview'],
      ['POST', '/api/admin/campaigns/test'],
      ['POST', '/api/admin/campaigns/x/send'],
      ['POST', '/api/admin/campaigns/x/cancel'],
      ['POST', '/api/admin/campaigns/x/resume'],
    ];
    for (const [method, path] of routes) {
      const response = await callWith(m.env, path, { method, token, body: method === 'GET' ? undefined : draft({ reason: 'x' }) });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    const foreign = await callWith(m.env, '/api/admin/campaigns', { method: 'POST', admin, body: draft(), origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM campaigns').first('n')).toBe(0);
  });

  it('counts each audience, and who an email reaches or skips', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const old = Date.parse('2026-01-15T00:00:00Z') / 1000;
    await user('a', { email: 'a@example.com', lastSeen: today, createdAt: old });
    await user('b', { contact: 'b@example.com', plan: 'pro' });
    await user('c', { email: 'c@example.com', optOut: true, plan: 'max' });
    const d = await user('d');
    await emailLogin((await user('e')).id, 'e@example.com', false);
    // A reminders address is never used for product news.
    await env.DB.prepare("INSERT INTO email_prefs (user_id, email, confirmed_at, time_zone, unsubscribe_token, created_at, updated_at) VALUES (?, 'd@example.com', 1, 'UTC', 'u-d', 0, 0)").bind(d.id).run();
    const blocked = await user('blocked', { email: 'z@example.com' });
    await env.DB.prepare('UPDATE users SET blocked_at = 1 WHERE id = ?').bind(blocked.id).run();
    const comped = await user('comped');
    await env.DB.prepare('UPDATE users SET comp_until = ? WHERE id = ?').bind(nowS() + 86_400, comped.id).run();

    expect(await countAudience(env.DB, { type: 'all' })).toEqual({ accounts: 6, emails: 2, optedOut: 1, unconfirmed: 3 });
    expect((await countAudience(env.DB, { type: 'plan', plan: 'pro' })).accounts).toBe(2);
    expect((await countAudience(env.DB, { type: 'plan', plan: 'max' })).accounts).toBe(1);
    expect((await countAudience(env.DB, { type: 'plan', plan: 'free' })).accounts).toBe(3);
    expect((await countAudience(env.DB, { type: 'active', days: 7 })).accounts).toBe(1);
    expect((await countAudience(env.DB, { type: 'signup', before: '2026-02-01' })).accounts).toBe(6);
    expect((await countAudience(env.DB, { type: 'signup', after: '2026-01-15' })).accounts).toBe(1);
    expect((await countAudience(env.DB, { type: 'signup', after: '2026-01-16' })).accounts).toBe(0);
    expect(await countAudience(env.DB, { type: 'user', id: d.id })).toEqual({ accounts: 1, emails: 0, optedOut: 0, unconfirmed: 1 });

    const m = fakeMail();
    const response = await callWith(m.env, '/api/admin/campaigns/audience', { method: 'POST', admin, body: { audience: { type: 'plan', plan: 'pro' } } });
    expect(await response.json()).toEqual({ accounts: 2, emails: 1, optedOut: 0, unconfirmed: 1 });
    expect((await callWith(m.env, '/api/admin/campaigns/audience', { method: 'POST', admin, body: { audience: { type: 'active', days: 0 } } })).status).toBe(400);
  });

  it('grants top-up credits and emails each account once, skipping opted-out and unconfirmed ones, and audits it', async () => {
    const a = await user('Ada', { email: 'a@example.com' });
    const b = await user('Bo', { contact: 'b@example.com' });
    const c = await user('Cy', { email: 'c@example.com', optOut: true });
    const d = await user('Di');
    const m = fakeMail();
    const id = await create(m, admin);
    expect((await send(m, admin, id, '')).status).toBe(400);
    const response = await send(m, admin, id);
    expect(response.status).toBe(200);

    expect(m.sent.map((s) => s.to).sort()).toEqual(['a@example.com', 'b@example.com']);
    const ada = m.sent.find((s) => s.to === 'a@example.com')!;
    expect(ada.subject).toBe('New on Proschi');
    expect(ada.text).toContain('Hi Ada, 150 credits are on your account.');
    expect(ada.html).toContain('<strong>150 credits</strong>');
    expect(ada.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(ada.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/proschi\.app\/api\/news\/unsubscribe\?token=.+>$/);
    expect(ada.text).toContain('Stop product news');

    const grants = await campaignGrants();
    expect(grants).toHaveLength(4);
    for (const g of grants) {
      expect(g).toMatchObject({ delta_mc: 150_000, bucket: 'topup', ref_id: `campaign:${id}:${g.user_id}` });
    }
    expect((await buckets(env, d.id)).topup).toBe(150_000);
    const rows = new Map((await recipients(id)).map((r) => [r.user_id, r]));
    expect(rows.get(a.id)).toMatchObject({ granted: 1, email_status: 'sent' });
    expect(rows.get(b.id)).toMatchObject({ granted: 1, email_status: 'sent' });
    expect(rows.get(c.id)).toMatchObject({ granted: 1, email_status: 'skipped_optout' });
    expect(rows.get(d.id)).toMatchObject({ granted: 1, email_status: 'skipped_unconfirmed' });

    const detail = (await (await callWith(m.env, `/api/admin/campaigns/${id}`, { admin })).json()) as { status: string; stats: Record<string, number> };
    expect(detail.status).toBe('done');
    expect(detail.stats).toMatchObject({ recipients: 4, pending: 0, granted: 4, sent: 2, failed: 0, skippedOptout: 1, skippedUnconfirmed: 1 });

    // Sending again, resuming, or another cron run changes nothing.
    expect((await send(m, admin, id)).status).toBe(409);
    expect((await callWith(m.env, `/api/admin/campaigns/${id}/resume`, { method: 'POST', admin, body: { reason: 'again' } })).status).toBe(409);
    await runCampaigns(m.env);
    expect(m.sent).toHaveLength(2);
    expect(await campaignGrants()).toHaveLength(4);

    const [created] = await audit('campaign.create');
    expect(created.target).toBe(id);
    expect(created.passkey_id).not.toBeNull();
    const [sent] = await audit('campaign.send');
    expect(JSON.parse(sent.detail!)).toMatchObject({ reason: 'Launch gift', recipients: 4, credits: 150 });
  });

  it('resumes a cancelled campaign without granting or emailing anyone twice, and never retries an interrupted email', async () => {
    const users: { id: string; token: string }[] = [];
    for (let i = 0; i < 4; i++) users.push(await user(`u${i}`, { email: `u${i}@example.com` }));
    const m = fakeMail();
    const id = await create(m, admin);
    // Sent, but cancelled before the background run: nobody is processed.
    await env.DB.prepare("UPDATE campaigns SET status = 'draft' WHERE id = ?").bind(id).run();
    const t = nowS();
    await env.DB.batch([
      env.DB.prepare("UPDATE campaigns SET status = 'cancelled', started_at = ?, reason = 'x' WHERE id = ?").bind(t, id),
      env.DB.prepare('INSERT INTO campaign_recipients (campaign_id, user_id) SELECT ?, id FROM users').bind(id),
      // u0 was granted and emailed by an earlier run; u1's email was going out when that run died.
      env.DB.prepare("UPDATE campaign_recipients SET granted = 1, email_status = 'sent', at = ?, done_at = ? WHERE user_id = ?").bind(t, t, users[0].id),
      env.DB.prepare("UPDATE campaign_recipients SET granted = 1, email_status = 'sending', at = ? WHERE user_id = ?").bind(t - 3600, users[1].id),
      ...[0, 1].map((i) =>
        env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at) VALUES (?, 'admin_grant', 'topup', '', 150000, 'campaign', ?, 0)").bind(users[i].id, `campaign:${id}:${users[i].id}`),
      ),
      // u2 was granted, but the run stopped before marking it: the grant is not given again.
      env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at) VALUES (?, 'admin_grant', 'topup', '', 150000, 'campaign', ?, 0)").bind(users[2].id, `campaign:${id}:${users[2].id}`),
    ]);
    await runCampaigns(m.env);
    expect(m.sent).toHaveLength(0);

    expect((await callWith(m.env, `/api/admin/campaigns/${id}/resume`, { method: 'POST', admin, body: {} })).status).toBe(400);
    expect((await callWith(m.env, `/api/admin/campaigns/${id}/resume`, { method: 'POST', admin, body: { reason: 'Go on' } })).status).toBe(200);
    expect(m.sent.map((s) => s.to).sort()).toEqual(['u2@example.com', 'u3@example.com']);
    const grants = await campaignGrants();
    expect(grants).toHaveLength(4);
    expect(new Set(grants.map((g) => g.user_id)).size).toBe(4);
    const rows = new Map((await recipients(id)).map((r) => [r.user_id, r]));
    expect(rows.get(users[1].id)?.email_status).toBe('failed');
    expect((await env.DB.prepare('SELECT status FROM campaigns WHERE id = ?').bind(id).first('status'))).toBe('done');
    expect(await audit('campaign.resume')).toHaveLength(1);
  });

  it('cancels with a reason; the background run stops at the next batch', async () => {
    await user('a', { email: 'a@example.com' });
    const m = fakeMail();
    const id = await create(m, admin);
    expect((await callWith(m.env, `/api/admin/campaigns/${id}/cancel`, { method: 'POST', admin, body: { reason: 'Typo' } })).status).toBe(200);
    expect((await send(m, admin, id)).status).toBe(409);
    expect(m.sent).toHaveLength(0);
    expect(JSON.parse((await audit('campaign.cancel'))[0].detail!)).toEqual({ reason: 'Typo' });
  });

  it('records a failed send and goes on', async () => {
    await user('a', { email: 'a@example.com' });
    await user('b', { email: 'b@example.com' });
    const m = fakeMail({ failFor: 'a@example.com' });
    const id = await create(m, admin, { credits: 0, body: 'Hello {{name}}' });
    await send(m, admin, id);
    expect(m.sent.map((s) => s.to)).toEqual(['b@example.com']);
    const detail = (await (await callWith(m.env, `/api/admin/campaigns/${id}`, { admin })).json()) as { stats: Record<string, number> };
    expect(detail.stats).toMatchObject({ sent: 1, failed: 1, granted: 0 });
    expect(await campaignGrants()).toHaveLength(0);
  });

  it('stops at the daily cap and sends the rest on a later run', async () => {
    for (let i = 0; i < 3; i++) await user(`u${i}`, { email: `u${i}@example.com` });
    const m = fakeMail();
    const capped = { ...m.env, CAMPAIGN_DAILY_CAP: '2' } as Env;
    const id = await create(m, admin, { credits: 0, body: 'Hi' });
    await callWith(capped, `/api/admin/campaigns/${id}/send`, { method: 'POST', admin, body: { reason: 'News' } });
    expect(m.sent).toHaveLength(2);
    await runCampaigns(capped);
    expect(m.sent).toHaveLength(2);
    expect(await env.DB.prepare('SELECT status FROM campaigns WHERE id = ?').bind(id).first('status')).toBe('sending');
    // Tomorrow.
    await runCampaigns(capped, { t: nowS() + 86_400 });
    expect(m.sent).toHaveLength(3);
    expect(new Set(m.sent.map((s) => s.to)).size).toBe(3);
  });

  it('a credits-only campaign emails nobody; an email-only one grants nothing', async () => {
    await user('a', { email: 'a@example.com' });
    const m = fakeMail();
    const id = await create(m, admin, { email: false, inapp: false, body: '' });
    await send(m, admin, id);
    expect(m.sent).toHaveLength(0);
    expect(await campaignGrants()).toHaveLength(1);
    expect((await recipients(id))[0]).toMatchObject({ granted: 1, email_status: null });
    const bad = await callWith(m.env, '/api/admin/campaigns', { method: 'POST', admin, body: draft({ credits: 0 }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain('{{credits}}');
  });

  it('sends a test to the admin’s own address only, and grants nothing', async () => {
    await user('a', { email: 'a@example.com' });
    const m = fakeMail();
    const response = await callWith(m.env, '/api/admin/campaigns/test', { method: 'POST', admin, body: draft() });
    expect(response.status).toBe(200);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ to: 'admin@example.com', subject: '[Test] New on Proschi' });
    expect(m.sent[0].text).toContain('Hi Ada, 150 credits');
    expect(await campaignGrants()).toHaveLength(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_recipients').first('n')).toBe(0);
    expect(await audit('campaign.test')).toHaveLength(1);
    const noAddress = await callWith({ ...m.env, ADMIN_EMAIL: undefined } as Env, '/api/admin/campaigns/test', { method: 'POST', admin, body: draft() });
    expect(noAddress.status).toBe(501);
  });

  it('only changes a draft, and audits each change', async () => {
    const m = fakeMail();
    const id = await create(m, admin);
    const put = await callWith(m.env, `/api/admin/campaigns/${id}`, { method: 'PUT', admin, body: draft({ subject: 'Second try' }) });
    expect(((await put.json()) as { subject: string }).subject).toBe('Second try');
    expect(await audit('campaign.update')).toHaveLength(1);
    await send(m, admin, id);
    expect((await callWith(m.env, `/api/admin/campaigns/${id}`, { method: 'PUT', admin, body: draft() })).status).toBe(409);
    expect((await callWith(m.env, '/api/admin/campaigns', { method: 'POST', admin, body: draft({ subject: 'Hi {{nmae}}' }) })).status).toBe(400);
    const list = (await (await callWith(m.env, '/api/admin/campaigns', { admin })).json()) as { campaigns: { id: string }[]; dailyCap: number; testAddress: string };
    expect(list.campaigns.map((c) => c.id)).toEqual([id]);
    expect(list.dailyCap).toBe(500);
    expect(list.testAddress).toBe('a***@example.com');
  });
});

describe('product news: opting out', () => {
  beforeEach(resetDatabase);

  it('the unsubscribe link: GET only shows the button; POST (one-click, no session, no Origin) records the opt-out; forged and expired links do nothing', async () => {
    const m = fakeMail();
    const u = await user('a', { email: 'a@example.com' });
    const link = new URL(await unsubscribeUrl(m.env, u.id, 'camp-1'));
    const path = `${link.pathname}${link.search}`;
    const page = await callWith(m.env, path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Stop product news');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM news_optouts').first('n')).toBe(0);

    const forged = await callWith(m.env, `${path.slice(0, -3)}abc`, { method: 'POST', origin: null });
    expect(forged.status).toBe(400);
    const token = link.searchParams.get('token');
    expect(await readUnsubscribeToken(m.env, token, nowS() + UNSUBSCRIBE_TTL + 10)).toBeUndefined();
    expect(await readUnsubscribeToken(m.env, token)).toEqual({ u: u.id, c: 'camp-1' });
    const expired = new URL(await unsubscribeUrl(m.env, u.id, 'camp-1', nowS() - UNSUBSCRIBE_TTL - 10));
    expect((await callWith(m.env, `${expired.pathname}${expired.search}`, { method: 'POST', origin: null })).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM news_optouts').first('n')).toBe(0);

    const ok = await callWith(m.env, path, { method: 'POST', origin: null });
    expect(ok.status).toBe(200);
    expect(await env.DB.prepare('SELECT via FROM news_optouts WHERE user_id = ?').bind(u.id).first('via')).toBe('link:camp-1');
    expect((await callWith(m.env, path, { method: 'POST', origin: null })).status).toBe(200);
  });

  it('Settings turns product news off and on, and says where it goes', async () => {
    const m = fakeMail();
    const u = await user('a', { contact: 'Me@Example.com' });
    const get = async () => (await callWith(m.env, '/api/me/news', { token: u.token })).json();
    expect(await get()).toEqual({ on: true, email: 'me@example.com', source: 'github' });
    await emailLogin(u.id, 'login@example.com');
    expect(await get()).toEqual({ on: true, email: 'login@example.com', source: 'email' });
    const off = await callWith(m.env, '/api/me/news', { method: 'PUT', token: u.token, body: { on: false } });
    expect(await off.json()).toMatchObject({ on: false });
    expect(await countAudience(env.DB, { type: 'all' })).toMatchObject({ emails: 0, optedOut: 1 });
    await callWith(m.env, '/api/me/news', { method: 'PUT', token: u.token, body: { on: true } });
    expect(await get()).toMatchObject({ on: true });
    expect((await call('/api/me/news')).status).toBe(401);
    const exported = (await (await call('/api/me/export', { token: u.token })).json()) as { news: { productNews: { on: boolean }; contactEmail: { email: string } } };
    expect(exported.news).toMatchObject({ productNews: { on: true }, contactEmail: { email: 'me@example.com', provider: 'github' } });
  });
});

describe('in-app announcements', () => {
  beforeEach(resetDatabase);

  it('shows the newest undismissed one (with the credits once granted), counts shown, dismissed and clicked', async () => {
    const admin = await setUpAdmin();
    const m = fakeMail();
    const u = await user('Ada');
    const first = await create(m, admin, { email: false, subject: 'First', body: 'One' , credits: 0});
    await send(m, admin, first);
    const second = await create(m, admin, { email: false, subject: 'Second {{name}}', body: 'You got {{credits}}', linkUrl: 'https://proschi.app/pricing/', linkLabel: 'See plans' });
    // Sent a second later, so it is the newest.
    await send(m, admin, second);
    await env.DB.prepare('UPDATE campaigns SET started_at = started_at + 1 WHERE id = ?').bind(second).run();

    const get = async () => ((await (await callWith(m.env, '/api/me/announcement', { token: u.token })).json()) as { announcement: Record<string, unknown> | null }).announcement;
    expect(await get()).toMatchObject({ id: second, title: 'Second {{name}}', body: 'You got {{credits}}', credits: 150, link: { url: 'https://proschi.app/pricing/', label: 'See plans' }, values: { name: 'Ada', credits: '150' } });
    expect((await callWith(m.env, `/api/me/announcement/${second}/click`, { method: 'POST', token: u.token })).status).toBe(204);
    expect(await get()).toMatchObject({ id: first, credits: null });
    await callWith(m.env, `/api/me/announcement/${first}/dismiss`, { method: 'POST', token: u.token });
    expect(await get()).toBeNull();

    const list = (await (await callWith(m.env, '/api/admin/campaigns', { admin })).json()) as { campaigns: { id: string; stats: Record<string, number> }[] };
    expect(list.campaigns.find((c) => c.id === second)!.stats).toMatchObject({ shown: 1, dismissed: 1, clicked: 1 });
    expect(list.campaigns.find((c) => c.id === first)!.stats).toMatchObject({ shown: 1, dismissed: 1, clicked: 0 });
    expect((await call('/api/me/announcement')).status).toBe(401);
  });

  it('keeps announcements of other accounts and of cancelled campaigns away', async () => {
    const admin = await setUpAdmin();
    const m = fakeMail();
    const a = await user('a');
    const id = await create(m, admin, { email: false, credits: 0, body: 'Hi', audience: { type: 'user', id: a.id } });
    await send(m, admin, id);
    const b = await user('b');
    expect(((await (await callWith(m.env, '/api/me/announcement', { token: b.token })).json()) as { announcement: unknown }).announcement).toBeNull();
    await env.DB.prepare("UPDATE campaigns SET status = 'cancelled' WHERE id = ?").bind(id).run();
    expect(((await (await callWith(m.env, '/api/me/announcement', { token: a.token })).json()) as { announcement: unknown }).announcement).toBeNull();
  });
});

describe('campaign Markdown', () => {
  const values = { name: '<img src=x onerror=alert(1)> [x](https://evil.example)', credits: '150' };

  it('escapes HTML in the source and in the placeholders', () => {
    const { html, text } = renderMarkdown('<script>alert(1)</script>\n\nHi {{name}}, <b>{{credits}}</b>', values);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // The name's Markdown is not rendered: no link from a display name.
    expect(html).not.toContain('href="https://evil.example"');
    expect(text).toContain('Hi <img src=x onerror=alert(1)> [x](https://evil.example), <b>150</b>');
  });

  it('renders the subset, and keeps only https and mailto links', () => {
    const { html, text } = renderMarkdown('## New\n\n- **bold** and *it*\n- `code`\n\n[Plans](https://proschi.app/pricing/) [bad](javascript:alert(1)) [q](https://x.test/"onmouseover=)', values);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<li');
    expect(html).toContain('href="https://proschi.app/pricing/"');
    expect(html).not.toContain('javascript:alert(1)"');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toMatch(/href="[^"]*"onmouseover/);
    expect(text).toContain('Plans (https://proschi.app/pricing/)');
  });
});

describe('the contact address of a GitHub or Google sign-in', () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  function mockGithub(emails: unknown[]) {
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gh-token' });
      if (url === 'https://api.github.com/user') return Response.json({ id: 4242, login: 'octo' });
      if (url === 'https://api.github.com/user/emails') return Response.json(emails);
      return real(input, init);
    });
  }

  async function signIn() {
    const startRequest = new Request(`${ORIGIN}/auth/github/start?return=/`, { headers: { 'CF-Connecting-IP': `test-${crypto.randomUUID()}` }, redirect: 'manual' });
    const start = await worker.fetch!(startRequest as Parameters<NonNullable<typeof worker.fetch>>[0], env as Env, createExecutionContext());
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    const request = new Request(`${ORIGIN}/auth/github/callback?code=c&state=${state}`, { headers: { Cookie: cookie, 'CF-Connecting-IP': `test-${crypto.randomUUID()}` }, redirect: 'manual' });
    await worker.fetch!(request as Parameters<NonNullable<typeof worker.fetch>>[0], env as Env, createExecutionContext());
  }

  it('is saved on every sign-in (the primary verified one), and is never a sign-in identity', async () => {
    mockGithub([{ email: 'Octo@Example.com', primary: true, verified: true }]);
    await signIn();
    const row = await env.DB.prepare('SELECT user_id, email, provider FROM contact_emails').first<{ user_id: string; email: string; provider: string }>();
    expect(row).toMatchObject({ email: 'octo@example.com', provider: 'github' });
    vi.restoreAllMocks();
    mockGithub([{ email: 'new@example.com', primary: true, verified: true }]);
    await signIn();
    expect(await env.DB.prepare('SELECT email FROM contact_emails WHERE user_id = ?').bind(row!.user_id).first('email')).toBe('new@example.com');
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'email'").first('n')).toBe(0);
    // Deleted with the account.
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(row!.user_id).run();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM contact_emails').first('n')).toBe(0);
  });

  it('is not saved without a verified primary address', async () => {
    mockGithub([{ email: 'x@example.com', primary: true, verified: false }]);
    await signIn();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM contact_emails').first('n')).toBe(0);
  });
});
