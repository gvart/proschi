import { useState } from 'react';
import { PRICES } from '../services/billing';
import { getBilling, type PolarDashboard } from './api';
import { formatDate, formatDateTime, formatNumber, humanize } from './format';
import { useLoad } from './hooks';
import { ErrorNote, Loading, PageHeader, Pager, Section, Stat, UserLink } from './ui';

function OrderLink({ dashboard, orderId }: { dashboard: PolarDashboard; orderId: string }) {
  return (
    <a className="adm-mono" href={`${dashboard.orders}/${encodeURIComponent(orderId)}`} target="_blank" rel="noreferrer">
      {orderId}
    </a>
  );
}

/** Pro accounts, subscribers, pack orders and refunds (the webhook log is WebhooksTab). Amounts live in Polar; D1 has counts only. */
export default function BillingTab({ onOpenUser, onSignedOut }: { onOpenUser: (id: string) => void; onSignedOut: () => void }) {
  const [offset, setOffset] = useState(0);
  const billing = useLoad(() => getBilling(offset), [offset], onSignedOut);
  const data = billing.data;
  if (!data) return billing.error ? <ErrorNote>{billing.error}</ErrorNote> : <Loading what="billing" />;
  const { counts, polarDashboard: dashboard } = data;
  const atList = counts.monthly * PRICES.proMonthly + (counts.yearly * PRICES.proYearly) / 12;
  return (
    <>
      <PageHeader
        page="billing"
        actions={
          <span className={`ps-badge ps-badge--${dashboard.server === 'sandbox' ? 'yellow' : 'neutral'}`}>
            Polar {dashboard.server}
            {data.billing ? '' : ' · billing off'}
          </span>
        }
      />
      <Section title="Subscribers">
        <div className="adm-stats">
          <Stat label="Pro accounts" value={formatNumber(counts.pro)} note={`${formatNumber(counts.comped)} comped · ${formatNumber(counts.canceling)} canceling`} />
          <Stat label="Monthly" value={formatNumber(counts.monthly)} note={`€${PRICES.proMonthly} a month list price`} />
          <Stat label="Yearly" value={formatNumber(counts.yearly)} note={`€${PRICES.proYearly} a year list price`} />
          <Stat label="Past due" value={formatNumber(counts.pastDue)} tone={counts.pastDue ? 'warn' : undefined} note="still Pro while Polar retries" />
          <Stat label="Pack orders" value={formatNumber(counts.packOrdersThisMonth)} note={`this month, ${formatNumber(counts.packOrders)} in all · €${PRICES.pack} each`} />
          <Stat label="Refunded orders" value={formatNumber(counts.refundedThisMonth)} note={`this month, ${formatNumber(counts.refunded)} in all`} tone={counts.refundedThisMonth ? 'warn' : undefined} />
        </div>
        <p className="adm-muted">
          At list price the subscriptions come to about €{atList.toFixed(0)} a month, before VAT, discounts and refunds. What was actually paid is only in{' '}
          <a href={dashboard.orders} target="_blank" rel="noreferrer">
            Polar&apos;s sales ↗
          </a>
          : Proschi stores no amounts.
        </p>
      </Section>

      <Section title={`Pro accounts (${formatNumber(data.total)})`}>
        {data.pro.length === 0 ? (
          <p className="adm-muted">Nobody is on Pro yet.</p>
        ) : (
          <>
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Pro through</th>
                    <th scope="col">Status</th>
                    <th scope="col">Renews or ends</th>
                    <th scope="col">Polar</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pro.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <UserLink user={p} onOpenUser={onOpenUser} />
                      </td>
                      <td>{p.source === 'subscription' ? humanize(p.product ?? 'subscription') : p.source === 'comp' ? `Comp until ${formatDate(p.compUntil)}` : 'Plan set by hand'}</td>
                      <td className="adm-badges">
                        {p.status && <span className={`ps-badge ps-badge--${p.status === 'past_due' ? 'yellow' : p.source === 'subscription' ? 'pass' : 'neutral'}`}>{humanize(p.status)}</span>}
                        {p.cancelAtPeriodEnd && <span className="ps-badge ps-badge--neutral">canceling</span>}
                        {p.source === 'comp' && <span className="ps-badge ps-badge--yellow">comp</span>}
                      </td>
                      <td>{formatDate(p.currentPeriodEnd)}</td>
                      <td>
                        {p.polarCustomerId ? (
                          <a href={`${dashboard.customers}/${encodeURIComponent(p.polarCustomerId)}`} target="_blank" rel="noreferrer">
                            Customer ↗
                          </a>
                        ) : (
                          <span className="adm-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager offset={data.offset} pageSize={data.pageSize} total={data.total} onChange={setOffset} />
          </>
        )}
      </Section>

      <div className="adm-columns">
        <Section title="Recent pack orders">
          {data.orders.length === 0 ? (
            <p className="adm-muted">None yet.</p>
          ) : (
            <table className="adm-table adm-table--compact">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Account</th>
                  <th scope="col">Order</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.orderId}>
                    <td>{formatDateTime(o.createdAt)}</td>
                    <td>
                      <UserLink user={o.user} onOpenUser={onOpenUser} />
                    </td>
                    <td>
                      <OrderLink dashboard={dashboard} orderId={o.orderId} />
                      {o.refunded && <span className="ps-badge ps-badge--fail adm-gap">refunded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Refunds and revokes">
          {data.refundedOrders.length === 0 && data.adjustments.length === 0 ? (
            <p className="adm-muted">None yet.</p>
          ) : (
            <table className="adm-table adm-table--compact">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">What</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="adm-num">
                    Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...data.refundedOrders.map((r) => ({ key: `r-${r.orderId}`, at: r.refundedAt, what: <>Refunded order <OrderLink dashboard={dashboard} orderId={r.orderId} /></>, user: r.user, delta: null })),
                  ...data.adjustments.map((a) => ({ key: `a-${a.kind}-${a.refId}`, at: a.createdAt, what: <>{a.kind === 'revoke' ? 'Pack taken back' : a.kind === 'admin_grant' ? 'Admin grant' : 'Admin revoke'}</>, user: a.user, delta: a.delta })),
                ]
                  .sort((a, b) => b.at - a.at)
                  .map((r) => (
                    <tr key={r.key}>
                      <td>{formatDateTime(r.at)}</td>
                      <td>{r.what}</td>
                      <td>
                        <UserLink user={r.user} onOpenUser={onOpenUser} />
                      </td>
                      <td className={`adm-num ${r.delta !== null && r.delta > 0 ? 'adm-plus' : 'adm-minus'}`}>{r.delta === null ? '' : r.delta > 0 ? `+${r.delta}` : r.delta}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <p className="adm-muted">Refunds are made in Polar; its webhook takes back what is left of a pack.</p>
        </Section>
      </div>

    </>
  );
}
