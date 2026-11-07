import { ArrowLeft, Plus, RefreshCw, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnnouncementCard } from '../announcements/Announcement';
import {
  cancelCampaign,
  countAudience,
  createCampaign,
  getCampaign,
  listCampaigns,
  previewCampaign,
  resumeCampaign,
  sendCampaign,
  testCampaign,
  updateCampaign,
  type Audience,
  type AudienceCount,
  type Campaign,
  type CampaignDraft,
  type CampaignStatus,
} from './api';
import { audienceReady, describeAudience, summarize } from './campaignText';
import { formatDateTime, formatNumber } from './format';
import { errorMessage, useAction, useLoad } from './hooks';
import { LAUNCH_TEMPLATE } from './launchTemplate';
import './campaigns.css';
import { Dialog, Empty, ErrorNote, PageHeader, Section, Skeleton, Stat } from './ui';

/**
 * Campaigns (backend/src/campaigns.ts): credits for many accounts at once,
 * product news by email, and announcements in the app. #/campaigns lists
 * them with their stats, #/campaigns/new composes one (with the email's
 * real layout as the preview), #/campaigns/<id> opens a draft in the
 * composer or shows a sent one's progress. Sending, cancelling and resuming
 * each ask for a reason, for the audit log.
 */

const STATUS_TONE: Record<CampaignStatus, string> = { draft: 'neutral', sending: 'yellow', done: 'pass', cancelled: 'fail' };
const STATUS_LABEL: Record<CampaignStatus, string> = { draft: 'Draft', sending: 'Sending', done: 'Done', cancelled: 'Cancelled' };

