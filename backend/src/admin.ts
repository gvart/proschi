import { SIM_VERSION } from '../../frontend/src/sim/version';
import { METRIC_EVENTS } from '../../frontend/src/services/metricsEvents';
import { TOKEN_CAP, VERDICT_RESERVE } from './ai/budget';
import { auditStatement, requireAdmin, MIN_SETUP_TOKEN } from './adminAuth';
import { cleanName, configuredProviders } from './auth';
import { billingConfigured } from './billing';
import type { Ctx } from './context';
import { now, secretOk, type Env } from './env';
import { credits as creditsOf, creditsView } from './credits';
import { MC } from './plans';
import { HttpError, json, readJson } from './http';
import { errorText } from './log';
import { deleteFeedbackFiles } from './feedback';
import { effectivePlan, effectivePlanSql } from './plans';

/**
 * The admin panel's data (/admin/, backend/README.md "Admin panel"); every
 * route needs an admin session (src/adminAuth.ts). What the admin changes is
 * written to the audit log (`admin_audit`) in the same batch as the change.
 *
 *   GET    /api/admin/overview                   users, sign-ups, activity, content and usage counts
 *   GET    /api/admin/trends?days=7|30|90       the overview's daily series for the range and the one before
 *   GET    /api/admin/health                     database, cron jobs, configuration, errors
 *   GET    /api/admin/users?q=&filter=&sort=&offset=   accounts, 50 at a time
 *   GET    /api/admin/users/<id>                 one account in detail
 *   PATCH  /api/admin/users/<id> {displayName?, publicProfile?}
 *   POST   /api/admin/users/<id>/block {reason?} blocks it: signed out everywhere, no sign-in, profile and short links hidden
 *   POST   /api/admin/users/<id>/unblock
 *   POST   /api/admin/users/<id>/sign-out        ends its sessions and apps' tokens
 *   DELETE /api/admin/users/<id>/email           removes its email reminders' address
 *   DELETE /api/admin/users/<id>                 deletes the account and everything in it
 *   GET    /api/admin/users/<id>/credits?offset= its credit ledger, newest first, 50 at a time
 *   POST   /api/admin/users/<id>/credits {kind: grant|revoke, credits, ref, reason}   top-up credits (up to 3 decimals), once per ref
 *   POST   /api/admin/users/<id>/comp {until, reason}   Pro until `until` (Unix seconds), whatever Polar says
 *   POST   /api/admin/users/<id>/comp/end {reason}      ends a comp early
 *   GET    /api/admin/billing?offset=            Pro and Max accounts, subscriber and order counts, recent orders and refunds
 *   GET    /api/admin/ai                         AI interviews and reviews per day, tokens and cost, credits charged against cost, top users
 *   GET    /api/admin/webhooks?outcome=&before=  Polar's webhook deliveries, newest first
 *   GET    /api/admin/document-shares?q=&state=live|all&offset=   live share links, newest first
 *   DELETE /api/admin/document-shares/<token>    revokes one
 *   GET    /api/admin/shares?q=&offset=          short links, newest first
 *   DELETE /api/admin/shares/<id>
 *   GET    /api/admin/events?kind=&level=&before=   app events, newest first
 *   GET    /api/admin/audit?before=              the audit log, newest first
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
const PAGE = 50;
const DAY = 86_400;
export const AUDIT_RETENTION_DAYS = 400;

const utcDay = (t: number): string => new Date(t * 1000).toISOString().slice(0, 10);

/** `a***@example.com`: enough to recognise an address, not to copy it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

function offsetOf(url: URL): number {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return Number.isInteger(offset) && offset >= 0 && offset <= 1_000_000 ? offset : 0;
}

/** A LIKE pattern matching `text` anywhere, its own % and _ taken literally. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** GET /api/admin/overview */
export async function getOverview(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const { DB } = ctx.env;
  const t = now();
  const today = utcDay(t);
  const dayAgo = (n: number) => utcDay(t - n * DAY);
  const since30 = t - 30 * DAY;
  const [users, signups, content, usage, events, spend] = await DB.batch([
    DB.prepare(
      `SELECT COUNT(*) AS total,
         COALESCE(SUM(blocked_at IS NOT NULL), 0) AS blocked,
         COALESCE(SUM(public_profile = 1), 0) AS public,
         COALESCE(SUM(created_at >= ?1), 0) AS new_1d,
         COALESCE(SUM(created_at >= ?2), 0) AS new_7d,
         COALESCE(SUM(created_at >= ?3), 0) AS new_30d,
         COALESCE(SUM(last_seen_day = ?4), 0) AS active_1d,
         COALESCE(SUM(last_seen_day >= ?5), 0) AS active_7d,
         COALESCE(SUM(last_seen_day >= ?6), 0) AS active_30d,
         (SELECT COUNT(*) FROM email_prefs WHERE confirmed_at IS NOT NULL) AS emails
       FROM users`,
    ).bind(t - DAY, t - 7 * DAY, since30, today, dayAgo(6), dayAgo(29)),
    DB.prepare(`SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`).bind(since30),
    DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM shares) AS shares,
         (SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL) AS documents,
         (SELECT COUNT(*) FROM progress) AS attempts,
         (SELECT COUNT(*) FROM progress WHERE solved_at IS NOT NULL) AS solves,
         (SELECT COUNT(*) FROM card_reviews) AS card_reviews,
         (SELECT COUNT(*) FROM challenge_attempts WHERE submitted_at IS NOT NULL) AS challenges,
         (SELECT COUNT(*) FROM game_runs WHERE submitted_at IS NOT NULL) AS game_runs`,
    ),
    DB.prepare('SELECT day, event, count FROM daily_counts WHERE day >= ? ORDER BY day').bind(dayAgo(29)),
    DB.prepare(`SELECT kind, level, COUNT(*) AS n FROM app_events WHERE at >= ? GROUP BY kind, level`).bind(t - DAY),
    // AI interviews' cost by the UTC day they started (ai_interviews times are Unix ms).
    DB.prepare(`SELECT date(started_at / 1000, 'unixepoch') AS day, SUM(cost_usd) AS cost FROM ai_interviews WHERE started_at >= ? GROUP BY day`).bind(
      Date.parse(`${dayAgo(29)}T00:00:00Z`),
    ),
  ]);
  const spendByDay = new Map((spend.results as { day: string; cost: number }[]).map((r) => [r.day, r.cost]));
  const u = users.results[0] as Record<string, number>;
  const c = content.results[0] as Record<string, number>;
  const days: { day: string; counts: Record<string, number> }[] = [];
  const byDay = new Map<string, Record<string, number>>();
  for (let i = 29; i >= 0; i--) {
    const counts: Record<string, number> = {};
    days.push({ day: dayAgo(i), counts });
    byDay.set(dayAgo(i), counts);
  }
  for (const r of usage.results as { day: string; event: string; count: number }[]) {
    const counts = byDay.get(r.day);
    if (counts) counts[r.event] = r.count;
  }
  const signupsByDay = new Map((signups.results as { day: string; n: number }[]).map((r) => [r.day, r.n]));
  return json(
    {
      users: {
        total: u.total,
        blocked: u.blocked,
        public: u.public,
        emailReminders: u.emails,
        new: { day: u.new_1d, week: u.new_7d, month: u.new_30d },
        active: { day: u.active_1d, week: u.active_7d, month: u.active_30d },
      },
      signups: days.map(({ day }) => ({ day, count: signupsByDay.get(day) ?? 0 })),
      content: {
        shares: c.shares,
        documents: c.documents,
        attempts: c.attempts,
        solves: c.solves,
        cardReviews: c.card_reviews,
        challenges: c.challenges,
        gameRuns: c.game_runs,
      },
      usage: { events: METRIC_EVENTS, days },
      events: events.results,
      aiSpend: days.map(({ day }) => ({ day, costUsd: spendByDay.get(day) ?? 0 })),
    },
    200,
    NO_STORE,
  );
}

/** The tables the health page counts rows of. */
const TABLES = [
  'users',
  'identities',
  'sessions',
  'progress',
  'card_reviews',
  'card_state',
  'achievements',
  'lesson_reads',
  'challenge_attempts',
  'game_meta',
  'game_runs',
  'shares',
  'documents',
  'document_versions',
  'document_shares',
  'billing',
  'billing_events',
  'billing_webhooks',
  'credits',
  'credit_holds',
  'credit_charges',
  'signup_identities',
  'refunded_orders',
  'account_tombstones',
  'ai_interviews',
  'ai_interview_messages',
  'roadmap_recs',
  'email_prefs',
  'daily_counts',
  'app_events',
  'admin_audit',
  'feedback_messages',
  'feedback_files',
] as const;

/** The daily and hourly jobs (src/cron.ts) that record a `cron` event when they run. */
export const CRON_JOBS = ['reminders', 'campaigns','sessions', 'game_runs', 'tombstones', 'usage_counts', 'app_events', 'interview_transcripts', 'credit_holds', 'partner_transcripts', 'email_sign_in', 'billing_webhooks'] as const;

/** GET /api/admin/health */
export async function getHealth(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const { env } = ctx;
  const { DB } = env;
  const t = now();
  const started = Date.now();
  let database: { ok: boolean; latencyMs: number; sizeBytes?: number; error?: string; migration?: string };
  let tables: Record<string, number> = {};
  try {
    const ping = await DB.prepare('SELECT 1').run();
    database = { ok: true, latencyMs: Date.now() - started, sizeBytes: ping.meta.size_after };
    const counts = await DB.batch(TABLES.map((name) => DB.prepare(`SELECT COUNT(*) AS n FROM ${name}`)));
    tables = Object.fromEntries(TABLES.map((name, i) => [name, (counts[i].results[0] as { n: number }).n]));
    const migration = await DB.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
      .first<{ name: string }>()
      .catch(() => null);
    if (migration) database.migration = migration.name;
  } catch (e) {
    database = { ok: false, latencyMs: Date.now() - started, error: errorText(e).split('\n')[0] };
  }
  const [cron, errors, email, reminders, lastError] = await DB.batch([
    DB.prepare(
      `SELECT e.message AS job, e.level, e.at, e.detail FROM app_events e
       JOIN (SELECT message, MAX(id) AS id FROM app_events WHERE kind = 'cron' GROUP BY message) last ON last.id = e.id ORDER BY e.message`,
    ),
    DB.prepare(
      `SELECT kind, COALESCE(SUM(at >= ?1), 0) AS day, COUNT(*) AS week FROM app_events
       WHERE at >= ?2 AND kind IN ('server_error', 'rate_limited', 'sign_in_failed', 'blocked_sign_in', 'reminder_failed', 'admin_sign_in_failed') GROUP BY kind`,
    ).bind(t - DAY, t - 7 * DAY),
    DB.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(confirmed_at IS NOT NULL), 0) AS confirmed, COALESCE(SUM(paused_at IS NOT NULL), 0) AS paused FROM email_prefs`,
    ),
    DB.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM daily_counts WHERE event = 'email_reminder_sent' AND day >= ?`).bind(utcDay(t - 6 * DAY)),
    DB.prepare(`SELECT at, message, detail FROM app_events WHERE kind = 'server_error' ORDER BY id DESC LIMIT 1`),
  ]);
  const version = env.CF_VERSION_METADATA;
  return json(
    {
      checkedAt: t,
      worker: {
        environment: env.ENVIRONMENT ?? 'development',
        simVersion: SIM_VERSION,
        ...(version ? { versionId: version.id, versionTag: version.tag || undefined, deployedAt: version.timestamp } : {}),
      },
      database: { ...database, tables },
      cron: { jobs: CRON_JOBS, runs: (cron.results as { job: string; level: string; at: number; detail: string | null }[]).map((r) => ({ ...r, detail: parse(r.detail) })) },
      errors: Object.fromEntries((errors.results as { kind: string; day: number; week: number }[]).map((r) => [r.kind, { day: r.day, week: r.week }])),
      lastError: lastError.results[0] ? { ...(lastError.results[0] as object), detail: parse((lastError.results[0] as { detail: string | null }).detail) } : null,
      email: { ...(email.results[0] as object), bound: Boolean(env.EMAIL), sentLast7Days: (reminders.results[0] as { n: number }).n },
      config: {
        sessionSecret: secretOk(env),
        providers: configuredProviders(env),
        appRedirects: Boolean(env.APP_REDIRECT_URIS?.trim()),
        metricsToken: (env.METRICS_TOKEN?.length ?? 0) >= 16,
        // Still set once the admin is set up: it only works while there is no passkey, but is better removed.
        setupToken: (env.ADMIN_SETUP_TOKEN?.length ?? 0) >= MIN_SETUP_TOKEN,
        // The paid features: whether each is set, never its value (POLAR_SERVER is no secret: sandbox or live).
        anthropicKey: Boolean(env.ANTHROPIC_API_KEY),
        aiGateway: Boolean(env.AI_GATEWAY_URL),
        polar: {
          accessToken: Boolean(env.POLAR_ACCESS_TOKEN),
          webhookSecret: Boolean(env.POLAR_WEBHOOK_SECRET),
          productProMonthly: Boolean(env.POLAR_PRODUCT_PRO_MONTHLY),
          productProYearly: Boolean(env.POLAR_PRODUCT_PRO_YEARLY),
          productMaxMonthly: Boolean(env.POLAR_PRODUCT_MAX_MONTHLY),
          productMaxYearly: Boolean(env.POLAR_PRODUCT_MAX_YEARLY),
          productCredits1000: Boolean(env.POLAR_PRODUCT_CREDITS_1000),
        },
        polarServer: polarServer(env),
        billing: billingConfigured(env),
      },
    },
    200,
    NO_STORE,
  );
}

function parse(detail: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

type Filter = 'all' | 'blocked' | 'active' | 'public' | 'email';
const FILTERS: Record<Filter, string> = {
  all: '1',
  blocked: 'u.blocked_at IS NOT NULL',
  active: 'u.last_seen_day >= ?3',
  public: 'u.public_profile = 1',
  email: 'EXISTS (SELECT 1 FROM email_prefs e WHERE e.user_id = u.id)',
};
const SORTS: Record<string, string> = {
  created: 'u.created_at DESC, u.id',
  seen: 'u.last_seen_day IS NULL, u.last_seen_day DESC, u.created_at DESC, u.id',
  name: 'u.display_name COLLATE NOCASE, u.id',
  solved: 'solved DESC, u.created_at DESC, u.id',
};

/** GET /api/admin/users?q=&filter=all|blocked|active|public|email&sort=created|seen|name|solved&offset= */
export async function listUsers(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const filter = (url.searchParams.get('filter') ?? 'all') as Filter;
  if (!Object.prototype.hasOwnProperty.call(FILTERS, filter)) throw new HttpError(400, `filter must be one of ${Object.keys(FILTERS).join(', ')}`);
  const sort = url.searchParams.get('sort') ?? 'created';
  if (!Object.prototype.hasOwnProperty.call(SORTS, sort)) throw new HttpError(400, `sort must be one of ${Object.keys(SORTS).join(', ')}`);
  const offset = offsetOf(url);
  // ?1 the query as typed (an id or a provider's user id), ?2 as a pattern on the display name, ?3 a week ago (the last
  // parameter is always bound and used, as D1 refuses bindings a statement does not use).
  const where = `(?1 = '' OR u.id = ?1 OR u.display_name LIKE ?2 ESCAPE '\\' OR EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.subject = ?1))
    AND ${FILTERS[filter]} AND ?3 IS NOT NULL`;
  const params = [q, contains(q), utcDay(now() - 6 * DAY)];
  const { DB } = ctx.env;
  const [rows, total] = await DB.batch([
    DB.prepare(
      `SELECT u.id, u.display_name, u.public_profile, u.created_at, u.last_seen_day, u.blocked_at, u.blocked_reason,
         (SELECT group_concat(provider) FROM identities i WHERE i.user_id = u.id) AS providers,
         (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id AND p.solved_at IS NOT NULL) AS solved,
         EXISTS (SELECT 1 FROM email_prefs e WHERE e.user_id = u.id) AS has_email
       FROM users u WHERE ${where} ORDER BY ${SORTS[sort]} LIMIT ${PAGE} OFFSET ${offset}`,
    ).bind(...params),
    DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`).bind(...params),
  ]);
  type Row = {
    id: string;
    display_name: string;
    public_profile: number;
    created_at: number;
    last_seen_day: string | null;
    blocked_at: number | null;
    blocked_reason: string | null;
    providers: string | null;
    solved: number;
    has_email: number;
  };
  return json(
    {
      total: (total.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE,
      users: (rows.results as unknown as Row[]).map((r) => ({
        id: r.id,
        displayName: r.display_name,
        publicProfile: r.public_profile === 1,
        createdAt: r.created_at,
        lastSeenDay: r.last_seen_day,
        blockedAt: r.blocked_at,
        blockedReason: r.blocked_reason,
        providers: r.providers ? r.providers.split(',').sort() : [],
        solved: r.solved,
        hasEmail: r.has_email === 1,
      })),
    },
    200,
    NO_STORE,
  );
}

