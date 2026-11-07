import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Play, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError, type EmailPrefs } from '../../services/api';
import { track } from '../../services/metrics';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import { browserTimeZone, isEmailAddress, REMINDER_KINDS, type ReminderKind } from './reminderForm';
import ProductNews from './ProductNews';
import { Row, Section, switchInput } from './settingsUi';

/**
 * Email reminders, the Notifications section of the settings page (`#/me`), signed in only: an address
 * (double opt-in: the server emails a confirmation link, and only a
 * confirmed address gets reminders), which reminders to get, resuming them
 * after a pause, and changing or removing the address. The browser's time
 * zone goes with the address, so reminders arrive in the learner's evening.
 * backend/src/reminders.ts has the rules; docs/PRIVACY.md what is stored.
 */

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; prefs: EmailPrefs };

const messageOf = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

export default function EmailReminders() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    api<EmailPrefs>('/api/me/email').then(
      (prefs) => !cancelled && setLoad({ status: 'ready', prefs }),
      (e: unknown) => !cancelled && setLoad({ status: 'error', message: messageOf(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function run(action: () => Promise<EmailPrefs | undefined>, done?: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const prefs = (await action()) ?? { email: null };
      setLoad({ status: 'ready', prefs });
      setNotice(done);
      return prefs;
    } catch (e) {
      setError(messageOf(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const email = address.trim();
    if (!isEmailAddress(email)) {
      setError('Enter an email address, like you@example.com');
      return;
    }
    const prefs = await run(() => api<EmailPrefs>('/api/me/email', { method: 'PUT', body: { email, timeZone: browserTimeZone() } }));
    if (!prefs || prefs.email === null) return;
    setEditing(false);
    if (prefs.confirmationSent) {
      track('email_opt_in');
      setNotice(`We sent a confirmation link to ${prefs.email}. Reminders start once you follow it.`);
    }
  }

  const patch = (body: Record<string, unknown>, done?: string) => run(() => api<EmailPrefs>('/api/me/email', { method: 'PATCH', body }), done);
  const remove = () => run(() => api<undefined>('/api/me/email', { method: 'DELETE' }), 'Your address was removed. No more emails.');

  const prefs = load.status === 'ready' ? load.prefs : undefined;
  const showForm = prefs && (prefs.email === null || editing);

  return (
    <Section
      id="notifications"
      title="Notifications"
      description="Email reminders when your streak is at risk or cards are due, and a weekly recap."
    >
      {load.status === 'loading' && <p className="p-4 text-sm text-muted">Loading…</p>}
      {load.status === 'error' && (
        <p role="alert" className="flex flex-wrap items-center gap-2 p-4 text-sm text-ink">
          {load.message}
          <button type="button" className={outlineButton} onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        </p>
      )}

      {showForm && (
        <Row label="Email address" htmlFor="reminder-email" help="At most one email a day, sent in your evening, each with a one-click unsubscribe link. We send a confirmation link first, and use your address for nothing else.">
          <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-center gap-2" noValidate>
            <input
              id="reminder-email"
              type="email"
              autoComplete="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com"
              className={`${field} w-full sm:w-72`}
              required
            />
            <button type="submit" disabled={busy} className={primaryButton}>
              <Mail size={14} aria-hidden="true" />
              Send confirmation link
            </button>
            {editing && (
              <button type="button" className={outlineButton} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </form>
        </Row>
      )}

      {prefs && prefs.email !== null && !editing && (
        <>
          <Row
            label="Email address"
            help={
              <>
                {prefs.confirmed ? 'Reminders go to ' : 'Waiting for you to confirm '}
                <strong className="break-all font-semibold text-ink">{prefs.email}</strong>
                {prefs.confirmed ? '.' : ': follow the link we emailed you.'}
              </>
            }
            control={
              <>
                {!prefs.confirmed && (
                  <button
                    type="button"
                    disabled={busy}
                    className={outlineButton}
                    onClick={() =>
                      void run(
                        () => api<EmailPrefs>('/api/me/email', { method: 'PUT', body: { email: prefs.email, timeZone: browserTimeZone() } }),
                        `We sent a new confirmation link to ${prefs.email}.`,
                      )
                    }
                  >
                    <Mail size={14} aria-hidden="true" />
                    Resend the link
                  </button>
                )}
                <button
                  type="button"
                  className={outlineButton}
                  onClick={() => {
                    setAddress(prefs.email);
                    setEditing(true);
                    setNotice(undefined);
                  }}
                >
                  Change address
                </button>
                <button type="button" disabled={busy} className={outlineButton} onClick={() => void remove()}>
                  <Trash2 size={14} aria-hidden="true" />
                  Remove address
                </button>
              </>
            }
          />
          {prefs.confirmed && prefs.paused && (
            <div className="flex flex-col gap-3 bg-pop-yellow/20 p-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between">
              <p>We paused your reminders after three in a row went unanswered.</p>
              <button type="button" disabled={busy} className={`${primaryButton} self-start sm:self-auto`} onClick={() => void patch({ resume: true }, 'Reminders are back on.')}>
                <Play size={14} aria-hidden="true" />
                Resume reminders
              </button>
            </div>
          )}
          {prefs.confirmed && (
            <div role="group" aria-label="Send me" className="divide-y divide-ink/15">
              {REMINDER_KINDS.map((kind) => (
                <Row
                  key={kind.key}
                  label={kind.label}
                  htmlFor={`reminder-${kind.key}`}
                  inline
                  help={`${kind.hint[0].toUpperCase()}${kind.hint.slice(1)}.`}
                  control={
                    <input
                      id={`reminder-${kind.key}`}
                      type="checkbox"
                      role="switch"
                      checked={prefs[kind.key as ReminderKind]}
                      disabled={busy}
                      onChange={(e) => void patch({ [kind.key]: e.target.checked })}
                      className={switchInput}
                    />
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      <ProductNews />

      {(error || notice) && (
        <div className="p-4">
          {error && (
            <p role="alert" className="text-sm font-semibold text-ink">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-ink">
              {notice}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
