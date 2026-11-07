import { useState } from 'react';
import { adjustCredits, compUser, endComp, listUserCredits, type UserDetail } from './api';
import { formatDate, formatDateTime, humanize } from './format';
import { useAction, useLoad } from './hooks';
import { Dialog, ErrorNote, Pager, Section, Skeleton, Stat } from './ui';

/** "pro_yearly" → "Pro yearly". */
const productName = (product: string | null) => (product ? humanize(product) : '—');

/** The account's plan, subscription and credits, with the admin's comp and credit actions (each needs a reason, for the audit log). */
export default function UserBilling({ id, data, onChanged, onSignedOut }: { id: string; data: UserDetail; onChanged: () => void; onSignedOut: () => void }) {
  const [offset, setOffset] = useState(0);
  const [nonce, setNonce] = useState(0);
  const ledger = useLoad(() => listUserCredits(id, offset), [id, offset, nonce], onSignedOut);
  const [dialog, setDialog] = useState<'credits' | 'comp' | 'end' | undefined>();
  const [notice, setNotice] = useState<string>();
  const done = (message: string) => {
    setDialog(undefined);
    setNotice(message);
    setNonce((n) => n + 1);
    onChanged();
  };
  const { user, billing, credits, polarDashboard } = data;
  const comped = user.compUntil !== null && user.compUntil * 1000 > Date.now();

  return (
    <>
      <Section
        title="Plan and billing"
        actions={
          billing?.polarCustomerId ? (
            <a className="ps-btn ps-btn--secondary ps-btn--sm" href={`${polarDashboard.customers}/${encodeURIComponent(billing.polarCustomerId)}`} target="_blank" rel="noreferrer">
              Open in Polar{polarDashboard.server === 'sandbox' ? ' (sandbox)' : ''} ↗
            </a>
          ) : undefined
        }
      >
        {notice && (
          <p className="adm-notice" role="status">
            {notice}
          </p>
        )}
        <div className="adm-stats">
          <Stat
            label="Effective plan"
            value={humanize(user.effectivePlan)}
            note={comped ? `comped until ${formatDate(user.compUntil)}` : user.plan !== user.effectivePlan ? `stored plan ${user.plan}` : 'from the subscription'}
            tone={user.effectivePlan === 'pro' ? 'pass' : undefined}
          />
          <Stat
            label="Subscription"
            value={billing?.status ? humanize(billing.status) : 'None'}
            note={billing?.status ? productName(billing.product) : undefined}
            tone={billing?.pastDue ? 'warn' : undefined}
          />
          <Stat
            label={billing?.cancelAtPeriodEnd ? 'Ends' : 'Renews'}
            value={billing?.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : '—'}
            note={billing?.cancelAtPeriodEnd ? 'canceled at period end' : undefined}
          />
          <Stat label="Interview credits" value={credits.total} note={`${credits.monthly} monthly · ${credits.trial} trial · ${credits.pack} pack`} />
        </div>
        {billing && (
          <dl className="adm-dl">
            <dt>Polar customer</dt>
            <dd className="adm-mono">{billing.polarCustomerId ?? '—'}</dd>
            <dt>Polar subscription</dt>
            <dd className="adm-mono">{billing.polarSubscriptionId ?? '—'}</dd>
            <dt>Last webhook change</dt>
            <dd>{formatDateTime(billing.updatedAt)}</dd>
          </dl>
        )}
        <div className="adm-actions">
          <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={() => setDialog('credits')}>
            Grant or revoke credits
          </button>
          <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={() => setDialog('comp')}>
            {comped ? 'Change comp' : 'Comp Pro'}
          </button>
          {comped && (
            <button type="button" className="ps-btn ps-btn--danger ps-btn--sm" onClick={() => setDialog('end')}>
              End comp
            </button>
          )}
        </div>
        <p className="adm-muted">Refunds and cancellations are done in Polar. A comp never touches Polar, and a Polar cancel doesn&apos;t end it.</p>
      </Section>

      <Section title={`Credit ledger (${ledger.data?.total ?? '…'})`}>
        <ErrorNote>{ledger.error}</ErrorNote>
        {!ledger.data ? (
          !ledger.error && <Skeleton what="the ledger" />
        ) : ledger.data.entries.length === 0 ? (
          <p className="adm-muted">No credits used or added yet.</p>
        ) : (
          <>
            <div className="adm-scroll">
              <table className="adm-table adm-table--compact">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Bucket</th>
                    <th scope="col" className="adm-num">
                      Credits
                    </th>
                    <th scope="col">For</th>
                    <th scope="col">Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDateTime(e.createdAt)}</td>
                      <td>{humanize(e.kind)}</td>
                      <td>
                        {e.bucket}
                        {e.period && <span className="adm-muted"> {e.period}</span>}
                      </td>
                      <td className={`adm-num ${e.delta > 0 ? 'adm-plus' : 'adm-minus'}`}>{e.delta > 0 ? `+${e.delta}` : e.delta}</td>
                      <td>{humanize(e.item)}</td>
                      <td className="adm-mono adm-cut" title={e.refId}>
                        {e.kind === 'grant' || e.kind === 'revoke' ? (
                          <a href={`${polarDashboard.orders}/${encodeURIComponent(e.refId)}`} target="_blank" rel="noreferrer">
                            {e.refId}
                          </a>
                        ) : (
                          e.refId
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={ledger.data.offset} pageSize={ledger.data.pageSize} total={ledger.data.total} onChange={setOffset} />
          </>
        )}
      </Section>

      {dialog === 'credits' && <CreditsDialog id={id} name={user.displayName} pack={credits.pack} onClose={() => setDialog(undefined)} onDone={done} />}
      {dialog === 'comp' && <CompDialog id={id} name={user.displayName} until={comped ? user.compUntil : null} onClose={() => setDialog(undefined)} onDone={done} />}
      {dialog === 'end' && <EndCompDialog id={id} name={user.displayName} onClose={() => setDialog(undefined)} onDone={done} />}
    </>
  );
}

function CreditsDialog({ id, name, pack, onClose, onDone }: { id: string; name: string; pack: number; onClose: () => void; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<'grant' | 'revoke'>('grant');
  const [credits, setCredits] = useState('1');
  const [reason, setReason] = useState('');
  // One ref per opened dialog: a double submit or a retry after a lost answer grants once.
  const [ref] = useState(() => crypto.randomUUID());
  const action = useAction();
  const n = Number(credits);
  return (
    <Dialog
      title={`Credits for ${name}`}
      open
      onClose={onClose}
      submitLabel={kind === 'grant' ? `Grant ${n || ''} credit${n === 1 ? '' : 's'}` : `Revoke ${n || ''} credit${n === 1 ? '' : 's'}`}
      danger={kind === 'revoke'}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(async () => {
          const result = await adjustCredits(id, { kind, credits: n, ref, reason });
          onDone(result.duplicate ? 'Already done: nothing changed.' : `${kind === 'grant' ? 'Granted' : 'Revoked'} ${Math.abs(result.delta)} pack credit${Math.abs(result.delta) === 1 ? '' : 's'}.`);
        })
      }
    >
      <fieldset className="adm-radios">
        <legend className="adm-sr">Grant or revoke</legend>
        <label>
          <input type="radio" name="kind" checked={kind === 'grant'} onChange={() => setKind('grant')} /> Grant
        </label>
        <label>
          <input type="radio" name="kind" checked={kind === 'revoke'} onChange={() => setKind('revoke')} /> Revoke
        </label>
      </fieldset>
      <label>
        Pack credits
        <input className="adm-input" type="number" min={1} max={100} step={1} required value={credits} onChange={(e) => setCredits(e.target.value)} />
      </label>
      <p className="adm-muted">
        {kind === 'grant' ? 'Pack credits never expire and are spent after the monthly and trial ones.' : `Takes at most what is left: ${pack} pack credit${pack === 1 ? '' : 's'} now. The balance never goes below 0.`}
      </p>
      <label>
        Reason (in the audit log)
        <textarea className="adm-input" required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Support ticket 1234: the interview crashed" />
      </label>
    </Dialog>
  );
}

/** A date input's value (YYYY-MM-DD) as the end of that UTC day, in Unix seconds. */
const endOfDay = (date: string) => Math.floor(Date.parse(`${date}T23:59:59Z`) / 1000);

function CompDialog({ id, name, until, onClose, onDone }: { id: string; name: string; until: number | null; onClose: () => void; onDone: (message: string) => void }) {
  const [date, setDate] = useState(() => new Date((until ?? Math.floor(Date.now() / 1000) + 30 * 86_400) * 1000).toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const action = useAction();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Dialog
      title={`Comp Pro for ${name}`}
      open
      onClose={onClose}
      submitLabel="Comp Pro"
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(async () => {
          await compUser(id, endOfDay(date), reason);
          onDone(`Pro until the end of ${date} (UTC).`);
        })
      }
    >
      <label>
        Pro until (the end of this UTC day)
        <input className="adm-input" type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <p className="adm-muted">Nothing is charged or changed in Polar. A subscription keeps running as it is.</p>
      <label>
        Reason (in the audit log)
        <textarea className="adm-input" required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Conference speaker" />
      </label>
    </Dialog>
  );
}

function EndCompDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState('');
  const action = useAction();
  return (
    <Dialog
      title={`End ${name}'s comp`}
      open
      onClose={onClose}
      submitLabel="End comp now"
      danger
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(async () => {
          await endComp(id, reason);
          onDone('Comp ended.');
        })
      }
    >
      <p>Pro ends now unless a subscription keeps it.</p>
      <label>
        Reason (in the audit log)
        <textarea className="adm-input" required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
    </Dialog>
  );
}