export default function CampaignsTab({ param, onOpen, onSignedOut }: { param?: string; onOpen: (id?: string) => void; onSignedOut: () => void }) {
  if (param === 'new') return <Composer onOpen={onOpen} onSent={(id) => onOpen(id)} />;
  if (param) return <CampaignPage id={param} onOpen={onOpen} onSignedOut={onSignedOut} />;
  return <CampaignList onOpen={onOpen} onSignedOut={onSignedOut} />;
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={`ps-badge ps-badge--${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/** What a campaign does, as small badges. */
function Does({ c }: { c: Pick<Campaign, 'credits' | 'email' | 'inapp'> }) {
  return (
    <span className="adm-badges">
      {c.credits > 0 && <span className="ps-badge ps-badge--neutral">{formatNumber(c.credits)} credits</span>}
      {c.email && <span className="ps-badge ps-badge--neutral">Email</span>}
      {c.inapp && <span className="ps-badge ps-badge--neutral">In-app</span>}
    </span>
  );
}

function CampaignList({ onOpen, onSignedOut }: { onOpen: (id?: string) => void; onSignedOut: () => void }) {
  const list = useLoad(listCampaigns, [], onSignedOut);
  const data = list.data;
  return (
    <>
      <PageHeader
        page="campaigns"
        actions={
          <>
            <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={list.reload} disabled={list.loading}>
              <RefreshCw size={14} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className="ps-btn ps-btn--primary ps-btn--sm" onClick={() => onOpen('new')}>
              <Plus size={14} aria-hidden="true" /> New campaign
            </button>
          </>
        }
      />
      <Section title="History">
        <ErrorNote>{list.error}</ErrorNote>
        {!data ? (
          !list.error && <Skeleton what="campaigns" />
        ) : data.campaigns.length === 0 ? (
          <Empty>No campaigns yet. A new one starts as a draft: nothing goes out until you review it and give a reason.</Empty>
        ) : (
          <div className={list.loading ? 'adm-refetching' : undefined}>
            <div className="adm-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Campaign</th>
                    <th scope="col">Status</th>
                    <th scope="col">Does</th>
                    <th scope="col" className="adm-num">Recipients</th>
                    <th scope="col" className="adm-num">Granted</th>
                    <th scope="col" className="adm-num">Sent</th>
                    <th scope="col" className="adm-num">Failed</th>
                    <th scope="col" className="adm-num">Skipped</th>
                    <th scope="col" className="adm-num">Unsubscribed</th>
                    <th scope="col">Sent at</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <button type="button" className="adm-link" onClick={() => onOpen(c.id)}>
                          {c.subject}
                        </button>
                        <div className="adm-muted adm-camp-sub">{describeAudience(c.audience)}</div>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td>
                        <Does c={c} />
                      </td>
                      <td className="adm-num">{c.status === 'draft' ? '—' : formatNumber(c.stats.recipients)}</td>
                      <td className="adm-num">{c.credits > 0 && c.status !== 'draft' ? formatNumber(c.stats.granted) : '—'}</td>
                      <td className="adm-num">{c.email && c.status !== 'draft' ? formatNumber(c.stats.sent) : '—'}</td>
                      <td className={`adm-num${c.stats.failed ? ' adm-warn' : ''}`}>{c.email && c.status !== 'draft' ? formatNumber(c.stats.failed) : '—'}</td>
                      <td className="adm-num">{c.email && c.status !== 'draft' ? formatNumber(c.stats.skippedOptout + c.stats.skippedUnconfirmed) : '—'}</td>
                      <td className="adm-num">{c.status === 'draft' ? '—' : formatNumber(c.stats.unsubscribes)}</td>
                      <td className="adm-nowrap">{c.startedAt ? formatDateTime(c.startedAt) : <span className="adm-muted">not sent</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data && (
          <p className="adm-footnote">
            Emails today: {formatNumber(data.sentToday)} of the daily cap of {formatNumber(data.dailyCap)} (CAMPAIGN_DAILY_CAP); the rest go out the next day.{' '}
            {data.testAddress ? `Tests go to ${data.testAddress}.` : 'Set ADMIN_EMAIL to send tests to yourself.'}
            {!data.emailConfigured && ' No EMAIL binding: emails can’t be sent.'}
          </p>
        )}
      </Section>
    </>
  );
}

/** A draft or a sent campaign, by id. */
function CampaignPage({ id, onOpen, onSignedOut }: { id: string; onOpen: (id?: string) => void; onSignedOut: () => void }) {
  const [nonce, setNonce] = useState(0);
  const loaded = useLoad(() => getCampaign(id), [id, nonce], onSignedOut);
  const c = loaded.data;
  // While it is sending, the numbers move: read them again every few seconds.
  useEffect(() => {
    if (c?.status !== 'sending') return;
    const timer = setInterval(() => setNonce((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, [c?.status]);
  if (!c) {
    return (
      <>
        <PageHeader page="campaigns" title="Campaign" />
        <ErrorNote>{loaded.error}</ErrorNote>
        {!loaded.error && <Skeleton what="the campaign" />}
      </>
    );
  }
  if (c.status === 'draft') return <Composer initial={c} onOpen={onOpen} onSent={() => setNonce((n) => n + 1)} />;
  return <CampaignDetail c={c} onChanged={() => setNonce((n) => n + 1)} onOpen={onOpen} />;
}

function BackLink({ onOpen }: { onOpen: (id?: string) => void }) {
  return (
    <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => onOpen()}>
      <ArrowLeft size={14} aria-hidden="true" /> All campaigns
    </button>
  );
}

function CampaignDetail({ c, onChanged, onOpen }: { c: Campaign; onChanged: () => void; onOpen: (id?: string) => void }) {
  const [dialog, setDialog] = useState<'cancel' | 'resume'>();
  const s = c.stats;
  const processed = s.recipients - s.pending;
  const share = s.recipients ? processed / s.recipients : 1;
  return (
    <>
      <PageHeader
        page="campaigns"
        title={c.subject}
        description={
          <>
            <StatusBadge status={c.status} /> <span className="adm-gap">{describeAudience(c.audience)}</span>
            {c.startedAt && <span className="adm-gap">· sent {formatDateTime(c.startedAt)}</span>}
          </>
        }
        actions={
          <>
            <BackLink onOpen={onOpen} />
            {c.status === 'sending' && (
              <button type="button" className="ps-btn ps-btn--danger ps-btn--sm" onClick={() => setDialog('cancel')}>
                Cancel
              </button>
            )}
            {(c.status === 'cancelled' || (c.status === 'sending' && s.pending > 0)) && (
              <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={() => setDialog('resume')}>
                Resume
              </button>
            )}
          </>
        }
      />
      <Section title="Progress">
        <div className="adm-camp-progress" role="progressbar" aria-label="Recipients processed" aria-valuemin={0} aria-valuemax={s.recipients} aria-valuenow={processed}>
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </div>
        <p className="adm-muted">
          {formatNumber(processed)} of {formatNumber(s.recipients)} recipients processed
          {c.status === 'sending' ? (s.pending ? ' · sending in the background, refreshing every 3 seconds' : ' · finishing') : c.status === 'cancelled' && s.pending ? ` · ${formatNumber(s.pending)} left when it was cancelled` : ''}
        </p>
        <div className="adm-stats">
          <Stat label="Recipients" value={formatNumber(s.recipients)} note="the audience when it was sent" />
          {c.credits > 0 && <Stat label="Credits granted" value={formatNumber(s.granted)} note={`${formatNumber(c.credits)} each, top-up`} tone={s.granted === s.recipients ? 'pass' : undefined} />}
          {c.email && <Stat label="Emails sent" value={formatNumber(s.sent)} tone={s.sent ? 'pass' : undefined} />}
          {c.email && <Stat label="Failed" value={formatNumber(s.failed)} tone={s.failed ? 'fail' : undefined} note={s.failed ? 'never retried, so nobody gets it twice' : undefined} />}
          {c.email && <Stat label="Skipped" value={formatNumber(s.skippedOptout + s.skippedUnconfirmed)} note={`${formatNumber(s.skippedOptout)} product news off · ${formatNumber(s.skippedUnconfirmed)} no confirmed address`} />}
          {c.email && <Stat label="Unsubscribed since" value={formatNumber(s.unsubscribes)} tone={s.unsubscribes ? 'warn' : undefined} />}
          {c.inapp && <Stat label="Announcement" value={formatNumber(s.shown)} note={`shown · ${formatNumber(s.dismissed)} dismissed · ${formatNumber(s.clicked)} clicked`} />}
        </div>
      </Section>
      <Section title="What was sent">
        <dl className="adm-dl">
          <dt>Does</dt>
          <dd>
            <Does c={c} />
          </dd>
          <dt>Reason</dt>
          <dd>{c.reason ?? '—'}</dd>
          {c.link && (
            <>
              <dt>Button</dt>
              <dd>
                {c.link.label} → <span className="adm-mono">{c.link.url}</span>
              </dd>
            </>
          )}
        </dl>
        {c.body && <pre className="adm-pre">{c.body}</pre>}
      </Section>
      {dialog && (
        <ReasonDialog
          title={dialog === 'cancel' ? 'Cancel this campaign' : 'Resume this campaign'}
          text={
            dialog === 'cancel'
              ? 'Nobody left gets the credits, the email or the announcement. Who already got them keeps them. You can resume later.'
              : 'Goes on with the recipients not processed yet. Nobody is granted or emailed twice.'
          }
          submitLabel={dialog === 'cancel' ? 'Cancel campaign' : 'Resume'}
          danger={dialog === 'cancel'}
          onClose={() => setDialog(undefined)}
          onSubmit={async (reason) => {
            await (dialog === 'cancel' ? cancelCampaign(c.id, reason) : resumeCampaign(c.id, reason));
            setDialog(undefined);
            onChanged();
          }}
        />
      )}
    </>
  );
}

function ReasonDialog({
  title,
  text,
  submitLabel,
  danger,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  text?: string;
  submitLabel: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const action = useAction();
  return (
    <Dialog title={title} open onClose={onClose} submitLabel={submitLabel} danger={danger} busy={action.busy} error={action.error} onSubmit={() => void action.run(() => onSubmit(reason))}>
      {children}
      {text && <p>{text}</p>}
      <label>
        Reason (in the audit log)
        <textarea className="adm-input" required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Launch gift for the early accounts" />
      </label>
    </Dialog>
  );
}

const EMPTY: CampaignDraft = { audience: { type: 'all' }, credits: 0, email: true, inapp: true, subject: '', body: '', linkUrl: '', linkLabel: '' };

const draftOf = (c: Campaign): CampaignDraft => ({
  audience: c.audience,
  credits: c.credits,
  email: c.email,
  inapp: c.inapp,
  subject: c.subject,
  body: c.body,
  linkUrl: c.link?.url ?? '',
  linkLabel: c.link?.label ?? '',
});

const AUDIENCES: { type: Audience['type']; label: string }[] = [
  { type: 'all', label: 'Everyone' },
  { type: 'plan', label: 'Plan' },
  { type: 'active', label: 'Active' },
  { type: 'signup', label: 'Signed up' },
  { type: 'user', label: 'One account' },
];

function defaultAudience(type: Audience['type']): Audience {
  switch (type) {
    case 'plan':
      return { type, plan: 'free' };
    case 'active':
      return { type, days: 30 };
    case 'signup':
      return { type, before: new Date().toISOString().slice(0, 10) };
    case 'user':
      return { type, id: '' };
    default:
      return { type: 'all' };
  }
}

/** Waits `ms` after the last change of `value` before handing it on. */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return out;
}

function Composer({ initial, onOpen, onSent }: { initial?: Campaign; onOpen: (id?: string) => void; onSent: (id: string) => void }) {
  const [draft, setDraft] = useState<CampaignDraft>(() => (initial ? draftOf(initial) : EMPTY));
  const [id, setId] = useState(initial?.id);
  const [grant, setGrant] = useState(() => (initial ? initial.credits > 0 : false));
  const [credits, setCredits] = useState(() => String(initial?.credits || 150));
  const [notice, setNotice] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<'email' | 'inapp'>('email');
  const body = useRef<HTMLTextAreaElement>(null);
  const save = useAction();
  const test = useAction();

  const full: CampaignDraft = { ...draft, credits: grant ? Number(credits) || 0 : 0 };
  const set = (patch: Partial<CampaignDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setNotice(undefined);
  };

  // The live count, a moment after the audience stops changing.
  const audience = useDebounced(draft.audience, 300);
  const [count, setCount] = useState<{ value?: AudienceCount; error?: string }>({});
  useEffect(() => {
    if (!audienceReady(audience)) return setCount({});
    let live = true;
    countAudience(audience).then(
      (value) => live && setCount({ value }),
      (e: unknown) => live && setCount({ error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [audience]);

  // The email in its real layout (the server renders it), a moment after typing stops.
  const forPreview = useDebounced(full, 400);
  const previewKey = JSON.stringify(forPreview);
  const [preview, setPreview] = useState<{ html?: string; error?: string }>({});
  useEffect(() => {
    let live = true;
    previewCampaign(JSON.parse(previewKey) as CampaignDraft).then(
      (p) => live && setPreview({ html: p.html }),
      (e: unknown) => live && setPreview({ error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [previewKey]);

  const insert = (token: string) => {
    const el = body.current;
    const at = el ? el.selectionStart : draft.body.length;
    const end = el ? el.selectionEnd : at;
    set({ body: `${draft.body.slice(0, at)}${token}${draft.body.slice(end)}` });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  /** Saves the draft (a new one first); answers its id. */
  const persist = async (): Promise<string> => {
    const saved = id ? await updateCampaign(id, full) : await createCampaign(full);
    setId(saved.id);
    return saved.id;
  };

  const canSend = audienceReady(draft.audience) && count.value !== undefined;
  const summary = count.value ? summarize(full, count.value) : undefined;

  return (
    <>
      <PageHeader
        page="campaigns"
        title={id ? 'Edit draft' : 'New campaign'}
        description="Nothing goes out until you review it and give a reason. A test goes only to you and grants nothing."
        actions={
          <>
            <BackLink onOpen={onOpen} />
            <button
              type="button"
              className="ps-btn ps-btn--secondary ps-btn--sm"
              onClick={() => {
                setDraft(LAUNCH_TEMPLATE);
                setGrant(LAUNCH_TEMPLATE.credits > 0);
                setCredits(String(LAUNCH_TEMPLATE.credits));
                setNotice('The launch template is in. Check the amount and the words, then send a test.');
              }}
            >
              <Sparkles size={14} aria-hidden="true" /> Use launch template
            </button>
          </>
        }
      />
      {notice && (
        <p className="adm-notice" role="status">
          {notice}
        </p>
      )}
      <div className="adm-camp">
        <div className="adm-camp__form">
          <Section title="What it does">
            <div className="adm-camp-does">
              <label className="adm-camp-opt">
                <input type="checkbox" checked={grant} onChange={(e) => setGrant(e.target.checked)} />
                <span>
                  <strong>Grant credits</strong>
                  <span className="adm-muted">Top-up credits: they never expire. Once per account.</span>
                </span>
                {grant && (
                  <input
                    className="adm-input adm-camp-amount"
                    type="number"
                    aria-label="Credits per account"
                    min={0.001}
                    max={10000}
                    step={0.001}
                    value={credits}
                    onChange={(e) => setCredits(e.target.value)}
                  />
                )}
              </label>
              <label className="adm-camp-opt">
                <input type="checkbox" checked={draft.email} onChange={(e) => set({ email: e.target.checked })} />
                <span>
                  <strong>Email</strong>
                  <span className="adm-muted">To confirmed addresses only, never to anyone who turned product news off.</span>
                </span>
              </label>
              <label className="adm-camp-opt">
                <input type="checkbox" checked={draft.inapp} onChange={(e) => set({ inapp: e.target.checked })} />
                <span>
                  <strong>In the app</strong>
                  <span className="adm-muted">An announcement on the next visit, until dismissed, for 30 days.</span>
                </span>
              </label>
            </div>
          </Section>

          <Section title="Audience">
            <div className="adm-segmented adm-camp-seg" role="group" aria-label="Audience">
              {AUDIENCES.map((a) => (
                <button key={a.type} type="button" aria-pressed={draft.audience.type === a.type} onClick={() => set({ audience: defaultAudience(a.type) })}>
                  {a.label}
                </button>
              ))}
            </div>
            <AudienceFields audience={draft.audience} onChange={(audience) => set({ audience })} />
            <div className="adm-camp-count" aria-live="polite">
              {count.error ? (
                <ErrorNote>{count.error}</ErrorNote>
              ) : count.value ? (
                <>
                  <strong>{formatNumber(count.value.accounts)}</strong> account{count.value.accounts === 1 ? '' : 's'}
                  {draft.email && (
                    <span className="adm-muted">
                      {' '}
                      · email reaches <strong className="adm-camp-ink">{formatNumber(count.value.emails)}</strong> · {formatNumber(count.value.optedOut)} product news off ·{' '}
                      {formatNumber(count.value.unconfirmed)} no confirmed address
                    </span>
                  )}
                </>
              ) : (
                <span className="adm-muted">{audienceReady(draft.audience) ? 'Counting…' : 'Finish the audience to count it.'}</span>
              )}
            </div>
            <p className="adm-footnote">Blocked accounts are never included. The audience is fixed when you send: later sign-ups don&apos;t get it.</p>
          </Section>

          <Section title="Message">
            <form className="adm-form" onSubmit={(e) => e.preventDefault()}>
              <label>
                Subject (also the announcement&apos;s title)
                <input className="adm-input" maxLength={150} value={draft.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="e.g. {{credits}} credits are on your Proschi account" />
              </label>
              <label>
                Body (Markdown)
                <textarea ref={body} className="adm-input adm-camp-body" rows={14} maxLength={20000} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
              </label>
              <div className="adm-inline">
                <span className="adm-muted">Insert</span>
                {['{{name}}', '{{credits}}'].map((t) => (
                  <button key={t} type="button" className="ps-btn ps-btn--ghost ps-btn--sm adm-mono" onClick={() => insert(t)}>
                    {t}
                  </button>
                ))}
                <span className="adm-footnote">**bold**, *italic*, - lists, ## headings, [links](https://…). HTML shows as text.</span>
              </div>
              <div className="adm-camp-link">
                <label>
                  Button label
                  <input className="adm-input" maxLength={40} value={draft.linkLabel} onChange={(e) => set({ linkLabel: e.target.value })} placeholder="Open Proschi" />
                </label>
                <label>
                  Button link (https://)
                  <input className="adm-input" type="url" value={draft.linkUrl} onChange={(e) => set({ linkUrl: e.target.value })} placeholder="https://proschi.app/practice/" />
                </label>
              </div>
            </form>
          </Section>

          <ErrorNote>{save.error ?? test.error}</ErrorNote>
          <div className="adm-actions adm-camp-actions">
            <button
              type="button"
              className="ps-btn ps-btn--secondary ps-btn--sm"
              disabled={save.busy}
              onClick={() => void save.run(async () => {
                await persist();
                setNotice('Draft saved.');
              })}
            >
              Save draft
            </button>
            <button
              type="button"
              className="ps-btn ps-btn--secondary ps-btn--sm"
              disabled={test.busy || !full.email}
              title={full.email ? undefined : 'Only an email campaign has an email to test'}
              onClick={() => void test.run(async () => {
                const r = await testCampaign(full);
                setNotice(`Test sent to ${r.to}. Nothing was granted.`);
              })}
            >
              <Send size={14} aria-hidden="true" /> Send a test to me
            </button>
            <button
              type="button"
              className="ps-btn ps-btn--primary ps-btn--sm"
              disabled={save.busy || !canSend}
              onClick={() => void save.run(async () => {
                await persist();
                setConfirm(true);
              })}
            >
              Review and send…
            </button>
          </div>
        </div>

        <div className="adm-camp__preview">
          <Section
            title="Preview"
            actions={
              <div className="adm-segmented" role="group" aria-label="Preview">
                <button type="button" aria-pressed={view === 'email'} onClick={() => setView('email')}>
                  Email
                </button>
                <button type="button" aria-pressed={view === 'inapp'} onClick={() => setView('inapp')}>
                  In the app
                </button>
              </div>
            }
          >
            {view === 'email' ? (
              <>
                <p className="adm-muted">
                  As Ada sees it{full.email ? '' : ' (email is off for this campaign)'}. The button and links work; the unsubscribe link here does nothing.
                </p>
                <ErrorNote>{preview.error}</ErrorNote>
                {preview.html ? (
                  <iframe className="adm-camp-frame" title="Email preview" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={preview.html} />
                ) : (
                  !preview.error && <Skeleton what="the preview" rows={8} />
                )}
              </>
            ) : (
              <>
                <p className="adm-muted">On the practice pages, under the header{full.inapp ? '' : ' (in-app is off for this campaign)'}.</p>
                <div className="adm-camp-inapp">
                  <AnnouncementCard
                    data={{
                      id: 'preview',
                      title: draft.subject || '(no subject)',
                      body: draft.body,
                      link: draft.linkUrl && draft.linkLabel ? { url: draft.linkUrl, label: draft.linkLabel } : null,
                      credits: full.credits > 0 ? full.credits : null,
                      values: { name: 'Ada', credits: full.credits.toLocaleString('en-US') },
                    }}
                  />
                </div>
              </>
            )}
          </Section>
        </div>
      </div>

      {confirm && id && summary && (
        <ReasonDialog
          title="Send this campaign"
          submitLabel="Send now"
          onClose={() => setConfirm(false)}
          onSubmit={async (reason) => {
            await sendCampaign(id, reason);
            setConfirm(false);
            onSent(id);
          }}
        >
          <div className="adm-camp-confirm">
            <p className="adm-camp-confirm__what">{summary.sentence}</p>
            {summary.skipped && <p className="adm-muted">{summary.skipped}</p>}
            <dl className="adm-dl">
              <dt>Audience</dt>
              <dd>{describeAudience(full.audience)}</dd>
              {(full.email || full.inapp) && (
                <>
                  <dt>Subject</dt>
                  <dd>{full.subject}</dd>
                </>
              )}
            </dl>
            <p className="adm-footnote">It goes out in the background, 50 at a time, at most the daily cap a day. Nobody gets it twice, also if you cancel and resume.</p>
          </div>
        </ReasonDialog>
      )}
    </>
  );
}

function AudienceFields({ audience, onChange }: { audience: Audience; onChange: (a: Audience) => void }) {
  switch (audience.type) {
    case 'plan':
      return (
        <div className="adm-segmented" role="group" aria-label="Plan">
          {(['free', 'pro', 'max'] as const).map((plan) => (
            <button key={plan} type="button" aria-pressed={audience.plan === plan} onClick={() => onChange({ type: 'plan', plan })}>
              {plan[0].toUpperCase() + plan.slice(1)}
            </button>
          ))}
        </div>
      );
    case 'active':
      return (
        <label className="adm-camp-field">
          Active in the last
          <input className="adm-input adm-camp-amount" type="number" min={1} max={365} value={audience.days} onChange={(e) => onChange({ type: 'active', days: Math.floor(Number(e.target.value)) })} />
          days
        </label>
      );
    case 'signup':
      return (
        <div className="adm-inline">
          <label className="adm-camp-field">
            On or after
            <input className="adm-input" type="date" value={audience.after ?? ''} onChange={(e) => onChange({ ...audience, after: e.target.value || undefined })} />
          </label>
          <label className="adm-camp-field">
            Before
            <input className="adm-input" type="date" value={audience.before ?? ''} onChange={(e) => onChange({ ...audience, before: e.target.value || undefined })} />
          </label>
        </div>
      );
    case 'user':
      return (
        <label className="adm-camp-field adm-camp-field--wide">
          Account id
          <input className="adm-input adm-mono" value={audience.id} onChange={(e) => onChange({ type: 'user', id: e.target.value.trim() })} placeholder="From the Users page, e.g. for a test on your own account" />
        </label>
      );
    default:
      return <p className="adm-muted">Every account that isn&apos;t blocked.</p>;
  }
}
