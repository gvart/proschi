import { ChartNoAxesColumn, LogIn, LogOut, Settings, UserRound } from 'lucide-react';
import Menu, { MenuItem } from '../components/Playground/Menu';
import { PROVIDER_LABEL } from './account';
import type { Account } from './useAccount';

/**
 * The header's account control on the React pages (static pages get the same
 * button from design/account.ts). Signed out, sign in to sync progress and
 * appear in the stats; signed in, progress, settings (`#/me`, with the rest of
 * the account's actions: AccountSettings) and sign out. Absent without an API.
 * `base` is the way back to the site root.
 */
export default function AccountMenu({ account, base = '../' }: { account: Account; base?: string }) {
  const { state } = account;
  if (state.status === 'off' || state.status === 'loading') return null;
  const message = state.message && <p className="px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-100 dark:border-amber-900">{state.message}</p>;

  if (state.status === 'signed-out') {
    if (state.providers.length === 0 && !state.message) return null;
    return (
      <Menu
        label="Sign in"
        align="right"
        buttonClassName="ps-account__button"
        trigger={
          <>
            <LogIn size={16} aria-hidden="true" />
            <span className="ps-account__name ps-hide-sm">Sign in</span>
          </>
        }
      >
        {() => (
          <>
            {message}
            <p className="px-3 py-2 text-xs text-muted">
              Keep your progress across devices, compare your designs with other solvers and join the leaderboard. Your designs are stored on the server;
              no email address is, unless you ask for email reminders.
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
  const go = (close: () => void, path: string) => {
    close();
    window.location.href = `${base}${path}`;
  };
  return (
    <Menu
      label="Account"
      align="right"
      buttonClassName="ps-account__button"
      trigger={
        <>
          <UserRound size={16} aria-hidden="true" />
          <span className="ps-account__name ps-hide-sm">{user.displayName}</span>
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
          <MenuItem onSelect={() => go(close, 'practice/#/progress')} icon={<ChartNoAxesColumn size={14} />}>
            Your progress
          </MenuItem>
          <MenuItem onSelect={() => go(close, 'practice/#/me')} icon={<Settings size={14} />}>
            Settings
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
        </>
      )}
    </Menu>
  );
}
