import { CircleCheck, OctagonAlert, RefreshCw, TriangleAlert } from 'lucide-react';
import { getCfUsage, type CfMetric, type CfStatus, type CfUsage } from './api';
import { compare, formatQuantity, formatResetDay, resetLabel, verdict, type PlanOption, type Tone } from './cfVerdict';
import { formatAgo, formatPercent, formatUsd, shortDay } from './format';
import { useLoad } from './hooks';
import { ErrorNote, PageHeader, Section, Skeleton } from './ui';

const PRODUCTS: CfMetric['product'][] = ['Workers', 'D1', 'R2', 'Email'];
const STATUS_LABEL: Record<CfStatus, string> = { ok: 'On track', watch: 'Watch', over: 'Over' };

/** Cloudflare usage (GET /api/admin/cf-usage): the verdict, one meter per quota, Free against Paid. */
export default function CloudflareTab({ onSignedOut }: { onSignedOut: () => void }) {
  const usage = useLoad(getCfUsage, [], onSignedOut);
  const data = usage.data;
  const notSetUp = !data && usage.error?.includes('CF_API_TOKEN');
  return (
    <>
      <PageHeader
        page="cloudflare"
        actions={
          data && (
            <span className="adm-muted adm-cf__updated">
              Updated {formatAgo(Math.floor(Date.parse(data.fetchedAt) / 1000))}
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={usage.reload} disabled={usage.loading}>
                <RefreshCw size={14} aria-hidden="true" /> Reload
              </button>
            </span>
          )
        }
      />
      {notSetUp ? <SetUp message={usage.error!} /> : <ErrorNote>{usage.error}</ErrorNote>}
      {!data ? (
        !usage.error && (
          <Section label="Loading">
            <Skeleton rows={4} what="Cloudflare usage" />
          </Section>
        )
      ) : (
        <UsageView data={data} />
      )}
    </>
  );
}