const USER_ID = /^[0-9a-f-]{36}$/;

function assertUserId(id: string): void {
  if (!USER_ID.test(id)) throw new HttpError(404, 'No such user');
}

/** GET /api/admin/users/<id> */
export async function getUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  await requireAdmin(request, ctx);
  assertUserId(id);
  const { DB } = ctx.env;
  const user = await DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, string | number | null>>();
  if (!user) throw new HttpError(404, 'No such user');
  const [identities, sessions, progress, cards, achievements, challenges, game, shares, documents, versions, email, lessons, audit, billing] = await DB.batch([
    DB.prepare('SELECT provider, subject FROM identities WHERE user_id = ? ORDER BY provider').bind(id),
    DB.prepare('SELECT kind, COUNT(*) AS n, MAX(created_at) AS last_created FROM sessions WHERE user_id = ? AND expires_at > ? GROUP BY kind').bind(id, now()),
    DB.prepare('SELECT problem_id, runs, first_run_at, updated_at, solved_at, runs_to_solve FROM progress WHERE user_id = ? ORDER BY updated_at DESC').bind(id),
    DB.prepare('SELECT COUNT(*) AS reviews, MAX(reviewed_at) AS last, (SELECT COUNT(*) FROM card_state WHERE user_id = ?1) AS cards FROM card_reviews WHERE user_id = ?1').bind(id),
    DB.prepare('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?').bind(id),
    DB.prepare('SELECT COUNT(*) AS n, MAX(score) AS best, MAX(day) AS last FROM challenge_attempts WHERE user_id = ? AND submitted_at IS NOT NULL').bind(id),
    DB.prepare('SELECT COUNT(*) AS runs, COALESCE(SUM(submitted_at IS NOT NULL), 0) AS submitted, MAX(score) AS best, MAX(started_at) AS last FROM game_runs WHERE user_id = ?').bind(id),
    DB.prepare('SELECT id, title, created_at, image IS NOT NULL AS has_image FROM shares WHERE user_id = ? ORDER BY created_at DESC').bind(id),
    DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(source)), 0) AS bytes, MAX(updated_at) AS last FROM documents WHERE user_id = ? AND deleted_at IS NULL').bind(id),
    DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM document_versions WHERE user_id = ? AND deleted_at IS NULL').bind(id),
    DB.prepare('SELECT email, confirmed_at, paused_at, streak_on, cards_on, recap_on, time_zone, last_sent_at FROM email_prefs WHERE user_id = ?').bind(id),
    DB.prepare('SELECT COUNT(*) AS n FROM lesson_reads WHERE user_id = ?').bind(id),
    DB.prepare('SELECT id, at, action, detail FROM admin_audit WHERE target = ? ORDER BY id DESC LIMIT 20').bind(id),
    DB.prepare('SELECT polar_customer_id, polar_subscription_id, status, product, current_period_end, cancel_at_period_end, updated_at FROM billing WHERE user_id = ?').bind(id),
  ]);
  const credits = await creditsView(ctx.env, id);
  type Row = Record<string, string | number | null>;
  const first = (r: D1Result) => (r.results[0] ?? {}) as Row;
  const e = email.results[0] as Row | undefined;
  return json(
    {
      user: {
        id: user.id,
        displayName: user.display_name,
        publicProfile: user.public_profile === 1,
        dailyGoal: user.daily_goal,
        createdAt: user.created_at,
        lastSeenDay: user.last_seen_day,
        blockedAt: user.blocked_at,
        blockedReason: user.blocked_reason,
        plan: user.plan,
        compUntil: user.comp_until,
        effectivePlan: effectivePlan(user.plan as string, user.comp_until as number | null),
      },
      billing: billingOf(billing.results[0] as Row | undefined),
      credits,
      polarDashboard: polarDashboard(ctx.env),
      identities: identities.results,
      sessions: (sessions.results as Row[]).map((r) => ({ kind: r.kind, count: r.n, lastCreatedAt: r.last_created })),
      progress: (progress.results as Row[]).map((r) => ({
        problemId: r.problem_id,
        runs: r.runs,
        firstRunAt: r.first_run_at,
        updatedAt: r.updated_at,
        solvedAt: r.solved_at,
        runsToSolve: r.runs_to_solve,
      })),
      cards: { reviews: first(cards).reviews ?? 0, cards: first(cards).cards ?? 0, lastReviewAt: first(cards).last ?? null },
      achievements: first(achievements).n ?? 0,
      lessonsRead: first(lessons).n ?? 0,
      challenges: { submitted: first(challenges).n ?? 0, best: first(challenges).best ?? null, lastDay: first(challenges).last ?? null },
      game: { runs: first(game).runs ?? 0, submitted: first(game).submitted ?? 0, best: first(game).best ?? null, lastStartedAt: first(game).last ?? null },
      shares: (shares.results as Row[]).map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, hasImage: r.has_image === 1 })),
      documents: { count: first(documents).n ?? 0, bytes: first(documents).bytes ?? 0, lastUpdatedAt: first(documents).last ?? null },
      documentVersions: { count: first(versions).n ?? 0, bytes: first(versions).bytes ?? 0 },
      email: e
        ? {
            address: maskEmail(String(e.email)),
            confirmed: e.confirmed_at !== null,
            paused: e.paused_at !== null,
            reminders: { streak: e.streak_on === 1, cards: e.cards_on === 1, recap: e.recap_on === 1 },
            timeZone: e.time_zone,
            lastSentAt: e.last_sent_at,
          }
        : null,
      audit: (audit.results as Row[]).map((r) => ({ id: r.id, at: r.at, action: r.action, detail: parse(r.detail as string | null) })),
    },
    200,
    NO_STORE,
  );
}

