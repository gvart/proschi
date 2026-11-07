import { requireAdmin } from './adminAuth';
import type { Ctx } from './context';
import type { Env } from './env';
import { HttpError, json } from './http';
import { errorText, log } from './log';

/**
 * GET /api/admin/cf-usage: the account's Cloudflare usage against its plan's
 * included quotas (backend/README.md "Cloudflare usage"; decision P44).
 *
 * Reads Cloudflare's GraphQL Analytics API (Account Analytics Read) and, when
 * the token may, the account's subscriptions (Billing Read) for the plan and
 * its billing period. Without the subscriptions, the plan is `CF_PLAN`
 * (default `paid`) and the period the UTC calendar month. Answers are cached
 * for 10 minutes (Cache API), so the dashboard never hammers the API. The
 * token is only ever sent to api.cloudflare.com, never logged or returned.
 *
 * Quotas and prices: Cloudflare's pricing pages, read on 2026-11-07
 * (developers.cloudflare.com/workers/platform/pricing, d1/platform/pricing,
 * r2/pricing, email-service/platform/pricing, workers-ai/platform/pricing).
 * Free plan daily limits reset at 00:00 UTC; Paid's monthly included usage at
 * the subscription's renewal. Workers AI's 10,000 free neurons are daily on
 * both plans (00:00 UTC); Paid bills each day's neurons past them.
 */

export type Plan = 'free' | 'paid';
export type Status = 'ok' | 'watch' | 'over';
type Product = 'Workers' | 'Workers AI' | 'D1' | 'R2' | 'Email';

export interface Quota {
  id: string;
  product: Product;
  label: string;
  unit: 'requests' | 'ms' | 'neurons' | 'rows' | 'bytes' | 'operations' | 'emails';
  /** A flow adds up over the period (requests); a stock is a level (storage), billed as it stands. */
  kind: 'flow' | 'stock';
  period: 'day' | 'month';
  included: number;
  /** Paid's overage: `priceUsd` for every `per` units past `included`. */
  per?: number;
  priceUsd?: number;
}

const GB = 1e9;
export const PAID_BASE_USD = 5;
/** Projected over this share of the quota: `watch`. */
export const WATCH_AT = 0.8;

export const QUOTAS: Record<Plan, Quota[]> = {
  paid: [
    { id: 'workers.requests', product: 'Workers', label: 'Workers requests', unit: 'requests', kind: 'flow', period: 'month', included: 10e6, per: 1e6, priceUsd: 0.3 },
    { id: 'workers.cpu', product: 'Workers', label: 'Workers CPU time', unit: 'ms', kind: 'flow', period: 'month', included: 30e6, per: 1e6, priceUsd: 0.02 },
    // Daily, not monthly: each day's neurons past 10,000 are billed (voice's Whisper uses the AI binding).
    { id: 'ai.neurons', product: 'Workers AI', label: 'Workers AI neurons', unit: 'neurons', kind: 'flow', period: 'day', included: 10_000, per: 1000, priceUsd: 0.011 },
    { id: 'd1.rowsRead', product: 'D1', label: 'D1 rows read', unit: 'rows', kind: 'flow', period: 'month', included: 25e9, per: 1e6, priceUsd: 0.001 },
    { id: 'd1.rowsWritten', product: 'D1', label: 'D1 rows written', unit: 'rows', kind: 'flow', period: 'month', included: 50e6, per: 1e6, priceUsd: 1 },
    { id: 'd1.storage', product: 'D1', label: 'D1 storage', unit: 'bytes', kind: 'stock', period: 'month', included: 5 * GB, per: GB, priceUsd: 0.75 },
    { id: 'r2.classA', product: 'R2', label: 'R2 class A operations', unit: 'operations', kind: 'flow', period: 'month', included: 1e6, per: 1e6, priceUsd: 4.5 },
    { id: 'r2.classB', product: 'R2', label: 'R2 class B operations', unit: 'operations', kind: 'flow', period: 'month', included: 10e6, per: 1e6, priceUsd: 0.36 },
    { id: 'r2.storage', product: 'R2', label: 'R2 storage', unit: 'bytes', kind: 'stock', period: 'month', included: 10 * GB, per: GB, priceUsd: 0.015 },
    { id: 'email.sent', product: 'Email', label: 'Emails sent', unit: 'emails', kind: 'flow', period: 'month', included: 3000, per: 1000, priceUsd: 0.35 },
  ],
  // Free: hard limits, no overage. CPU is capped per request (10 ms), not metered; Email sending is not available.
  free: [
    { id: 'workers.requests', product: 'Workers', label: 'Workers requests', unit: 'requests', kind: 'flow', period: 'day', included: 100_000 },
    { id: 'ai.neurons', product: 'Workers AI', label: 'Workers AI neurons', unit: 'neurons', kind: 'flow', period: 'day', included: 10_000 },
    { id: 'd1.rowsRead', product: 'D1', label: 'D1 rows read', unit: 'rows', kind: 'flow', period: 'day', included: 5e6 },
    { id: 'd1.rowsWritten', product: 'D1', label: 'D1 rows written', unit: 'rows', kind: 'flow', period: 'day', included: 100_000 },
    { id: 'd1.storage', product: 'D1', label: 'D1 storage', unit: 'bytes', kind: 'stock', period: 'month', included: 5 * GB },
    { id: 'r2.classA', product: 'R2', label: 'R2 class A operations', unit: 'operations', kind: 'flow', period: 'month', included: 1e6 },
    { id: 'r2.classB', product: 'R2', label: 'R2 class B operations', unit: 'operations', kind: 'flow', period: 'month', included: 10e6 },
    { id: 'r2.storage', product: 'R2', label: 'R2 storage', unit: 'bytes', kind: 'stock', period: 'month', included: 10 * GB },
  ],
};

