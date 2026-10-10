import { useState } from 'react';
import { addPasskey, deletePasskey, getPasskeys, revokeAdminSessions } from './api';
import { formatAgo, formatDate } from './format';
import { useAction, useLoad } from './hooks';
import { ErrorNote, Loading, Section } from './ui';

/** The admin's passkeys: add a backup, remove a lost one (never the last), end every admin session. */
export default function PasskeysTab({ onSignedOut }: { onSignedOut: () => void }) {
  const passkeys = useLoad(getPasskeys, [], onSignedOut);
  const action = useAction(passkeys.reload);
  const [name, setName] = useState('');
  const data = passkeys.data;
  return (
    <>
      <Section title="Passkeys">
        <ErrorNote>{passkeys.error ?? action.error}</ErrorNote>
        {!data ? (
          !passkeys.error && <Loading what="passkeys" />
        ) : (
          <>
            {data.passkeys.length === 1 && (
              <p className="adm-notice">Only one passkey: add a second one (another device or a security key) so losing this one doesn't lock you out.</p>
            )}
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Added</th>
                    <th scope="col">Last used</th>
                    <th scope="col">
                      <span className="adm-sr">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.passkeys.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        {p.current && <span className="ps-badge ps-badge--pass adm-gap">this session</span>}
                      </td>
                      <td>{formatDate(p.createdAt)}</td>
                      <td>{formatAgo(p.lastUsedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="ps-btn ps-btn--danger ps-btn--sm"
                          disabled={action.busy || data.passkeys.length === 1}
                          title={data.passkeys.length === 1 ? "The last passkey can't be removed" : undefined}
                          onClick={() =>
                            window.confirm(`Remove the passkey "${p.name}"? It can't sign in any more.${p.current ? ' This session ends too.' : ''}`) &&
                            void action.run(() => deletePasskey(p.id)).then((ok) => ok && p.current && onSignedOut())
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form
              className="adm-inline"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(() => addPasskey(name.trim() || 'Passkey')).then((ok) => ok && setName(''));
              }}
            >
              <input className="adm-input" aria-label="New passkey's name" placeholder="Name, e.g. Phone or YubiKey" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="ps-btn ps-btn--primary ps-btn--sm" disabled={action.busy}>
                Add a passkey
              </button>
            </form>
          </>
        )}
      </Section>
      {data && (
        <Section title="Sessions">
          <p>
            {data.sessions === 1 ? '1 admin session is' : `${data.sessions} admin sessions are`} active. A session ends after 30 idle minutes, and 12 hours after sign-in at
            the latest.
          </p>
          <button
            type="button"
            className="ps-btn ps-btn--secondary ps-btn--sm"
            disabled={action.busy}
            onClick={() => window.confirm('Sign out every admin session, this one too?') && void action.run(revokeAdminSessions).then((ok) => ok && onSignedOut())}
          >
            Sign out everywhere
          </button>
        </Section>
      )}
    </>
  );
}
