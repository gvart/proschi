import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Play, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError, type EmailPrefs } from '../../services/api';
import { track } from '../../services/metrics';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import { browserTimeZone, isEmailAddress, REMINDER_KINDS, type ReminderKind } from './emailReminders';

/**
 * Email reminders on the account page (`#/me`), signed in only: an address
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
    <section aria-labelledby="email-reminders" className="mt-8 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
      <h2 id="email-reminders" className="font-display text-xl font-bold text-ink">
        Email reminders
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ink/80">
        Opt in to a nudge when your streak is at risk or cards are due, and a weekly recap. At most one email a day, sent in your evening; every email has a
        one-click unsubscribe link. Your address is used for nothing else.
      </p>

      {load.status === 'loading' && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {load.status === 'error' && (
        <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink">
          {load.message}
          <button type="button" className={outlineButton} onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        </p>
      )}

      {showForm && (
        <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-end gap-2" noValidate>
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm font-semibold text-ink sm:w-auto">
            Email address
            <input
              type="email"
              autoComplete="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com"
              className={`${field} w-full sm:w-72`}
              required
            />
          </label>
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
      )}

      {prefs && prefs.email !== null && !editing && (
        <div className="mt-3">
          <p className="text-sm text-ink">
            {prefs.confirmed ? 'Reminders go to ' : 'Waiting for you to confirm '}
            <strong className="break-all">{prefs.email}</strong>
            {prefs.confirmed ? '.' : ': follow the link we emailed you.'}
          </p>
          {prefs.confirmed && prefs.paused && (
            <p className="mt-2 flex flex-wrap items-center gap-2 rounded border-bw-1 border-ink bg-pop-yellow/30 p-2 text-sm text-ink">
              We paused your reminders after three in a row went unanswered.
              <button type="button" disabled={busy} className={primaryButton} onClick={() => void patch({ resume: true }, 'Reminders are back on.')}>
                <Play size={14} aria-hidden="true" />
                Resume reminders
              </button>
            </p>
          )}
          {prefs.confirmed && (
            <fieldset className="mt-3">
              <legend className="text-sm font-semibold text-ink">Send me</legend>
              {REMINDER_KINDS.map((kind) => (
                <label key={kind.key} className="mt-2 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={prefs[kind.key as ReminderKind]}
                    disabled={busy}
                    onChange={(e) => void patch({ [kind.key]: e.target.checked })}
                    className="mt-0.5 h-5 w-5 flex-shrink-0 accent-ink"
                  />
                  <span className="text-sm text-ink">
                    <span className="font-semibold">{kind.label}</span> <span className="text-ink/70">— {kind.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-ink">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-ink">
          {notice}
        </p>
      )}
    </section>
  );
}
