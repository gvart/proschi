import { getAi } from './api';
import BarChart from './BarChart';
import { formatCompact, formatNumber, formatPercent, formatUsd } from './format';
import { useLoad } from './hooks';
import LineChart from './LineChart';
import { ErrorNote, Loading, Section, Stat } from './ui';

const INTERVIEW_SERIES = [
  { id: 'started', label: 'Started' },
  { id: 'finished', label: 'Finished' },
  { id: 'failed', label: 'Failed' },
  { id: 'refunded', label: 'Refunded' },
];

/** AI interviews and reviews over 30 days: how many, what they cost, who uses them most, and how often the token cap is hit. */
export default function AiTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const ai = useLoad(getAi, [], onSignedOut);
  const data = ai.data;
  if (!data) return ai.error ? <ErrorNote>{ai.error}</ErrorNote> : <Loading what="AI usage" />;
  const { totals, days } = data;
  const today = days.at(-1);
  return (
    <>
      <Section title="Last 30 days">
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
          <Stat label="AI reviews" value={formatNumber(totals.reviews)} note="their cost isn't stored" />
        </div>
      </Section>

      <Section title="Interviews per day">
        <LineChart title="AI interviews, by the UTC day they started" series={INTERVIEW_SERIES} points={days.map((d) => ({ day: d.day, values: { started: d.started, finished: d.finished, failed: d.failed, refunded: d.refunded } }))} />
      </Section>

      <Section title="Cost and tokens per day">
        <BarChart title="AI interview spend (USD)" bars={days.map((d) => ({ day: d.day, value: d.costUsd }))} format={formatUsd} />
        <BarChart title="Tokens" bars={days.map((d) => ({ day: d.day, value: d.tokens }))} format={formatCompact} />
        <p className="adm-muted">By the day each session started, at first-party API prices (src/ai/budget.ts). The real bill is in Anthropic&apos;s console.</p>
      </Section>

      <Section title="AI reviews per day">
        <BarChart title="AI design reviews" bars={days.map((d) => ({ day: d.day, value: d.reviews }))} />
      </Section>

      <Section title="Top accounts by cost">
        {data.topUsers.length === 0 ? (
          <p className="adm-muted">No AI interviews in 30 days.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="adm-num">
                  Interviews
                </th>
                <th scope="col" className="adm-num">
                  Tokens
                </th>
                <th scope="col" className="adm-num">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {data.topUsers.map((u) => (
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
    </>
  );
}
