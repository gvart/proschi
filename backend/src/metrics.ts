import { isClientMetricEvent, MAX_METRIC_BATCH, METRIC_EVENTS, type MetricEvent } from '../../frontend/src/services/metricsEvents';
import type { Ctx } from './context';
import { timingSafeEqual } from './crypto';
import { now, type Env } from './env';
import { errorResponse, HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';

/**
 * Product metrics (backend/README.md "Usage counts", docs/PRIVACY.md): one
 * number per UTC day and event in `daily_counts`, and nothing else. No user
 * id, IP, cookie, page address or per-visit row is ever written; the IP is
 * only the key of the rate limit, which Cloudflare keeps for the minute.
 */

/** Small: `{"events": [...]}` of at most MAX_METRIC_BATCH names. */
const MAX_METRICS_BODY = 2048;

/** Days kept: the cron deletes older ones (src/cron.ts). */
export const METRICS_RETENTION_DAYS = 400;

/** The UTC date of a Unix time, YYYY-MM-DD. */
const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Adds each event's count to today's (UTC) row. */
export async function countEvents(env: Env, counts: Map<MetricEvent, number>): Promise<void> {
  if (!counts.size) return;
  const day = utcDay(now());
  await env.DB.batch(
    [...counts].map(([event, n]) =>
      env.DB.prepare('INSERT INTO daily_counts (day, event, count) VALUES (?1, ?2, ?3) ON CONFLICT (day, event) DO UPDATE SET count = count + ?3').bind(day, event, n),
    ),
  );
}

/**
 * One event counted by the Worker itself (a sign-in, a verified first
 * solve). A failure is logged and swallowed: a count never fails the
 * request it belongs to.
 */
export async function countServerEvent(ctx: Ctx, event: MetricEvent): Promise<void> {
  try {
    await countEvents(ctx.env, new Map([[event, 1]]));
  } catch (e) {
    log('warn', 'Counting a metric failed', { requestId: ctx.requestId, event, error: errorText(e) });
  }
}

/**
 * POST /api/metrics {event} or {events: [...]}: counts events a page saw,
 * signed in or not (the session is never read). Every name must be on the
 * allow-list (frontend/src/services/metricsEvents.ts), or the whole request
 * is a 400; at most MAX_METRIC_BATCH a request. Answers 204.
 */
export async function postMetrics(request: Request, ctx: Ctx): Promise<Response> {
  await rateLimit(ctx.env.METRICS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const body = await readJson(request, MAX_METRICS_BODY);
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'event' && k !== 'events') || ('event' in body) === ('events' in body)) {
    throw new HttpError(400, 'The body must be {event} or {events}');
  }
  const events: unknown = 'event' in body ? [body.event] : body.events;
  if (!Array.isArray(events) || events.length === 0) throw new HttpError(400, 'events must be a non-empty list');
  if (events.length > MAX_METRIC_BATCH) throw new HttpError(413, `At most ${MAX_METRIC_BATCH} events`);
  const counts = new Map<MetricEvent, number>();
  for (const event of events) {
    if (!isClientMetricEvent(event)) throw new HttpError(400, `Unknown event: ${String(event).slice(0, 40)}`);
    counts.set(event, (counts.get(event) ?? 0) + 1);
  }
  await countEvents(ctx.env, counts);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * GET /api/metrics/summary?days=30: each day's counts, newest first, for the
 * last `days` UTC days (1 to METRICS_RETENTION_DAYS, today included), and
 * their totals. Only with `X-Metrics-Token: <METRICS_TOKEN>`; without the
 * secret set, or with a wrong token, it answers 404 like any unknown path.
 */
export async function getMetricsSummary(request: Request, ctx: Ctx): Promise<Response> {
  const secret = ctx.env.METRICS_TOKEN ?? '';
  if (secret.length < 16) return errorResponse(404, 'Not found');
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  if (!timingSafeEqual(request.headers.get('X-Metrics-Token') ?? '', secret)) return errorResponse(404, 'Not found');

  const param = new URL(request.url).searchParams.get('days');
  const days = param === null ? 30 : Number(param);
  if (!Number.isInteger(days) || days < 1 || days > METRICS_RETENTION_DAYS) {
    throw new HttpError(400, `days must be a whole number from 1 to ${METRICS_RETENTION_DAYS}`);
  }
  const to = utcDay(now());
  const from = utcDay(now() - (days - 1) * 86_400);
  const { results } = await ctx.env.DB.prepare('SELECT day, event, count FROM daily_counts WHERE day >= ? AND day <= ? ORDER BY day DESC, event')
    .bind(from, to)
    .all<{ day: string; event: string; count: number }>();
  const byDay = new Map<string, Record<string, number>>();
  const totals: Record<string, number> = Object.fromEntries(METRIC_EVENTS.map((e) => [e, 0]));
  for (const { day, event, count } of results) {
    const row = byDay.get(day) ?? {};
    row[event] = count;
    byDay.set(day, row);
    totals[event] = (totals[event] ?? 0) + count;
  }
  return json(
    { from, to, events: METRIC_EVENTS, days: [...byDay].map(([day, counts]) => ({ day, counts })), totals },
    200,
    { 'Cache-Control': 'no-store' },
  );
}

/** For the daily cron: deletes days older than METRICS_RETENTION_DAYS; returns how many rows. */
export async function pruneDailyCounts(env: Env): Promise<number> {
  const cutoff = utcDay(now() - METRICS_RETENTION_DAYS * 86_400);
  const { meta } = await env.DB.prepare('DELETE FROM daily_counts WHERE day < ?').bind(cutoff).run();
  return meta.changes;
}
