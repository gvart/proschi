import { auditStatement, requireAdmin } from './adminAuth';
import { requireUser } from './auth';
import { unknownPlaceholders, type Values } from './campaignMarkdown';
import { newsAddressSql } from './contactEmail';
import type { Ctx } from './context';
import { credits as creditsOf } from './credits';
import { decodeJson, encodeJson, sign, unsign } from './crypto';
import { emailConfigured, sendEmail } from './email';
import { pageHtml, type Accent } from './emailLayout';
import { newsEmail } from './emails';
import { now, secretOk, type Env } from './env';
import { recordEvent } from './events';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { effectivePlanSql, MC } from './plans';
import { isEmail, siteOrigin } from './reminders';

/**
 * Admin campaigns (backend/README.md "Campaigns"; docs/PRIVACY.md "Product
 * news"): top-up credits given to many accounts at once, product news by
 * email, and an announcement in the app, in any mix. A campaign is a draft
 * until sent; sending snapshots its audience into `campaign_recipients`
 * (one row per account, UNIQUE, so nobody is granted or emailed twice), and
 * the recipients are processed in the background, BATCH at a time: after
 * the send's answer (waitUntil), and every hour by the cron until done.
 *
 *   - Credits: a ledger row `admin_grant` in the top-up bucket (never
 *     expires, P24) with ref 'campaign:<id>:<user>', once per account.
 *   - Email: only to a confirmed email sign-in address or the verified
 *     address of a GitHub or Google sign-in (src/contactEmail.ts), never to
 *     an account that turned product news off. At most CAMPAIGN_DAILY_CAP a
 *     UTC day; the rest wait for the next day. An email is marked 'sending'
 *     before it goes out, so an interrupted run never sends it again.
 *   - In the app: the newest undismissed announcement shows on the
 *     account's next visit (GET /api/me/announcement), for 30 days.
 *
 * Admin (every change in the audit log; sending, cancelling and resuming
 * need a reason):
 *   GET    /api/admin/campaigns                  every campaign with its stats, newest first
 *   POST   /api/admin/campaigns {draft}          a new draft
 *   GET    /api/admin/campaigns/<id>
 *   PUT    /api/admin/campaigns/<id> {draft}     changes a draft
 *   POST   /api/admin/campaigns/audience {audience, email}   who it would reach
 *   POST   /api/admin/campaigns/preview {draft}  the email as it will look
 *   POST   /api/admin/campaigns/test {draft}     the email to ADMIN_EMAIL; grants nothing
 *   POST   /api/admin/campaigns/<id>/send {reason}
 *   POST   /api/admin/campaigns/<id>/cancel {reason}   stops it; who was done stays done
 *   POST   /api/admin/campaigns/<id>/resume {reason}   goes on with who is left
 * Users:
 *   GET    /api/me/announcement                  the announcement to show, or null (marks it shown)
 *   POST   /api/me/announcement/<id>/dismiss | click
 *   GET    /api/me/news                          {on, email, source}
 *   PUT    /api/me/news {on}
 *   GET    /api/news/unsubscribe?token=          the page with the button; POST stops product news (one-click, no session)
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
const DAY = 86_400;
/** Recipients processed at a time. */
export const BATCH = 50;
export const DEFAULT_DAILY_CAP = 500;
/** An announcement shows this long after its campaign was sent. */
export const ANNOUNCEMENT_DAYS = 30;
/** The unsubscribe link works this long (seconds). */
export const UNSUBSCRIBE_TTL = 365 * DAY;
const MAX_SUBJECT = 150;
const MAX_BODY = 20_000;
const MAX_REASON = 500;
const MAX_CREDITS = 10_000;
const SAMPLE_NAME = 'Ada';

export type Audience =
  | { type: 'all' }
  | { type: 'plan'; plan: 'free' | 'pro' | 'max' }
  | { type: 'active'; days: number }
  | { type: 'signup'; after?: string; before?: string }
  | { type: 'user'; id: string };

export interface Draft {
  audience: Audience;
  creditsMc: number;
  email: boolean;
  inapp: boolean;
  subject: string;
  body: string;
  link: { url: string; label: string } | null;
}

