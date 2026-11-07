import { getAi, type AiUsage } from './api';
import Chart from './Chart';
import { formatCompact, formatNumber, formatPercent, formatUsd } from './format';
import { useLoad, useSort } from './hooks';
import { Empty, ErrorNote, PageHeader, Section, Skeleton, SortHeader, Stat } from './ui';

const INTERVIEW_SERIES = [
  { id: 'started', label: 'Started' },
  { id: 'finished', label: 'Finished' },
  { id: 'failed', label: 'Failed' },
];

const MARGIN_SERIES = [
  { id: 'charged', label: 'Charged (€)' },
  { id: 'cost', label: 'Cost (USD)' },
];

/** Two decimals, for a chart that mixes euros and dollars. */
const formatMoney = (n: number) => n.toFixed(2);

/** AI interviews and reviews over 30 days: how many, what they cost, the credits charged for them, who uses them most, and how often the token cap is hit. */
export default function AiTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const ai = useLoad(getAi, [], onSignedOut);
  const data = ai.data;
  return (
    <>
      <PageHeader page="ai" />
      <ErrorNote>{ai.error}</ErrorNote>
      {!data ? (
        !ai.error && (
          <Section title="Last 30 days">
            <Skeleton rows={3} what="AI usage" />
          </Section>
        )
      ) : (
        <AiUsageView data={data} onOpenUser={onOpenUser} />
      )}
    </>
  );
}

function AiUsageView({ data, onOpenUser }: { data: AiUsage; onOpenUser: (id: string) => void }) {
  const { totals, days } = data;
  const today = days.at(-1);
  const top = useSort(
    data.topUsers,
    { name: (u) => u.displayName, sessions: (u) => u.sessions, tokens: (u) => u.tokens, cost: (u) => u.costUsd },
    { key: 'cost', dir: 'desc' },
  );
  const perDay = (key: keyof (typeof days)[number]) => days.map((d) => ({ day: d.day, values: { n: Number(d[key]) } }));
  return (
    <>
      <Section label="Last 30 days">
        <div className="adm-stats">
          <Stat label="AI spend" value={formatUsd(totals.costUsd)} note={`${formatUsd(today?.costUsd ?? 0)} today`} />
          <Stat label="Interviews" value={formatNumber(totals.sessions)} note={`${formatNumber(totals.finished)} finished`} />
          <Stat label="Cost per finished" value={formatUsd(totals.avgCostPerFinished)} note="average, Sonnet and Haiku" />
          <Stat
            label="Hit the token cap"
            value={formatPercent(totals.cappedShare)}
            note={`${formatNumber(totals.capped)} of ${formatNumber(totals.sessions)} past ${formatCompact(data.cappedAt)} tokens`}
            tone={totals.cappedShare && totals.cappedShare > 0.1 ? 'warn' : undefined}
          />
          <Stat label="Tokens" value={formatCompact(totals.tokens)} note="input-equivalent" />
          <Stat label="In-depth reviews" value={formatNumber(totals.reviews)} note="charged in credits" />
          <Stat label="Credits charged" value={formatNumber(totals.credits)} note={`€${totals.chargedEur.toFixed(2)} for calls that cost ${formatUsd(totals.chargedCostUsd)}`} />
        </div>
      </Section>

      <Section label="Interviews">
        <Chart
          kind="line"
          title="AI interviews, by the UTC day they started"
          series={INTERVIEW_SERIES}
          points={days.map((d) => ({ day: d.day, values: { started: d.started, finished: d.finished, failed: d.failed } }))}
          summary="total"
          empty="No AI interviews in 30 days."
        />
      </Section>

      <div className="adm-grid">
        <Section label="Spend">
          <Chart
            kind="bar"
            title="AI interview spend (USD)"
            series={[{ id: 'n', label: 'Spend' }]}
            points={perDay('costUsd')}
            format={formatUsd}
            empty="Nothing spent in 30 days."
          />
          <p className="adm-footnote">
            By the day each session started, at first-party API prices (src/ai/budget.ts). The real bill is in Anthropic&apos;s console.
          </p>
        </Section>
        <Section label="Tokens">
          <Chart
            kind="bar"
            title="Input-equivalent tokens"
            series={[{ id: 'n', label: 'Tokens' }]}
            points={perDay('tokens')}
            format={formatCompact}
            empty="No tokens used in 30 days."
          />
        </Section>
        <Section label="Reviews">
          <Chart kind="bar" title="In-depth reviews" series={[{ id: 'n', label: 'Reviews' }]} points={perDay('reviews')} empty="No in-depth reviews in 30 days." />
        </Section>
        <Section label="Credits">
          <Chart
            kind="line"
            title="Credits charged (€) against what the calls cost (USD)"
            series={MARGIN_SERIES}
            points={days.map((d) => ({ day: d.day, values: { charged: d.chargedEur, cost: d.chargedCostUsd } }))}
            format={formatMoney}
            empty="No credits charged in 30 days."
          />
          <p className="adm-footnote">By the day each call was charged: twice the model cost, at €0.01 a credit (src/meter.ts).</p>
        </Section>

        <Section title="Top accounts by cost">
          {data.topUsers.length === 0 ? (
            <Empty>No AI interviews in 30 days.</Empty>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <SortHeader label="Account" {...top.by('name')} />
                  <SortHeader label="Interviews" numeric {...top.by('sessions')} />
                  <SortHeader label="Tokens" numeric {...top.by('tokens')} />
                  <SortHeader label="Cost" numeric {...top.by('cost')} />
                </tr>
              </thead>
              <tbody>
                {top.rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button type="button" className="adm-link" onClick={() => onOpenUser(u.id)}>
                        {u.displayName}
                      </button>
                    </td>
                    <td className="adm-num">{formatNumber(u.sessions)}</td>
                    <td className="adm-num">{formatCompact(u.tokens)}</td>
                    <td className="adm-num">{formatUsd(u.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </>
  );
}
