import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleCheck, Minus, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getHealth, getOverview, getTrends, listWebhooks, RANGES, type Range, type TrendPoint } from './api';
import { failedDeliveries, missingSecrets } from './attention';
import Chart from './Chart';
import { change, periods, sum } from './chartScale';
import { formatNumber, formatUsd, humanize } from './format';
import { useLoad } from './hooks';
import { routeHash } from './route';
import Sparkline from './Sparkline';
import { ErrorNote, PageHeader, Section, Skeleton } from './ui';

type Key = Exclude<keyof TrendPoint, 'day'>;

interface Kpi {
  key: Key;
  label: string;
  /** A total over the range (a flow), or the level on its last day (a stock). */
  sum: boolean;
  /** Whether a rise is good news, bad news, or neither (spend). */
  up: 'good' | 'bad' | 'neutral';
  format?: (n: number) => string;
}

const KPIS: Kpi[] = [
  { key: 'signups', label: 'Sign-ups', sum: true, up: 'good' },
  { key: 'active', label: 'Weekly active users', sum: false, up: 'good' },
  { key: 'proSubscribers', label: 'Pro subscribers', sum: false, up: 'good' },
  { key: 'interviewsFinished', label: 'Interviews finished', sum: true, up: 'good' },
  { key: 'aiCostUsd', label: 'AI spend', sum: true, up: 'neutral', format: formatUsd },
  { key: 'webhookFailures', label: 'Webhook failures', sum: true, up: 'bad' },
];

/** The overview's charts, in pairs: what happens per day as bars, levels as lines. */
const CHARTS: { key: Key; title: string; kind: 'bar' | 'line'; empty: string; format?: (n: number) => string }[][] = [
  [
    { key: 'signups', title: 'Sign-ups', kind: 'bar', empty: 'No sign-ups in this range.' },
    { key: 'active', title: 'Weekly active users', kind: 'line', empty: 'No recorded activity in this range.' },
  ],
  [
    { key: 'aiCostUsd', title: 'AI spend (USD)', kind: 'bar', empty: 'Nothing spent on AI in this range.', format: formatUsd },
    { key: 'interviewsFinished', title: 'AI interviews finished', kind: 'bar', empty: 'No interviews finished in this range.' },
  ],
  [
    { key: 'proSubscribers', title: 'Pro subscribers', kind: 'line', empty: 'No Pro subscribers in this range.' },
    { key: 'packOrders', title: 'Interview pack orders', kind: 'bar', empty: 'No pack orders in this range.' },
  ],
];

const parseRange = (param?: string): Range => (RANGES.find((r) => String(r) === param) ?? 30) as Range;