/** 404 unless the user exists. */
async function assertUser(ctx: Ctx, id: string): Promise<void> {
  assertUserId(id);
  if (!(await ctx.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(id).first())) throw new HttpError(404, 'No such user');
}

const signOutStatements = (ctx: Ctx, id: string) => [
  ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
  ctx.env.DB.prepare('DELETE FROM app_auth_codes WHERE user_id = ?').bind(id),
];

/** PATCH /api/admin/users/<id> {displayName?, publicProfile?}: a name that slipped past moderation, or a profile to take down. */
export async function patchUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const body = await readJson(request);
  const sets: string[] = [];
  const values: (string | number)[] = [];
  const changed: Record<string, unknown> = {};
  if (body.displayName !== undefined) {
    const name = typeof body.displayName === 'string' ? cleanName(body.displayName) : undefined;
    if (!name) throw new HttpError(400, 'displayName must be a non-empty string');
    sets.push('display_name = ?');
    values.push(name);
    changed.displayName = true;
  }
  if (body.publicProfile !== undefined) {
    if (typeof body.publicProfile !== 'boolean') throw new HttpError(400, 'publicProfile must be true or false');
    sets.push('public_profile = ?');
    values.push(body.publicProfile ? 1 : 0);
    changed.publicProfile = body.publicProfile;
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to change: give displayName or publicProfile');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id),
    auditStatement(ctx.env, admin, 'user.update', id, changed),
  ]);
  return new Response(null, { status: 204 });
}

