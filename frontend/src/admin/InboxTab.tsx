import { Camera, Copy, ExternalLink, FileCode, Mail } from 'lucide-react';
import { useCallback, useState } from 'react';
import { encodeShareHash } from '../playground/share';
import { deleteFeedback, feedbackFileUrl, getFeedback, KIND_LABEL, listFeedback, patchFeedback, STATUS_LABEL, type FeedbackFilter, type FeedbackKind, type FeedbackStatus } from './feedbackApi';
import { formatAgo, formatBytes, formatDateTime, formatNumber } from './format';
import { useAction, useLoad } from './hooks';
import { Empty, ErrorNote, PageHeader, Pager, SearchBox, Section, Skeleton, UserLink } from './ui';

const STATUS_TONE: Record<FeedbackStatus, string> = { new: 'yellow', in_progress: 'blue', done: 'neutral' };
const KIND_TONE: Record<FeedbackKind, string> = { bug: 'fail', question: 'blue', proposal: 'lilac', other: 'neutral' };
const STATUS_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: '', label: 'All' },
] as const;

/** The Inbox: messages from the app's Send feedback (#/inbox), and one of them (#/inbox/<id>). */
export default function InboxTab({
  messageId,
  onOpen,
  onOpenUser,
  onChanged,
  onSignedOut,
}: {
  messageId?: string;
  onOpen: (id?: string) => void;
  onOpenUser: (id: string) => void;
  /** After a change the sidebar's unread count may be stale. */
  onChanged: () => void;
  onSignedOut: () => void;
}) {
  return messageId ? (
    <MessageView id={messageId} onBack={() => onOpen()} onOpenUser={onOpenUser} onChanged={onChanged} onSignedOut={onSignedOut} />
  ) : (
    <MessageList onOpen={onOpen} onOpenUser={onOpenUser} onSignedOut={onSignedOut} />
  );
}

