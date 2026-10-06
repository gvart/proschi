import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, weekStart } from '../../frontend/src/learn/streak';
import { SESSION_COOKIE } from '../src/auth';
import { hourlyCron } from '../src/cron';
import type { Env } from '../src/env';
import worker from '../src/index';
import { allCards, cardTopics } from '../src/cards';
import { confirmationEmail, reminderEmail } from '../src/emails';
import { confirmToken, localTime, sendReminders } from '../src/reminders';
import { ORIGIN, resetDatabase, signedInUser } from './helpers';

/**
 * Opt-in email reminders (src/reminders.ts), with a fake send_email binding
 * that keeps what it was given: double opt-in, the local-time selection of
 * the hourly cron, its caps, one-click unsubscribe, export and deletion.
 */

interface Sent {
  from: unknown;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

function fakeMail() {
  const sent: Sent[] = [];
  const EMAIL = {
    async send(message: Sent) {
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
  } as unknown as SendEmail;
  return { sent, env: { ...env, EMAIL } as Env };
}

/** A request to the Worker with `withEnv` (the fake binding), as a page on the site sends it. */
async function callWith(withEnv: Env, path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}) {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (method !== 'GET' && !headers.has('Origin')) headers.set('Origin', ORIGIN);
  headers.set('CF-Connecting-IP', `test-${crypto.randomUUID()}`);
  if (init.token) headers.set('Cookie', `${SESSION_COOKIE}=${init.token}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)) });
  return worker.fetch!(request as Parameters<NonNullable<typeof worker.fetch>>[0], withEnv, createExecutionContext());
}

const DAY = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

/** An Etc/GMT zone whose local hour is `hour` at `t` (Etc/GMT-5 is UTC+5). */
function zoneAt(hour: number, t: number): string {
  const h = new Date(t * 1000).getUTCHours();
  let o = (((hour - h) % 24) + 24) % 24;
  if (o > 14) o -= 24;
  return o === 0 ? 'Etc/GMT' : `Etc/GMT${o > 0 ? '-' : '+'}${Math.abs(o)}`;
}

/** A confirmed (or not) reminder address for `userId`, straight in the database. */
async function prefs(userId: string, timeZone: string, { confirmed = true, streak = 1, cards = 1, recap = 1 } = {}) {
  await env.DB.prepare(
    `INSERT INTO email_prefs (user_id, email, confirmed_at, time_zone, streak_on, cards_on, recap_on, unsubscribe_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
  )
    .bind(userId, `${userId}@example.com`, confirmed ? 1 : null, timeZone, streak, cards, recap, `unsub-${userId}`)
    .run();
}

/** A solve on `day` (the user's local date), long ago by the clock: a streak day that is no activity since any email. */
async function solveOn(userId: string, day: string, problem = 'url-shortener') {
  await env.DB.prepare('INSERT INTO progress (user_id, problem_id, runs, first_run_at, updated_at, solved_at, solved_day) VALUES (?, ?, 1, 0, 0, 1, ?)')
    .bind(userId, problem, day)
    .run();
}

/** `n` review cards due before `t`. */
async function dueCards(userId: string, n: number, t: number) {
  await env.DB.batch(
    Array.from({ length: n }, (_, i) =>
      env.DB.prepare(
        'INSERT INTO card_state (user_id, card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at) VALUES (?, ?, 1, ?, 1, 5, 1, 0, 0)',
      ).bind(userId, `card-${i}`, t - 3600),
    ),
  );
}

const row = (userId: string) => env.DB.prepare('SELECT * FROM email_prefs WHERE user_id = ?').bind(userId).first<Record<string, unknown>>();

describe('opting in', () => {
  beforeEach(resetDatabase);

  it('needs a session and a valid address and time zone', async () => {
    const mail = fakeMail();
    expect((await callWith(mail.env, '/api/me/email', { method: 'PUT', body: { email: 'a@example.com', timeZone: 'UTC' } })).status).toBe(401);
    const { token } = await signedInUser();
    expect((await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'not an email', timeZone: 'UTC' } })).status).toBe(400);
    expect((await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'a@example.com', timeZone: 'Mars/Olympus' } })).status).toBe(400);
    expect(mail.sent).toHaveLength(0);
  });

  it('sends a confirmation email, and only the confirm button (not opening the link) confirms', async () => {
    const mail = fakeMail();
    const { id, token } = await signedInUser();
    const put = await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'me@example.com', timeZone: 'Europe/Berlin', recap: false } });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ email: 'me@example.com', confirmed: false, streak: true, cards: true, recap: false, confirmationSent: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: 'me@example.com', subject: 'Confirm your Proschi reminders', from: { name: 'Proschi', email: 'reminders@proschi.app' } });
    const link = /https:\/\/proschi\.app(\/api\/email\/confirm\?token=[^\s"]+)/.exec(mail.sent[0].text)![1];

    const opened = await callWith(mail.env, link);
    expect(opened.status).toBe(200);
    expect(await opened.text()).toContain('Confirm my address');
    expect((await row(id))!.confirmed_at).toBeNull();

    // As a browser sends the confirm page's form: its Referrer-Policy is no-referrer, so the Origin is "null".
    const confirmed = await callWith(mail.env, link, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.text()).toContain('Address confirmed');
    const got = (await (await callWith(mail.env, '/api/me/email', { token })).json()) as Record<string, unknown>;
    expect(got).toMatchObject({ email: 'me@example.com', confirmed: true, timeZone: 'Europe/Berlin' });

    // The same confirmed address again only takes the settings.
    const again = await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'me@example.com', timeZone: 'UTC' } });
    expect(await again.json()).toMatchObject({ confirmed: true, confirmationSent: false, timeZone: 'UTC' });
    expect(mail.sent).toHaveLength(1);
  });

  it('refuses a link for an address changed since, and an expired or forged one', async () => {
    const mail = fakeMail();
    const { id, token } = await signedInUser();
    await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'old@example.com', timeZone: 'UTC' } });
    const oldLink = /(\/api\/email\/confirm\?token=[^\s"]+)/.exec(mail.sent[0].text)![1];
    await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'new@example.com', timeZone: 'UTC' } });
    expect((await callWith(mail.env, oldLink, { method: 'POST' })).status).toBe(400);
    const secretEnv = env as Env & { SESSION_SECRET: string };
    const expired = await confirmToken(secretEnv, id, 'new@example.com', nowS() - 3 * DAY);
    expect((await callWith(mail.env, `/api/email/confirm?token=${encodeURIComponent(expired)}`, { method: 'POST' })).status).toBe(400);
    expect((await callWith(mail.env, `/api/email/confirm?token=abc.def`, { method: 'POST' })).status).toBe(400);
    expect((await row(id))!.confirmed_at).toBeNull();
  });

  it('changes the settings, and removes the address', async () => {
    const mail = fakeMail();
    const { id, token } = await signedInUser();
    await callWith(mail.env, '/api/me/email', { method: 'PUT', token, body: { email: 'me@example.com', timeZone: 'UTC' } });
    const patched = await callWith(mail.env, '/api/me/email', { method: 'PATCH', token, body: { cards: false } });
    expect(await patched.json()).toMatchObject({ streak: true, cards: false, recap: true });
    expect((await callWith(mail.env, '/api/me/email', { method: 'DELETE', token })).status).toBe(204);
    expect(await row(id)).toBeNull();
    expect(await (await callWith(mail.env, '/api/me/email', { token })).json()).toEqual({ email: null });
  });
});