const MAX_REASON = 500;

/**
 * POST /api/admin/users/<id>/block {reason?}: signed out everywhere (apps
 * too), refused at sign-in, and every session check fails; the public
 * profile is turned off (the user can turn it on again once unblocked) and
 * short links answer 404 while blocked.
 */
export async function blockUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const body = await readJson(request);
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';
  const [blocked] = await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET blocked_at = ?, blocked_reason = ?, public_profile = 0 WHERE id = ? AND blocked_at IS NULL').bind(now(), reason || null, id),
    ...signOutStatements(ctx, id),
  ]);
  if (blocked.meta.changes === 0) throw new HttpError(409, 'Already blocked');
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'user.block', id, reason ? { reason } : undefined)]);
  return new Response(null, { status: 204 });
}

/** POST /api/admin/users/<id>/unblock */
export async function unblockUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const [unblocked] = await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET blocked_at = NULL, blocked_reason = NULL WHERE id = ? AND blocked_at IS NOT NULL').bind(id),
  ]);
  if (unblocked.meta.changes === 0) throw new HttpError(409, 'Not blocked');
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'user.unblock', id)]);
  return new Response(null, { status: 204 });
}

/** POST /api/admin/users/<id>/sign-out */
export async function signOutUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const [sessions] = await ctx.env.DB.batch([...signOutStatements(ctx, id), auditStatement(ctx.env, admin, 'user.sign_out', id)]);
  return json({ sessions: sessions.meta.changes }, 200, NO_STORE);
}

/** DELETE /api/admin/users/<id>/email */
export async function deleteUserEmail(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const [deleted] = await ctx.env.DB.batch([ctx.env.DB.prepare('DELETE FROM email_prefs WHERE user_id = ?').bind(id)]);
  if (deleted.meta.changes === 0) throw new HttpError(404, 'No email address');
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'user.email.delete', id)]);
  return new Response(null, { status: 204 });
}

/** DELETE /api/admin/users/<id>: the account and everything in it, as the user's own Delete account does. */
export async function deleteUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  await deleteFeedbackFiles(ctx.env, id);
  await ctx.env.DB.batch([ctx.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id), auditStatement(ctx.env, admin, 'user.delete', id)]);
  return new Response(null, { status: 204 });
}

/** GET /api/admin/shares?q=&offset=: q matches a short link's id, title or owner id. */
export async function listAdminShares(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const offset = offsetOf(url);
  const where = `(?1 = '' OR s.id = ?1 OR s.user_id = ?1 OR s.title LIKE ?2 ESCAPE '\\')`;
  const { DB } = ctx.env;
  const [rows, total] = await DB.batch([
    DB.prepare(
      `SELECT s.id, s.title, s.created_at, s.image IS NOT NULL AS has_image, length(s.source) AS bytes, s.user_id, u.display_name, u.blocked_at
       FROM shares s JOIN users u ON u.id = s.user_id WHERE ${where} ORDER BY s.created_at DESC, s.id LIMIT ${PAGE} OFFSET ${offset}`,
    ).bind(q, contains(q)),
    DB.prepare(`SELECT COUNT(*) AS n FROM shares s WHERE ${where}`).bind(q, contains(q)),
  ]);
  const origin = url.origin;
  type Row = { id: string; title: string; created_at: number; has_image: number; bytes: number; user_id: string; display_name: string; blocked_at: number | null };
  return json(
    {
      total: (total.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE,
      shares: (rows.results as unknown as Row[]).map((r) => ({
        id: r.id,
        url: `${origin}/s/${r.id}`,
        title: r.title,
        createdAt: r.created_at,
        hasImage: r.has_image === 1,
        bytes: r.bytes,
        owner: { id: r.user_id, displayName: r.display_name, blocked: r.blocked_at !== null },
      })),
    },
    200,
    NO_STORE,
  );
}

/** DELETE /api/admin/shares/<id> */
export async function deleteAdminShare(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const row = /^[0-9A-Za-z]{1,32}$/.test(id) ? await ctx.env.DB.prepare('SELECT user_id FROM shares WHERE id = ?').bind(id).first<{ user_id: string }>() : null;
  if (!row) throw new HttpError(404, 'No such short link');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(id),
    auditStatement(ctx.env, admin, 'share.delete', id, { owner: row.user_id }),
  ]);
  return new Response(null, { status: 204 });
}

function beforeOf(url: URL): number {
  const before = Number(url.searchParams.get('before') ?? 0);
  return Number.isInteger(before) && before > 0 ? before : Number.MAX_SAFE_INTEGER;
}

/** GET /api/admin/events?kind=&level=&before=<id>: 100 at a time, newest first; `next` is the `before` of the next page. */
export async function listEvents(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? '';
  const level = url.searchParams.get('level') ?? '';
  const { DB } = ctx.env;
  const [rows, kinds] = await DB.batch([
    DB.prepare(
      `SELECT id, at, level, kind, message, detail FROM app_events
       WHERE id < ?1 AND (?2 = '' OR kind = ?2) AND (?3 = '' OR level = ?3) ORDER BY id DESC LIMIT 100`,
    ).bind(beforeOf(url), kind, level),
    DB.prepare('SELECT kind, COUNT(*) AS n FROM app_events GROUP BY kind ORDER BY kind'),
  ]);
  const events = (rows.results as { id: number; at: number; level: string; kind: string; message: string; detail: string | null }[]).map((r) => ({ ...r, detail: parse(r.detail) }));
  return json({ events, kinds: kinds.results, next: events.length === 100 ? events[events.length - 1].id : null }, 200, NO_STORE);
}

/** GET /api/admin/audit?before=<id> */
export async function listAudit(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const { results } = await ctx.env.DB.prepare(
    `SELECT a.id, a.at, a.action, a.target, a.detail, p.name AS passkey FROM admin_audit a LEFT JOIN admin_passkeys p ON p.id = a.passkey_id
     WHERE a.id < ? ORDER BY a.id DESC LIMIT 100`,
  )
    .bind(beforeOf(url))
    .all<{ id: number; at: number; action: string; target: string | null; detail: string | null; passkey: string | null }>();
  const entries = results.map((r) => ({ ...r, detail: parse(r.detail) }));
  return json({ entries, next: entries.length === 100 ? entries[entries.length - 1].id : null }, 200, NO_STORE);
}

