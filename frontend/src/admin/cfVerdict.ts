import type { CfMetric, CfUsage } from './api';
import { formatUsd } from './format';

/**
 * The Cloudflare usage page's words (CloudflareTab.tsx): the one-line
 * verdict, Free against Paid, and what the overview flags. Pure, so the
 * wording is unit tested (cfVerdict.test.ts).
 */

export type Tone = 'ok' | 'watch' | 'over';

/** Why this Worker can't run on Workers Free, whatever its traffic (backend/wrangler.jsonc). */
export const FREE_BLOCKERS = [
  'wrangler.jsonc sets limits.cpu_ms to 1000; Free caps a request at 10 ms of CPU and can’t deploy it (solves are verified with 3–12 ms).',
  'Email Service sending (reminders, email sign-in, campaigns) is Paid only.',
];

const GB = 1e9;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** A quantity in its unit: "25B", "30M ms", "5 GB". */
export function formatQuantity(unit: CfMetric['unit'], n: number): string {
  if (unit === 'bytes') {
    if (n >= GB) return `${trim(n / GB)} GB`;
    if (n >= 1e6) return `${trim(n / 1e6)} MB`;
    if (n >= 1e3) return `${trim(n / 1e3)} kB`;
    return `${Math.round(n)} B`;
  }
  return `${compact.format(n)}${unit === 'ms' ? ' ms' : ''}`;
}

const trim = (n: number) => (n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));

/** "Nov 24": a date of the period, in UTC (Cloudflare's days are UTC). */
export const formatResetDay = (isoTime: string): string =>
  new Date(isoTime).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** When a quota resets: "00:00 UTC" for a daily one, else its day. */
export const resetLabel = (m: Pick<CfMetric, 'period' | 'periodEnd'>): string =>
  m.period === 'day' ? 'Resets at 00:00 UTC' : `Resets ${formatResetDay(m.periodEnd)}`;

const planName = (plan: CfUsage['plan']) => (plan === 'paid' ? 'Workers Paid' : 'Workers Free');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What to look at first: over before watch, then the most expensive, then the fullest. */
export function flagged(metrics: CfMetric[]): CfMetric[] {
  const rank = { over: 0, watch: 1, ok: 2 } as const;
  return metrics
    .filter((m) => m.status !== 'ok')
    .sort((a, b) => rank[a.status] - rank[b.status] || (b.overageUsd ?? 0) - (a.overageUsd ?? 0) || b.projected / b.included - a.projected / a.included);
}

/** The page's headline: whether this plan does, and if not, what passes when and what it costs. */
export function verdict(usage: CfUsage): { tone: Tone; text: string } {
  const top = flagged(usage.metrics);
  const more = top.length > 1 ? ` (and ${plural(top.length - 1, 'more quota')})` : '';
  if (usage.plan === 'free') {
    const hit = [...usage.freeTier].sort((a, b) => b.daysOver7 - a.daysOver7)[0];
    if (hit && hit.daysOver7 > 0) {
      return {
        tone: 'over',
        text: `Free plan: ${hit.label} hit ${formatQuantity(unitOf(hit.id), hit.included)}/day ${times(hit.daysOver7)} this week — upgrade to Paid ($5/mo).`,
      };
    }
    const m = top[0];
    if (m) {
      const limit = m.period === 'day' ? `today's ${formatQuantity(m.unit, m.included)}` : `the month's ${formatQuantity(m.unit, m.included)}`;
      const text =
        m.status === 'over'
          ? `Free plan: ${m.label} is past ${limit}${more} — requests past a limit fail until it resets. Upgrade to Paid ($5/mo).`
          : `Free plan: ${m.label} is on course for ${pct(m.projected / m.included)} of ${limit}${more}. Watch it, or upgrade to Paid ($5/mo).`;
      return { tone: m.status, text };
    }
    return { tone: 'ok', text: `You're fine on Workers Free: no daily limit hit in the last 7 days.` };
  }
  const m = top[0];
  if (!m) {
    return { tone: 'ok', text: `You're fine on Workers Paid this period: every quota is projected under what's included. Resets ${formatResetDay(usage.period.end)}.` };
  }
  const extra = usage.costs.paidOverageUsd > 0 ? ` — about ${formatUsd(usage.costs.paidOverageUsd)} extra` : '';
  const included = `the included ${formatQuantity(m.unit, m.included)}`;
  if (m.status === 'over') return { tone: 'over', text: `${m.label} is past ${included}${more}${extra} by ${formatResetDay(m.periodEnd)}.` };
  if (m.passesAt) return { tone: 'watch', text: `${m.label} will pass ${included} around ${formatResetDay(m.passesAt)}${more}${extra}.` };
  return { tone: 'watch', text: `${m.label} is on course for ${pct(m.projected / m.included)} of ${included} by ${formatResetDay(m.periodEnd)}${more}. Nothing extra yet.` };
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const pct = (share: number) => `${Math.round(share * 100)}%`;
const unitOf = (id: string): CfMetric['unit'] => (id.startsWith('workers') ? 'requests' : id.startsWith('d1.rows') ? 'rows' : 'operations');

export interface PlanOption {
  plan: 'free' | 'paid';
  name: string;
  /** Projected for this period, in USD. */
  usd: number;
  fits: boolean;
  reasons: string[];
}

/** Free against Paid for this period's traffic: what each costs and whether it would hold. */
export function compare(usage: CfUsage): { free: PlanOption; paid: PlanOption; recommend: 'free' | 'paid' } {
  const freeReasons = [
    ...usage.freeTier.filter((f) => f.daysOver30 > 0).map((f) => `${f.label} passed ${formatQuantity(unitOf(f.id), f.included)}/day on ${plural(f.daysOver30, 'day')} of the last 30 (peak ${formatQuantity(unitOf(f.id), f.maxDay)}).`),
    ...FREE_BLOCKERS,
  ];
  const paidOver = flagged(usage.metrics).filter((m) => (m.overageUsd ?? 0) > 0);
  const paid: PlanOption = {
    plan: 'paid',
    name: planName('paid'),
    usd: usage.plan === 'paid' ? usage.costs.paidTotalUsd : usage.costs.paidBaseUsd,
    fits: true,
    reasons:
      usage.plan === 'paid' && paidOver.length
        ? paidOver.map((m) => `${m.label}: about ${formatUsd(m.overageUsd)} past ${formatQuantity(m.unit, m.included)}.`)
        : [`$${usage.costs.paidBaseUsd}/month covers this traffic with room to spare.`],
  };
  const free: PlanOption = { plan: 'free', name: planName('free'), usd: 0, fits: freeReasons.length === 0, reasons: freeReasons };
  return { free, paid, recommend: free.fits ? 'free' : 'paid' };
}

/** The overview's "Needs attention" row: ok, or the quotas to look at. */
export function attention(usage: CfUsage): { ok: boolean; detail: string } {
  const top = flagged(usage.metrics);
  const freeHits = usage.plan === 'free' ? usage.freeTier.filter((f) => f.daysOver7 > 0) : [];
  if (!top.length && !freeHits.length) {
    return { ok: true, detail: usage.errors.length ? `Within ${planName(usage.plan)}'s quotas (${plural(usage.errors.length, 'product')} not read)` : `Every quota within ${planName(usage.plan)}` };
  }
  const names = [...new Set([...top.map((m) => `${m.label} (${m.status})`), ...freeHits.map((f) => `${f.label} (limit hit ${times(f.daysOver7)} this week)`)])];
  return { ok: false, detail: names.join(', ') };
}
