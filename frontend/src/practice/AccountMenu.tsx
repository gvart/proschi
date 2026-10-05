import { Check, Download, Link, LogIn, LogOut, MonitorX, Pencil, Trash2, Unlink, UserRound } from 'lucide-react';
import Menu, { MenuItem } from '../components/Playground/Menu';
import { PROVIDER_LABEL } from './account';
import type { Account } from './useAccount';

/** Sign in to sync progress and appear in the stats; signed in, the account's settings. Absent without an API. */
export default function AccountMenu({ account }: { account: Account }) {
  const { state } = account;
  if (state.status === 'off' || state.status === 'loading') return null;
  const message = state.message && <p className="px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-100 dark:border-amber-900">{state.message}</p>;

  if (state.status === 'signed-out') {
    if (state.providers.length === 0 && !state.message) return null;
    return (
      <Menu
        label="Sign in"
        align="right"
        trigger={
          <>
            <LogIn size={16} />
            <span className="hidden sm:inline">Sign in</span>
          </>
        }
      >
        {() => (
          <>
            {message}
            <p className="px-3 py-2 text-xs text-muted">
              Keep your progress across devices, compare your designs with other solvers and join the leaderboard. Your designs are stored on the server;
              no email address is.
            </p>
            {state.providers.map((p) => (
              <MenuItem key={p} onSelect={() => account.signIn(p)} icon={<LogIn size={14} />}>
                Sign in with {PROVIDER_LABEL[p]}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    );
  }

  const { user } = state;
  const linked = user.providers ?? [];
  const linkable = state.providers.filter((p) => !linked.includes(p));
  return (
    <Menu
      label="Account"
      align="right"
      trigger={
        <>
          <UserRound size={16} />
          <span className="hidden md:inline-block max-w-[6rem] truncate align-bottom">{user.displayName}</span>
        </>
      }
    >
      {(close) => (
        <>
          {message}
          <p className="px-3 py-2 text-xs text-muted">
            Signed in as <strong className="text-ink">{user.displayName}</strong>
            {user.providers?.length ? ` with ${user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}` : ''}
          </p>
          <MenuItem
            onSelect={() => void account.update({ publicProfile: !user.publicProfile })}
            icon={<Check size={14} className={user.publicProfile ? 'text-green-600 dark:text-green-400' : 'invisible'} />}
          >
            Show me on the leaderboard
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              const name = window.prompt('Display name (shown on the leaderboard if you opt in)', user.displayName);
              if (name !== null && name.trim()) void account.update({ displayName: name });
            }}
            icon={<Pencil size={14} />}
          >
            Change display name
          </MenuItem>
          {linkable.map((p) => (
            <MenuItem key={`link-${p}`} onSelect={() => account.link(p)} icon={<Link size={14} />}>
              Link {PROVIDER_LABEL[p]}
            </MenuItem>
          ))}
          {linked.length >= 2 &&
            linked.map((p) => (
              <MenuItem
                key={`unlink-${p}`}
                onSelect={() => {
                  close();
                  if (window.confirm(`Stop signing in with ${PROVIDER_LABEL[p] ?? p}?`)) void account.unlink(p);
                }}
                icon={<Unlink size={14} />}
              >
                Unlink {PROVIDER_LABEL[p] ?? p}
              </MenuItem>
            ))}
          <MenuItem
            onSelect={() => {
              close();
              void account.downloadData();
            }}
            icon={<Download size={14} />}
          >
            Download my data
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              void account.signOut();
            }}
            icon={<LogOut size={14} />}
          >
            Sign out
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              if (window.confirm('Sign out on every device and browser, this one included?')) void account.signOutEverywhere();
            }}
            icon={<MonitorX size={14} />}
          >
            Sign out everywhere
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              if (window.confirm('Delete your account and the progress stored on the server? Progress in this browser stays.')) void account.remove();
            }}
            icon={<Trash2 size={14} className="text-red-600 dark:text-red-400" />}
          >
            Delete account
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
