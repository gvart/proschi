import { useCallback, useState } from 'react';
import { deleteShare, listShares } from './api';
import { formatBytes, formatDateTime } from './format';
import { useAction, useLoad } from './hooks';
import { ErrorNote, Loading, Pager, SearchBox, Section } from './ui';

/** Every short link, newest first: the only user content other people see. */
export default function SharesTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
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
        !shares.error && <Loading what="short links" />
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
                        onClick={() => window.confirm(`Delete the short link "${s.title || s.id}"? Its address stops working.`) && void action.run(() => deleteShare(s.id))}
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