/** Deletes audit entries older than AUDIT_RETENTION_DAYS (the daily cron). */
export async function pruneAudit(env: Env): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM admin_audit WHERE at < ?').bind(now() - AUDIT_RETENTION_DAYS * DAY).run();
  return meta.changes;
}


// --- The paid product (docs/design/paid-plans.md P24) ----------------------
//
// The admin API answers Unix seconds throughout, as the panel formats them;
// the paid tables store Unix milliseconds, so those are divided here.

const seconds = (ms: number | null | undefined): number | null => (typeof ms === 'number' ? Math.floor(ms / 1000) : null);

/** Subscription statuses that keep Pro (src/billing.ts PRO_STATUSES). */
const PRO_STATUSES = ['active', 'trialing', 'past_due'];
const PRO_STATUSES_SQL = `(${PRO_STATUSES.map((s) => `'${s}'`).join(', ')})`;

/** POLAR_SERVER as the admin sees it: sandbox, or live otherwise (src/billing.ts apiBase). */
const polarServer = (env: Env): 'sandbox' | 'live' => (env.POLAR_SERVER === 'sandbox' ? 'sandbox' : 'live');

/**
 * Polar's dashboard, where refunds and everything about money are done
 * (Proschi never refunds itself): `/to/dashboard/<rest>` redirects to
 * `/dashboard/<the signed-in user's organization>/<rest>`, on sandbox.polar.sh
 * as on polar.sh (Polar's web app, `app/(main)/to/[...path]`); the panel
 * appends a customer's, an order's or a subscription's id
 * (frontend/src/admin/polarLinks.ts).
 */
export function polarDashboard(env: Env): { server: 'sandbox' | 'live'; customers: string; orders: string; subscriptions: string } {
  const base = polarServer(env) === 'sandbox' ? 'https://sandbox.polar.sh' : 'https://polar.sh';
  return {
    server: polarServer(env),
    customers: `${base}/to/dashboard/customers`,
    orders: `${base}/to/dashboard/sales`,
    subscriptions: `${base}/to/dashboard/sales/subscriptions`,
  };
}

type Row = Record<string, string | number | null>;

function billingOf(row: Row | undefined) {
  if (!row) return null;
  return {
    polarCustomerId: row.polar_customer_id,
    polarSubscriptionId: row.polar_subscription_id,
    status: row.status,
    product: row.product,
    currentPeriodEnd: seconds(row.current_period_end as number | null),
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    pastDue: row.status === 'past_due',
    updatedAt: seconds(row.updated_at as number | null),
  };
}

/** The reason an admin action must give: 400 without one. */
function reasonOf(body: Record<string, unknown>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';
  if (!reason) throw new HttpError(400, 'Give a reason: it goes in the audit log');
  return reason;
}

/** GET /api/admin/users/<id>/credits?offset=: the ledger, newest first. */
export async function listUserCredits(request: Request, ctx: Ctx, id: string): Promise<Response> {
  await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const offset = offsetOf(new URL(request.url));
  const { DB } = ctx.env;
  const [rows, total] = await DB.batch([
    DB.prepare(`SELECT id, kind, bucket, period, delta_mc, item, ref_id, created_at FROM credits WHERE user_id = ? ORDER BY id DESC LIMIT ${PAGE} OFFSET ${offset}`).bind(id),
    DB.prepare('SELECT COUNT(*) AS n FROM credits WHERE user_id = ?').bind(id),
  ]);
  return json(
    {
      total: (total.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE,
      entries: (rows.results as Row[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        bucket: r.bucket,
        period: r.period || null,
        credits: creditsOf(r.delta_mc as number),
        item: r.item,
        refId: r.ref_id,
        createdAt: seconds(r.created_at as number),
      })),
    },
    200,
    NO_STORE,
  );
}

const MAX_ADMIN_CREDITS = 10_000;
const REF = /^[A-Za-z0-9-]{8,64}$/;

/**
 * POST /api/admin/users/<id>/credits {kind: grant|revoke, credits, ref, reason}:
 * top-up credits (they never expire) given or taken back, as a ledger row of
 * kind admin_grant or admin_revoke; `credits` is a number of credits with up
 * to 3 decimals (stored in millicredits). `ref` is the panel's id of this one
 * action: sent again, it changes nothing and answers {duplicate: true}. A
 * revoke takes at most what the top-up balance has left, never below 0, and
 * answers 409 when it has none.
 */
export async function adjustCredits(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const body = await readJson(request);
  const kind = body.kind;
  if (kind !== 'grant' && kind !== 'revoke') throw new HttpError(400, 'kind must be grant or revoke');
  const credits = body.credits;
  const mc = typeof credits === 'number' ? Math.round(credits * MC) : NaN;
  if (typeof credits !== 'number' || !Number.isFinite(credits) || Math.abs(credits * MC - mc) > 1e-6 || mc < 1 || mc > MAX_ADMIN_CREDITS * MC) {
    throw new HttpError(400, `credits must be from 0.001 to ${MAX_ADMIN_CREDITS}, with at most 3 decimals`);
  }
  if (typeof body.ref !== 'string' || !REF.test(body.ref)) throw new HttpError(400, 'ref must be 8 to 64 letters, digits or dashes');
  const reason = reasonOf(body);
  const ledgerKind = kind === 'grant' ? 'admin_grant' : 'admin_revoke';
  const ref = `admin:${body.ref}`;
  const { DB } = ctx.env;
  const at = Date.now();
  const row =
    kind === 'grant'
      ? await DB.prepare(
          `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at) VALUES (?1, 'admin_grant', 'topup', '', ?2, 'admin', ?3, ?4)
           ON CONFLICT (kind, ref_id) DO NOTHING RETURNING delta_mc`,
        )
          .bind(id, mc, ref, at)
          .first<{ delta_mc: number }>()
      : // One statement, so a revoke can't race a charge below a zero top-up balance.
        await DB.prepare(
          `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
           SELECT ?1, 'admin_revoke', 'topup', '', -MIN(?2, topup), 'admin', ?3, ?4
           FROM (SELECT COALESCE(SUM(delta_mc), 0) AS topup FROM credits WHERE user_id = ?1 AND bucket = 'topup') WHERE topup > 0
           ON CONFLICT (kind, ref_id) DO NOTHING RETURNING delta_mc`,
        )
          .bind(id, mc, ref, at)
          .first<{ delta_mc: number }>();
  if (!row) {
    const earlier = await DB.prepare('SELECT user_id, delta_mc FROM credits WHERE kind = ? AND ref_id = ?').bind(ledgerKind, ref).first<{ user_id: string; delta_mc: number }>();
    if (earlier?.user_id === id) return json({ duplicate: true, delta: creditsOf(earlier.delta_mc), credits: await creditsView(ctx.env, id) }, 200, NO_STORE);
    if (earlier) throw new HttpError(409, 'That ref was used for another account');
    throw new HttpError(409, 'No top-up credits to revoke');
  }
  await DB.batch([auditStatement(ctx.env, admin, kind === 'grant' ? 'user.credits.grant' : 'user.credits.revoke', id, { credits: creditsOf(Math.abs(row.delta_mc)), reason, ref: body.ref })]);
  return json({ delta: creditsOf(row.delta_mc), credits: await creditsView(ctx.env, id) }, 200, NO_STORE);
}

const MAX_COMP_DAYS = 5 * 366;

/**
 * POST /api/admin/users/<id>/comp {until, reason}: Pro until `until` (Unix
 * seconds, in the future, at most 5 years ahead). It is `users.comp_until`
 * only: the effective plan (src/plans.ts) is Pro while it is in the future,
 * whatever the subscription; nothing is sent to Polar and no webhook ends it.
 */