interface CampaignRow {
  id: string;
  audience: string;
  credits_mc: number;
  email: number;
  inapp: number;
  subject: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  reason: string | null;
  created_by: string | null;
  status: 'draft' | 'sending' | 'done' | 'cancelled';
  recipients: number;
  granted: number;
  sent: number;
  failed: number;
  skipped: number;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  finished_at: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (t: number): string => new Date(t * 1000).toISOString().slice(0, 10);
const dayStart = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 1000;

/** The audience in a request or a stored campaign; 400 for anything else. */
export function parseAudience(value: unknown): Audience {
  const a = (value ?? {}) as Record<string, unknown>;
  switch (a.type) {
    case 'all':
      return { type: 'all' };
    case 'plan':
      if (a.plan === 'free' || a.plan === 'pro' || a.plan === 'max') return { type: 'plan', plan: a.plan };
      throw new HttpError(400, 'audience.plan must be free, pro or max');
    case 'active':
      if (typeof a.days === 'number' && Number.isInteger(a.days) && a.days >= 1 && a.days <= 365) return { type: 'active', days: a.days };
      throw new HttpError(400, 'audience.days must be a whole number from 1 to 365');
    case 'signup': {
      const ok = (d: unknown) => d === undefined || d === null || d === '' || (typeof d === 'string' && DATE.test(d) && !Number.isNaN(dayStart(d)));
      if (!ok(a.after) || !ok(a.before)) throw new HttpError(400, 'audience.after and audience.before must be dates (YYYY-MM-DD)');
      if (!a.after && !a.before) throw new HttpError(400, 'Give audience.after, audience.before or both');
      return { type: 'signup', ...(a.after ? { after: a.after as string } : {}), ...(a.before ? { before: a.before as string } : {}) };
    }
    case 'user':
      if (typeof a.id === 'string' && /^[\w-]{1,64}$/.test(a.id)) return { type: 'user', id: a.id };
      throw new HttpError(400, 'audience.id must be an account id');
    default:
      throw new HttpError(400, 'audience.type must be all, plan, active, signup or user');
  }
}

/** The WHERE clause (over `users u`) that picks the audience, with its parameters; blocked accounts never count. */
export function audienceWhere(audience: Audience, t = now()): { sql: string; binds: (string | number)[] } {
  const base = 'u.blocked_at IS NULL';
  switch (audience.type) {
    case 'all':
      return { sql: base, binds: [] };
    case 'plan':
      return { sql: `${base} AND ${effectivePlanSql('u', '?')} = ?`, binds: [t, audience.plan] };
    case 'active':
      return { sql: `${base} AND u.last_seen_day >= ?`, binds: [utcDay(t - (audience.days - 1) * DAY)] };
    case 'signup': {
      const parts = [base];
      const binds: number[] = [];
      if (audience.after) {
        parts.push('u.created_at >= ?');
        binds.push(dayStart(audience.after));
      }
      if (audience.before) {
        parts.push('u.created_at < ?');
        binds.push(dayStart(audience.before));
      }
      return { sql: parts.join(' AND '), binds };
    }
    case 'user':
      return { sql: `${base} AND u.id = ?`, binds: [audience.id] };
  }
}

export interface AudienceCount {
  accounts: number;
  /** With email: who gets it, and who is skipped (product news off; no confirmed address). */
  emails: number;
  optedOut: number;
  unconfirmed: number;
}

/** How many accounts the audience is, and how many of them an email reaches. */
export async function countAudience(DB: D1Database, audience: Audience, t = now()): Promise<AudienceCount> {
  const where = audienceWhere(audience, t);
  const row = await DB.prepare(
    `SELECT COUNT(*) AS accounts,
       COALESCE(SUM(o IS NULL AND addr IS NOT NULL), 0) AS emails,
       COALESCE(SUM(o IS NOT NULL), 0) AS opted_out,
       COALESCE(SUM(o IS NULL AND addr IS NULL), 0) AS unconfirmed
     FROM (SELECT ${newsAddressSql('u')} AS addr, (SELECT 1 FROM news_optouts n WHERE n.user_id = u.id) AS o FROM users u WHERE ${where.sql})`,
  )
    .bind(...where.binds)
    .first<{ accounts: number; emails: number; opted_out: number; unconfirmed: number }>();
  return { accounts: row?.accounts ?? 0, emails: row?.emails ?? 0, optedOut: row?.opted_out ?? 0, unconfirmed: row?.unconfirmed ?? 0 };
}

/** Credits in millicredits from a number of credits with up to 3 decimals; 400 otherwise. 0 for none. */
function creditsMcOf(value: unknown): number {
  if (value === undefined || value === null || value === 0) return 0;
  const mc = typeof value === 'number' ? Math.round(value * MC) : NaN;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value * MC - mc) > 1e-6 || mc < 1 || mc > MAX_CREDITS * MC) {
    throw new HttpError(400, `credits must be 0 (none) or from 0.001 to ${MAX_CREDITS}, with at most 3 decimals`);
  }
  return mc;
}

