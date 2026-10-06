import { computeStreak, goalFor, recapIsEmpty, weeklyRecap, type Streak, type WeeklyRecap } from '../../frontend/src/learn/streak';
import { loadActivity } from './activity';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { decodeJson, encodeJson, randomToken, sign, unsign } from './crypto';
import { render, sendEmail, emailConfigured, type Block } from './email';
import { now, secretOk, type Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { countEvents } from './metrics';

/**
 * Opt-in email reminders (backend/README.md "Email reminders",
 * docs/PRIVACY.md): a signed-in user gives an address on the account page,
 * follows the confirmation link sent to it (double opt-in), and from then on
 * gets at most one email a day, in their local evening:
 *
 *   - streak at risk: a streak of at least a day, and today's goal not met yet;
 *   - cards due: at least DUE_CARDS_MIN review cards due (when no streak email went out);
 *   - weekly recap: Monday morning, last week's totals (the recap of GET /api/me/activity).
 *
 * Three reminders in a row with no practice in between pause them (the third
 * says so); the account page resumes them. Every reminder has a one-click
 * unsubscribe link (RFC 8058), which deletes the address.
 *
 *   GET    /api/me/email                    the address and settings ({email: null} without one)
 *   PUT    /api/me/email {email, timeZone, streak?, cards?, recap?}   sets the address; a new one gets a confirmation email
 *   PATCH  /api/me/email {streak?, cards?, recap?, timeZone?, resume?}   the settings; resume: true after a pause
 *   DELETE /api/me/email                    removes the address
 *   GET    /api/email/confirm?token=        a page with the button that confirms the address
 *   POST   /api/email/confirm?token=        confirms it
 *   GET    /api/email/unsubscribe?token=    a page with the unsubscribe button
 *   POST   /api/email/unsubscribe?token=    one-click unsubscribe (no session; the token is the credential)
 *
 * The GET pages change nothing: mail scanners open links, and must not
 * confirm or unsubscribe anyone by doing so.
 */

/** A confirmation link works this long (seconds). */
export const CONFIRM_TTL = 2 * 86_400;
/** The local hour of the evening reminders and of the weekly recap (Mondays). */
export const REMINDER_HOUR = 19;
export const RECAP_HOUR = 9;
/** A cards-due reminder needs at least this many cards due. */
export const DUE_CARDS_MIN = 5;
/** Reminders in a row without practice before they pause. */
export const PAUSE_AFTER = 3;
/** Users read per query in the cron, and the most emails one cron run sends. */
const PAGE = 100;
export const MAX_PER_RUN = 500;
const MAX_EMAIL = 254;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Where the links in emails point. */
export const siteOrigin = (env: Env) => (env.ENVIRONMENT === 'staging' ? 'https://staging.proschi.app' : 'https://proschi.app');

/** A plausible address: one @, no spaces or angle brackets, a dot in the domain. */
export function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_EMAIL && /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/.test(value);
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
      });
    } catch {
      f = null;
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** Whether `value` is an IANA time zone the runtime knows. */
export function isTimeZone(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && formatter(value) !== null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The local date, hour (0–23) and weekday (0 Sunday) at Unix time `t` in `timeZone`; undefined for an unknown zone. */
export function localTime(timeZone: string, t: number): { day: string; hour: number; weekday: number } | undefined {
  const f = formatter(timeZone);
  if (!f) return undefined;
  const parts = Object.fromEntries(f.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, weekday: WEEKDAYS.indexOf(parts.weekday) };
}

interface PrefsRow {
  user_id: string;
  email: string;
  confirmed_at: number | null;
  confirm_sent_at: number | null;
  time_zone: string;
  streak_on: number;
  cards_on: number;
  recap_on: number;
  unsubscribe_token: string;
  last_sent_day: string | null;
  last_sent_at: number | null;
  last_kind: string | null;
  ignored_count: number;
  paused_at: number | null;
  created_at: number;
  updated_at: number;
}

/** What the account page shows. */
function prefsOf(row: PrefsRow | null) {
  if (!row) return { email: null };
  return {
    email: row.email,
    confirmed: row.confirmed_at !== null,
    timeZone: row.time_zone,
    streak: row.streak_on === 1,
    cards: row.cards_on === 1,
    recap: row.recap_on === 1,
    paused: row.paused_at !== null,
  };
}

const readPrefs = (DB: D1Database, userId: string) => DB.prepare('SELECT * FROM email_prefs WHERE user_id = ?').bind(userId).first<PrefsRow>();

/** The confirmation token's key: the session secret, kept apart from its other uses. */
const confirmKey = (secret: string) => `${secret}/email-confirm`;

/** A signed token for confirming `email` for `userId`, valid CONFIRM_TTL. */
export async function confirmToken(env: Env & { SESSION_SECRET: string }, userId: string, email: string, t = now()): Promise<string> {
  return sign(encodeJson({ u: userId, e: email, x: t + CONFIRM_TTL }), confirmKey(env.SESSION_SECRET));
}

async function readConfirmToken(env: Env, token: string | null): Promise<{ u: string; e: string } | undefined> {
  if (!token || token.length > 2048 || !secretOk(env)) return undefined;
  const value = await unsign(token, confirmKey(env.SESSION_SECRET));
  const payload = value === undefined ? undefined : (decodeJson(value) as { u?: unknown; e?: unknown; x?: unknown } | undefined);
  if (!payload || typeof payload.u !== 'string' || typeof payload.e !== 'string' || typeof payload.x !== 'number' || payload.x < now()) return undefined;
  return { u: payload.u, e: payload.e };
}

/** Sends the confirmation email for the address in `row`. */
async function sendConfirmation(env: Env & { SESSION_SECRET: string }, userId: string, email: string): Promise<void> {
  const link = `${siteOrigin(env)}/api/email/confirm?token=${encodeURIComponent(await confirmToken(env, userId, email))}`;
  const { text, html } = render(
    [
      'Confirm your email address to get Proschi reminders: a nudge when your streak is at risk or cards are due, and a weekly recap. At most one email a day.',
      { link, label: 'Confirm my address' },
      'The link works for two days.',
    ],
    ["You got this because someone entered this address on their Proschi account page. If that wasn't you, ignore this email: nothing is sent to an unconfirmed address."],
  );
  await sendEmail(env, { to: email, subject: 'Confirm your Proschi reminders', text, html });
}

function readFlag(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new HttpError(400, `${key} must be true or false`);
  return v;
}

/** GET /api/me/email */
export async function getEmailPrefs(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  return json(prefsOf(await readPrefs(ctx.env.DB, user.id)), 200, NO_STORE);
}

/**
 * PUT /api/me/email {email, timeZone, streak?, cards?, recap?}: sets the
 * address. A new address (or the same one still unconfirmed) gets a
 * confirmation email and reminders stop until it is confirmed; the same
 * confirmed address only takes the settings.
 */
export async function putEmail(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, 2048);
  const email = typeof body.email === 'string' ? body.email.trim() : undefined;
  if (!isEmail(email)) throw new HttpError(400, 'email must be an email address');
  if (!isTimeZone(body.timeZone)) throw new HttpError(400, 'timeZone must be an IANA time zone, e.g. Europe/Berlin');
  const timeZone = body.timeZone;
  const streak = readFlag(body, 'streak');
  const cards = readFlag(body, 'cards');
  const recap = readFlag(body, 'recap');
  if (!emailConfigured(env) || !secretOk(env)) throw new HttpError(503, 'Email reminders are not available right now');

  const t = now();
  const old = await readPrefs(env.DB, user.id);
  const same = old !== null && old.email.toLowerCase() === email.toLowerCase();
  const confirm = !same || old.confirmed_at === null;
  if (confirm) await rateLimit(env.EMAIL_LIMITER, user.id, 'Too many confirmation emails; wait a minute');
  const flag = (v: boolean | undefined, was: number | undefined) => (v === undefined ? (was ?? 1) : v ? 1 : 0);
  await env.DB.prepare(
    `INSERT INTO email_prefs (user_id, email, confirmed_at, confirm_sent_at, time_zone, streak_on, cards_on, recap_on, unsubscribe_token, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT (user_id) DO UPDATE SET email = ?2, confirmed_at = ?3, confirm_sent_at = COALESCE(?4, confirm_sent_at), time_zone = ?5,
       streak_on = ?6, cards_on = ?7, recap_on = ?8, unsubscribe_token = ?9, updated_at = ?10,
       ignored_count = CASE WHEN ?11 THEN ignored_count ELSE 0 END, paused_at = CASE WHEN ?11 THEN paused_at ELSE NULL END,
       last_sent_day = CASE WHEN ?11 THEN last_sent_day ELSE NULL END, last_sent_at = CASE WHEN ?11 THEN last_sent_at ELSE NULL END,
       last_kind = CASE WHEN ?11 THEN last_kind ELSE NULL END`,
  )
    .bind(
      user.id,
      email,
      same ? old.confirmed_at : null,
      confirm ? t : null,
      timeZone,
      flag(streak, old?.streak_on),
      flag(cards, old?.cards_on),
      flag(recap, old?.recap_on),
      // A new address gets a new unsubscribe link, so links sent to the old one stop working.
      same ? old.unsubscribe_token : randomToken(),
      t,
      same ? 1 : 0,
    )
    .run();
  if (confirm) {
    try {
      await sendConfirmation(env, user.id, email);
    } catch (e) {
      log('error', 'Sending a confirmation email failed', { requestId: ctx.requestId, error: errorText(e) });
      throw new HttpError(502, 'The confirmation email could not be sent; try again later');
    }
  }
  return json({ ...prefsOf(await readPrefs(env.DB, user.id)), confirmationSent: confirm }, 200, NO_STORE);
}

/** PATCH /api/me/email {streak?, cards?, recap?, timeZone?, resume?} */
export async function patchEmail(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request, 2048);
  const old = await readPrefs(DB, user.id);
  if (!old) throw new HttpError(404, 'No email address set');
  const streak = readFlag(body, 'streak');
  const cards = readFlag(body, 'cards');
  const recap = readFlag(body, 'recap');
  const resume = readFlag(body, 'resume');
  if (body.timeZone !== undefined && !isTimeZone(body.timeZone)) throw new HttpError(400, 'timeZone must be an IANA time zone, e.g. Europe/Berlin');
  const bit = (v: boolean | undefined, was: number) => (v === undefined ? was : v ? 1 : 0);
  await DB.prepare(
    `UPDATE email_prefs SET streak_on = ?, cards_on = ?, recap_on = ?, time_zone = ?, updated_at = ?,
       paused_at = CASE WHEN ? THEN NULL ELSE paused_at END, ignored_count = CASE WHEN ? THEN 0 ELSE ignored_count END
     WHERE user_id = ?`,
  )
    .bind(
      bit(streak, old.streak_on),
      bit(cards, old.cards_on),
      bit(recap, old.recap_on),
      (body.timeZone as string | undefined) ?? old.time_zone,
      now(),
      resume ? 1 : 0,
      resume ? 1 : 0,
      user.id,
    )
    .run();
  return json(prefsOf(await readPrefs(DB, user.id)), 200, NO_STORE);
}

