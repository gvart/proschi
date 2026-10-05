import { useEffect } from 'react';
import { ArrowRight, Dumbbell, Lock, LogIn, RotateCcw } from 'lucide-react';
import deck from 'virtual:practice-cards';
import type { AchievementsAnswer } from '../../learn/achievements';
import { percent } from '../../learn/mastery';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, primaryButton } from '../../components/Playground/ui';
import { ACHIEVEMENTS } from '../achievementList';
import { PROVIDER_LABEL } from '../account';
import type { Account } from '../useAccount';
import BadgeGrid from '../profile/BadgeGrid';
import { profileBadge, type ProfileBadge } from '../profile/profile';
import SkillRadar, { type RadarPoint } from './SkillRadar';
import type { Achievements } from './useAchievements';

/**
 * The progress page (`#/progress`): the skill map (each topic's mastery as a
 * radar, with a table for screen readers), the "interview ready" score with
 * the weakest topics to train, and every badge as a compact grid (BadgeGrid),
 * earned or locked with its progress. Signed out, a locked preview with a
 * sign-in invitation. A tab of the interview prep hub.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';

/** The badges with no progress: what a signed-out reader sees. */
const preview: ProfileBadge[] = ACHIEVEMENTS.map((a) => ({ ...a, earned: false }));

export default function ProgressRoute({ account, achievements }: { account: Account; achievements: Achievements }) {
  const { state, refresh } = achievements;
  useEffect(() => {
    document.title = 'Your progress · Proschi practice';
  }, []);
  // Opening the page checks for anything new.
  useEffect(() => refresh(), [refresh]);

  if (state.status === 'loading') return <PaneLoading label="Loading your progress…" />;

  const answer: AchievementsAnswer | undefined = state.status === 'ready' ? state.answer : undefined;
  const titles = new Map(deck.topics.map((t) => [t.id, t.title]));
  const mastery = new Map(answer?.skills.topics.map((t) => [t.topic, t.mastery]) ?? []);
  // Every topic with cards, in tags.json's order; locked or loading, all at 0.
  const points: RadarPoint[] = deck.topics
    .filter((t) => deck.cards.some((c) => !c.retired && c.tags.includes(t.id)))
    .map((t) => ({ id: t.id, label: t.title, value: mastery.get(t.id) ?? 0 }));
  const badges: ProfileBadge[] = answer ? answer.achievements.map(profileBadge) : preview;

  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Your progress</h1>
      <p className="mt-3 max-w-2xl text-base text-ink/80">
        How well you know each topic, from the cards you review and the problems you solve, and the badges you have earned on the way.
      </p>

      {state.status === 'locked' && <SignInInvite account={account} />}
      {state.status === 'error' && (
        <section aria-label="Could not load" className={`mt-6 p-4 ${card}`}>
          <p role="alert" className="text-sm text-ink">
            {state.message}
          </p>
          <button type="button" onClick={() => refresh(true)} className={`mt-3 ${primaryButton}`}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        </section>
      )}

      <div className="mt-6 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="readiness" className={`p-4 sm:p-5 ${card} ${answer ? '' : 'opacity-60'}`}>
          <h2 id="readiness" className={eyebrow}>
            Interview ready
          </h2>
          <p className="mt-1 font-display text-5xl font-extrabold tabular-nums text-ink" data-testid="readiness">
            {percent(answer?.skills.readiness ?? 0)}%
          </p>
          <p className="mt-1 text-sm text-ink/80">The mastery of every topic, weighted by how many cards it has.</p>
          <div className="mt-3 h-3 overflow-hidden rounded-full border-bw-1 border-ink bg-paper" aria-hidden="true">
            <div className="h-full bg-pass" style={{ width: `${percent(answer?.skills.readiness ?? 0)}%` }} />
          </div>
          {answer && answer.skills.weakest.length > 0 && (
            <>
              <h3 className="mt-5 font-display text-lg font-bold text-ink">Train next</h3>
              <ul className="mt-2 space-y-2">
                {answer.skills.weakest.map((id) => (
                  <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 text-sm text-ink">
                      <span className="font-semibold">{titles.get(id) ?? id}</span>
                      <span className="tabular-nums text-muted"> · {percent(mastery.get(id) ?? 0)}%</span>
                    </span>
                    <a href={`#/review/${id}`} className={`min-h-[40px] ${primaryButton}`} aria-label={`Train this topic: ${titles.get(id) ?? id}`}>
                      <Dumbbell size={14} aria-hidden="true" />
                      Train this topic
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {answer && (
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t-bw-1 border-dashed border-ink/40 pt-4">
              <Stat label="Cards reviewed" value={answer.stats.reviews} />
              <Stat label="Cards mastered" value={answer.stats.mastered} />
              <Stat label="Problems solved" value={answer.stats.solved} />
              <Stat label="Longest streak" value={answer.stats.longestStreak} unit={answer.stats.longestStreak === 1 ? 'day' : 'days'} />
            </dl>
          )}
        </section>

        <section aria-labelledby="skill-map" className={`p-4 sm:p-5 ${card} ${answer ? '' : 'opacity-60'}`}>
          <h2 id="skill-map" className={eyebrow}>
            Skill map
          </h2>
          <SkillRadar points={points} summary={`Topic mastery, from 0 to 100%. ${answer ? `Interview ready: ${percent(answer.skills.readiness)}%.` : 'Locked.'} Each topic's value is in the table that follows.`} />
          <table className="sr-only">
            <caption>Mastery per topic</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Mastery</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.label}</th>
                  <td>{percent(p.value)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="mt-8">
        <BadgeGrid badges={badges} />
      </div>
    </main>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div>
      <dt className={eyebrow}>{label}</dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </dd>
    </div>
  );
}

/** Signed out: the page is a preview; an account tracks it. */
function SignInInvite({ account }: { account: Account }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <section aria-label="Sign in to track your progress" className="mt-6 rounded-brutal border-bw-2 border-ink bg-pop-lilac/20 p-4 shadow-brutal-md">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Lock size={16} aria-hidden="true" />A preview: sign in to fill it in
      </p>
      <p className="mt-1 max-w-2xl text-sm text-ink/80">
        Signed in, your reviews and solves build a skill map of every topic, an interview-ready score and badges, kept across devices.
      </p>
      {providers.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {providers.map((p) => (
            <button key={p} type="button" onClick={() => account.signIn(p)} className={primaryButton}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>
      ) : (
        <a href="#/review" className={`mt-3 ${primaryButton}`}>
          Try the free sample deck
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