/** The dashboard: KPIs against the period before, the trends behind them, and what needs attention, all for one time range. */
export default function OverviewTab({
  range: param,
  onRange,
  onSignedOut,
  onOpenEvents,
}: {
  range?: string;
  onRange: (days: string) => void;
  onSignedOut: () => void;
  onOpenEvents: (kind: string) => void;
}) {
  const range = parseRange(param);
  const trends = useLoad(() => getTrends(range), [range], onSignedOut);
  const overview = useLoad(getOverview, [], onSignedOut);
  const health = useLoad(getHealth, [], onSignedOut);
  const webhooks = useLoad(() => listWebhooks(''), [], onSignedOut);
  const [event, setEvent] = useState('editor_open');
  const data = trends.data;
  // While another range loads, the last one stays on screen, dimmed.
  const refetching = trends.loading && !!data;
  const points = data?.points ?? [];
  const days = data?.days ?? range;
  const current = points.slice(-days);

  return (
    <>
      <PageHeader page="overview" actions={<RangePicker value={range} onChange={(r) => onRange(String(r))} />} />
      <ErrorNote>{trends.error}</ErrorNote>

      <section className="adm-kpis" aria-label="Key numbers">
        {KPIS.map((kpi) =>
          data ? (
            <KpiTile key={kpi.key} kpi={kpi} points={points} days={days} refetching={refetching} />
          ) : (
            <div key={kpi.key} className="adm-kpi">
              <Skeleton rows={3} what={kpi.label} />
            </div>
          ),
        )}
      </section>

      <Section title="Needs attention">
        <ul className="adm-attention">
          <Attention
            loading={!webhooks.data}
            ok={failedDeliveries(webhooks.data?.counts ?? []) === 0}
            href={routeHash({ page: 'webhooks' })}
            title="Failed webhooks"
            detail={(() => {
              const n = failedDeliveries(webhooks.data?.counts ?? []);
              return n
                ? `${formatNumber(n)} ${n === 1 ? 'delivery' : 'deliveries'} refused or failed in the last 7 days`
                : 'No refused or failed deliveries in the last 7 days';
            })()}
          />
          <Attention
            loading={!health.data}
            ok={health.data ? missingSecrets(health.data.config).length === 0 : true}
            href={routeHash({ page: 'health' })}
            title="Missing secrets"
            detail={health.data ? missingSecrets(health.data.config).join(', ') || 'Every required secret is set' : ''}
          />
          <Attention
            loading={!overview.data}
            ok={!overview.data?.events.some((e) => e.level !== 'info')}
            href={routeHash({ page: 'events' })}
            title="Errors in the last 24 h"
            detail={
              overview.data?.events.some((e) => e.level !== 'info') ? (
                <span className="adm-chips">
                  {overview.data.events
                    .filter((e) => e.level !== 'info')
                    .map((e) => (
                      <button key={`${e.kind}-${e.level}`} type="button" className={`adm-filter adm-filter--${e.level}`} onClick={() => onOpenEvents(e.kind)}>
                        <span className={`adm-dot adm-dot--${e.level === 'error' ? 'fail' : 'yellow'}`} aria-hidden="true" />
                        {humanize(e.kind)}: {formatNumber(e.n)}
                      </button>
                    ))}
                </span>
              ) : (
                'No errors or warnings'
              )
            }
          />
        </ul>
      </Section>

      {CHARTS.map((pair, i) => (
        <div key={i} className="adm-grid">
          {pair.map((c) => (
            <Section key={c.key} label={c.title}>
              {data ? (
                <Chart
                  kind={c.kind}
                  title={c.title}
                  series={[{ id: c.key, label: c.title }]}
                  points={current.map((p) => ({ day: p.day, values: { [c.key]: p[c.key] } }))}
                  format={c.format}
                  empty={c.empty}
                  refetching={refetching}
                />
              ) : (
                <Skeleton rows={6} what={c.title} />
              )}
            </Section>
          ))}
        </div>
      ))}


      {data && (
        <Section
          title="Usage counts"
          actions={
            <label className="adm-inline">
              <span className="adm-muted">Event</span>
              <select className="adm-input" value={event} onChange={(e) => setEvent(e.target.value)}>
                {data.usage.events.map((name) => (
                  <option key={name} value={name}>
                    {humanize(name)}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          <Chart
            kind="bar"
            title={humanize(event)}
            series={[{ id: event, label: humanize(event) }]}
            points={data.usage.days.slice(-days).map((d) => ({ day: d.day, values: { [event]: d.counts[event] ?? 0 } }))}
            empty="None counted in this range."
            refetching={refetching}
          />
          <p className="adm-footnote">Anonymous daily counts from the site (docs/PRIVACY.md, “Usage counts”).</p>
        </Section>
      )}

      {overview.data && (
        <Section title="All time">
          <dl className="adm-totals">
            <Total label="Accounts" value={overview.data.users.total} note={`${formatNumber(overview.data.users.blocked)} blocked`} />
            <Total label="Problems solved" value={overview.data.content.solves} note={`${formatNumber(overview.data.content.attempts)} attempted`} />
            <Total label="Card reviews" value={overview.data.content.cardReviews} />
            <Total label="Daily challenges" value={overview.data.content.challenges} />
            <Total label="Game runs" value={overview.data.content.gameRuns} />
            <Total label="Short links" value={overview.data.content.shares} />
            <Total label="Synced diagrams" value={overview.data.content.documents} />
            <Total label="Email reminders" value={overview.data.users.emailReminders} />
          </dl>
        </Section>
      )}
    </>
  );
}

/** 7, 30 or 90 days: the one filter, above everything it scopes. */
function RangePicker({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return (
    <div className="adm-segmented" role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button key={r} type="button" aria-pressed={r === value} aria-label={`Last ${r} days`} onClick={() => onChange(r)}>
          {r} days
        </button>
      ))}
    </div>
  );
}

function KpiTile({ kpi, points, days, refetching }: { kpi: Kpi; points: TrendPoint[]; days: number; refetching: boolean }) {
  const values = points.map((p) => p[kpi.key]);
  const { current, previous } = periods(values, days);
  const now = kpi.sum ? sum(current) : (current.at(-1) ?? 0);
  const before = kpi.sum ? sum(previous) : (previous.at(-1) ?? 0);
  const format = kpi.format ?? formatNumber;
  const ratio = change(now, before);
  const direction = now > before ? 'up' : now < before ? 'down' : 'flat';
  const tone = direction === 'flat' || kpi.up === 'neutral' ? 'neutral' : (direction === 'up') === (kpi.up === 'good') ? 'good' : 'bad';
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;
  const amount = ratio !== null ? `${Math.round(Math.abs(ratio) * 100)}%` : `${now >= before ? '+' : '−'}${format(Math.abs(now - before))}`;
  return (
    <div className={`adm-kpi${refetching ? ' adm-refetching' : ''}`}>
      <span className="adm-kpi__label">{kpi.label}</span>
      <span className="adm-kpi__value">{format(now)}</span>
      <span className={`adm-delta adm-delta--${tone}`}>
        <Icon size={14} aria-hidden="true" />
        <span>{direction === 'flat' ? 'No change' : amount}</span>
        <span className="adm-muted">
          vs previous {days} days{kpi.sum ? '' : ` (${format(before)})`}
        </span>
      </span>
      <Sparkline previous={previous} current={current} />
    </div>
  );
}

function Attention({ loading, ok, href, title, detail }: { loading: boolean; ok: boolean; href: string; title: string; detail: ReactNode }) {
  return (
    <li className={`adm-attention__row${!loading && !ok ? ' is-alert' : ''}`}>
      <span className="adm-attention__icon" aria-hidden="true">
        {loading ? null : ok ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
      </span>
      <span className="adm-attention__text">
        <strong>{title}</strong>
        <span className="adm-muted">{loading ? 'Checking…' : detail}</span>
      </span>
      <a className="adm-attention__link" href={href}>
        Open <span className="adm-sr">{title}</span>
        <ChevronRight size={14} aria-hidden="true" />
      </a>
    </li>
  );
}

function Total({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="adm-total">
      <dt>{label}</dt>
      <dd>
        {formatNumber(value)}
        {note && <span className="adm-muted"> · {note}</span>}
      </dd>
    </div>
  );
}
