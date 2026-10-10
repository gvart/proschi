import { useState } from 'react';
import { getOverview } from './api';
import BarChart from './BarChart';
import { formatNumber, humanize } from './format';
import { useLoad } from './hooks';
import { ErrorNote, Loading, Section, Stat } from './ui';

/** Users, sign-ups, content and the daily usage counts. */
export default function OverviewTab({ onSignedOut, onOpenEvents }: { onSignedOut: () => void; onOpenEvents: (kind: string) => void }) {
  const overview = useLoad(getOverview, [], onSignedOut);
  const [event, setEvent] = useState('editor_open');
  const data = overview.data;
  if (!data) return overview.error ? <ErrorNote>{overview.error}</ErrorNote> : <Loading what="the overview" />;
  const { users, content } = data;
  const issues = data.events.filter((e) => e.level !== 'info');
  return (
    <>
      <Section title="Accounts">
        <div className="adm-stats">
          <Stat label="Accounts" value={formatNumber(users.total)} note={`${formatNumber(users.public)} public`} />
          <Stat label="Active today" value={formatNumber(users.active.day)} note={`${formatNumber(users.active.week)} this week, ${formatNumber(users.active.month)} in 30 days`} />
          <Stat label="New today" value={formatNumber(users.new.day)} note={`${formatNumber(users.new.week)} this week, ${formatNumber(users.new.month)} in 30 days`} />
          <Stat label="Blocked" value={formatNumber(users.blocked)} tone={users.blocked ? 'warn' : undefined} />
          <Stat label="Email reminders" value={formatNumber(users.emailReminders)} note="confirmed addresses" />
        </div>
        <BarChart title="Sign-ups" bars={data.signups.map((s) => ({ day: s.day, value: s.count }))} />
      </Section>

      <Section title="Last 24 hours">
        {issues.length ? (
          <ul className="adm-chips">
            {issues.map((e) => (
              <li key={`${e.kind}-${e.level}`}>
                <button type="button" className={`ps-badge ps-badge--${e.level === 'error' ? 'fail' : 'yellow'} adm-chip`} onClick={() => onOpenEvents(e.kind)}>
                  {humanize(e.kind)}: {formatNumber(e.n)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adm-muted">No errors or warnings.</p>
        )}
      </Section>

      <Section title="Content">
        <div className="adm-stats">
          <Stat label="Problems attempted" value={formatNumber(content.attempts)} note={`${formatNumber(content.solves)} solved`} />
          <Stat label="Card reviews" value={formatNumber(content.cardReviews)} />
          <Stat label="Daily challenges" value={formatNumber(content.challenges)} />
          <Stat label="Game runs" value={formatNumber(content.gameRuns)} />
          <Stat label="Short links" value={formatNumber(content.shares)} />
          <Stat label="Synced diagrams" value={formatNumber(content.documents)} />
        </div>
      </Section>

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
        <BarChart title={humanize(event)} bars={data.usage.days.map((d) => ({ day: d.day, value: d.counts[event] ?? 0 }))} />
      </Section>
    </>
  );
}