export async function compUser(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const body = await readJson(request);
  const t = now();
  const until = body.until;
  if (typeof until !== 'number' || !Number.isInteger(until) || until <= t || until > t + MAX_COMP_DAYS * DAY) {
    throw new HttpError(400, 'until must be a time in the future, at most 5 years ahead, in Unix seconds');
  }
  const reason = reasonOf(body);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE users SET comp_until = ? WHERE id = ?').bind(until, id),
    auditStatement(ctx.env, admin, 'user.comp', id, { until, reason }),
  ]);
  return new Response(null, { status: 204 });
}

/** POST /api/admin/users/<id>/comp/end {reason}: ends a comp now; 409 without one running. A subscription is left as it is. */
export async function endComp(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  await assertUser(ctx, id);
  const reason = reasonOf(await readJson(request));
  const [ended] = await ctx.env.DB.batch([ctx.env.DB.prepare('UPDATE users SET comp_until = NULL WHERE id = ? AND comp_until > ?').bind(id, now())]);
  if (ended.meta.changes === 0) throw new HttpError(409, 'No comp running');
  await ctx.env.DB.batch([auditStatement(ctx.env, admin, 'user.comp.end', id, { reason })]);
  return new Response(null, { status: 204 });
}

/**
 * GET /api/admin/billing?offset=: the counts (Pro and Max accounts, monthly
 * and yearly subscribers of each, comps, top-up orders this month), the paid
 * accounts 50 at a time, and the latest top-up orders, credit adjustments and
 * refunded orders. No amounts of money: D1 stores none (the webhook keeps no
 * payload), so the panel shows counts, and prices only as the pricing page
 * lists them. Credits are in credits (3 decimals).
 */
