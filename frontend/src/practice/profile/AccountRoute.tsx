import { useEffect, useState } from 'react';
import { ExternalLink, LogIn, RotateCcw, UserRound } from 'lucide-react';
import problems from 'virtual:practice-listings';
import PaneLoading from '../../components/PaneLoading';
import { challengeDay, challengeSummary, type ChallengeSummary } from '../../learn/challenge';
import { api, type ChallengeToday } from '../../services/api';
import { localResults } from '../challenge/store';
import { eyebrow, primaryButton } from '../../components/Playground/ui';
import { PROVIDER_LABEL } from '../account';
import { summarize, type Activity } from '../activity';
import type { Progress } from '../progress';
import { GoalPicker } from '../Streak';
import type { Account } from '../useAccount';
import type { Achievements } from '../skills/useAchievements';
import ProfileView from './ProfileView';
import { ownProfile, PUBLIC_FIELDS } from './profile';

/**
 * The account page (`#/me`): the learner's own profile (ProfileView) with
 * what only they see: streak freezes, card counts, the daily goal picker and
 * the public profile setting. The daily challenge's streak and best score
 * come from GET /api/challenge/today (signed in) or this browser's results. Signed out, an invitation to sign in; in a
 * build without accounts, this browser's progress.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

/**
 * The learner's daily challenge stats: from the server signed in, from this
 * browser's results in a build without accounts; null before a first
 * challenge, undefined while unknown (or when the server cannot be reached).
 */
function useChallengeSummary(account: Account): ChallengeSummary | null | undefined {
  const status = account.state.status;
  const userId = account.state.status === 'signed-in' ? account.state.user.id : undefined;
  const [fetched, setFetched] = useState<{ userId: string; summary: ChallengeSummary | null } | undefined>(undefined);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    api<ChallengeToday>('/api/challenge/today').then(
      (today) => {
        if (cancelled) return;
        const summary = today.streak && today.best != null ? { current: today.streak.current, longest: today.streak.longest, best: today.best } : null;
        setFetched({ userId, summary });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);
  if (status === 'off') {
    return challengeSummary(
      Object.values(localResults()).map((r) => ({ day: r.day, score: r.score })),
      challengeDay(),
    );
  }
  return fetched && fetched.userId === userId ? fetched.summary : undefined;
}

export default function AccountRoute({ account, activity, achievements, progress }: { account: Account; activity: Activity; achievements: Achievements; progress: Progress }) {
  const { state } = account;
  const { state: badges, refresh } = achievements;
  const challenge = useChallengeSummary(account);
  useEffect(() => {
    document.title = 'Your profile · Proschi practice';
  }, []);
  // Opening the page checks for anything new.
  useEffect(() => refresh(), [refresh]);

  if (state.status === 'loading') return <PaneLoading label="Checking your sign-in…" />;
  if (state.status === 'signed-out') return <SignInInvite account={account} />;
  if (badges.status === 'loading' || badges.status === 'locked') return <PaneLoading label="Loading your profile…" />;
  if (badges.status === 'error') {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Your profile</h1>
        <p role="alert" className="mt-4 text-sm text-ink">
          {badges.message}
        </p>
        <button type="button" onClick={() => refresh(true)} className={`mt-3 ${primaryButton}`}>
          <RotateCcw size={14} aria-hidden="true" />
          Try again
        </button>
      </main>
    );
  }

  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  const streak = ready && summarize(ready).streak;
  const user = state.status === 'signed-in' ? state.user : undefined;
  const model = ownProfile({
    displayName: user?.displayName ?? 'Your profile',
    memberSince: user?.createdAt,
    streak: streak && { current: streak.current, longest: streak.longest, freezes: streak.freezes },
    challenge,
    answer: badges.answer,
    progress,
    problems,
  });

  return (
    <ProfileView
      model={model}
      kicker={user ? 'Your profile' : 'Kept in this browser'}
      goal={ready && <GoalPicker goal={ready.goal} onPick={(n) => void activity.setGoal(n)} />}
    >
      {user && (
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
            When on, anyone can see {PUBLIC_FIELDS}. Your designs, daily goal, review history, sign-ins and sessions always stay private. Turn it off to
            hide your profile at once.
          </p>
          {user.publicProfile && (
            <a href={`#/u/${user.id}`} className={`mt-3 ${primaryButton}`}>
              <ExternalLink size={14} aria-hidden="true" />
              See your public profile
            </a>
          )}
        </section>
      )}
    </ProfileView>
  );
}

/** Signed out: what an account keeps, and the way in. */
function SignInInvite({ account }: { account: Account }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
      <p className={eyebrow}>Your profile</p>
      <h1 className="mt-1 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Sign in to see your profile</h1>
      <section aria-label="Sign in" className="mt-6 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <UserRound size={16} aria-hidden="true" />
          Your streak, badges, skill map and solved problems, in one place
        </p>
        <p className="mt-1 max-w-2xl text-sm text-ink/80">Signed in, your progress is kept across devices, and you can choose to share a public profile from the leaderboard.</p>
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