/** A draft from a request; 400 with what is wrong. */
export function parseDraft(body: Record<string, unknown>): Draft {
  const audience = parseAudience(body.audience);
  const creditsMc = creditsMcOf(body.credits);
  const email = body.email === true;
  const inapp = body.inapp === true;
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!creditsMc && !email && !inapp) throw new HttpError(400, 'A campaign grants credits, sends an email, shows in the app, or a mix');
  if (!subject || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) throw new HttpError(400, `subject must be one line of 1 to ${MAX_SUBJECT} characters`);
  if (text.length > MAX_BODY) throw new HttpError(400, `body must be at most ${MAX_BODY} characters`);
  if ((email || inapp) && !text) throw new HttpError(400, 'An email or announcement needs a body');
  const unknown = [...unknownPlaceholders(subject), ...unknownPlaceholders(text)];
  if (unknown.length) throw new HttpError(400, `Unknown placeholder ${unknown[0]}: use {{name}} or {{credits}}`);
  if (!creditsMc && /\{\{\s*credits\s*\}\}/.test(subject + text)) throw new HttpError(400, '{{credits}} needs credits to grant');
  let link: Draft['link'] = null;
  const url = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : '';
  const label = typeof body.linkLabel === 'string' ? body.linkLabel.trim() : '';
  if (url) {
    if (!/^https:\/\/[^\s<>"']+$/.test(url) || url.length > 500) throw new HttpError(400, 'linkUrl must be an https:// address');
    if (!label || label.length > 40) throw new HttpError(400, 'linkLabel must be 1 to 40 characters');
    link = { url, label };
  }
  return { audience, creditsMc, email, inapp, subject, body: text, link };
}

/** {{credits}} as the email says it: 150, 1,000, 0.5. */
export const formatCredits = (mc: number): string => creditsOf(mc).toLocaleString('en-US', { maximumFractionDigits: 3 });

const valuesOf = (name: string, creditsMc: number): Values => ({ name: name.replace(/[\r\n]+/g, ' '), credits: formatCredits(creditsMc) });

function view(r: CampaignRow) {
  return {
    id: r.id,
    status: r.status,
    audience: JSON.parse(r.audience) as Audience,
    credits: creditsOf(r.credits_mc),
    email: r.email === 1,
    inapp: r.inapp === 1,
    subject: r.subject,
    body: r.body,
    link: r.link_url ? { url: r.link_url, label: r.link_label ?? '' } : null,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

interface Stats {
  recipients: number;
  pending: number;
  granted: number;
  sent: number;
  failed: number;
  skippedOptout: number;
  skippedUnconfirmed: number;
  shown: number;
  dismissed: number;
  clicked: number;
  /** Recipients who turned product news off since the campaign was sent. */
  unsubscribes: number;
}

const STATS_SQL = `SELECT r.campaign_id AS id, COUNT(*) AS recipients,
    COALESCE(SUM(r.done_at IS NULL), 0) AS pending,
    COALESCE(SUM(r.granted), 0) AS granted,
    COALESCE(SUM(r.email_status = 'sent'), 0) AS sent,
    COALESCE(SUM(r.email_status = 'failed'), 0) AS failed,
    COALESCE(SUM(r.email_status = 'skipped_optout'), 0) AS skippedOptout,
    COALESCE(SUM(r.email_status = 'skipped_unconfirmed'), 0) AS skippedUnconfirmed,
    COALESCE(SUM(r.shown_at IS NOT NULL), 0) AS shown,
    COALESCE(SUM(r.dismissed_at IS NOT NULL), 0) AS dismissed,
    COALESCE(SUM(r.clicked_at IS NOT NULL), 0) AS clicked,
    COALESCE(SUM(EXISTS (SELECT 1 FROM news_optouts o WHERE o.user_id = r.user_id AND o.at >= c.started_at)), 0) AS unsubscribes
  FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id`;

const EMPTY_STATS: Stats = { recipients: 0, pending: 0, granted: 0, sent: 0, failed: 0, skippedOptout: 0, skippedUnconfirmed: 0, shown: 0, dismissed: 0, clicked: 0, unsubscribes: 0 };

async function readCampaign(DB: D1Database, id: string): Promise<CampaignRow> {
  const row = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<CampaignRow>();
  if (!row) throw new HttpError(404, 'No such campaign');
  return row;
}

/** The reason an admin action must give: 400 without one. */
function reasonOf(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';
  if (!reason) throw new HttpError(400, 'Give a reason: it goes in the audit log');
  return reason;
}

/** What the audit log keeps of a draft: never the body, which can be long. */
const auditDetail = (d: Draft) => ({ subject: d.subject, audience: d.audience, credits: creditsOf(d.creditsMc), email: d.email, inapp: d.inapp });

// ---- Admin routes ----

/** GET /api/admin/campaigns */
export async function listCampaigns(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const { DB } = ctx.env;
  const [rows, stats] = await DB.batch([DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC, rowid DESC LIMIT 200'), DB.prepare(`${STATS_SQL} GROUP BY r.campaign_id`)]);
  const byId = new Map((stats.results as (Stats & { id: string })[]).map(({ id, ...s }) => [id, s]));
  return json(
    {
      campaigns: (rows.results as unknown as CampaignRow[]).map((r) => ({ ...view(r), stats: byId.get(r.id) ?? EMPTY_STATS })),
      dailyCap: dailyCap(ctx.env),
      sentToday: await sentToday(DB),
      testAddress: ctx.env.ADMIN_EMAIL ? maskAddress(ctx.env.ADMIN_EMAIL) : null,
      emailConfigured: emailConfigured(ctx.env),
    },
    200,
    NO_STORE,
  );
}

/** a***@example.com */
function maskAddress(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}

/** GET /api/admin/campaigns/<id> */
export async function getCampaign(request: Request, ctx: Ctx, id: string): Promise<Response> {
  await requireAdmin(request, ctx);
  const { DB } = ctx.env;
  const row = await readCampaign(DB, id);
  const stats = await DB.prepare(`${STATS_SQL} WHERE r.campaign_id = ?`).bind(id).first<Stats & { id: string | null }>();
  const { id: _, ...s } = stats ?? { id: null, ...EMPTY_STATS };
  return json({ ...view(row), stats: s.recipients ? s : EMPTY_STATS }, 200, NO_STORE);
}

/** POST /api/admin/campaigns {audience, credits, email, inapp, subject, body, linkUrl?, linkLabel?} */
export async function createCampaign(request: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const draft = parseDraft(await readJson(request, 64 * 1024));
  const id = crypto.randomUUID();
  const t = now();
  const { DB } = ctx.env;
  await DB.batch([
    DB.prepare(
      `INSERT INTO campaigns (id, audience, credits_mc, email, inapp, subject, body, link_url, link_label, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, JSON.stringify(draft.audience), draft.creditsMc, draft.email ? 1 : 0, draft.inapp ? 1 : 0, draft.subject, draft.body, draft.link?.url ?? null, draft.link?.label ?? null, admin.passkeyId, t, t),
    auditStatement(ctx.env, admin, 'campaign.create', id, auditDetail(draft)),
  ]);
  return json(view(await readCampaign(DB, id)), 201, NO_STORE);
}

/** PUT /api/admin/campaigns/<id> {draft}: only while it is a draft (409 after). */
export async function updateCampaign(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const draft = parseDraft(await readJson(request, 64 * 1024));
  const { DB } = ctx.env;
  await readCampaign(DB, id);
  const [result] = await DB.batch([
    DB.prepare(
      `UPDATE campaigns SET audience = ?, credits_mc = ?, email = ?, inapp = ?, subject = ?, body = ?, link_url = ?, link_label = ?, updated_at = ?
       WHERE id = ? AND status = 'draft'`,
    ).bind(JSON.stringify(draft.audience), draft.creditsMc, draft.email ? 1 : 0, draft.inapp ? 1 : 0, draft.subject, draft.body, draft.link?.url ?? null, draft.link?.label ?? null, now(), id),
  ]);
  if (!result.meta.changes) throw new HttpError(409, 'Only a draft can be changed');
  await DB.batch([auditStatement(ctx.env, admin, 'campaign.update', id, auditDetail(draft))]);
  return json(view(await readCampaign(DB, id)), 200, NO_STORE);
}

/** POST /api/admin/campaigns/audience {audience}: the composer's live count. */
export async function campaignAudience(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const body = await readJson(request);
  return json(await countAudience(ctx.env.DB, parseAudience(body.audience)), 200, NO_STORE);
}

/** The email of a draft for `name`; lenient, for previews of unfinished drafts. */
function draftEmail(env: Env, body: Record<string, unknown>, name: string, unsubscribeUrl: string) {
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const text = typeof body.body === 'string' ? body.body.slice(0, MAX_BODY) : '';
  let mc = 0;
  try {
    mc = creditsMcOf(body.credits);
  } catch {
    // An unfinished amount previews as 0.
  }
  const url = typeof body.linkUrl === 'string' && /^https:\/\/[^\s<>"']+$/.test(body.linkUrl.trim()) ? body.linkUrl.trim() : '';
  const label = typeof body.linkLabel === 'string' ? body.linkLabel.trim().slice(0, 40) : '';
  return newsEmail(subject || '(no subject)', text, valuesOf(name, mc), { origin: siteOrigin(env), unsubscribeUrl, link: url && label ? { url, label } : undefined });
}

/** POST /api/admin/campaigns/preview {draft}: the email's subject, HTML and text, for a sample recipient. */
export async function previewCampaign(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const body = await readJson(request, 64 * 1024);
  const email = draftEmail(ctx.env, body, SAMPLE_NAME, `${siteOrigin(ctx.env)}/api/news/unsubscribe?token=preview`);
  return json(email, 200, NO_STORE);
}

/** POST /api/admin/campaigns/test {draft}: the email to the admin's own address (ADMIN_EMAIL), marked as a test. Grants nothing. */
export async function testCampaign(request: Request, ctx: Ctx): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const { env } = ctx;
  const body = await readJson(request, 64 * 1024);
  parseDraft(body);
  const to = env.ADMIN_EMAIL?.trim();
  if (!to || !isEmail(to)) throw new HttpError(501, 'Set ADMIN_EMAIL (npx wrangler secret put ADMIN_EMAIL) to send tests to yourself');
  if (!emailConfigured(env) || !secretOk(env)) throw new HttpError(503, 'Email is not available right now');
  await rateLimit(env.EMAIL_LIMITER, 'admin-campaign-test', 'Too many test emails; wait a minute');
  const email = draftEmail(env, body, SAMPLE_NAME, await unsubscribeUrl(env, 'test', 'test'));
  try {
    await sendEmail(env, { to, subject: `[Test] ${email.subject}`, text: email.text, html: email.html });
  } catch (e) {
    log('error', 'Sending a campaign test failed', { requestId: ctx.requestId, error: errorText(e) });
    throw new HttpError(502, 'The test email could not be sent');
  }
  await env.DB.batch([auditStatement(env, admin, 'campaign.test', undefined, { subject: email.subject })]);
  return json({ sent: true, to: maskAddress(to) }, 200, NO_STORE);
}

/**
 * POST /api/admin/campaigns/<id>/send {reason}: snapshots the audience as
 * the recipients and starts sending in the background. 409 unless a draft.
 */
export async function sendCampaign(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const reason = reasonOf(await readJson(request));
  const { env } = ctx;
  const { DB } = env;
  const row = await readCampaign(DB, id);
  if (row.status !== 'draft') throw new HttpError(409, 'This campaign was already sent');
  if (row.email === 1 && (!emailConfigured(env) || !secretOk(env))) throw new HttpError(503, 'Email is not available right now');
  const t = now();
  const where = audienceWhere(parseAudience(JSON.parse(row.audience)), t);
  const [claimed] = await DB.batch([
    DB.prepare("UPDATE campaigns SET status = 'sending', reason = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(reason, t, t, id),
    // Only when this request is the one that moved it out of draft (started_at is this request's).
    DB.prepare(
      `INSERT INTO campaign_recipients (campaign_id, user_id) SELECT ?, u.id FROM users u
       WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND status = 'sending' AND started_at = ? AND reason = ?) AND ${where.sql}
       ON CONFLICT (campaign_id, user_id) DO NOTHING`,
    ).bind(id, id, t, reason, ...where.binds),
    DB.prepare('UPDATE campaigns SET recipients = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?) WHERE id = ?').bind(id, id),
  ]);
  if (!claimed.meta.changes) throw new HttpError(409, 'This campaign was already sent');
  const recipients = (await readCampaign(DB, id)).recipients;
  await DB.batch([auditStatement(env, admin, 'campaign.send', id, { reason, recipients, credits: creditsOf(row.credits_mc), email: row.email === 1, inapp: row.inapp === 1 })]);
  ctx.exec.waitUntil(runCampaigns(env));
  return json({ ...view(await readCampaign(DB, id)), recipients }, 200, NO_STORE);
}

/** POST /api/admin/campaigns/<id>/cancel {reason}: a draft or a campaign still sending stops; who was processed stays processed. */
export async function cancelCampaign(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const reason = reasonOf(await readJson(request));
  const { DB } = ctx.env;
  await readCampaign(DB, id);
  const t = now();
  const [result] = await DB.batch([
    DB.prepare("UPDATE campaigns SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('draft', 'sending')").bind(t, t, id),
  ]);
  if (!result.meta.changes) throw new HttpError(409, 'Only a draft or a campaign still sending can be cancelled');
  await DB.batch([auditStatement(ctx.env, admin, 'campaign.cancel', id, { reason })]);
  return json(view(await readCampaign(DB, id)), 200, NO_STORE);
}

/** POST /api/admin/campaigns/<id>/resume {reason}: a cancelled or stalled campaign goes on with the recipients left; nobody is done twice. */
export async function resumeCampaign(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const reason = reasonOf(await readJson(request));
  const { env } = ctx;
  const row = await readCampaign(env.DB, id);
  if (row.status === 'draft' || row.status === 'done' || row.started_at === null) throw new HttpError(409, 'Only a cancelled campaign or one still sending can be resumed');
  if (row.email === 1 && (!emailConfigured(env) || !secretOk(env))) throw new HttpError(503, 'Email is not available right now');
  await env.DB.batch([
    env.DB.prepare("UPDATE campaigns SET status = 'sending', finished_at = NULL, updated_at = ? WHERE id = ?").bind(now(), id),
    auditStatement(env, admin, 'campaign.resume', id, { reason }),
  ]);
  ctx.exec.waitUntil(runCampaigns(env));
  return json(view(await readCampaign(env.DB, id)), 200, NO_STORE);
}

// ---- Sending ----

export const dailyCap = (env: Env): number => {
  const n = Number(env.CAMPAIGN_DAILY_CAP);
  return env.CAMPAIGN_DAILY_CAP && Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
};

/** Campaign emails that went out (or were tried) today, UTC. */
async function sentToday(DB: D1Database, t = now()): Promise<number> {
  const row = await DB.prepare("SELECT COUNT(*) AS n FROM campaign_recipients WHERE email_status IN ('sending', 'sent', 'failed') AND at >= ?")
    .bind(dayStart(utcDay(t)))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

const unsubscribeKey = (secret: string) => `${secret}/news-unsubscribe`;

/** The "Stop product news" link of `userId`'s email from `campaignId`. */
export async function unsubscribeUrl(env: Env, userId: string, campaignId: string, t = now()): Promise<string> {
  if (!secretOk(env)) throw new Error('No SESSION_SECRET');
  const token = await sign(encodeJson({ u: userId, c: campaignId, x: t + UNSUBSCRIBE_TTL }), unsubscribeKey(env.SESSION_SECRET));
  return `${siteOrigin(env)}/api/news/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** The account and campaign of an unsubscribe token; undefined when forged, malformed or expired. */
export async function readUnsubscribeToken(env: Env, token: string | null, t = now()): Promise<{ u: string; c: string } | undefined> {
  if (!token || token.length > 2048 || !secretOk(env)) return undefined;
  const value = await unsign(token, unsubscribeKey(env.SESSION_SECRET));
  const p = value === undefined ? undefined : (decodeJson(value) as { u?: unknown; c?: unknown; x?: unknown } | undefined);
  if (!p || typeof p.u !== 'string' || typeof p.c !== 'string' || typeof p.x !== 'number' || p.x < t) return undefined;
  return { u: p.u, c: p.c };
}

const refreshCounts = (DB: D1Database, id: string) =>
  DB.prepare(
    `UPDATE campaigns SET
       granted = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?1 AND granted = 1),
       sent = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?1 AND email_status = 'sent'),
       failed = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?1 AND email_status = 'failed'),
       skipped = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?1 AND email_status IN ('skipped_optout', 'skipped_unconfirmed'))
     WHERE id = ?1`,
  ).bind(id);

/**
 * One batch of a campaign's pending recipients: the credits (one atomic
 * batch, idempotent by the ledger's ref), then each email. Answers how many
 * were done, and whether the daily cap stopped it.
 */
export async function processBatch(env: Env, c: CampaignRow, t = now()): Promise<{ done: number; emailed: number; capped: boolean }> {
  const { DB } = env;
  // An email left 'sending' by an interrupted run may or may not have gone out: never sent again.
  await DB.prepare(
    "UPDATE campaign_recipients SET email_status = 'failed', error = 'interrupted: may not have been delivered', done_at = ?1 WHERE campaign_id = ?2 AND email_status = 'sending' AND at < ?3",
  )
    .bind(t, c.id, t - 600)
    .run();
  const pending = (
    await DB.prepare(
      `SELECT r.user_id, r.granted, u.display_name, ${newsAddressSql('u')} AS addr, (SELECT 1 FROM news_optouts n WHERE n.user_id = u.id) AS opted_out
       FROM campaign_recipients r JOIN users u ON u.id = r.user_id
       WHERE r.campaign_id = ? AND r.done_at IS NULL AND r.email_status IS NULL ORDER BY r.rowid LIMIT ${BATCH}`,
    )
      .bind(c.id)
      .all<{ user_id: string; granted: number; display_name: string; addr: string | null; opted_out: number | null }>()
  ).results;
  if (!pending.length) return { done: 0, emailed: 0, capped: false };

  if (c.credits_mc > 0) {
    const grants = pending.filter((p) => p.granted === 0);
    if (grants.length) {
      const at = Date.now();
      await DB.batch(
        grants.flatMap((p) => [
          DB.prepare(
            `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
             SELECT ?1, 'admin_grant', 'topup', '', ?2, 'campaign', ?3, ?4 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1)
             ON CONFLICT (kind, ref_id) DO NOTHING`,
          ).bind(p.user_id, c.credits_mc, `campaign:${c.id}:${p.user_id}`, at),
          DB.prepare('UPDATE campaign_recipients SET granted = 1 WHERE campaign_id = ? AND user_id = ?').bind(c.id, p.user_id),
        ]),
      );
    }
  }

  if (c.email !== 1) {
    await DB.batch([
      ...pending.map((p) => DB.prepare('UPDATE campaign_recipients SET done_at = ? WHERE campaign_id = ? AND user_id = ?').bind(t, c.id, p.user_id)),
      refreshCounts(DB, c.id),
    ]);
    return { done: pending.length, emailed: 0, capped: false };
  }

  const cap = dailyCap(env);
  let today = await sentToday(DB, t);
  let done = 0;
  let emailed = 0;
  let capped = false;
  const origin = siteOrigin(env);
  for (const p of pending) {
    const skip = p.opted_out ? 'skipped_optout' : p.addr === null || !isEmail(p.addr) ? 'skipped_unconfirmed' : undefined;
    if (skip) {
      await DB.prepare('UPDATE campaign_recipients SET email_status = ?, at = ?, done_at = ? WHERE campaign_id = ? AND user_id = ? AND email_status IS NULL')
        .bind(skip, t, t, c.id, p.user_id)
        .run();
      done++;
      continue;
    }
    if (today >= cap) {
      capped = true;
      break;
    }
    // Claim the email first: a parallel run, or a run after a crash, never sends it again.
    const claim = await DB.prepare("UPDATE campaign_recipients SET email_status = 'sending', at = ? WHERE campaign_id = ? AND user_id = ? AND email_status IS NULL")
      .bind(t, c.id, p.user_id)
      .run();
    if (!claim.meta.changes) continue;
    today++;
    let status: 'sent' | 'failed' = 'sent';
    let error: string | null = null;
    try {
      const link = await unsubscribeUrl(env, p.user_id, c.id, t);
      const email = newsEmail(c.subject, c.body, valuesOf(p.display_name, c.credits_mc), {
        origin,
        unsubscribeUrl: link,
        link: c.link_url ? { url: c.link_url, label: c.link_label ?? 'Open' } : undefined,
      });
      await sendEmail(env, {
        to: p.addr!,
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      emailed++;
    } catch (e) {
      status = 'failed';
      // Not the provider's text: it may name the address.
      error = 'send failed';
      log('error', 'Sending a campaign email failed', { campaign: c.id, userId: p.user_id, error: errorText(e) });
    }
    await DB.prepare('UPDATE campaign_recipients SET email_status = ?, error = ?, done_at = ? WHERE campaign_id = ? AND user_id = ?').bind(status, error, t, c.id, p.user_id).run();
    done++;
  }
  await refreshCounts(DB, c.id).run();
  return { done, emailed, capped };
}

/**
 * Processes every campaign that is sending, a batch at a time, until each is
 * done, the daily cap is reached, or `budgetMs` has passed (the cron and the
 * send's waitUntil). A campaign with nobody left is marked done.
 */
export async function runCampaigns(env: Env, { budgetMs = 20_000, t = now() } = {}): Promise<{ emailed: number; done: number }> {
  const started = Date.now();
  const { DB } = env;
  let emailed = 0;
  let done = 0;
  try {
    const ids = (await DB.prepare("SELECT id FROM campaigns WHERE status = 'sending' ORDER BY started_at").all<{ id: string }>()).results.map((r) => r.id);
    for (const id of ids) {
      for (;;) {
        // Read each time: a cancel takes effect at the next batch.
        const c = await DB.prepare("SELECT * FROM campaigns WHERE id = ? AND status = 'sending'").bind(id).first<CampaignRow>();
        if (!c) break;
        const result = await processBatch(env, c, t);
        emailed += result.emailed;
        done += result.done;
        if (result.capped) {
          log('warn', 'Campaign emails hit the daily cap; the rest go out tomorrow', { campaign: id });
          return { emailed, done };
        }
        if (result.done === 0) {
          const left = await DB.prepare('SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ? AND done_at IS NULL').bind(id).first<{ n: number }>();
          // Nothing left (or only emails a parallel run is still sending): done when none is pending.
          if (!left?.n) await DB.prepare("UPDATE campaigns SET status = 'done', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'").bind(t, t, id).run();
          break;
        }
        if (Date.now() - started > budgetMs) return { emailed, done };
      }
    }
  } catch (e) {
    log('error', 'Running campaigns failed', { error: errorText(e) });
    await recordEvent(env, 'error', 'campaign_failed', 'Running campaigns failed', { error: errorText(e).split('\n')[0] });
  }
  return { emailed, done };
}

// ---- Users: the announcement, product news, the unsubscribe link ----

/** GET /api/me/announcement: the newest undismissed one (credits once granted), or null; marks it shown. */
export async function getAnnouncement(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const { DB } = ctx.env;
  const t = now();
  const row = await DB.prepare(
    `SELECT c.id, c.subject, c.body, c.link_url, c.link_label, c.credits_mc, r.granted, r.shown_at, u.display_name
     FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id JOIN users u ON u.id = r.user_id
     WHERE r.user_id = ? AND r.dismissed_at IS NULL AND c.inapp = 1 AND c.status IN ('sending', 'done') AND c.started_at > ?
       AND (c.credits_mc = 0 OR r.granted = 1)
     ORDER BY c.started_at DESC LIMIT 1`,
  )
    .bind(user.id, t - ANNOUNCEMENT_DAYS * DAY)
    .first<{ id: string; subject: string; body: string; link_url: string | null; link_label: string | null; credits_mc: number; granted: number; shown_at: number | null; display_name: string }>();
  if (!row) return json({ announcement: null }, 200, NO_STORE);
  if (row.shown_at === null) await DB.prepare('UPDATE campaign_recipients SET shown_at = ? WHERE campaign_id = ? AND user_id = ? AND shown_at IS NULL').bind(t, row.id, user.id).run();
  return json(
    {
      announcement: {
        id: row.id,
        title: row.subject,
        body: row.body,
        link: row.link_url ? { url: row.link_url, label: row.link_label ?? 'Open' } : null,
        credits: row.credits_mc > 0 && row.granted === 1 ? creditsOf(row.credits_mc) : null,
        values: valuesOf(row.display_name, row.credits_mc),
      },
    },
    200,
    NO_STORE,
  );
}

/** POST /api/me/announcement/<id>/dismiss | click: a click also dismisses it. 204 either way. */
export async function markAnnouncement(request: Request, ctx: Ctx, id: string, what: 'dismiss' | 'click'): Promise<Response> {
  const user = await requireUser(request, ctx);
  const t = now();
  await ctx.env.DB.prepare(
    `UPDATE campaign_recipients SET dismissed_at = COALESCE(dismissed_at, ?1), clicked_at = CASE WHEN ?2 THEN COALESCE(clicked_at, ?1) ELSE clicked_at END
     WHERE campaign_id = ?3 AND user_id = ?4`,
  )
    .bind(t, what === 'click' ? 1 : 0, id, user.id)
    .run();
  return new Response(null, { status: 204 });
}

/** Product news for the account: on unless opted out, and where it goes ('email' sign-in, 'github' or 'google', or null without an address). */
async function newsPrefs(DB: D1Database, userId: string) {
  const row = await DB.prepare(
    `SELECT (SELECT el.email FROM email_logins el WHERE el.user_id = ?1 AND el.confirmed_at IS NOT NULL) AS login,
       (SELECT ce.email FROM contact_emails ce WHERE ce.user_id = ?1) AS contact,
       (SELECT ce.provider FROM contact_emails ce WHERE ce.user_id = ?1) AS provider,
       (SELECT 1 FROM news_optouts n WHERE n.user_id = ?1) AS opted_out`,
  )
    .bind(userId)
    .first<{ login: string | null; contact: string | null; provider: string | null; opted_out: number | null }>();
  return {
    on: !row?.opted_out,
    email: row?.login ?? row?.contact ?? null,
    source: row?.login ? 'email' : row?.contact ? row.provider : null,
  };
}

/** GET /api/me/news */
export async function getNews(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  return json(await newsPrefs(ctx.env.DB, user.id), 200, NO_STORE);
}

/** PUT /api/me/news {on} */
export async function putNews(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const body = await readJson(request, 1024);
  if (typeof body.on !== 'boolean') throw new HttpError(400, 'on must be true or false');
  const { DB } = ctx.env;
  if (body.on) await DB.prepare('DELETE FROM news_optouts WHERE user_id = ?').bind(user.id).run();
  else await DB.prepare("INSERT INTO news_optouts (user_id, at, via) VALUES (?, ?, 'settings') ON CONFLICT (user_id) DO NOTHING").bind(user.id, now()).run();
  return json(await newsPrefs(DB, user.id), 200, NO_STORE);
}

/** Download my data: product news, the contact address, and the campaigns that reached the account. */
export async function exportNews(DB: D1Database, userId: string) {
  const [optout, contact, campaigns] = await DB.batch([
    DB.prepare('SELECT at, via FROM news_optouts WHERE user_id = ?').bind(userId),
    DB.prepare('SELECT email, provider, updated_at FROM contact_emails WHERE user_id = ?').bind(userId),
    DB.prepare('SELECT campaign_id, granted, email_status, at, shown_at, dismissed_at, clicked_at FROM campaign_recipients WHERE user_id = ? ORDER BY rowid').bind(userId),
  ]);
  const o = optout.results[0] as { at: number; via: string } | undefined;
  const ce = contact.results[0] as { email: string; provider: string; updated_at: number } | undefined;
  return {
    productNews: { on: !o, optedOutAt: o?.at ?? null, via: o?.via ?? null },
    contactEmail: ce ? { email: ce.email, provider: ce.provider, updatedAt: ce.updated_at } : null,
    campaigns: (campaigns.results as Record<string, string | number | null>[]).map((r) => ({
      campaignId: r.campaign_id,
      granted: r.granted === 1,
      emailStatus: r.email_status,
      at: r.at,
      shownAt: r.shown_at,
      dismissedAt: r.dismissed_at,
      clickedAt: r.clicked_at,
    })),
  };
}

const LOOKS = {
  confirm: { accent: 'pink', emoji: '📣', kernel: 'Kernel will stop paging you about launches. Streak reminders are a separate pager.' },
  gone: { accent: 'lilac', emoji: '💤', kernel: 'Noted in the runbook: no product news for this inbox. Kernel went back to its nap. 😴' },
  expired: { accent: 'red', emoji: '⌛', kernel: 'Kernel checked the logs: this link timed out. Settings has the switch.' },
} as const satisfies Record<string, { accent: Accent; emoji: string; kernel: string }>;

function page(look: keyof typeof LOOKS, title: string, message: string, action?: { label: string; url: string }, status = 200): Response {
  return new Response(pageHtml({ title, message, action, ...LOOKS[look] }), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

const EXPIRED = 'This link is no longer valid. Turn product news off in Settings › Notifications instead.';

/** GET /api/news/unsubscribe?token=: the page with the button; changes nothing (mail scanners open links). */
export async function newsUnsubscribePage(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const url = new URL(request.url);
  if (!(await readUnsubscribeToken(ctx.env, url.searchParams.get('token')))) return page('expired', 'This link has expired', EXPIRED, undefined, 400);
  return page('confirm', 'Stop product news', 'Stop emails about new Proschi features? Reminders you turned on, and account emails, are not affected.', {
    label: 'Stop product news',
    url: `${url.pathname}${url.search}`,
  });
}

/**
 * POST /api/news/unsubscribe?token=: one-click (RFC 8058: mail clients POST
 * without a session or Origin). Records the opt-out; 400 for a forged or
 * expired token, 200 otherwise (also when already off).
 */
export async function newsUnsubscribe(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const claim = await readUnsubscribeToken(ctx.env, new URL(request.url).searchParams.get('token'));
  if (!claim) return page('expired', 'This link has expired', EXPIRED, undefined, 400);
  await ctx.env.DB.prepare('INSERT INTO news_optouts (user_id, at, via) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?1) ON CONFLICT (user_id) DO NOTHING')
    .bind(claim.u, now(), `link:${claim.c}`.slice(0, 80))
    .run();
  return page('gone', 'No more product news', 'You will get no more product news from Proschi. Turn it back on any time in Settings › Notifications.');
}