export async function getBilling(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const offset = offsetOf(new URL(request.url));
  const { DB } = ctx.env;
  const t = now();
  const monthStart = Date.parse(`${new Date(t * 1000).toISOString().slice(0, 7)}-01T00:00:00Z`);
  const pro = `${effectivePlanSql('u', '?1')} IN ('pro', 'max')`;
  const [counts, list, orders, adjustments, refunded] = await DB.batch([
    DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users u WHERE ${effectivePlanSql('u', '?1')} = 'pro') AS pro,
         (SELECT COUNT(*) FROM users u WHERE ${effectivePlanSql('u', '?1')} = 'max') AS max,
         (SELECT COUNT(*) FROM billing WHERE status IN ${PRO_STATUSES_SQL} AND product = 'pro_monthly') AS monthly,
         (SELECT COUNT(*) FROM billing WHERE status IN ${PRO_STATUSES_SQL} AND product = 'pro_yearly') AS yearly,
         (SELECT COUNT(*) FROM billing WHERE status IN ${PRO_STATUSES_SQL} AND product = 'max_monthly') AS max_monthly,
         (SELECT COUNT(*) FROM billing WHERE status IN ${PRO_STATUSES_SQL} AND product = 'max_yearly') AS max_yearly,
         (SELECT COUNT(*) FROM billing WHERE status = 'past_due') AS past_due,
         (SELECT COUNT(*) FROM billing WHERE status IN ${PRO_STATUSES_SQL} AND cancel_at_period_end = 1) AS canceling,
         (SELECT COUNT(*) FROM users WHERE comp_until > ?1) AS comped,
         (SELECT COUNT(*) FROM credits WHERE kind = 'topup' AND created_at >= ?2) AS topups_month,
         (SELECT COUNT(*) FROM credits WHERE kind = 'topup') AS topups,
         (SELECT COUNT(*) FROM refunded_orders WHERE refunded_at >= ?2) AS refunded_month,
         (SELECT COUNT(*) FROM refunded_orders) AS refunded`,
    ).bind(t, monthStart),
    DB.prepare(
      `SELECT u.id, u.display_name, u.plan, u.comp_until, b.polar_customer_id, b.status, b.product, b.current_period_end, b.cancel_at_period_end
       FROM users u LEFT JOIN billing b ON b.user_id = u.id WHERE ${pro} ORDER BY u.display_name COLLATE NOCASE, u.id LIMIT ${PAGE} OFFSET ${offset}`,
    ).bind(t),
    DB.prepare(
      `SELECT c.ref_id, c.delta_mc, c.created_at, c.user_id, u.display_name, EXISTS (SELECT 1 FROM refunded_orders r WHERE r.order_id = c.ref_id) AS refunded
       FROM credits c JOIN users u ON u.id = c.user_id WHERE c.kind = 'topup' ORDER BY c.id DESC LIMIT 20`,
    ),
    DB.prepare(
      `SELECT c.kind, c.ref_id, c.delta_mc, c.created_at, c.user_id, u.display_name FROM credits c JOIN users u ON u.id = c.user_id
       WHERE c.kind IN ('topup_revoke', 'admin_revoke', 'admin_grant') ORDER BY c.id DESC LIMIT 20`,
    ),
    DB.prepare(
      `SELECT r.order_id, r.refunded_at, g.user_id, u.display_name FROM refunded_orders r
       LEFT JOIN credits g ON g.kind = 'topup' AND g.ref_id = r.order_id LEFT JOIN users u ON u.id = g.user_id ORDER BY r.refunded_at DESC LIMIT 20`,
    ),
  ]);
  const c = counts.results[0] as Record<string, number>;
  const owner = (r: Row) => (r.user_id ? { id: r.user_id, displayName: r.display_name } : null);
  return json(
    {
      counts: {
        pro: c.pro,
        max: c.max,
        monthly: c.monthly,
        yearly: c.yearly,
        maxMonthly: c.max_monthly,
        maxYearly: c.max_yearly,
        pastDue: c.past_due,
        canceling: c.canceling,
        comped: c.comped,
        topupOrdersThisMonth: c.topups_month,
        topupOrders: c.topups,
        refundedThisMonth: c.refunded_month,
        refunded: c.refunded,
      },
      total: c.pro + c.max,
      offset,
      pageSize: PAGE,
      pro: (list.results as Row[]).map((r) => {
        const comped = typeof r.comp_until === 'number' && r.comp_until > t;
        return {
          id: r.id,
          displayName: r.display_name,
          plan: effectivePlan(r.plan as string, r.comp_until as number | null),
          // What keeps the account on its plan: a subscription, a comp, or a plan set by hand.
          source: PRO_STATUSES.includes(String(r.status)) ? 'subscription' : comped ? 'comp' : 'plan',
          compUntil: comped ? r.comp_until : null,
          polarCustomerId: r.polar_customer_id,
          status: r.status,
          product: r.product,
          currentPeriodEnd: seconds(r.current_period_end as number | null),
          cancelAtPeriodEnd: r.cancel_at_period_end === 1,
        };
      }),
      orders: (orders.results as Row[]).map((r) => ({ orderId: r.ref_id, credits: creditsOf(r.delta_mc as number), createdAt: seconds(r.created_at as number), refunded: r.refunded === 1, user: owner(r) })),
      adjustments: (adjustments.results as Row[]).map((r) => ({ kind: r.kind, refId: r.ref_id, delta: creditsOf(r.delta_mc as number), createdAt: seconds(r.created_at as number), user: owner(r) })),
      refundedOrders: (refunded.results as Row[]).map((r) => ({ orderId: r.order_id, refundedAt: seconds(r.refunded_at as number), user: owner(r) })),
      polarDashboard: polarDashboard(ctx.env),
      billing: billingConfigured(ctx.env),
    },
    200,
    NO_STORE,
  );
}

/**
 * GET /api/admin/ai: the last 30 UTC days of AI interviews (started,
 * finished, failed, tokens and cost, by the day a session started), reviews,
 * and the credits charged per day against what those calls cost us
 * (`credit_charges`: `credits`, `chargedEur` at €0.01 a credit, and
 * `chargedCostUsd`), so the margin shows; the top accounts by cost, the
 * average cost of a finished interview and the share of sessions that reached
 * the token cap (TOKEN_CAP less the verdict's reserve: no more turns fit).
 */
export async function getAi(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const { DB } = ctx.env;
  const t = now();
  const dayAgo = (n: number) => utcDay(t - n * DAY);
  const since = Date.parse(`${dayAgo(29)}T00:00:00Z`);
  const cappedAt = TOKEN_CAP - VERDICT_RESERVE;
  const [perDay, charges, top, totals] = await DB.batch([
    DB.prepare(
      `SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS started, COALESCE(SUM(status = 'finished'), 0) AS finished,
         COALESCE(SUM(status = 'failed'), 0) AS failed, COALESCE(SUM(tokens), 0) AS tokens, COALESCE(SUM(cost_usd), 0) AS cost
       FROM ai_interviews WHERE started_at >= ? GROUP BY day`,
    ).bind(since),
    DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COALESCE(SUM(charged_mc), 0) AS mc, COALESCE(SUM(cost_usd), 0) AS cost,
         COALESCE(SUM(ref LIKE 'review:%'), 0) AS reviews
       FROM credit_charges WHERE created_at >= ? GROUP BY day`,
    ).bind(since),
    DB.prepare(
      `SELECT i.user_id, u.display_name, COUNT(*) AS sessions, SUM(i.tokens) AS tokens, SUM(i.cost_usd) AS cost
       FROM ai_interviews i JOIN users u ON u.id = i.user_id WHERE i.started_at >= ? GROUP BY i.user_id ORDER BY cost DESC, i.user_id LIMIT 10`,
    ).bind(since),
    DB.prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(tokens >= ?2), 0) AS capped, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(tokens), 0) AS tokens,
         COALESCE(SUM(status = 'finished'), 0) AS finished, AVG(CASE WHEN status = 'finished' THEN cost_usd END) AS avg_finished
       FROM ai_interviews WHERE started_at >= ?1`,
    ).bind(since, cappedAt),
  ]);
  const byDay = new Map((perDay.results as Row[]).map((r) => [r.day as string, r as Record<string, number>]));
  const chargesByDay = new Map((charges.results as { day: string; mc: number; cost: number; reviews: number }[]).map((r) => [r.day, r]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const day = dayAgo(29 - i);
    const r = byDay.get(day);
    const ch = chargesByDay.get(day);
    return {
      day,
      started: r?.started ?? 0,
      finished: r?.finished ?? 0,
      failed: r?.failed ?? 0,
      reviews: ch?.reviews ?? 0,
      tokens: r?.tokens ?? 0,
      costUsd: r?.cost ?? 0,
      credits: creditsOf(ch?.mc ?? 0),
      chargedEur: (ch?.mc ?? 0) / MC / 100,
      chargedCostUsd: ch?.cost ?? 0,
    };
  });
  const s = totals.results[0] as Record<string, number | null>;
  const sessions = s.sessions ?? 0;
  return json(
    {
      days,
      totals: {
        sessions,
        finished: s.finished ?? 0,
        tokens: s.tokens ?? 0,
        costUsd: s.cost ?? 0,
        avgCostPerFinished: s.avg_finished ?? null,
        capped: s.capped ?? 0,
        cappedShare: sessions ? (s.capped ?? 0) / sessions : null,
        reviews: days.reduce((sum, d) => sum + d.reviews, 0),
        credits: creditsOf(days.reduce((sum, d) => sum + Math.round(d.credits * MC), 0)),
        chargedEur: days.reduce((sum, d) => sum + d.chargedEur, 0),
        chargedCostUsd: days.reduce((sum, d) => sum + d.chargedCostUsd, 0),
      },
      tokenCap: TOKEN_CAP,
      cappedAt,
      topUsers: (top.results as Row[]).map((r) => ({ id: r.user_id, displayName: r.display_name, sessions: r.sessions, tokens: r.tokens, costUsd: r.cost })),
    },
    200,
    NO_STORE,
  );
}

const OUTCOMES = ['applied', 'duplicate', 'ignored', 'bad_signature', 'stale', 'error'];

/** GET /api/admin/webhooks?outcome=&before=<id>: Polar's deliveries, 100 at a time, newest first, with the counts per outcome over 7 days. */
export async function listWebhooks(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const outcome = url.searchParams.get('outcome') ?? '';
  if (outcome && !OUTCOMES.includes(outcome)) throw new HttpError(400, `outcome must be one of ${OUTCOMES.join(', ')}`);
  const { DB } = ctx.env;
  const [rows, counts] = await DB.batch([
    DB.prepare(
      `SELECT w.id, w.received_at, w.webhook_id, w.type, w.outcome, w.user_id, u.display_name FROM billing_webhooks w LEFT JOIN users u ON u.id = w.user_id
       WHERE w.id < ?1 AND (?2 = '' OR w.outcome = ?2) ORDER BY w.id DESC LIMIT 100`,
    ).bind(beforeOf(url), outcome),
    DB.prepare('SELECT outcome, COUNT(*) AS n FROM billing_webhooks WHERE received_at >= ? GROUP BY outcome ORDER BY outcome').bind(Date.now() - 7 * DAY * 1000),
  ]);
  const deliveries = (rows.results as Row[]).map((r) => ({
    id: r.id as number,
    at: seconds(r.received_at as number),
    webhookId: r.webhook_id,
    type: r.type,
    outcome: r.outcome,
    user: r.user_id ? { id: r.user_id, displayName: r.display_name } : null,
  }));
  return json({ deliveries, counts: counts.results, next: deliveries.length === 100 ? deliveries[deliveries.length - 1].id : null }, 200, NO_STORE);
}

const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** GET /api/admin/document-shares?q=&state=live|all&offset=: live share links (Pro), newest first; q matches a token, an owner's id or a diagram's name. */
export async function listDocumentShares(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  const state = url.searchParams.get('state') ?? 'live';
  if (state !== 'live' && state !== 'all') throw new HttpError(400, 'state must be live or all');
  const offset = offsetOf(url);
  const where = `(?1 = '' OR s.token = ?1 OR s.user_id = ?1 OR d.name LIKE ?2 ESCAPE '\\') AND (?3 = 'all' OR s.revoked_at IS NULL)`;
  const from = 'FROM document_shares s JOIN users u ON u.id = s.user_id LEFT JOIN documents d ON d.user_id = s.user_id AND d.id = s.document_id';
  const { DB } = ctx.env;
  const [rows, total] = await DB.batch([
    DB.prepare(
      `SELECT s.token, s.document_id, s.created_at, s.revoked_at, d.name, d.deleted_at, s.user_id, u.display_name, u.blocked_at ${from}
       WHERE ${where} ORDER BY s.created_at DESC, s.token LIMIT ${PAGE} OFFSET ${offset}`,
    ).bind(q, contains(q), state),
    DB.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).bind(q, contains(q), state),
  ]);
  return json(
    {
      total: (total.results[0] as { n: number }).n,
      offset,
      pageSize: PAGE,
      links: (rows.results as Row[]).map((r) => ({
        token: r.token,
        url: `${url.origin}/share/${r.token}`,
        document: { id: r.document_id, name: r.deleted_at ? null : r.name },
        createdAt: seconds(r.created_at as number),
        revokedAt: seconds(r.revoked_at as number | null),
        owner: { id: r.user_id, displayName: r.display_name, blocked: r.blocked_at !== null },
      })),
    },
    200,
    NO_STORE,
  );
}

/** DELETE /api/admin/document-shares/<token>: revokes a live share link (the row stays, revoked, as the owner's own revoke leaves it). */
export async function adminRevokeDocumentShare(request: Request, ctx: Ctx, token: string): Promise<Response> {
  const admin = await requireAdmin(request, ctx);
  const row = SHARE_TOKEN.test(token)
    ? await ctx.env.DB.prepare('SELECT user_id, revoked_at FROM document_shares WHERE token = ?').bind(token).first<{ user_id: string; revoked_at: number | null }>()
    : null;
  if (!row) throw new HttpError(404, 'No such share link');
  if (row.revoked_at !== null) throw new HttpError(409, 'Already revoked');
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('UPDATE document_shares SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL').bind(Date.now(), token),
    auditStatement(ctx.env, admin, 'document_share.revoke', token, { owner: row.user_id }),
  ]);
  return new Response(null, { status: 204 });
}

/** The time ranges the overview offers, in days. */
export const TREND_RANGES = [7, 30, 90] as const;

/**
 * GET /api/admin/trends?days=7|30|90: the overview's daily series for the
 * range and the range before it (2 × days points, oldest first), so each
 * number can be compared with the period before:
 *
 * - `signups`: accounts created that UTC day;
 * - `active`: weekly active accounts, those with any recorded activity in the
 *   7 days to that day (a card review, a daily challenge, a game run, a
 *   lesson read, a problem's latest run, an AI interview, the day an account
 *   was created or last seen). D1 keeps no visit log, so this undercounts
 *   visits that left nothing behind; today's value matches `last_seen_day`;
 * - `interviewsStarted`, `aiCostUsd` by the day an AI interview started,
 *   `interviewsFinished` by the day it finished;
 * - `topupOrders`: credit top-ups paid (`credits` rows of kind topup);
 * - `webhookFailures`: Polar deliveries refused (`bad_signature`) or failed (`error`);
 * - `proSubscribers`: subscriptions that keep Pro, counted back from today's
 *   with the applied `subscription.active` (one more) and
 *   `subscription.revoked` (one fewer) deliveries. The webhook log is kept
 *   90 days, so before that the line is flat.
 *
 * Plus the daily usage counts (`daily_counts`) for the same days.
 */
export async function getTrends(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
  if (!(TREND_RANGES as readonly number[]).includes(days)) throw new HttpError(400, `days must be one of ${TREND_RANGES.join(', ')}`);
  const { DB } = ctx.env;
  const t = now();
  const dayAgo = (n: number) => utcDay(t - n * DAY);
  const span = 2 * days;
  const from = dayAgo(span - 1);
  const to = dayAgo(0);
  const fromS = Date.parse(`${from}T00:00:00Z`) / 1000;
  const fromMs = fromS * 1000;
  // Activity reaches 6 days before the first day: that day's week.
  const actFrom = dayAgo(span + 5);
  const actFromS = Date.parse(`${actFrom}T00:00:00Z`) / 1000;
  const [signups, active, started, finished, packs, webhooks, proNow, usage] = await DB.batch([
    DB.prepare(`SELECT date(created_at, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day`).bind(fromS),
    DB.prepare(
      // D1 allows few terms in one compound SELECT, so the activity is two unions of four.
      `WITH d(day) AS (SELECT value FROM json_each(?1)),
       act(user_id, day) AS (
         SELECT * FROM (
           SELECT user_id, day FROM card_reviews WHERE day >= ?2
           UNION SELECT user_id, day FROM challenge_attempts WHERE day >= ?2
           UNION SELECT user_id, date(started_at, 'unixepoch') FROM game_runs WHERE started_at >= ?3
           UNION SELECT user_id, date(read_at, 'unixepoch') FROM lesson_reads WHERE read_at >= ?3
         )
         UNION SELECT * FROM (
           SELECT user_id, date(updated_at, 'unixepoch') FROM progress WHERE updated_at >= ?3
           UNION SELECT user_id, date(started_at / 1000, 'unixepoch') FROM ai_interviews WHERE started_at >= ?3 * 1000
           UNION SELECT id, last_seen_day FROM users WHERE last_seen_day >= ?2
           UNION SELECT id, date(created_at, 'unixepoch') FROM users WHERE created_at >= ?3
         )
       )
       SELECT d.day, COUNT(DISTINCT act.user_id) AS n FROM d LEFT JOIN act ON act.day BETWEEN date(d.day, '-6 days') AND d.day GROUP BY d.day`,
    ).bind(JSON.stringify(Array.from({ length: span }, (_, i) => dayAgo(span - 1 - i))), actFrom, actFromS),
    DB.prepare(`SELECT date(started_at / 1000, 'unixepoch') AS day, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_interviews WHERE started_at >= ? GROUP BY day`).bind(fromMs),
    DB.prepare(`SELECT date(ended_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM ai_interviews WHERE status = 'finished' AND ended_at >= ? GROUP BY day`).bind(fromMs),
    DB.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM credits WHERE kind = 'topup' AND created_at >= ? GROUP BY day`).bind(fromMs),

    DB.prepare(
      `SELECT date(received_at / 1000, 'unixepoch') AS day,
         COALESCE(SUM(outcome IN ('bad_signature', 'error')), 0) AS failures,
         COALESCE(SUM(outcome = 'applied' AND type = 'subscription.active'), 0) AS pro_new,
         COALESCE(SUM(outcome = 'applied' AND type = 'subscription.revoked'), 0) AS pro_ended
       FROM billing_webhooks WHERE received_at >= ? GROUP BY day`,
    ).bind(fromMs),
    DB.prepare(`SELECT COUNT(*) AS n FROM billing WHERE status IN ${PRO_STATUSES_SQL}`),
    DB.prepare('SELECT day, event, count FROM daily_counts WHERE day >= ?').bind(from),
  ]);
  const byDay = <T extends Row>(rows: unknown[]) => new Map((rows as T[]).map((r) => [r.day as string, r]));
  const s = byDay(signups.results);
  const a = byDay(active.results);
  const st = byDay(started.results);
  const fi = byDay(finished.results);
  const pk = byDay(packs.results);
  const wh = byDay(webhooks.results);
  const counts = new Map<string, Record<string, number>>();
  for (const r of usage.results as { day: string; event: string; count: number }[]) {
    if (!counts.has(r.day)) counts.set(r.day, {});
    counts.get(r.day)![r.event] = r.count;
  }
  const n = (row: Row | undefined, key: string) => Number(row?.[key] ?? 0);
  const points = Array.from({ length: span }, (_, i) => {
    const day = dayAgo(span - 1 - i);
    return {
      day,
      signups: n(s.get(day), 'n'),
      active: n(a.get(day), 'n'),
      interviewsStarted: n(st.get(day), 'n'),
      interviewsFinished: n(fi.get(day), 'n'),
      aiCostUsd: n(st.get(day), 'cost'),
      topupOrders: n(pk.get(day), 'n'),
      webhookFailures: n(wh.get(day), 'failures'),
      proSubscribers: 0,
    };
  });
  // Today's subscribers, then back a day at a time: before a day's changes there was one fewer per start and one more per end.
  let pro = (proNow.results[0] as { n: number }).n;
  for (let i = span - 1; i >= 0; i--) {
    points[i].proSubscribers = pro;
    pro = Math.max(0, pro - n(wh.get(points[i].day), 'pro_new') + n(wh.get(points[i].day), 'pro_ended'));
  }
  return json({ days, from, to, points, usage: { events: METRIC_EVENTS, days: points.map(({ day }) => ({ day, counts: counts.get(day) ?? {} })) } }, 200, NO_STORE);
}