function MessageList({ onOpen, onOpenUser, onSignedOut }: { onOpen: (id: string) => void; onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [filter, setFilter] = useState<FeedbackFilter>({ status: 'open', kind: '', q: '', offset: 0 });
  const list = useLoad(() => listFeedback(filter), [filter.status, filter.kind, filter.q, filter.offset], onSignedOut);
  const counts = list.data?.counts;
  const search = useCallback((q: string) => setFilter((f) => ({ ...f, q, offset: 0 })), []);
  const countOf = (id: (typeof STATUS_FILTERS)[number]['id']) =>
    !counts ? undefined : id === 'open' ? counts.open : id === 'new' ? counts.new : id === 'in_progress' ? counts.inProgress : id === 'done' ? counts.done : counts.open + counts.done;

  return (
    <>
      <PageHeader page="inbox" />
      <Section title="Messages">
        <div className="adm-filters" role="group" aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <button key={s.id} type="button" className="adm-filter" aria-pressed={filter.status === s.id} onClick={() => setFilter((f) => ({ ...f, status: s.id, offset: 0 }))}>
              {s.label} {countOf(s.id) !== undefined && <span className="adm-filter__n">{formatNumber(countOf(s.id)!)}</span>}
            </button>
          ))}
          {counts && counts.unread > 0 && <span className="adm-muted adm-filters__note">{formatNumber(counts.unread)} unread</span>}
        </div>
        <div className="adm-toolbar">
          <SearchBox value={filter.q} onChange={search} label="Search messages" placeholder="Words in the subject or message, or the sender's account id" />
          <select className="adm-input" aria-label="Type" value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value as FeedbackKind | '', offset: 0 }))}>
            <option value="">Every type</option>
            {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <ErrorNote>{list.error}</ErrorNote>
        {!list.data ? (
          !list.error && <Skeleton what="messages" />
        ) : list.data.messages.length === 0 ? (
          <Empty>{filter.q || filter.kind ? 'No messages match.' : filter.status === 'open' ? 'Nothing open: every message is done.' : 'No messages here.'}</Empty>
        ) : (
          <div className={list.loading ? 'adm-refetching' : undefined}>
            <div className="adm-scroll">
              <table className="adm-table adm-inbox">
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Message</th>
                    <th scope="col">From</th>
                    <th scope="col">Received</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.messages.map((m) => (
                    <tr key={m.id} className={m.read ? undefined : 'is-unread'}>
                      <td>
                        <span className={`ps-badge ps-badge--${KIND_TONE[m.kind]}`}>{KIND_LABEL[m.kind]}</span>
                      </td>
                      <td className="adm-inbox__message">
                        <button type="button" className="adm-link" onClick={() => onOpen(m.id)}>
                          {!m.read && <span className="adm-sr">Unread: </span>}
                          {m.subject || m.excerpt.split('\n')[0] || 'No subject'}
                        </button>
                        {m.subject && <span className="adm-inbox__excerpt adm-muted">{m.excerpt}</span>}
                        {(m.screenshots > 0 || m.hasDiagram) && (
                          <span className="adm-inbox__attached adm-muted">
                            {m.screenshots > 0 && (
                              <span title={`${m.screenshots} screenshot${m.screenshots === 1 ? '' : 's'}`}>
                                <Camera size={13} aria-hidden="true" /> {m.screenshots}
                                <span className="adm-sr"> screenshots</span>
                              </span>
                            )}
                            {m.hasDiagram && (
                              <span title="Diagram attached">
                                <FileCode size={13} aria-hidden="true" />
                                <span className="adm-sr">diagram attached</span>
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        <UserLink user={m.sender} onOpenUser={onOpenUser} />
                        {m.sender.blocked && <span className="ps-badge ps-badge--fail adm-gap">blocked</span>}
                      </td>
                      <td title={formatDateTime(m.createdAt)}>{formatAgo(m.createdAt)}</td>
                      <td>
                        <span className={`ps-badge ps-badge--${STATUS_TONE[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={list.data.offset} pageSize={list.data.pageSize} total={list.data.total} onChange={(offset) => setFilter((f) => ({ ...f, offset }))} />
          </div>
        )}
      </Section>
    </>
  );
}

function MessageView({ id, onBack, onOpenUser, onChanged, onSignedOut }: { id: string; onBack: () => void; onOpenUser: (id: string) => void; onChanged: () => void; onSignedOut: () => void }) {
  const detail = useLoad(
    () =>
      getFeedback(id).then((m) => {
        // Opening it marked it read.
        onChanged();
        return m;
      }),
    [id],
    onSignedOut,
  );
  const back = (
    <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={onBack}>
      ← Inbox
    </button>
  );
  const m = detail.data;
  if (!m) {
    return (
      <>
        <PageHeader page="inbox" title="Message" description={<span className="adm-mono">{id}</span>} actions={back} />
        <Section label="Message">{detail.error ? <ErrorNote>{detail.error}</ErrorNote> : <Skeleton rows={6} what="the message" />}</Section>
      </>
    );
  }
  const version = m.context.version;
  return (
    <>
      <PageHeader
        page="inbox"
        title={m.subject || 'No subject'}
        description={
          <>
            <span className={`ps-badge ps-badge--${KIND_TONE[m.kind]}`}>{KIND_LABEL[m.kind]}</span> from <UserLink user={m.sender} onOpenUser={onOpenUser} /> · {formatDateTime(m.createdAt)}
          </>
        }
        actions={back}
      />
      <Section title="Message">
        {/* Plain text, as written: React escapes it, and pre-wrap keeps its lines. */}
        <p className="adm-inbox__text">{m.message}</p>
        <div className="adm-actions adm-inbox__actions">
          {m.sender.email ? (
            <a className="ps-btn ps-btn--secondary ps-btn--sm" href={`mailto:${m.sender.email}?subject=${encodeURIComponent(`Re: ${m.subject || `your ${KIND_LABEL[m.kind].toLowerCase()} on Proschi`}`)}`}>
              <Mail size={14} aria-hidden="true" /> Reply to {m.sender.email}
            </a>
          ) : (
            <span className="adm-muted">No confirmed email address on this account, so no way to reply.</span>
          )}
        </div>
      </Section>

      <Section title="Context">
        <dl className="adm-dl">
          <dt>Page</dt>
          <dd className="adm-mono">{m.context.path || '—'}</dd>
          <dt>Browser</dt>
          <dd className="adm-mono">{m.context.userAgent || '—'}</dd>
          <dt>Window</dt>
          <dd>{m.context.viewport || '—'}</dd>
          <dt>Plan</dt>
          <dd>{m.context.plan || '—'}</dd>
          <dt>Version</dt>
          <dd className="adm-mono">{version ? `${version.tag || version.id}${version.timestamp ? ` · ${version.timestamp}` : ''}` : 'local development'}</dd>
        </dl>
      </Section>

      {m.diagram !== null && <DiagramSection source={m.diagram} />}

      {m.screenshots.length > 0 && (
        <Section title={`Screenshots (${m.screenshots.length})`}>
          <ul className="adm-inbox__shots">
            {m.screenshots.map((s, i) => (
              <li key={s.key}>
                <a href={feedbackFileUrl(m.id, s.key)} target="_blank" rel="noreferrer">
                  <img src={feedbackFileUrl(m.id, s.key)} alt={`Screenshot ${i + 1}`} loading="lazy" />
                </a>
                <span className="adm-muted">
                  {s.type.replace('image/', '').toUpperCase()} · {formatBytes(s.bytes)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Handling key={m.updatedAt} id={m.id} status={m.status} note={m.note ?? ''} onSaved={() => (detail.reload(), onChanged())} onDeleted={() => (onChanged(), onBack())} />
    </>
  );
}

function DiagramSection({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  const hash = encodeShareHash(source);
  return (
    <Section title="Diagram">
      <pre className="adm-inbox__diagram">{source}</pre>
      <div className="adm-actions adm-inbox__actions">
        <a className="ps-btn ps-btn--secondary ps-btn--sm" href={`../embed/${hash}`} target="_blank" rel="noreferrer">
          <ExternalLink size={14} aria-hidden="true" /> Open read-only
        </a>
        <a className="ps-btn ps-btn--ghost ps-btn--sm" href={`../app/${hash}`} target="_blank" rel="noreferrer">
          Open in the editor
        </a>
        <button
          type="button"
          className="ps-btn ps-btn--ghost ps-btn--sm"
          onClick={() =>
            void navigator.clipboard.writeText(source).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          <Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy source'}
        </button>
      </div>
    </Section>
  );
}

function Handling({ id, status: saved, note: savedNote, onSaved, onDeleted }: { id: string; status: FeedbackStatus; note: string; onSaved: () => void; onDeleted: () => void }) {
  const [status, setStatus] = useState(saved);
  const [note, setNote] = useState(savedNote);
  const [reason, setReason] = useState('');
  const save = useAction(onSaved);
  const remove = useAction(onDeleted);
  const dirty = status !== saved || note.trim() !== savedNote;
  return (
    <Section title="Handling">
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(() => patchFeedback(id, { status, note }));
        }}
      >
        <div className="adm-filters" role="group" aria-label="Status">
          {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
            <button key={s} type="button" className="adm-filter" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <label>
          <span>Internal note</span>
          <textarea className="adm-input adm-inbox__note" rows={3} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only admins see it; changes go in the audit log." />
        </label>
        <ErrorNote>{save.error}</ErrorNote>
        <div className="adm-actions adm-inbox__actions">
          <button type="submit" className="ps-btn ps-btn--primary ps-btn--sm" disabled={!dirty || save.busy}>
            Save
          </button>
        </div>
      </form>
      <form
        className="adm-inline adm-danger-zone adm-inbox__delete"
        onSubmit={(e) => {
          e.preventDefault();
          if (window.confirm('Delete this message and its screenshots? This cannot be undone.')) void remove.run(() => deleteFeedback(id, reason));
        }}
      >
        <input className="adm-input" aria-label="Reason for deleting" placeholder="Reason (for the audit log)" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="ps-btn ps-btn--danger ps-btn--sm" disabled={!reason.trim() || remove.busy}>
          Delete message
        </button>
      </form>
      <ErrorNote>{remove.error}</ErrorNote>
    </Section>
  );
}
