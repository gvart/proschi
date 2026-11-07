import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { listWebhooks, type WebhookOutcome } from './api';
import { formatDateTime, formatNumber, humanize } from './format';
import { useLoad } from './hooks';
import { Empty, ErrorNote, PageHeader, Section, Skeleton, UserLink } from './ui';

const OUTCOMES: WebhookOutcome[] = ['applied', 'duplicate', 'ignored', 'stale', 'bad_signature', 'error'];
const OUTCOME_TONE: Record<WebhookOutcome, string> = {
  applied: 'pass',
  duplicate: 'neutral',
  ignored: 'neutral',
  stale: 'yellow',
  bad_signature: 'fail',
  error: 'fail',
};

/** Polar's webhook deliveries, newest first, kept 90 days: when, the event, what was done with it and the account. */
export default function WebhooksTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [outcome, setOutcome] = useState('');
  const [before, setBefore] = useState<number[]>([]);
  const cursor = before.at(-1);
  const log = useLoad(() => listWebhooks(outcome, cursor), [outcome, cursor], onSignedOut);
  const counts = new Map((log.data?.counts ?? []).map((c) => [c.outcome, c.n]));
  const week = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const pick = (value: string) => {
    setOutcome(value);
    setBefore([]);
  };
  return (
    <>
      <PageHeader
        page="webhooks"
        actions={
          <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={log.reload} disabled={log.loading}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        }
      />
      <Section title="Deliveries">
        <div className="adm-filters" role="group" aria-label="Outcome">
          <button type="button" className="adm-filter" aria-pressed={outcome === ''} onClick={() => pick('')}>
            All <span className="adm-filter__n">{formatNumber(week)}</span>
          </button>
          {OUTCOMES.map((o) => (
            <button key={o} type="button" className="adm-filter" aria-pressed={outcome === o} onClick={() => pick(o)}>
              <span className={`adm-dot adm-dot--${OUTCOME_TONE[o]}`} aria-hidden="true" />
              {humanize(o)} <span className="adm-filter__n">{formatNumber(counts.get(o) ?? 0)}</span>
            </button>
          ))}
          <span className="adm-muted adm-filters__note">in the last 7 days</span>
        </div>
        <ErrorNote>{log.error}</ErrorNote>
        {!log.data ? (
          !log.error && <Skeleton what="webhook deliveries" />
        ) : log.data.deliveries.length === 0 ? (
          <Empty>{outcome ? `No ${humanize(outcome).toLowerCase()} deliveries.` : 'No deliveries yet.'} They are kept for 90 days.</Empty>
        ) : (
          <div className={log.loading ? 'adm-refetching' : undefined}>
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Received</th>
                    <th scope="col">Event</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Account</th>
                    <th scope="col">Webhook id</th>
                  </tr>
                </thead>
                <tbody>
                  {log.data.deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="adm-nowrap">{formatDateTime(d.at)}</td>
                      <td className="adm-mono">{d.type ?? <span className="adm-muted">unread</span>}</td>
                      <td>
                        <span className={`ps-badge ps-badge--${OUTCOME_TONE[d.outcome]}`}>{humanize(d.outcome)}</span>
                      </td>
                      <td>{d.user ? <UserLink user={d.user} onOpenUser={onOpenUser} /> : <span className="adm-muted">—</span>}</td>
                      <td className="adm-mono adm-cut" title={d.webhookId ?? undefined}>
                        {d.webhookId ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(before.length > 0 || log.data.next !== null) && (
              <div className="adm-pager">
                <button
                  type="button"
                  className="ps-btn ps-btn--secondary ps-btn--sm"
                  disabled={!before.length}
                  onClick={() => setBefore((b) => b.slice(0, -1))}
                >
                  Newer
                </button>
                <button
                  type="button"
                  className="ps-btn ps-btn--secondary ps-btn--sm"
                  disabled={log.data.next === null}
                  onClick={() => log.data?.next != null && setBefore((b) => [...b, log.data!.next!])}
                >
                  Older
                </button>
              </div>
            )}
          </div>
        )}
        <p className="adm-footnote">
          Stale: older than what is stored, not applied. Bad signature: refused with 403, its body never read. No payload is ever stored.
        </p>
      </Section>
    </>
  );
}
