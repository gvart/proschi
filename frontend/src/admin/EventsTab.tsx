import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { listAudit, listEvents, type AppEvent, type AuditEntry } from './api';
import { formatDateTime, humanize } from './format';
import { useLoad } from './hooks';
import { Empty, ErrorNote, LevelBadge, PageHeader, SearchBox, Section, Skeleton } from './ui';
import Select from '../design/Select';

/** App events (errors, cron runs, sign-in failures, rate limits), newest first, filtered by kind and level. */
export function EventsTab({ kind, onKind, onSignedOut }: { kind: string; onKind: (kind: string) => void; onSignedOut: () => void }) {
  const [level, setLevel] = useState('');
  const [before, setBefore] = useState<number[]>([]);
  const cursor = before.at(-1);
  const events = useLoad(() => listEvents({ kind, level, before: cursor }), [kind, level, cursor], onSignedOut);
  const reset = () => setBefore([]);
  return (
    <>
      <PageHeader
        page="events"
        actions={
          <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={events.reload} disabled={events.loading}>
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        }
      />
      <Section title="App events">
        <div className="adm-toolbar">
          <Select
            size="sm"
            aria-label="Kind"
            value={kind}
            onChange={(v) => (onKind(v), reset())}
            options={[
              { value: '', label: 'All kinds' },
              ...(events.data?.kinds ?? []).map((k) => ({ value: k.kind, label: `${humanize(k.kind)} (${k.n})` })),
              ...(kind && !events.data?.kinds.some((k) => k.kind === kind) ? [{ value: kind, label: `${humanize(kind)} (0)` }] : []),
            ]}
          />
          <Select
            size="sm"
            aria-label="Level"
            value={level}
            onChange={(v) => (setLevel(v), reset())}
            options={[
              { value: '', label: 'All levels' },
              { value: 'error', label: 'Errors' },
              { value: 'warn', label: 'Warnings' },
              { value: 'info', label: 'Info' },
            ]}
          />
        </div>
        <ErrorNote>{events.error}</ErrorNote>
        {!events.data ? (
          !events.error && <Skeleton what="events" />
        ) : events.data.events.length === 0 ? (
          <Empty>{kind || level ? 'No events of this kind or level.' : 'No events.'} They are kept for 30 days.</Empty>
        ) : (
          <>
            <ol className="adm-events">
              {events.data.events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ol>
            <Older
              hasPrevious={before.length > 0}
              next={events.data.next}
              onNewer={() => setBefore((b) => b.slice(0, -1))}
              onOlder={(id) => setBefore((b) => [...b, id])}
            />
          </>
        )}
      </Section>
    </>
  );
}

function EventRow({ event }: { event: AppEvent }) {
  const detail = event.detail && typeof event.detail === 'object' ? (event.detail as Record<string, unknown>) : undefined;
  const { stack, ...rest } = detail ?? {};
  return (
    <li className="adm-event">
      <div className="adm-event__head">
        <LevelBadge level={event.level} />
        <span className="adm-event__kind">{humanize(event.kind)}</span>
        <span className="adm-muted">{formatDateTime(event.at)}</span>
      </div>
      <p className="adm-event__message">{event.message}</p>
      {detail && Object.keys(rest).length > 0 && (
        <p className="adm-muted adm-mono">
          {Object.entries(rest)
            .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join('  ')}
        </p>
      )}
      {typeof stack === 'string' && (
        <details>
          <summary>Stack</summary>
          <pre className="adm-pre">{stack}</pre>
        </details>
      )}
    </li>
  );
}

function Older({ hasPrevious, next, onNewer, onOlder }: { hasPrevious: boolean; next: number | null; onNewer: () => void; onOlder: (id: number) => void }) {
  if (!hasPrevious && next === null) return null;
  return (
    <div className="adm-pager">
      <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" disabled={!hasPrevious} onClick={onNewer}>
        Newer
      </button>
      <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" disabled={next === null} onClick={() => next !== null && onOlder(next)}>
        Older
      </button>
    </div>
  );
}

/** What the admin did, newest first; kept 400 days. */
export function AuditTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [before, setBefore] = useState<number[]>([]);
  const cursor = before.at(-1);
  const audit = useLoad(() => listAudit(cursor), [cursor], onSignedOut);
  const [filter, setFilter] = useState('');
  const needle = filter.toLowerCase();
  // Filters the page that is loaded: the action, its target and detail, and the passkey.
  const entries = (audit.data?.entries ?? []).filter(
    (a) => !needle || [a.action, humanize(a.action), a.target ?? '', a.passkey ?? '', a.detail ? JSON.stringify(a.detail) : ''].some((text) => text.toLowerCase().includes(needle)),
  );
  return (
    <>
      <PageHeader page="audit" />
      <Section title="Entries">
        <div className="adm-toolbar">
          <SearchBox value={filter} onChange={setFilter} label="Filter the audit log" placeholder="Action, account id, reason or passkey" />
        </div>
        <ErrorNote>{audit.error}</ErrorNote>
        {!audit.data ? (
          !audit.error && <Skeleton what="the audit log" />
        ) : audit.data.entries.length === 0 ? (
          <Empty>No admin actions yet.</Empty>
        ) : entries.length === 0 ? (
          <Empty>Nothing on this page matches “{filter}”.</Empty>
        ) : (
          <>
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Target</th>
                    <th scope="col">Passkey</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((a) => (
                    <AuditRow key={a.id} entry={a} onOpenUser={onOpenUser} />
                  ))}
                </tbody>
              </table>
            </div>
            <Older hasPrevious={before.length > 0} next={audit.data.next} onNewer={() => setBefore((b) => b.slice(0, -1))} onOlder={(id) => setBefore((b) => [...b, id])} />
          </>
        )}
      </Section>
    </>
  );
}

function AuditRow({ entry, onOpenUser }: { entry: AuditEntry; onOpenUser: (id: string) => void }) {
  const isUser = entry.action.startsWith('user.') && entry.action !== 'user.delete' && entry.target;
  return (
    <tr>
      <td>{formatDateTime(entry.at)}</td>
      <td>
        {humanize(entry.action)}
        {entry.detail && <span className="adm-muted"> {JSON.stringify(entry.detail)}</span>}
      </td>
      <td className="adm-mono">
        {isUser ? (
          <button type="button" className="adm-link" onClick={() => onOpenUser(entry.target!)}>
            {entry.target}
          </button>
        ) : (
          (entry.target ?? '—')
        )}
      </td>
      <td>{entry.passkey ?? <span className="adm-muted">removed</span>}</td>
    </tr>
  );
}