/** R2 operations by billing class (r2/pricing); deletes and aborts are free. */
const R2_CLASS_A = /^(ListBuckets|PutBucket|ListObjects|PutObject|CopyObject|CompleteMultipartUpload|CreateMultipartUpload|LifecycleStorageTierTransition|ListMultipartUploads|UploadPart|UploadPartCopy|ListParts)/;
const R2_CLASS_B = /^(HeadBucket|HeadObject|GetObject|UsageSummary|GetBucket)/;

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const SERIES_DAYS = 30;
const CACHE_SECONDS = 600;
const API = 'https://api.cloudflare.com/client/v4';

/** One bucket of a metric: its start (Unix ms) and value. */
export interface Point {
  t: number;
  value: number;
}

export interface Period {
  start: number;
  end: number;
}

export interface Metric {
  id: string;
  product: Product;
  label: string;
  unit: Quota['unit'];
  kind: Quota['kind'];
  period: Quota['period'];
  included: number;
  /** Paid's price past `included`: `priceUsd` for every `per` units. */
  per?: number;
  priceUsd?: number;
  used: number;
  /** used / included, 0..∞. */
  percent: number;
  periodStart: string;
  /** When it resets. */
  periodEnd: string;
  /** A straight line from the period's start through now to its end (a stock: as it stands). */
  projected: number;
  /** When the line passes the quota, if it does this period and hasn't yet. */
  passesAt: string | null;
  /**
   * Paid: what the projection costs past the included quota (null on Free,
   * which has none). A daily quota on Paid: the billing period's days past
   * it so far (today as projected), carried on to the period's end.
   */
  overageUsd: number | null;
  status: Status;
  /** The last 30 UTC days: a flow's total each day, a stock's level. */
  series: { day: string; value: number }[];
}

/** A Free plan daily limit against the last 30 days: what being on Free would have meant. */
export interface FreeCheck {
  id: string;
  label: string;
  included: number;
  maxDay: number;
  daysOver7: number;
  daysOver30: number;
}

