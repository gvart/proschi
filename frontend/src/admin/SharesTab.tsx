import { useCallback, useState } from 'react';
import { confirm } from '../design/dialogs';
import { deleteShare, listLiveShares, listShares, revokeLiveShare } from './api';
import { formatBytes, formatDateTime } from './format';
import { useAction, useLoad } from './hooks';
import { Empty, ErrorNote, PageHeader, Pager, SearchBox, Section, Skeleton } from './ui';

/** Every short link and live share link, newest first: the only user content other people see. */
export default function SharesTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  return (
    <>
      <PageHeader page="links" />
      <ShortLinks onOpenUser={onOpenUser} onSignedOut={onSignedOut} />
      <LiveLinks onOpenUser={onOpenUser} onSignedOut={onSignedOut} />
    </>
  );
}

/** Short links (/s/<id>): snapshots, free. */
function ShortLinks({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const shares = useLoad(() => listShares(q, offset), [q, offset], onSignedOut);
  const action = useAction(shares.reload);
  const search = useCallback((value: string) => {
    setQ(value);
    setOffset(0);
  }, []);
  return (
    <Section title="Short links">
      <div className="adm-toolbar">
        <SearchBox value={q} onChange={search} label="Search short links" placeholder="Title, link id or owner's account id" />
      </div>
      <ErrorNote>{shares.error ?? action.error}</ErrorNote>
      {!shares.data ? (
        !shares.error && <Skeleton what="short links" />
      ) : shares.data.shares.length === 0 ? (
        <Empty>{q ? 'No short links match.' : 'No short links yet.'}</Empty>
      ) : (
        <>
          <div className="adm-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Created</th>
                  <th scope="col" className="adm-num">
                    Size
                  </th>
                  <th scope="col">
                    <span className="adm-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shares.data.shares.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a href={`/s/${s.id}`} target="_blank" rel="noreferrer">
                        {s.title || s.id}
                      </a>
                      {s.hasImage && <span className="adm-muted"> · preview</span>}
                    </td>
                    <td>
                      <button type="button" className="adm-link" onClick={() => onOpenUser(s.owner.id)}>
                        {s.owner.displayName}
                      </button>
                      {s.owner.blocked && <span className="ps-badge ps-badge--fail adm-gap">blocked</span>}
                    </td>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td className="adm-num">{formatBytes(s.bytes)}</td>
                    <td>
                      <button
                        type="button"
                        className="ps-btn ps-btn--danger ps-btn--sm"
                        disabled={action.busy}
                        onClick={async () => (await confirm({ title: `Delete the short link "${s.title || s.id}"?`, body: 'Its address stops working.', confirmLabel: 'Delete', tone: 'danger' })) && void action.run(() => deleteShare(s.id))}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager offset={shares.data.offset} pageSize={shares.data.pageSize} total={shares.data.total} onChange={setOffset} />
        </>
      )}
    </Section>
  );
}

/** Live share links (/share/<token>, Pro): they show a synced diagram as it is now, until revoked. */
function LiveLinks({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<'live' | 'all'>('live');
  const [offset, setOffset] = useState(0);
  const links = useLoad(() => listLiveShares(q, state, offset), [q, state, offset], onSignedOut);
  const action = useAction(links.reload);
  const search = useCallback((value: string) => {
    setQ(value);
    setOffset(0);
  }, []);
  return (
    <Section title="Live share links">
      <div className="adm-toolbar">
        <SearchBox value={q} onChange={search} label="Search live share links" placeholder="Diagram name, token or owner's account id" />
        <select className="adm-input" aria-label="Show" value={state} onChange={(e) => (setState(e.target.value as 'live' | 'all'), setOffset(0))}>
          <option value="live">Live</option>
          <option value="all">Live and revoked</option>
        </select>
      </div>
      <ErrorNote>{links.error ?? action.error}</ErrorNote>
      {!links.data ? (
        !links.error && <Skeleton what="live share links" />
      ) : links.data.links.length === 0 ? (
        <Empty>{q ? 'No live share links match.' : state === 'live' ? 'No live share links.' : 'No live share links yet.'}</Empty>
      ) : (
        <>
          <div className="adm-scroll">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Diagram</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Created</th>
                  <th scope="col">Revoked</th>
                  <th scope="col">
                    <span className="adm-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {links.data.links.map((l) => (
                  <tr key={l.token}>
                    <td>
                      {l.revokedAt ? (
                        (l.document.name ?? <span className="adm-muted">deleted diagram</span>)
                      ) : (
                        <a href={l.url} target="_blank" rel="noreferrer">
                          {l.document.name ?? l.document.id}
                        </a>
                      )}
                    </td>
                    <td>
                      <button type="button" className="adm-link" onClick={() => onOpenUser(l.owner.id)}>
                        {l.owner.displayName}
                      </button>
                      {l.owner.blocked && <span className="ps-badge ps-badge--fail adm-gap">blocked</span>}
                    </td>
                    <td>{formatDateTime(l.createdAt)}</td>
                    <td>{l.revokedAt ? formatDateTime(l.revokedAt) : <span className="adm-muted">—</span>}</td>
                    <td>
                      {!l.revokedAt && (
                        <button
                          type="button"
                          className="ps-btn ps-btn--danger ps-btn--sm"
                          disabled={action.busy}
                          onClick={async () => (await confirm({ title: `Revoke the live link to "${l.document.name ?? l.document.id}"?`, body: 'Its address stops working at once.', confirmLabel: 'Revoke', tone: 'danger' })) && void action.run(() => revokeLiveShare(l.token))}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager offset={links.data.offset} pageSize={links.data.pageSize} total={links.data.total} onChange={setOffset} />
        </>
      )}
    </Section>
  );
}