describe('the hourly reminders', () => {
  beforeEach(resetDatabase);

  it('emails a confirmed user at their local evening about a streak at risk, with one-click unsubscribe', async () => {
    const mail = fakeMail();
    const t = nowS();
    const zone = zoneAt(19, t);
    const today = localTime(zone, t)!.day;
    const { id } = await signedInUser();
    await prefs(id, zone);
    await solveOn(id, addDays(today, -1));
    expect(await sendReminders(mail.env, t)).toBe(1);
    const email = mail.sent[0];
    expect(email.to).toBe(`${id}@example.com`);
    expect(email.subject).toBe("🔥 Day 1 streak — don't let it go out");
    expect(email.text).toContain('https://proschi.app/practice/#/review');
    expect(email.text).toContain('streak reminders');
    expect(email.html).toContain('Unsubscribe');
    expect(email.headers).toEqual({
      'List-Unsubscribe': `<https://proschi.app/api/email/unsubscribe?token=unsub-${id}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(await row(id)).toMatchObject({ last_sent_day: today, last_kind: 'streak', ignored_count: 1, paused_at: null });
  });

  it('never emails an unconfirmed address, nor anyone whose local hour is not the evening one', async () => {
    const mail = fakeMail();
    const t = nowS();
    const a = await signedInUser();
    const b = await signedInUser();
    await prefs(a.id, zoneAt(19, t), { confirmed: false });
    await prefs(b.id, zoneAt(16, t));
    for (const { id } of [a, b]) {
      await solveOn(id, addDays(localTime(zoneAt(19, t), t)!.day, -1));
      await dueCards(id, 10, t);
    }
    expect(await sendReminders(mail.env, t)).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('sends cards due from 5 cards on, when there is no streak to save; not when today already met the goal', async () => {
    const mail = fakeMail();
    const t = nowS();
    const zone = zoneAt(19, t);
    const today = localTime(zone, t)!.day;
    const [few, many, done] = [await signedInUser(), await signedInUser(), await signedInUser()];
    for (const u of [few, many, done]) await prefs(u.id, zone);
    await dueCards(few.id, 4, t);
    await dueCards(many.id, 5, t);
    // A streak whose today is done: no streak email, and it falls back to cards (none due).
    await solveOn(done.id, addDays(today, -1), 'a');
    await solveOn(done.id, today, 'b');
    expect(await sendReminders(mail.env, t)).toBe(1);
    expect(mail.sent[0]).toMatchObject({ to: `${many.id}@example.com`, subject: '🧠 5 cards are due — review before they fade' });
  });

  it('sends at most one email a day, and respects the per-type switches', async () => {
    const mail = fakeMail();
    const t = nowS();
    const zone = zoneAt(19, t);
    const today = localTime(zone, t)!.day;
    const a = await signedInUser();
    const off = await signedInUser();
    await prefs(a.id, zone);
    await prefs(off.id, zone, { streak: 0, cards: 0 });
    for (const { id } of [a, off]) {
      await solveOn(id, addDays(today, -1));
      await dueCards(id, 8, t);
    }
    expect(await sendReminders(mail.env, t)).toBe(1);
    expect(mail.sent[0].subject).toContain('streak');
    expect(await sendReminders(mail.env, t + 60)).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it('pauses after three reminders in a row with no practice, says so in the third, and resumes from the account page', async () => {
    const mail = fakeMail();
    const t = nowS();
    const zone = zoneAt(19, t);
    const { id, token } = await signedInUser();
    await prefs(id, zone);
    await dueCards(id, 6, t);
    expect(await sendReminders(mail.env, t)).toBe(1);
    // Practice after the first email starts the count over.
    await env.DB.prepare("INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, day) VALUES ('r-1', ?, 'card-x', 1, 3, ?, '2026-01-01')")
      .bind(id, t + 10)
      .run();
    expect(await sendReminders(mail.env, t + DAY)).toBe(1);
    expect((await row(id))!.ignored_count).toBe(1);
    expect(await sendReminders(mail.env, t + 2 * DAY)).toBe(1);
    expect(await sendReminders(mail.env, t + 3 * DAY)).toBe(1);
    expect(mail.sent[3].text).toContain('we paused your reminders');
    expect(mail.sent[3].subject).toBe('💤 We paused your Proschi reminders');
    expect(mail.sent[3].text).toContain('https://proschi.app/practice/#/me');
    expect(mail.sent[2].text).not.toContain('paused');
    expect((await row(id))!.paused_at).not.toBeNull();
    expect(await sendReminders(mail.env, t + 4 * DAY)).toBe(0);

    const prefsNow = (await (await callWith(mail.env, '/api/me/email', { token })).json()) as Record<string, unknown>;
    expect(prefsNow.paused).toBe(true);
    const resumed = await callWith(mail.env, '/api/me/email', { method: 'PATCH', token, body: { resume: true } });
    expect(await resumed.json()).toMatchObject({ paused: false });
    expect(await sendReminders(mail.env, t + 5 * DAY)).toBe(1);
  });

  it('sends the weekly recap on Monday morning, local time', async () => {
    const mail = fakeMail();
    // The latest Monday 09:17 UTC before now.
    const monday = weekStart(new Date().toISOString().slice(0, 10));
    let t = Date.parse(`${monday}T09:17:00Z`) / 1000;
    if (t > nowS()) t -= 7 * DAY;
    const day = localTime('UTC', t)!.day;
    const { id } = await signedInUser();
    const quiet = await signedInUser();
    await prefs(id, 'UTC');
    await prefs(quiet.id, 'UTC');
    await solveOn(id, addDays(day, -3));
    expect(await sendReminders(mail.env, t)).toBe(1);
    expect(mail.sent[0]).toMatchObject({ to: `${id}@example.com`, subject: '📊 Your Proschi week: 1 goal day' });
    expect(mail.sent[0].text).toContain('1 problem solved');
    expect(mail.sent[0].text).toContain('weekly recap');
  });

  it('runs the daily jobs only in the 03:xx UTC run', async () => {
    const { id } = await signedInUser();
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ('expired', ?, 1, 0)").bind(id).run();
    const count = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'expired'").first<{ n: number }>())!.n;
    await hourlyCron(env, Date.parse('2026-10-05T05:17:00Z'));
    expect(await count()).toBe(1);
    await hourlyCron(env, Date.parse('2026-10-05T03:17:00Z'));
    expect(await count()).toBe(0);
  });
});

describe('unsubscribing, export and deletion', () => {
  beforeEach(resetDatabase);

  it('one-click unsubscribe works without a session or a same-site Origin; opening the link changes nothing', async () => {
    const mail = fakeMail();
    const { id } = await signedInUser();
    await prefs(id, 'UTC');
    const page = await callWith(mail.env, `/api/email/unsubscribe?token=unsub-${id}`);
    expect(await page.text()).toContain(`${id}@example.com`);
    expect(await row(id)).not.toBeNull();
    const response = await callWith(mail.env, `/api/email/unsubscribe?token=unsub-${id}`, {
      method: 'POST',
      headers: { Origin: 'https://mail.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      rawBody: 'List-Unsubscribe=One-Click',
    });
    expect(response.status).toBe(200);
    expect(await row(id)).toBeNull();
    // Again: still fine.
    expect((await callWith(mail.env, `/api/email/unsubscribe?token=unsub-${id}`, { method: 'POST' })).status).toBe(200);
  });

  it('includes the address in the export, without the unsubscribe secret, and deletes it with the account', async () => {
    const mail = fakeMail();
    const { id, token } = await signedInUser();
    await prefs(id, 'Europe/Berlin');
    const data = (await (await callWith(mail.env, '/api/me/export', { token })).json()) as Record<string, any>;
    expect(data.emailReminders).toMatchObject({ email: `${id}@example.com`, timeZone: 'Europe/Berlin', streak: true, cards: true, recap: true, confirmedAt: 1 });
    expect(JSON.stringify(data)).not.toContain(`unsub-${id}`);
    expect((await callWith(mail.env, '/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await row(id)).toBeNull();
  });
});

/** Every URL an email's HTML could load or link: attributes, CSS url()s and bare http(s) URLs. */
function urlsIn(html: string): string[] {
  const found = [
    ...[...html.matchAll(/\b(?:href|src|background|action|poster|srcset)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/url\(\s*['"]?([^'")]+)/gi)].map((m) => m[1]),
    ...[...html.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]),
  ];
  return found.map((u) => u.replace(/&amp;/g, '&'));
}

describe('the emails themselves', () => {
  const origin = 'https://proschi.app';
  const unsubscribeUrl = `${origin}/api/email/unsubscribe?token=tok-123`;
  const recap = { start: '2026-09-28', end: '2026-10-04', reviews: 40, newCards: 5, solves: 2, challenges: 3, runs: 1, goalDays: 5, streak: 9 };
  const reminders = {
    streak: reminderEmail('streak', { streak: { current: 6, today: { day: '2026-10-06', reviews: 2, solves: 0 } }, goal: { reviews: 10, solves: 1 } }, { origin, unsubscribeUrl }),
    cards: reminderEmail('cards', { due: 12, topics: ['Caching', 'Queues'] }, { origin, unsubscribeUrl }),
    recap: reminderEmail('recap', { recap }, { origin, unsubscribeUrl }),
    paused: reminderEmail('cards', { due: 7 }, { origin, unsubscribeUrl, paused: true }),
  };
  const all = { confirmation: confirmationEmail(`${origin}/api/email/confirm?token=abc`), ...reminders };

  it('each has a subject, an HTML body and a complete plain-text body', () => {
    for (const [name, email] of Object.entries(all)) {
      expect(email.subject, name).toBeTruthy();
      expect(email.html, name).toMatch(/^<!doctype html>/);
      expect(email.html, name).toContain(`<title>${email.subject.replace(/'/g, '&#39;')}</title>`);
      expect(email.text.length, name).toBeGreaterThan(100);
      expect(email.text, name).not.toMatch(/<[a-z/!]/i);
      expect(email.text, name).toContain('https://proschi.app/');
    }
    expect(all.confirmation.text).toContain('https://proschi.app/api/email/confirm?token=abc');
    expect(all.confirmation.text).toContain('two days');
    expect(reminders.streak.text).toContain('6-day streak');
    expect(reminders.streak.text).toContain('Do 5 cards (3 min): https://proschi.app/practice/#/review');
    expect(reminders.streak.text).toContain('Kernel');
    expect(reminders.cards.text).toContain('From: Caching, Queues');
    expect(reminders.cards.text).toContain('Review now: https://proschi.app/practice/#/review');
    for (const stat of ['Reviews: 40', 'Solves: 2', 'Challenges: 3', 'Arcade runs: 1', 'Goal days: 5/7', 'Day streak: 9']) expect(reminders.recap.text).toContain(stat);
    expect(reminders.recap.text).toContain('Keep going: https://proschi.app/practice/#/review');
    expect(reminders.paused.text).toContain('we paused your reminders');
  });

  it('each reminder has the unsubscribe link and the account page link, in both bodies', () => {
    for (const [name, email] of Object.entries(reminders)) {
      expect(email.text, name).toContain(`Unsubscribe from all Proschi emails: ${unsubscribeUrl}`);
      expect(email.html, name).toContain(`href="${unsubscribeUrl}"`);
      expect(email.html, name).toContain('href="https://proschi.app/practice/#/me"');
      expect(email.text, name).toContain('You got this because');
    }
  });

  it('loads nothing and links nowhere but proschi.app', () => {
    for (const [name, email] of Object.entries(all)) {
      const urls = urlsIn(email.html);
      expect(urls.length, name).toBeGreaterThan(0);
      for (const url of urls) expect(url, name).toMatch(/^https:\/\/proschi\.app\//);
      expect(email.html, name).not.toMatch(/<(img|link|script|iframe)\b/i);
      expect(email.html, name).not.toMatch(/@import|@font-face/i);
    }
  });

  it('escapes what it shows', () => {
    const email = reminderEmail('cards', { due: 6, topics: ['<b>x</b>'] }, { origin, unsubscribeUrl: `${origin}/api/email/unsubscribe?token=a"b` });
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(email.html).not.toContain('token=a"b');
  });
});

describe('what the reminders and pages show', () => {
  beforeEach(resetDatabase);

  it("names the due cards' topics in a cards-due reminder", async () => {
    const mail = fakeMail();
    const t = nowS();
    const { id } = await signedInUser();
    await prefs(id, zoneAt(19, t));
    const picked = [...allCards().values()].filter((c) => !c.retired).slice(0, 6);
    await env.DB.batch(
      picked.map((c) =>
        env.DB.prepare(
          'INSERT INTO card_state (user_id, card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at) VALUES (?, ?, 1, ?, 1, 5, 1, 0, 0)',
        ).bind(id, c.id, t - 3600),
      ),
    );
    expect(await sendReminders(mail.env, t)).toBe(1);
    const title = cardTopics().find((topic) => topic.id === picked[0].topic)!.title;
    expect(mail.sent[0].text).toContain(`From: ${title}`);
  });

  it('the confirm and unsubscribe pages keep their strict CSP: no scripts, nothing external', async () => {
    const mail = fakeMail();
    const { id } = await signedInUser();
    await prefs(id, 'UTC');
    const response = await callWith(mail.env, `/api/email/unsubscribe?token=unsub-${id}`);
    const csp = response.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    const html = await response.text();
    expect(html).toContain('Kernel');
    expect(html).not.toMatch(/<(script|img|link)\b/i);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
