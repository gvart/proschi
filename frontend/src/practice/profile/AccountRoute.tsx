import { useEffect } from 'react';
import { ArrowRight, ExternalLink, LogIn, UserRound } from 'lucide-react';
import PaneLoading from '../../components/PaneLoading';
import ShareButton from '../../components/ShareButton';
import { profileShareText } from '../../learn/share';
import { eyebrow, primaryButton } from '../../components/Playground/ui';
import { PROVIDER_LABEL } from '../account';
import AccountSettings from '../AccountSettings';
import type { Account } from '../useAccount';
import EmailReminders from './EmailReminders';
import { PUBLIC_FIELDS } from './profile';

/**
 * The account and settings page (`#/me`): who is signed in, the public
 * profile and leaderboard setting, and email reminders, then the account's
 * own actions (linked accounts, data download, sign-out, deletion). Progress
 * (level, skills, badges, streaks, problems solved) lives on `#/progress`.
 * Signed out, an invitation to sign in; in a build without accounts, a
 * pointer to the progress page.
 */

const heading = 'mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink';

export default function AccountRoute({ account }: { account: Account }) {
  const { state } = account;
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
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <p className={eyebrow}>Your account</p>
      <h1 className={heading}>Settings</h1>
      <p className="mt-2 text-sm text-muted">
        Signed in as <strong className="text-ink">{user.displayName}</strong>
        {user.providers?.length ? ` with ${user.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(', ')}` : ''}.{' '}
        <a href="#/progress" className="font-semibold text-ink underline underline-offset-2">
          See your progress
        </a>
      </p>

      <section aria-labelledby="public-profile" className="mt-8 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-md">
        <h2 id="public-profile" className="font-display text-xl font-bold text-ink">
          Public profile
        </h2>
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            checked={user.publicProfile}
            onChange={(e) => void account.update({ publicProfile: e.target.checked })}
            className="mt-0.5 h-5 w-5 flex-shrink-0 accent-ink"
          />
          <span className="text-sm font-semibold text-ink">Show me on the leaderboard, with a public profile</span>
        </label>
        <p className="mt-2 max-w-2xl text-sm text-ink/80">
          When on, anyone can see {PUBLIC_FIELDS}. Your designs, daily goal, review history, sign-ins and sessions always stay private. Turn it off to hide
          your profile at once.
        </p>
        {user.publicProfile && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={`#/u/${user.id}`} className={primaryButton}>
              <ExternalLink size={14} aria-hidden="true" />
              See your public profile
            </a>
            <ShareButton label="Share your profile" text={profileShareText({ displayName: user.displayName, userId: user.id, own: true })} />
          </div>
        )}
      </section>
      <EmailReminders />
      <AccountSettings account={account} />
    </main>
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