export interface CfUsage {
  plan: Plan;
  planSource: 'subscription' | 'CF_PLAN';
  period: { start: string; end: string; source: 'subscription' | 'calendar' };
  fetchedAt: string;
  cached: boolean;
  metrics: Metric[];
  freeTier: FreeCheck[];
  costs: { paidBaseUsd: number; paidOverageUsd: number; paidTotalUsd: number };
  /** Products Cloudflare couldn't answer for; their metrics are missing. */
  errors: { product: string; message: string }[];
  /** What isn't measured, and why. */
  notes: string[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const isoSeconds = (ms: number) => iso(ms).replace(/\.\d+Z$/, 'Z');
const dayOf = (ms: number) => iso(ms).slice(0, 10);
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;

/** The UTC calendar month around `now`. */
export function calendarMonth(now: number): Period {
  const d = new Date(now);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/** Today in UTC: Free's daily limits reset at 00:00 UTC. */
export function utcDay(now: number): Period {
  const start = startOfDay(now);
  return { start, end: start + DAY };
}

export function statusOf(used: number, projected: number, included: number): Status {
  if (used >= included) return 'over';
  if (projected >= WATCH_AT * included) return 'watch';
  return 'ok';
}

/**
 * One quota from its points (any bucket size; a stock's are daily levels).
 * A flow's projection is a straight line from the period's start through
 * now, with at least an hour elapsed so a period's first minutes don't
 * project wildly. `billing` is the plan's period, for a daily quota's
 * overage on Paid.
 */
export function buildMetric(quota: Quota, points: Point[], period: Period, now: number, plan: Plan, billing: Period = period): Metric {
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => dayOf(startOfDay(now) - (SERIES_DAYS - 1 - i) * DAY));
  const byDay = new Map<string, number>(days.map((d) => [d, 0]));
  let used = 0;
  if (quota.kind === 'flow') {
    for (const p of points) {
      const d = dayOf(p.t);
      if (byDay.has(d)) byDay.set(d, byDay.get(d)! + p.value);
      if (p.t >= period.start && p.t < period.end) used += p.value;
    }
  } else {
    for (const p of points) if (byDay.has(dayOf(p.t))) byDay.set(dayOf(p.t), p.value);
    // The latest level reported: storage is measured once in a while, not every day.
    const latest = [...points].sort((a, b) => b.t - a.t)[0];
    used = latest?.value ?? 0;
  }
  const length = period.end - period.start;
  const elapsed = Math.min(length, Math.max(HOUR, now - period.start));
  const projected = quota.kind === 'flow' ? (used * length) / elapsed : used;
  const rate = used / elapsed;
  const passesAt = quota.kind === 'flow' && used < quota.included && projected > quota.included && rate > 0 ? iso(period.start + quota.included / rate) : null;
  const excess = quota.kind === 'flow' && quota.period === 'day' ? dailyExcess(quota, points, projected, billing, now) : Math.max(0, projected - quota.included);
  const overageUsd = plan === 'paid' && quota.per && quota.priceUsd !== undefined ? round2((excess / quota.per) * quota.priceUsd) : null;
  return {
    id: quota.id,
    product: quota.product,
    label: quota.label,
    unit: quota.unit,
    kind: quota.kind,
    period: quota.period,
    included: quota.included,
    ...(plan === 'paid' && quota.per && quota.priceUsd !== undefined ? { per: quota.per, priceUsd: quota.priceUsd } : {}),
    used,
    percent: quota.included ? used / quota.included : 0,
    periodStart: iso(period.start),
    periodEnd: iso(period.end),
    projected,
    passesAt,
    overageUsd,
    status: statusOf(used, projected, quota.included),
    series: days.map((day) => ({ day, value: byDay.get(day)! })),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A daily quota over the billing period: each day's units past it, today's as projected, at that pace to the period's end. */
function dailyExcess(quota: Quota, points: Point[], today: number, billing: Period, now: number): number {
  const day = startOfDay(now);
  const byDay = new Map<number, number>();
  for (const p of points) {
    const d = startOfDay(p.t);
    if (p.t >= billing.start && d < day) byDay.set(d, (byDay.get(d) ?? 0) + p.value);
  }
  byDay.set(day, today);
  const excess = [...byDay.values()].reduce((s, v) => s + Math.max(0, v - quota.included), 0);
  const days = Math.max(1, Math.round((billing.end - billing.start) / DAY));
  const elapsed = Math.min(days, Math.max(1, Math.floor((day - startOfDay(billing.start)) / DAY) + 1));
  return (excess * days) / elapsed;
}

/** Free's daily limits against the daily series: how often they would have been hit. */
export function freeChecks(series: Map<string, Metric['series']>): FreeCheck[] {
  return QUOTAS.free
    .filter((q) => q.period === 'day')
    .flatMap((q) => {
      const s = series.get(q.id);
      if (!s) return [];
      const over = (days: number) => s.slice(-days).filter((d) => d.value > q.included).length;
      return [{ id: q.id, label: q.label, included: q.included, maxDay: Math.max(0, ...s.map((d) => d.value)), daysOver7: over(7), daysOver30: over(SERIES_DAYS) }];
    });
}

// --- Cloudflare's answers -----------------------------------------------------

interface GraphQlAnswer<T> {
  data?: { viewer?: { accounts?: T[]; zones?: T[] } } | null;
  errors?: { message: string }[] | null;
}

/** The hour or day a row is for (`datetimeHour` or `date` dimension). */
const rowTime = (d: { date?: string; datetimeHour?: string }): number => Date.parse(d.datetimeHour ?? `${d.date}T00:00:00Z`);

export function parseWorkers(rows: { sum: { requests: number; cpuTimeUs: number }; dimensions: { datetimeHour: string } }[]): Record<string, Point[]> {
  return {
    'workers.requests': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.sum.requests })),
    'workers.cpu': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.sum.cpuTimeUs / 1000 })),
  };
}

