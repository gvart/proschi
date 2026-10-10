import { getHealth } from './api';
import { formatAgo, formatBytes, formatDateTime, formatNumber, humanize } from './format';
import { useLoad } from './hooks';
import { ErrorNote, LevelBadge, Loading, Section, Stat } from './ui';

/** How long after its last run a job counts as late: the hourly reminders after 2 hours, the daily jobs after 26. */
const LATE_AFTER: Record<string, number> = { reminders: 2 * 3600 };
const DAILY_LATE = 26 * 3600;

const ERROR_KINDS = ['server_error', 'rate_limited', 'sign_in_failed', 'blocked_sign_in', 'reminder_failed', 'admin_sign_in_failed'];

/** The database, cron jobs, errors, email and configuration. */
export default function HealthTab({ onSignedOut, onOpenEvents }: { onSignedOut: () => void; onOpenEvents: (kind: string) => void }) {
  const health = useLoad(getHealth, [], onSignedOut);
  const data = health.data;
  if (!data) return health.error ? <ErrorNote>{health.error}</ErrorNote> : <Loading what="the health checks" />;
  const { database, worker, config, email } = data;
  const runs = new Map(data.cron.runs.map((r) => [r.job, r]));
  return (
    <>
      <Section
        title="Worker and database"
        actions={
          <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={health.reload} disabled={health.loading}>
            Check again
          </button>
        }
      >
        <div className="adm-stats">
          <Stat label="Database" value={database.ok ? 'OK' : 'Down'} tone={database.ok ? 'pass' : 'fail'} note={database.ok ? `${database.latencyMs} ms` : database.error} />
          <Stat label="Database size" value={formatBytes(database.sizeBytes)} note={database.migration ?? undefined} />
          <Stat label="Environment" value={worker.environment} note={`simulation v${worker.simVersion}`} />
          <Stat
            label="Deployed"
            value={worker.deployedAt ? formatAgo(Math.floor(Date.parse(worker.deployedAt) / 1000)) : '—'}
            note={worker.versionId ? `version ${worker.versionTag ?? worker.versionId.slice(0, 8)}` : undefined}
          />
        </div>
        <p className="adm-muted">Checked {formatDateTime(data.checkedAt)}.</p>
      </Section>

      <Section title="Errors and warnings">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col" className="adm-num">
                24 hours
              </th>
              <th scope="col" className="adm-num">
                7 days
              </th>
            </tr>
          </thead>
          <tbody>
            {ERROR_KINDS.map((kind) => (
              <tr key={kind}>
                <td>
                  <button type="button" className="adm-link" onClick={() => onOpenEvents(kind)}>
                    {humanize(kind)}
                  </button>
                </td>
                <td className={`adm-num${data.errors[kind]?.day ? ' adm-warn' : ''}`}>{formatNumber(data.errors[kind]?.day ?? 0)}</td>
                <td className="adm-num">{formatNumber(data.errors[kind]?.week ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.lastError && (
          <p className="adm-muted">
            Last server error {formatAgo(data.lastError.at)}: <code>{data.lastError.message}</code>
          </p>
        )}
        <p className="adm-muted">Server errors and rate limits are recorded at most once a minute per route.</p>
      </Section>

      <Section title="Scheduled jobs">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Last run</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {data.cron.jobs.map((job) => {
              const run = runs.get(job);
              const late = run && data.checkedAt - run.at > (LATE_AFTER[job] ?? DAILY_LATE);
              return (
                <tr key={job}>
                  <td>{humanize(job)}</td>
                  <td>
                    {run ? formatAgo(run.at, data.checkedAt) : 'not yet'}
                    {late && <span className="ps-badge ps-badge--yellow adm-gap">late</span>}
                  </td>
                  <td>
                    {run ? (
                      <>
                        <LevelBadge level={run.level === 'error' ? 'error' : 'ok'} />{' '}
                        <span className="adm-muted">
                          {Object.entries(run.detail ?? {})
                            .map(([k, v]) => `${k}: ${String(v)}`)
                            .join(', ')}
                        </span>
                      </>
                    ) : (
                      <span className="adm-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="adm-muted">Reminders run hourly; the other jobs once a day at 03:17 UTC.</p>
      </Section>

      <Section title="Email reminders">
        <div className="adm-stats">
          <Stat label="Email service" value={email.bound ? 'Bound' : 'Not bound'} tone={email.bound ? 'pass' : 'warn'} />
          <Stat label="Addresses" value={formatNumber(email.total)} note={`${formatNumber(email.confirmed)} confirmed, ${formatNumber(email.paused)} paused`} />
          <Stat label="Sent in 7 days" value={formatNumber(email.sentLast7Days)} />
        </div>
      </Section>

      <Section title="Configuration">
        <ul className="adm-checks">
          <Check ok={config.sessionSecret} label="SESSION_SECRET set (sign-in works)" />
          <Check ok={config.providers.length > 0} label={`Sign-in providers: ${config.providers.join(', ') || 'none'}`} />
          <Check ok={config.metricsToken} label="METRICS_TOKEN set (the metrics CLI works)" optional />
          <Check ok={config.appRedirects} label="APP_REDIRECT_URIS set (native app sign-in)" optional />
          <Check ok={!config.setupToken} label={config.setupToken ? 'ADMIN_SETUP_TOKEN is still set: remove it (npx wrangler secret delete ADMIN_SETUP_TOKEN)' : 'ADMIN_SETUP_TOKEN removed'} />
        </ul>
      </Section>

      <Section title="Rows per table">
        <table className="adm-table adm-table--compact">
          <tbody>
            {Object.entries(database.tables).map(([table, n]) => (
              <tr key={table}>
                <td>
                  <code>{table}</code>
                </td>
                <td className="adm-num">{formatNumber(n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Check({ ok, label, optional }: { ok: boolean; label: string; optional?: boolean }) {
  const state = ok ? 'ok' : optional ? 'off' : 'bad';
  return (
    <li className={`adm-check adm-check--${state}`}>
      <span aria-hidden="true">{ok ? '✓' : optional ? '–' : '!'}</span> {label}
      {!ok && optional && <span className="adm-muted"> (optional)</span>}
    </li>
  );
}
