import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LogIn, UserRound } from 'lucide-react';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, primaryButton } from '../../components/Playground/ui';
import { PROVIDER_LABEL } from '../account';
import { billingEnabled } from '../../services/billing';
import type { Activity } from '../activity';
import type { Account } from '../useAccount';
import { ConnectedAccounts, DangerZone, DataPrivacy, LearningSection, ProfileSection } from './AccountSections';
import CheckoutStatus from './CheckoutStatus';
import { checkoutReturned } from './checkoutReturned';
import EmailReminders from './EmailReminders';
import PlanBilling from './PlanBilling';
import SettingsNav from './SettingsNav';
import { SECTIONS } from './settingsSections';

/**
 * The account and settings page (`#/me`): who is signed in, then the
 * sections in order (settingsSections.ts): Plan & billing, Profile,
 * Learning, Notifications, Connected accounts, Data & privacy and the
 * Danger zone, with a sticky list of them on the left from 900 px and a
 * "Jump to" menu on phones (SettingsNav.tsx). Back from a checkout, its
 * status and the welcome to Pro show at the top, above the sections. Progress
 * (level, skills, badges, streaks, problems solved) lives on `#/progress`.
 * Signed out, an invitation to sign in; in a build without accounts, a
 * pointer to the progress page.
 */

const heading = 'mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink';

export default function AccountRoute({ account, activity }: { account: Account; activity: Activity }) {
  const { state } = account;
  const [returned] = useState(checkoutReturned);
  useEffect(() => {
    document.title = 'Settings · Proschi practice';
  }, []);

  if (state.status === 'loading') return <PaneLoading label="Checking your sign-in…" />;
  if (state.status === 'signed-out') return <SignInInvite account={account} />;
  if (state.status === 'off') {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
        <p className={eyebrow}>Kept in this browser</p>
        <h1 className={heading}>Settings</h1>
        <p className="mt-4 max-w-2xl text-sm text-ink/80">This build has no accounts: your progress stays in this browser, with nothing to set up.</p>
        <a href="#/progress" className={`mt-3 ${primaryButton}`}>
          See your progress
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </main>
    );
  }

  const { user } = state;
  const sections = SECTIONS.filter((s) => s.id !== 'plan' || billingEnabled);
  return (
    <main className="max-w-5xl mx-auto px-4 py-8 sm:py-14">
      <p className={eyebrow}>Your account</p>
      <h1 className={heading}>Settings</h1>
      <p className="mt-2 text-sm text-muted">
        Signed in as <strong className="text-ink">{user.displayName}</strong>
        {user.providers?.length ? ` with ${user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}` : ''}.{' '}
        <a href="#/progress" className="font-semibold text-ink underline underline-offset-2">
          See your progress
        </a>
      </p>
      {state.message && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">{state.message}</p>}
      {billingEnabled && returned && <CheckoutReturn />}

      <div className="mt-8 min-[900px]:grid min-[900px]:grid-cols-[13rem_minmax(0,1fr)] min-[900px]:gap-12">
        <SettingsNav sections={sections} />
        <div className="mt-4 max-w-3xl space-y-10 min-[900px]:mt-0">
          <PlanBilling />
          <ProfileSection account={account} user={user} />
          <LearningSection activity={activity} />
          <EmailReminders />
          <ConnectedAccounts account={account} state={state} />
          <DataPrivacy account={account} user={user} />
          <DangerZone account={account} />
        </div>
      </div>
    </main>
  );
}

/** Back from a checkout: its status (and the welcome to Pro) above the sections, scrolled into view. */
function CheckoutReturn() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), []);
  return (
    <div ref={ref} className="mt-6 max-w-3xl scroll-mt-24 min-[900px]:ml-[16rem]">
      <CheckoutStatus />
    </div>
  );
}

/** Signed out: what an account keeps, and the way in. */
function SignInInvite({ account }: { account: Account }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <p className={eyebrow}>Settings</p>
      <h1 className={heading}>Sign in to manage your account</h1>
      <section aria-label="Sign in" className="mt-6 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <UserRound size={16} aria-hidden="true" />
          Your streak, badges, skill map and solved problems, kept across devices
        </p>
        <p className="mt-1 max-w-2xl text-sm text-ink/80">Signed in, you can choose a display name, share a public profile from the leaderboard and get email reminders.</p>
        {providers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {providers.map((p) => (
              <button key={p} type="button" onClick={() => account.signIn(p)} className={primaryButton}>
                <LogIn size={14} aria-hidden="true" />
                Sign in with {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