export function parseAi(rows: { sum: { totalNeurons: number }; dimensions: { date: string } }[]): Record<string, Point[]> {
  return { 'ai.neurons': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.sum.totalNeurons })) };
}

export function parseD1(rows: { sum: { rowsRead: number; rowsWritten: number }; dimensions: { date: string } }[]): Record<string, Point[]> {
  return {
    'd1.rowsRead': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.sum.rowsRead })),
    'd1.rowsWritten': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.sum.rowsWritten })),
  };
}

/** Each day's level summed across databases or buckets (each one's largest that day). */
function levels(rows: { t: number; key: string; value: number }[]): Point[] {
  const byDay = new Map<number, Map<string, number>>();
  for (const r of rows) {
    const day = startOfDay(r.t);
    const keys = byDay.get(day) ?? new Map<string, number>();
    keys.set(r.key, Math.max(keys.get(r.key) ?? 0, r.value));
    byDay.set(day, keys);
  }
  return [...byDay].map(([t, keys]) => ({ t, value: [...keys.values()].reduce((a, b) => a + b, 0) }));
}

export function parseD1Storage(rows: { max: { databaseSizeBytes: number }; dimensions: { date: string; databaseId: string } }[]): Record<string, Point[]> {
  return { 'd1.storage': levels(rows.map((r) => ({ t: rowTime(r.dimensions), key: r.dimensions.databaseId, value: r.max.databaseSizeBytes }))) };
}

export function parseR2(rows: { sum: { requests: number }; dimensions: { date: string; actionType: string } }[]): Record<string, Point[]> {
  const of = (re: RegExp) => rows.filter((r) => re.test(r.dimensions.actionType)).map((r) => ({ t: rowTime(r.dimensions), value: r.sum.requests }));
  return { 'r2.classA': of(R2_CLASS_A), 'r2.classB': of(R2_CLASS_B) };
}

export function parseR2Storage(rows: { max: { payloadSize: number; metadataSize: number }; dimensions: { date: string; bucketName: string } }[]): Record<string, Point[]> {
  return { 'r2.storage': levels(rows.map((r) => ({ t: rowTime(r.dimensions), key: r.dimensions.bucketName, value: r.max.payloadSize + r.max.metadataSize }))) };
}

export function parseEmail(rows: { count: number; dimensions: { date: string } }[]): Record<string, Point[]> {
  return { 'email.sent': rows.map((r) => ({ t: rowTime(r.dimensions), value: r.count })) };
}

interface Subscription {
  rate_plan?: { id?: string };
  state?: string;
  current_period_start?: string;
  current_period_end?: string;
}