/** DELETE /api/me/email: the address and its settings are deleted. */
export async function deleteEmail(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await ctx.env.DB.prepare('DELETE FROM email_prefs WHERE user_id = ?').bind(user.id).run();
  return new Response(null, { status: 204 });
}

/** GET /api/me/export's `emailReminders`: the address, settings and send state; the unsubscribe secret stays out. */
export async function exportEmailPrefs(DB: D1Database, userId: string) {
  const row = await readPrefs(DB, userId);
  if (!row) return null;
  return {
    email: row.email,
    confirmedAt: row.confirmed_at,
    confirmationSentAt: row.confirm_sent_at,
    timeZone: row.time_zone,
    streak: row.streak_on === 1,
    cards: row.cards_on === 1,
    recap: row.recap_on === 1,
    lastSentDay: row.last_sent_day,
    lastSentAt: row.last_sent_at,
    lastKind: row.last_kind,
    ignoredCount: row.ignored_count,
    pausedAt: row.paused_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- The pages behind the links in emails ----

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A small standalone page (no scripts): a heading, a message, and a form button or a link back. */
function page(title: string, message: string, action?: { label: string; url: string }, status = 200): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · Proschi</title>
<style>body{margin:0;padding:48px 16px;font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#fffdf6;color:#111}
main{max-width:520px;margin:0 auto}h1{font-size:28px;margin:0 0 12px}button,a.b{display:inline-block;margin-top:16px;padding:10px 16px;border:2px solid #111;border-radius:6px;background:#111;color:#fff;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
@media (prefers-color-scheme:dark){body{background:#151515;color:#eee}button,a.b{background:#eee;color:#111;border-color:#eee}}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
${action ? `<form method="post" action="${escapeHtml(action.url)}"><button type="submit">${escapeHtml(action.label)}</button></form>` : '<a class="b" href="/practice/#/me">Go to your account</a>'}
</main></body></html>`;
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

const tokenOf = (request: Request) => new URL(request.url).searchParams.get('token');
const selfUrl = (request: Request) => {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
};

/** GET /api/email/confirm?token= */
export async function confirmPage(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const claim = await readConfirmToken(ctx.env, tokenOf(request));
  if (!claim) return page('This link has expired', 'Confirmation links work for two days. Enter your address again on your account page for a new one.', undefined, 400);
  return page('Confirm your address', `Get Proschi reminders at ${claim.e}?`, { label: 'Confirm my address', url: selfUrl(request) });
}

/** POST /api/email/confirm?token=: confirms the address when it is still the one the token names. */
export async function confirmEmail(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const claim = await readConfirmToken(ctx.env, tokenOf(request));
  if (!claim) return page('This link has expired', 'Confirmation links work for two days. Enter your address again on your account page for a new one.', undefined, 400);
  const t = now();
  const result = await ctx.env.DB.prepare('UPDATE email_prefs SET confirmed_at = COALESCE(confirmed_at, ?), updated_at = ? WHERE user_id = ? AND email = ?')
    .bind(t, t, claim.u, claim.e)
    .run();
  if (!result.meta.changes) return page('This link is no longer valid', 'The address was changed or removed since. Check your account page.', undefined, 400);
  return page('Address confirmed', `Reminders will go to ${claim.e}. Change which ones, or turn them off, on your account page.`);
}

/** GET /api/email/unsubscribe?token= */
export async function unsubscribePage(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const token = tokenOf(request);
  const row = token ? await ctx.env.DB.prepare('SELECT email FROM email_prefs WHERE unsubscribe_token = ?').bind(token).first<{ email: string }>() : null;
  if (!row) return page('Already unsubscribed', 'This address gets no Proschi emails.');
  return page('Unsubscribe', `Stop all Proschi reminders to ${row.email} and delete the address?`, { label: 'Unsubscribe', url: selfUrl(request) });
}

/**
 * POST /api/email/unsubscribe?token=: one-click unsubscribe (RFC 8058; mail
 * clients POST `List-Unsubscribe=One-Click` without a session or a same-site
 * Origin). Deletes the address; answers 200 whether or not it was there.
 */
export async function unsubscribe(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const token = tokenOf(request);
  if (token) await ctx.env.DB.prepare('DELETE FROM email_prefs WHERE unsubscribe_token = ?').bind(token).run();
  return page('Unsubscribed', 'You will get no more Proschi reminders, and the address was deleted. You can sign up again on your account page.');
}

// ---- The hourly cron ----

type Kind = 'streak' | 'cards' | 'recap';

interface Candidate extends PrefsRow {
  daily_goal: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The subject and blocks of a reminder. */
function compose(kind: Kind, origin: string, data: { streak?: Streak; due?: number; recap?: WeeklyRecap }): { subject: string; blocks: Block[] } {
  if (kind === 'streak') {
    const s = data.streak!;
    return {
      subject: `Your ${s.current}-day streak ends tonight`,
      blocks: [
        `You're on a ${plural(s.current, 'day')} streak, and today's goal isn't met yet. A few cards, the daily challenge or an Arcade run keeps it going.`,
        { link: `${origin}/practice/#/review`, label: 'Review cards' },
      ],
    };
  }
  if (kind === 'cards') {
    return {
      subject: `${data.due} cards are due for review`,
      blocks: [
        `${plural(data.due!, 'card')} ${data.due === 1 ? 'is' : 'are'} due today. Reviewing them now, before you forget, is what makes them stick.`,
        { link: `${origin}/practice/#/review`, label: 'Review cards' },
      ],
    };
  }
  const r = data.recap!;
  const parts = [
    plural(r.reviews, 'card') + ' reviewed',
    ...(r.newCards ? [`${r.newCards} new`] : []),
    plural(r.solves, 'problem') + ' solved',
    ...(r.challenges ? [plural(r.challenges, 'daily challenge')] : []),
    ...(r.runs ? [plural(r.runs, 'Arcade run')] : []),
  ];
  return {
    subject: `Your Proschi week: ${plural(r.goalDays, 'goal day')}`,
    blocks: [
      `Last week (${r.start} to ${r.end}): ${parts.join(', ')}. You met your daily goal on ${plural(r.goalDays, 'day')} of 7${r.streak ? `, and your streak was ${plural(r.streak, 'day')} on Sunday` : ''}.`,
      { link: `${origin}/practice/#/progress`, label: 'See your progress' },
    ],
  };
}

const WHY: Record<Kind, string> = {
  streak: 'You got this because you turned on streak reminders on your Proschi account page.',
  cards: 'You got this because you turned on cards-due reminders on your Proschi account page.',
  recap: 'You got this because you turned on the weekly recap on your Proschi account page.',
};

/** Lists `ids` as `?, ?, …` for an IN clause. */
const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * The hourly reminder run (src/cron.ts): emails the confirmed, unpaused users
 * whose local hour is REMINDER_HOUR (or RECAP_HOUR on a Monday), at most one
 * each per local day. Finds those time zones from the distinct zones first,
 * so an hour with nobody due costs one small query. Answers how many were sent.
 */
export async function sendReminders(env: Env, t = now()): Promise<number> {
  const { DB } = env;
  const zones = (
    await DB.prepare('SELECT DISTINCT time_zone FROM email_prefs WHERE confirmed_at IS NOT NULL AND paused_at IS NULL').all<{ time_zone: string }>()
  ).results
    .map((r) => r.time_zone)
    .filter((z) => {
      const l = localTime(z, t);
      return l !== undefined && (l.hour === REMINDER_HOUR || (l.hour === RECAP_HOUR && l.weekday === 1));
    });
  if (!zones.length) return 0;

  const origin = siteOrigin(env);
  let sent = 0;
  // D1 binds at most 100 parameters a query: zones go in chunks.
  for (let z = 0; z < zones.length && sent < MAX_PER_RUN; z += 50) {
    const chunk = zones.slice(z, z + 50);
    let after = '';
    for (;;) {
      const rows = (
        await DB.prepare(
          `SELECT p.*, u.daily_goal FROM email_prefs p JOIN users u ON u.id = p.user_id
           WHERE p.confirmed_at IS NOT NULL AND p.paused_at IS NULL AND p.time_zone IN (${marks(chunk.length)}) AND p.user_id > ?
           ORDER BY p.user_id LIMIT ${PAGE}`,
        )
          .bind(...chunk, after)
          .all<Candidate>()
      ).results;
      if (!rows.length) break;
      after = rows[rows.length - 1].user_id;
      sent += await processPage(env, rows, t, origin, MAX_PER_RUN - sent);
      if (rows.length < PAGE || sent >= MAX_PER_RUN) break;
    }
  }
  if (sent >= MAX_PER_RUN) log('warn', 'Reminder run hit its cap; the rest wait for tomorrow', { sent });
  if (sent) {
    try {
      await countEvents(env, new Map([['email_reminder_sent', sent]]));
    } catch (e) {
      log('warn', 'Counting reminders failed', { error: errorText(e) });
    }
  }
  return sent;
}

/** One page of candidates: decides, sends and records; answers how many were sent. */
async function processPage(env: Env, rows: Candidate[], t: number, origin: string, budget: number): Promise<number> {
  const { DB } = env;
  const todo = rows.flatMap((row) => {
    const l = localTime(row.time_zone, t)!;
    if (row.last_sent_day === l.day) return [];
    const evening = l.hour === REMINDER_HOUR && (row.streak_on === 1 || row.cards_on === 1);
    const recap = l.hour === RECAP_HOUR && l.weekday === 1 && row.recap_on === 1;
    return evening || recap ? [{ row, day: l.day, recap }] : [];
  });
  if (!todo.length) return 0;

  // For the whole page at once: cards due, and the latest practice (to tell an ignored reminder).
  const ids = todo.map((c) => c.row.user_id);
  const q = marks(ids.length);
  const [due, reviews, runs, challenges, games] = await DB.batch([
    DB.prepare(`SELECT user_id, COUNT(*) AS n FROM card_state WHERE user_id IN (${q}) AND due_at <= ? GROUP BY user_id`).bind(...ids, t),
    DB.prepare(`SELECT user_id, MAX(reviewed_at) AS m FROM card_reviews WHERE user_id IN (${q}) GROUP BY user_id`).bind(...ids),
    DB.prepare(`SELECT user_id, MAX(updated_at) AS m FROM progress WHERE user_id IN (${q}) GROUP BY user_id`).bind(...ids),
    DB.prepare(`SELECT user_id, MAX(COALESCE(submitted_at, started_at)) AS m FROM challenge_attempts WHERE user_id IN (${q}) GROUP BY user_id`).bind(...ids),
    DB.prepare(`SELECT user_id, MAX(submitted_at) AS m FROM game_runs WHERE user_id IN (${q}) AND submitted_at IS NOT NULL GROUP BY user_id`).bind(...ids),
  ]);
  const dueBy = new Map((due.results as { user_id: string; n: number }[]).map((r) => [r.user_id, r.n]));
  const lastActive = new Map<string, number>();
  for (const result of [reviews, runs, challenges, games]) {
    for (const r of result.results as { user_id: string; m: number | null }[]) lastActive.set(r.user_id, Math.max(lastActive.get(r.user_id) ?? 0, r.m ?? 0));
  }

  const updates: D1PreparedStatement[] = [];
  let sent = 0;
  for (const { row, day, recap: isRecap } of todo) {
    if (sent >= budget) break;
    const goal = goalFor(row.daily_goal);
    const dueCards = dueBy.get(row.user_id) ?? 0;
    let kind: Kind | undefined;
    let data: Parameters<typeof compose>[2] = {};
    if (isRecap) {
      const recap = weeklyRecap(await loadActivity(DB, row.user_id, day), day, goal);
      if (!recapIsEmpty(recap)) [kind, data] = ['recap', { recap }];
    } else {
      if (row.streak_on === 1) {
        const streak = computeStreak(await loadActivity(DB, row.user_id, day), day, goal);
        if (streak.current >= 1 && !streak.todayDone) [kind, data] = ['streak', { streak }];
      }
      if (!kind && row.cards_on === 1 && dueCards >= DUE_CARDS_MIN) [kind, data] = ['cards', { due: dueCards }];
    }
    if (!kind) continue;

    // Practice since the last reminder starts the count of ignored ones over.
    const active = row.last_sent_at === null || (lastActive.get(row.user_id) ?? 0) > row.last_sent_at;
    const ignored = (active ? 0 : row.ignored_count) + 1;
    const pause = ignored >= PAUSE_AFTER;
    const unsubscribeUrl = `${origin}/api/email/unsubscribe?token=${encodeURIComponent(row.unsubscribe_token)}`;
    const { subject, blocks } = compose(kind, origin, data);
    if (pause) {
      blocks.push(
        `We haven't seen you practice since our last ${plural(PAUSE_AFTER - 1, 'email')}, so we paused your reminders: this is the last one until you turn them back on.`,
        { link: `${origin}/practice/#/me`, label: 'Resume reminders' },
      );
    }
    const { text, html } = render(blocks, [
      WHY[kind],
      { link: `${origin}/practice/#/me`, label: 'Change which emails you get' },
      { link: unsubscribeUrl, label: 'Unsubscribe from all Proschi emails' },
    ]);
    try {
      await sendEmail(env, {
        to: row.email,
        subject,
        text,
        html,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
    } catch (e) {
      log('error', 'Sending a reminder failed', { userId: row.user_id, kind, error: errorText(e) });
      continue;
    }
    sent++;
    updates.push(
      DB.prepare('UPDATE email_prefs SET last_sent_day = ?, last_sent_at = ?, last_kind = ?, ignored_count = ?, paused_at = ? WHERE user_id = ?').bind(
        day,
        t,
        kind,
        ignored,
        pause ? t : null,
        row.user_id,
      ),
    );
  }
  if (updates.length) await DB.batch(updates);
  return sent;
}
