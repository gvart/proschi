import { useState, type FormEvent } from 'react';
import { Download, Link, LogOut, MonitorX, Pencil, Trash2, Unlink } from 'lucide-react';
import { field, outlineButton, primaryButton } from '../components/Playground/ui';
import { removeSyncedFromBrowser, syncedInBrowser } from '../playground/localDocs';
import type { ProviderId } from '../services/api';
import { PROVIDER_LABEL } from './account';
import type { Account } from './useAccount';

/**
 * The account's settings on the account page (`#/me`), signed in only: the
 * display name, sign-in methods, a copy of the data, the ways to sign out,
 * and deleting the account in a danger zone. The everyday account menu keeps
 * only progress, settings and sign out. Every destructive action asks first.
 */

const card = 'mt-8 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md';
const heading = 'font-display text-xl font-bold text-ink';
const dangerButton = `${outlineButton} !border-red-700 !text-red-700 dark:!border-red-400 dark:!text-red-300`;

/** What is waiting for a second click: unlinking a provider, signing out everywhere, or deleting the account. */
type Pending = { kind: 'unlink'; provider: ProviderId } | { kind: 'everywhere' } | { kind: 'delete' };

export default function AccountSettings({ account }: { account: Account }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const { state } = account;
  if (state.status !== 'signed-in') return null;

  const { user } = state;
  const linked = user.providers ?? [];
  const linkable = state.providers.filter((p) => !linked.includes(p));
  const synced = syncedInBrowser();
  const label = (p: ProviderId) => PROVIDER_LABEL[p] ?? p;

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void account.update({ displayName: name.trim() });
    setEditing(false);
  };

  const confirm = (question: string, yes: string, run: () => void) => (
    <p role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink">
      {question}
      <button
        type="button"
        className={dangerButton}
        onClick={() => {
          setPending(null);
          run();
        }}
      >
        {yes}
      </button>
      <button type="button" className={outlineButton} onClick={() => setPending(null)}>
        Cancel
      </button>
    </p>
  );

  return (
    <>
      <section aria-labelledby="account-settings" className={card}>
        <h2 id="account-settings" className={heading}>
          Account
        </h2>
        {state.message && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">{state.message}</p>}

        <h3 className="mt-4 text-sm font-semibold text-ink">Display name</h3>
        {editing ? (
          <form onSubmit={saveName} className="mt-1 flex flex-wrap items-end gap-2">
            <label className="flex w-full min-w-0 flex-col gap-1 text-sm text-muted sm:w-auto">
              Shown on the leaderboard if you opt in
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={`${field} w-full sm:w-64`} autoFocus />
            </label>
            <button type="submit" className={primaryButton}>
              Save
            </button>
            <button type="button" className={outlineButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink">
            <strong>{user.displayName}</strong>
            <button
              type="button"
              className={outlineButton}
              onClick={() => {
                setName(user.displayName);
                setEditing(true);
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              Change display name
            </button>
          </p>
        )}

        <h3 className="mt-4 text-sm font-semibold text-ink">Sign-in methods</h3>
        <p className="mt-1 text-sm text-ink/80">{linked.length ? `You sign in with ${linked.map(label).join(' and ')}.` : 'No sign-in method is linked.'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {linkable.map((p) => (
            <button key={p} type="button" className={outlineButton} onClick={() => account.link(p)}>
              <Link size={14} aria-hidden="true" />
              Link {label(p)}
            </button>
          ))}
          {linked.length >= 2 &&
            linked.map((p) => (
              <button key={p} type="button" className={outlineButton} onClick={() => setPending({ kind: 'unlink', provider: p })}>
                <Unlink size={14} aria-hidden="true" />
                Unlink {label(p)}
              </button>
            ))}
        </div>
        {pending?.kind === 'unlink' && confirm(`Stop signing in with ${label(pending.provider)}?`, `Unlink ${label(pending.provider)}`, () => void account.unlink(pending.provider))}

        <h3 className="mt-4 text-sm font-semibold text-ink">Your data and sessions</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={outlineButton} onClick={() => void account.downloadData()}>
            <Download size={14} aria-hidden="true" />
            Download my data
          </button>
          <button type="button" className={outlineButton} onClick={() => void account.signOut()}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
          {synced > 0 && (
            <button
              type="button"
              className={outlineButton}
              onClick={() => {
                removeSyncedFromBrowser();
                void account.signOut();
              }}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out and remove synced diagrams from this browser
            </button>
          )}
          <button type="button" className={outlineButton} onClick={() => setPending({ kind: 'everywhere' })}>
            <MonitorX size={14} aria-hidden="true" />
            Sign out everywhere
          </button>
        </div>
        {pending?.kind === 'everywhere' && confirm('Sign out on every device and browser, this one included?', 'Sign out everywhere', () => void account.signOutEverywhere())}
      </section>

      <section aria-labelledby="danger-zone" className={`${card} !border-red-700 dark:!border-red-400`}>
        <h2 id="danger-zone" className={heading}>
          Danger zone
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-ink/80">
          Deleting your account removes it and the progress stored on the server. Progress kept in this browser stays.
        </p>
        <button type="button" className={`mt-3 ${dangerButton}`} onClick={() => setPending({ kind: 'delete' })}>
          <Trash2 size={14} aria-hidden="true" />
          Delete account
        </button>
        {pending?.kind === 'delete' && confirm('Delete your account for good? This cannot be undone.', 'Yes, delete my account', () => void account.remove())}
      </section>
    </>
  );
}