/** Workers Paid's subscription, if the token may read the account's subscriptions (Billing Read). */
export function paidSubscription(subscriptions: Subscription[]): Period | null {
  const paid = subscriptions.find((s) => s.rate_plan?.id === 'workers_paid' && !['Cancelled', 'Expired', 'Failed'].includes(s.state ?? ''));
  if (!paid?.current_period_start || !paid.current_period_end) return null;
  const start = Date.parse(paid.current_period_start);
  const end = Date.parse(paid.current_period_end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

// --- Fetching -----------------------------------------------------------------

const WORKERS = `query ($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $since, datetime_leq: $until}) { sum { requests cpuTimeUs } dimensions { datetimeHour } } } } }`;
// Workers AI inference, all models (voice's Whisper among them): neurons by UTC day.
const AI = `query ($account: string!, $sinceDate: Date!, $untilDate: Date!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: aiInferenceAdaptiveGroups(limit: 10000, filter: {date_geq: $sinceDate, date_leq: $untilDate}) { sum { totalNeurons } dimensions { date } } } } }`;
const D1 = `query ($account: string!, $sinceDate: Date!, $untilDate: Date!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: d1AnalyticsAdaptiveGroups(limit: 10000, filter: {date_geq: $sinceDate, date_leq: $untilDate}) { sum { rowsRead rowsWritten } dimensions { date } } } } }`;
const D1_STORAGE = `query ($account: string!, $sinceDate: Date!, $untilDate: Date!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: d1StorageAdaptiveGroups(limit: 10000, filter: {date_geq: $sinceDate, date_leq: $untilDate}) { max { databaseSizeBytes } dimensions { date databaseId } } } } }`;
const R2 = `query ($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: $since, datetime_leq: $until}) { sum { requests } dimensions { date actionType } } } } }`;
const R2_STORAGE = `query ($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $account}) {
  rows: r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: $since, datetime_leq: $until}) { max { payloadSize metadataSize } dimensions { date bucketName } } } } }`;
// Zone-level; one row per email: its last event (isLastEvent).
const EMAIL = `query ($zone: string!, $sinceDate: Date!, $untilDate: Date!) { viewer { zones(filter: {zoneTag: $zone}) {
  rows: emailSendingAdaptiveGroups(limit: 10000, filter: {date_geq: $sinceDate, date_leq: $untilDate, isLastEvent: 1}) { count dimensions { date } } } } }`;

/** Why Cloudflare refused, without anything of the request (never the token). */
class CfError extends Error {}

async function cf<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    });
  } catch {
    throw new CfError('Cloudflare API unreachable');
  }
  const body = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !body) throw new CfError(`Cloudflare API answered ${response.status}`);
  return body;
}

