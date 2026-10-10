import { useState } from 'react';
import { listAudit, listEvents, type AppEvent, type AuditEntry } from './api';
import { formatDateTime, humanize } from './format';
import { useLoad } from './hooks';
import { ErrorNote, LevelBadge, Loading, Section } from './ui';

/** App events (errors, cron runs, sign-in failures, rate limits), newest first, filtered by kind and level. */
export function EventsTab({ kind, onKind, onSignedOut }: { kind: string; onKind: (kind: string) => void; onSignedOut: () => void }) {
  const [level, setLevel] = useState('');
  const [before, setBefore] = useState<number[]>([]);
  const cursor = before.at(-1);
  const events = useLoad(() => listEvents({ kind, level, before: cursor }), [kind, level, cursor], onSignedOut);
  const reset = () => setBefore([]);
  return (
    <Section
      title="App events"
      actions={
        <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={events.reload} disabled={events.loading}>
          Refresh
        </button>
      }
    >
      <div className="adm-toolbar">
        <select className="adm-input" aria-label="Kind" value={kind} onChange={(e) => (onKind(e.target.value), reset())}>
          <option value="">All kinds</option>
          {(events.data?.kinds ?? []).map((k) => (
            <option key={k.kind} value={k.kind}>
              {humanize(k.kind)} ({k.n})
            </option>
          ))}
          {kind && !events.data?.kinds.some((k) => k.kind === kind) && <option value={kind}>{humanize(kind)} (0)</option>}
        </select>
        <select className="adm-input" aria-label="Level" value={level} onChange={(e) => (setLevel(e.target.value), reset())}>
          <option value="">All levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
        </select>
      </div>
      <ErrorNote>{events.error}</ErrorNote>
      {!events.data ? (
        !events.error && <Loading what="events" />
      ) : events.data.events.length === 0 ? (
        <p className="adm-muted">No events. They are kept for 30 days.</p>
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
  return (
    <Section title="Audit log">
      <ErrorNote>{audit.error}</ErrorNote>
      {!audit.data ? (
        !audit.error && <Loading what="the audit log" />
      ) : audit.data.entries.length === 0 ? (
        <p className="adm-muted">Nothing yet.</p>
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
                {audit.data.entries.map((a) => (
                  <AuditRow key={a.id} entry={a} onOpenUser={onOpenUser} />
                ))}
              </tbody>
            </table>
          </div>
          <Older hasPrevious={before.length > 0} next={audit.data.next} onNewer={() => setBefore((b) => b.slice(0, -1))} onOlder={(id) => setBefore((b) => [...b, id])} />
        </>
      )}
    </Section>
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