function UsageView({ data }: { data: CfUsage }) {
  const v = verdict(data);
  const plans = compare(data);
  return (
    <>
      <Verdict tone={v.tone} text={v.text} usage={data} />
      {data.errors.length > 0 && (
        <p className="adm-cf__errors" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            Cloudflare didn’t answer for {data.errors.map((e) => `${e.product} (${e.message})`).join(', ')}. Those quotas are missing below; the rest is current.
          </span>
        </p>
      )}
      {PRODUCTS.map((product) => {
        const metrics = data.metrics.filter((m) => m.product === product);
        if (!metrics.length) return null;
        return (
          <Section key={product} title={product}>
            <div className="adm-cf__meters">
              {metrics.map((m) => (
                <Meter key={m.id} m={m} />
              ))}
            </div>
          </Section>
        );
      })}
      <Section title="Free or Paid">
        <p className="adm-cf__recommend">
          {plans.recommend === data.plan
            ? `Stay on ${data.plan === 'paid' ? 'Workers Paid' : 'Workers Free'}.`
            : plans.recommend === 'paid'
              ? 'Upgrade to Workers Paid ($5/month).'
              : 'Workers Free would hold this traffic.'}{' '}
          <span className="adm-muted">Projected for this period, at today’s pace.</span>
        </p>
        <div className="adm-cf__plans">
          <PlanCard option={plans.free} current={data.plan === 'free'} />
          <PlanCard option={plans.paid} current={data.plan === 'paid'} />
        </div>
      </Section>
      {data.notes.length > 0 && (
        <ul className="adm-footnote adm-cf__notes">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="adm-footnote">
        Whole account, from Cloudflare’s analytics (a few minutes behind), cached 10 minutes. Quotas and prices from Cloudflare’s pricing pages (backend/src/cfUsage.ts).
      </p>
    </>
  );
}

function Verdict({ tone, text, usage }: { tone: Tone; text: string; usage: CfUsage }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'watch' ? TriangleAlert : OctagonAlert;
  return (
    <section className={`adm-cf__verdict adm-cf__verdict--${tone}`} aria-label="Verdict">
      <Icon size={20} aria-hidden="true" />
      <div>
        <p className="adm-cf__verdict-text">{text}</p>
        <p className="adm-muted">
          {usage.plan === 'paid' ? 'Workers Paid' : 'Workers Free'} ({usage.planSource === 'subscription' ? 'from the subscription' : 'CF_PLAN'}) · period{' '}
          {formatResetDay(usage.period.start)} – {formatResetDay(usage.period.end)}
          {usage.period.source === 'calendar' ? ' (calendar month)' : ''} · projected {formatUsd(usage.plan === 'paid' ? usage.costs.paidTotalUsd : 0)}
        </p>
      </div>
    </section>
  );
}

/** One quota: used against included, the projection marked, when it resets, and the last 30 days. */
function Meter({ m }: { m: CfMetric }) {
  const domain = Math.max(m.included, m.projected, m.used, 1);
  const at = (n: number) => `${Math.min(100, (n / domain) * 100)}%`;
  const q = (n: number) => formatQuantity(m.unit, n);
  const flow = m.kind === 'flow';
  const summary = `${m.label}: ${q(m.used)} of ${q(m.included)} used (${formatPercent(m.percent)})${flow ? `, projected ${q(m.projected)}` : ''}. ${resetLabel(m)}.`;
  return (
    <article className={`adm-cf__meter adm-cf__meter--${m.status}`}>
      <header className="adm-cf__meter-head">
        <h3>{m.label}</h3>
        <span className={`ps-badge ps-badge--${m.status === 'ok' ? 'pass' : m.status === 'watch' ? 'yellow' : 'fail'}`}>{STATUS_LABEL[m.status]}</span>
      </header>
      <p className="adm-cf__amount">
        <span className="adm-cf__used">{q(m.used)}</span>
        <span className="adm-muted">
          {' '}
          of {q(m.included)}
          {m.period === 'day' ? ' today' : ''} · {formatPercent(m.percent)}
        </span>
      </p>
      <div className="adm-cf__bar" role="img" aria-label={summary}>
        {flow && m.projected > m.used && <span className="adm-cf__bar-projected" style={{ left: at(m.used), width: `calc(${at(m.projected)} - ${at(m.used)})` }} />}
        <span className="adm-cf__bar-used" style={{ width: at(m.used) }} />
        <span className="adm-cf__bar-quota" style={{ left: at(m.included) }} />
        {flow && <span className="adm-cf__bar-marker" style={{ left: at(m.projected) }} />}
      </div>
      <dl className="adm-cf__facts">
        {flow && (
          <div>
            <dt>Projected</dt>
            <dd>
              {q(m.projected)}
              {m.passesAt ? ` · passes ${formatResetDay(m.passesAt)}` : ''}
            </dd>
          </div>
        )}
        <div>
          <dt>{m.period === 'day' ? 'Daily limit' : 'Monthly'}</dt>
          <dd>{resetLabel(m)}</dd>
        </div>
        {m.overageUsd !== null && m.overageUsd > 0 && (
          <div>
            <dt>Extra</dt>
            <dd>about {formatUsd(m.overageUsd)}</dd>
          </div>
        )}
      </dl>
      <Bars m={m} />
    </article>
  );
}

const BW = 300;
const BH = 40;

/** The last 30 days as thin bars; a daily quota as a dashed line. Each bar's value is in its tooltip; the meter's label says it in words. */
function Bars({ m }: { m: CfMetric }) {
  const daily = m.period === 'day';
  const max = Math.max(1e-9, ...m.series.map((d) => d.value), daily ? m.included : 0);
  const step = BW / m.series.length;
  const y = (v: number) => BH - (v / max) * (BH - 2);
  return (
    <figure className="adm-cf__bars">
      <svg viewBox={`0 0 ${BW} ${BH}`} preserveAspectRatio="none" aria-hidden="true">
        {m.series.map((d, i) => {
          const h = BH - y(d.value);
          return (
            <g key={d.day} className="adm-cf__bars-day">
              <rect className="adm-cf__bars-hit" x={i * step} y={0} width={step} height={BH}>
                <title>{`${shortDay(d.day)}: ${formatQuantity(m.unit, d.value)}`}</title>
              </rect>
              {d.value > 0 && <rect className={`adm-cf__bars-bar${daily && d.value > m.included ? ' is-over' : ''}`} x={i * step + 1} y={y(d.value)} width={Math.max(1, step - 2)} height={Math.max(1, h)} rx={1} />}
            </g>
          );
        })}
        {daily && <line className="adm-cf__bars-quota" x1={0} x2={BW} y1={y(m.included)} y2={y(m.included)} vectorEffect="non-scaling-stroke" />}
      </svg>
      <figcaption className="adm-cf__bars-axis">
        <span>{shortDay(m.series[0]?.day ?? '')}</span>
        <span>{m.kind === 'stock' ? 'level, last 30 days' : 'per day, last 30 days'}</span>
        <span>{shortDay(m.series.at(-1)?.day ?? '')}</span>
      </figcaption>
    </figure>
  );
}

function PlanCard({ option, current }: { option: PlanOption; current: boolean }) {
  return (
    <div className={`adm-cf__plan${option.fits ? '' : ' is-blocked'}`}>
      <div className="adm-cf__plan-head">
        <strong>{option.name}</strong>
        {current && <span className="ps-badge ps-badge--blue">Current</span>}
      </div>
      <p className="adm-cf__plan-cost">
        {formatUsd(option.usd)}
        <span className="adm-muted"> this period</span>
      </p>
      <p className="adm-muted">{option.fits ? 'Would hold this traffic.' : 'Would not hold:'}</p>
      <ul className="adm-cf__plan-reasons">
        {option.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/** 501: what to set, with the token's exact permissions. */
function SetUp({ message }: { message: string }) {
  return (
    <Section title="Not set up yet">
      <p className="adm-muted">{message}</p>
      <ol className="adm-cf__steps">
        <li>
          Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token, with <strong>Account → Account Analytics → Read</strong>; add{' '}
          <strong>Account → Billing → Read</strong> for the plan and renewal date, and <strong>Zone → Analytics → Read</strong> (proschi.app) to count emails.
        </li>
        <li>
          <code>npx wrangler secret put CF_API_TOKEN</code> and <code>npx wrangler secret put CF_ACCOUNT_ID</code>; optionally <code>CF_ZONE_ID</code>, and{' '}
          <code>CF_PLAN</code> (free or paid) without Billing Read.
        </li>
      </ol>
    </Section>
  );
}