async function graphql<T>(env: Env, query: string, variables: Record<string, string>): Promise<T[]> {
  const body = await cf<GraphQlAnswer<{ rows: T[] }>>(env, '/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (body.errors?.length) throw new CfError(body.errors[0].message.slice(0, 200));
  const scope = body.data?.viewer?.accounts ?? body.data?.viewer?.zones;
  if (!scope) throw new CfError('Cloudflare API answered without data');
  return scope[0]?.rows ?? [];
}

export const cfUsageConfigured = (env: Env): boolean => Boolean(env.CF_API_TOKEN && env.CF_ACCOUNT_ID);

export const cfPlanVar = (env: Env): Plan => (env.CF_PLAN?.trim().toLowerCase() === 'free' ? 'free' : 'paid');

/** Everything for the page, from Cloudflare, at `now`. */
export async function collect(env: Env, now: number): Promise<CfUsage> {
  const account = env.CF_ACCOUNT_ID!;
  const errors: CfUsage['errors'] = [];
  const notes: string[] = [];

  let subscription: Period | null = null;
  try {
    const subs = await cf<{ success?: boolean; result?: Subscription[] }>(env, `/accounts/${encodeURIComponent(account)}/subscriptions`);
    subscription = paidSubscription(subs.result ?? []);
  } catch {
    // Most likely no Billing Read on the token: the plan is CF_PLAN and the period the calendar month.
  }
  const plan: Plan = subscription ? 'paid' : cfPlanVar(env);
  const month = subscription ?? calendarMonth(now);
  if (!subscription) notes.push('Plan from CF_PLAN and the UTC calendar month as the period: the token cannot read the account’s subscriptions (add Billing Read for the exact renewal date).');

  // From the period's start or 30 days back, whichever is earlier, to now (both within the API's month of history).
  const since = Math.min(month.start, startOfDay(now) - (SERIES_DAYS - 1) * DAY);
  const vars = { account, since: isoSeconds(since), until: isoSeconds(now), sinceDate: dayOf(since), untilDate: dayOf(now) };

  const zone = env.CF_ZONE_ID;
  const sources: [string, Promise<Record<string, Point[]>>][] = [
    ['Workers', graphql<Parameters<typeof parseWorkers>[0][number]>(env, WORKERS, vars).then(parseWorkers)],
    ['Workers AI', graphql<Parameters<typeof parseAi>[0][number]>(env, AI, vars).then(parseAi)],
    ['D1', graphql<Parameters<typeof parseD1>[0][number]>(env, D1, vars).then(parseD1)],
    ['D1 storage', graphql<Parameters<typeof parseD1Storage>[0][number]>(env, D1_STORAGE, vars).then(parseD1Storage)],
    ['R2', graphql<Parameters<typeof parseR2>[0][number]>(env, R2, vars).then(parseR2)],
    ['R2 storage', graphql<Parameters<typeof parseR2Storage>[0][number]>(env, R2_STORAGE, vars).then(parseR2Storage)],
  ];
  if (plan === 'paid' && zone) {
    sources.push(['Email', graphql<Parameters<typeof parseEmail>[0][number]>(env, EMAIL, { zone, sinceDate: vars.sinceDate, untilDate: vars.untilDate }).then(parseEmail)]);
  } else if (plan === 'paid') {
    notes.push('Emails sent are not measured: set CF_ZONE_ID (the proschi.app zone) to count them.');
  }
  const points: Record<string, Point[]> = {};
  const settled = await Promise.allSettled(sources.map(([, p]) => p));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') Object.assign(points, r.value);
    else {
      const message = r.reason instanceof CfError ? r.reason.message : 'Unexpected answer';
      errors.push({ product: sources[i][0], message });
      log('warn', 'cf_usage_failed', { product: sources[i][0], error: errorText(r.reason).split('\n')[0] });
    }
  });

  const day = utcDay(now);
  const metrics = QUOTAS[plan].filter((q) => points[q.id]).map((q) => buildMetric(q, points[q.id], q.period === 'day' ? day : month, now, plan, month));
  // Free's daily limits, from the same days, whichever plan this is.
  const series = new Map(
    QUOTAS.free.filter((q) => points[q.id]).map((q) => [q.id, buildMetric(q, points[q.id], day, now, 'free').series] as const),
  );
  const paidOverageUsd = round2(metrics.reduce((s, m) => s + (m.overageUsd ?? 0), 0));
  return {
    plan,
    planSource: subscription ? 'subscription' : 'CF_PLAN',
    period: { start: iso(month.start), end: iso(month.end), source: subscription ? 'subscription' : 'calendar' },
    fetchedAt: iso(now),
    cached: false,
    metrics,
    freeTier: freeChecks(series),
    costs: { paidBaseUsd: PAID_BASE_USD, paidOverageUsd, paidTotalUsd: round2(PAID_BASE_USD + paidOverageUsd) },
    errors,
    notes,
  };
}

/** The Cache API's key for an account and plan setting (never the token). */
const cacheKey = (env: Env) => `https://cf-usage.proschi.internal/v1/${encodeURIComponent(env.CF_ACCOUNT_ID ?? '')}/${cfPlanVar(env)}/${env.CF_ZONE_ID ? 'zone' : 'nozone'}`;

/** GET /api/admin/cf-usage */
export async function getCfUsage(request: Request, ctx: Ctx): Promise<Response> {
  await requireAdmin(request, ctx);
  const { env } = ctx;
  if (!cfUsageConfigured(env)) {
    throw new HttpError(501, 'Cloudflare usage is not set up: add CF_API_TOKEN (Account Analytics Read) and CF_ACCOUNT_ID (backend/README.md "Cloudflare usage")');
  }
  const headers = { 'Cache-Control': 'no-store' };
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(cacheKey(env));
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return json({ ...((await hit.json()) as CfUsage), cached: true }, 200, headers);
  const usage = await collect(env, Date.now());
  // An answer with gaps is kept a minute only, so a passing outage doesn't stick for 10.
  const ttl = usage.errors.length ? 60 : CACHE_SECONDS;
  const store = cache.put(key, json(usage, 200, { 'Cache-Control': `max-age=${ttl}` })).catch(() => undefined);
  await store;
  return json(usage, 200, headers);
}
