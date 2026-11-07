import { useEffect, useState } from 'react';
import { ChartNoAxesColumn, Coins, LogIn, LogOut, Settings, UserRound } from 'lucide-react';
import Menu, { MenuItem } from '../components/Playground/Menu';
import { PLAN_CHANGED, type CreditBalance } from '../services/billing';
import { formatCredits, isLow } from '../services/credits';
import { useCredits } from '../services/useCredits';
import { PROVIDER_LABEL } from './account';
import type { Account } from './useAccount';

/**
 * The header's account control on the React pages (static pages get the same
 * button from design/account.ts). Signed out, sign in to sync progress and
 * appear in the stats; signed in, progress, settings (`#/me`, with the rest of
 * the account's actions: AccountSettings) and sign out, with a Pro badge on
 * Pro (the account's plan, or a purchase that just landed). Absent without an API.
 * `base` is the way back to the site root.
 */
export default function AccountMenu({ account, base = '../' }: { account: Account; base?: string }) {
  const { state } = account;
  const { credits, plan: planNow } = useCredits(state.status === 'signed-in');
  const plan = usePlanName(planNow ?? (state.status === 'signed-in' ? state.user.plan : undefined));
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
    <>
    {credits && <CreditsChip credits={credits} href={`${base}practice/#/me`} />}
    <Menu
      label="Account"
      align="right"
      buttonClassName="ps-account__button"
      trigger={
        <>
          <UserRound size={16} aria-hidden="true" />
          <span className="ps-account__name ps-hide-sm">{user.displayName}</span>
          {(plan === 'pro' || plan === 'max') && (
            <span
              data-testid="plan-badge"
              className={`rounded-sm border-bw-1 border-ink px-1 text-[10px] font-bold uppercase leading-4 tracking-wide text-on-accent ${plan === 'max' ? 'bg-pop-lilac' : 'bg-pop-yellow'}`}
            >
              {plan === 'max' ? 'Max' : 'Pro'}
            </span>
          )}
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
    </>
  );
}

/** The credits left, a link to Settings › Plan & billing; orange under about 10% of the allowance. */
function CreditsChip({ credits, href }: { credits: CreditBalance; href: string }) {
  const low = isLow(credits);
  const left = formatCredits(credits.balance, { floor: true });
  return (
    <a
      href={href}
      data-testid="credits-chip"
      data-credits-chip=""
      data-low={low || undefined}
      aria-label={`${left} credits left${low ? ', running low' : ''}. Plan and billing`}
      title={low ? 'Running low on credits' : 'Credits left'}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-sm border-bw-2 px-2.5 text-sm font-semibold tabular-nums shadow-[3px_3px_0_rgb(var(--c-shadow))] ${
        low ? 'border-orange-700 bg-orange-100 text-orange-950 dark:border-orange-300 dark:bg-orange-400/20 dark:text-orange-100' : 'border-ink bg-surface text-ink hover:bg-pop-yellow hover:text-on-accent'
      }`}
    >
      <Coins size={15} aria-hidden="true" />
      {left}
      <span className="ps-hide-sm font-normal">credits</span>
    </a>
  );
}

/** The account's plan: GET /api/me/plan's once read, else GET /api/me's, or the one PLAN_CHANGED announced since (a purchase landed). */
function usePlanName(fromAccount: string | undefined): string | undefined {
  const [announced, setAnnounced] = useState<string>();
  useEffect(() => {
    const on = (e: Event) => {
      const plan = (e as CustomEvent<string | undefined>).detail;
      if (plan) setAnnounced(plan);
    };
    window.addEventListener(PLAN_CHANGED, on);
    return () => window.removeEventListener(PLAN_CHANGED, on);
  }, []);
  return announced ?? fromAccount;
}
