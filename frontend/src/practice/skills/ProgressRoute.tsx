import { useEffect, type ReactNode } from 'react';
import { ArrowRight, Dumbbell, Flame, Layers, Lock, LogIn, RotateCcw, Snowflake, Sparkles, Zap } from 'lucide-react';
import deck from 'virtual:practice-cards';
import problems from 'virtual:practice-listings';
import { MAX_SCORE } from '../../learn/challenge';
import type { AchievementsAnswer } from '../../learn/achievements';
import { percent } from '../../learn/mastery';
import { levelOf, XP_PER_MASTERED_CARD, XP_PER_SOLVE, XP_PER_STREAK_DAY } from '../../learn/level';
import { roadmapHref, type RoadmapStage, type RoadmapState } from '../roadmap';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, primaryButton } from '../../components/Playground/ui';
import { ACHIEVEMENTS } from '../achievementList';
import { PROVIDER_LABEL } from '../account';
import { summarize, type Activity } from '../activity';
import { DifficultyBadge } from '../Badges';
import { statusOf, type Progress } from '../progress';
import { GoalPicker } from '../Streak';
import type { Account } from '../useAccount';
import AchievementIcon from './AchievementIcon';
import BadgeGrid from '../profile/BadgeGrid';
import { nextBadges, profileBadge, type ProfileBadge } from '../profile/profile';
import SkillRadar, { type RadarPoint } from './SkillRadar';
import type { Achievements } from './useAchievements';
import { useChallengeSummary } from './useChallengeSummary';

/**
 * The progress page (`#/progress`), the one place for progress, read top to
 * bottom: "Your next step" first while nothing is earned yet, the headline
 * level and XP (src/learn/level.ts, from problems solved, cards mastered and
 * the longest streak) with the stats behind it, the streak (with freezes, the
 * daily challenge's streak and best score, and the daily goal), the skill map
 * (each topic's mastery as a radar, with a table for screen readers, and the
 * "interview ready" score with the weakest topics to train), the roadmap's
 * progress, the next badges to earn with every badge behind "All badges"
 * (BadgeGrid), and the problems solved. Signed out, a locked preview with a
 * sign-in invitation. A tab of the practice hub; the account's settings are
 * on `#/me`.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';

/** The badges with no progress: what a signed-out reader sees. */
const preview: ProfileBadge[] = ACHIEVEMENTS.map((a) => ({ ...a, earned: false }));

export default function ProgressRoute({
  account,
  achievements,
  roadmap,
  stages,
  activity,
  progress,
}: {
  account: Account;
  achievements: Achievements;
  activity: Activity;
  /** This browser's progress (merged with the account's when signed in): the problems solved. */
  progress: Progress;
  /** Where the learner is on the roadmap (roadmapState), and its stages. */
  roadmap: RoadmapState;
  stages: RoadmapStage[];
}) {
  const { state, refresh } = achievements;
  const challenge = useChallengeSummary(account);
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
  const level = levelOf(answer?.stats ?? { solved: 0, mastered: 0, longestStreak: 0 });
  const earned = badges.filter((b) => b.earned).length;
  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  const streak = ready && summarize(ready).streak;
  const solved = problems.filter((p) => statusOf(progress, p.id) === 'solved');

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

      {level.xp === 0 && <NextStep roadmap={roadmap} />}

      <section aria-labelledby="level-title" className={`mt-6 overflow-hidden ${card} ${answer ? '' : 'opacity-60'}`}>
        <div className="h-2 border-b-bw-2 border-ink bg-pop-yellow" aria-hidden="true" />
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h2 id="level-title" className={`flex items-center gap-1.5 ${eyebrow}`}>
                <Sparkles size={13} aria-hidden="true" />
                Your level
              </h2>
              <p className="mt-1 font-display text-5xl font-extrabold tabular-nums text-ink" data-testid="level">
                Level {level.level}
              </p>
            </div>
            <p className="text-sm tabular-nums text-ink/80">
              <span className="font-display text-2xl font-extrabold text-ink" data-testid="xp">
                {level.xp.toLocaleString('en-US')} XP
              </span>{' '}
              · {(level.next - level.xp).toLocaleString('en-US')} XP to level {level.level + 1}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={`Progress to level ${level.level + 1}`}
            aria-valuemin={level.floor}
            aria-valuemax={level.next}
            aria-valuenow={level.xp}
            className="mt-3 h-3 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
          >
            <div className="h-full bg-pop-yellow" style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {XP_PER_SOLVE} XP per problem solved, {XP_PER_MASTERED_CARD} per card mastered (remembered for 21 days or more) and {XP_PER_STREAK_DAY} per day of your
            longest streak.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t-bw-1 border-dashed border-ink/40 pt-4 sm:grid-cols-5">
            <Stat label="Problems solved" value={answer?.stats.solved ?? 0} />
            <Stat label="Cards mastered" value={answer?.stats.mastered ?? 0} />
            <Stat label="Longest streak" value={answer?.stats.longestStreak ?? 0} unit={answer?.stats.longestStreak === 1 ? 'day' : 'days'} />
            <Stat label="Cards reviewed" value={answer?.stats.reviews ?? 0} />
            <Stat label="Badges" value={earned} unit={`of ${badges.length}`} />
          </dl>
        </div>
      </section>

      {(streak || challenge) && (
        <section aria-labelledby="streak-title" className="mt-10">
          <h2 id="streak-title" className="font-display text-2xl font-extrabold text-ink">
            Streak
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Streak">
            {streak && (
              <Tile
                label="Current streak"
                value={streak.current}
                unit={streak.current === 1 ? 'day' : 'days'}
                icon={<Flame size={16} aria-hidden="true" className={streak.current > 0 ? 'fill-pop-yellow text-ink' : 'text-muted'} />}
              />
            )}
            {streak && <Tile label="Streak freezes" value={streak.freezes} icon={<Snowflake size={16} aria-hidden="true" className="text-ink" />} />}
            {challenge && (
              <Tile
                label="Challenge streak"
                value={challenge.current}
                unit={challenge.current === 1 ? 'day' : 'days'}
                icon={<Zap size={16} aria-hidden="true" className={challenge.current > 0 ? 'fill-pop-yellow text-ink' : 'text-muted'} />}
                detail={`Longest ${challenge.longest} ${challenge.longest === 1 ? 'day' : 'days'}`}
              />
            )}
            {challenge && <Tile label="Best challenge" value={challenge.best} unit={`/ ${MAX_SCORE}`} testId="profile-challenge-best" />}
          </dl>
          {ready && (
            <div className="mt-4">
              <GoalPicker goal={ready.goal} onPick={(n) => void activity.setGoal(n)} />
            </div>
          )}
        </section>
      )}

      <h2 className="mt-10 font-display text-2xl font-extrabold text-ink">Skills and mastery</h2>
      <div className="mt-3 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section aria-labelledby="readiness" className={`p-4 sm:p-5 ${card} ${answer ? '' : 'opacity-60'}`}>
          <h3 id="readiness" className={eyebrow}>
            Interview ready
          </h3>
          <p className="mt-1 font-display text-5xl font-extrabold tabular-nums text-ink" data-testid="readiness">
            {percent(answer?.skills.readiness ?? 0)}%
          </p>
          <p className="mt-1 text-sm text-ink/80">The mastery of every topic, weighted by how many cards it has.</p>
          <div className="mt-3 h-3 overflow-hidden rounded-full border-bw-1 border-ink bg-paper" aria-hidden="true">
            <div className="h-full bg-pass" style={{ width: `${percent(answer?.skills.readiness ?? 0)}%` }} />
          </div>
          {answer && answer.skills.weakest.length > 0 && (
            <>
              <h4 className="mt-5 font-display text-lg font-bold text-ink">Train next</h4>
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
        </section>

        <section aria-labelledby="skill-map" className={`p-4 sm:p-5 ${card} ${answer ? '' : 'opacity-60'}`}>
          <h3 id="skill-map" className={eyebrow}>
            Skill map
          </h3>
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

      <RoadmapProgress roadmap={roadmap} stages={stages} />

      <NextBadges badges={badges} />
      {/* New learners see the next badges first; the whole grid opens on demand. */}
      <details className="mt-4" open={earned > 0}>
        <summary className="cursor-pointer text-sm font-semibold text-ink underline-offset-2 hover:underline">All {badges.length} badges</summary>
        <div className="mt-3">
          <BadgeGrid badges={badges} headingLevel={3} label="All badges" />
        </div>
      </details>

      <section aria-labelledby="progress-solved" className="mt-10">
        <h2 id="progress-solved" className="font-display text-2xl font-extrabold text-ink">
          Problems solved
        </h2>
        {solved.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            None yet.{' '}
            <a href="#/" className="font-semibold text-ink underline underline-offset-2">
              Pick a problem
            </a>
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/15 overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface text-sm shadow-brutal-sm">
            {solved.map((p) => (
              <li key={p.id}>
                <a href={`#/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-none focus-visible:bg-pop-yellow/25">
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.title}</span>
                  <DifficultyBadge difficulty={p.difficulty} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
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

/** A streak total, in a tile: a label, a number with its unit, an icon and a detail line. */
function Tile({ label, value, unit, icon, detail, testId }: { label: string; value: number; unit?: string; icon?: ReactNode; detail?: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-brutal border-bw-2 border-ink bg-surface px-3 py-2 shadow-brutal-sm">
      <dt className={eyebrow}>{label}</dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums text-ink">
        <span className="inline-flex items-center gap-1.5" data-testid={testId}>
          {value}
          {unit && <span className="text-sm font-semibold text-muted">{unit}</span>}
          {icon}
        </span>
        {detail && <span className="block font-sans text-xs font-semibold text-muted">{detail}</span>}
      </dd>
    </div>
  );
}

/** Before anything is earned: one clear next step instead of a page of zeros. */
function NextStep({ roadmap }: { roadmap: RoadmapState }) {
  const title = roadmap.next && (problems.find((p) => p.id === roadmap.next!.id)?.title ?? roadmap.next.id);
  return (
    <section aria-labelledby="next-step" className={`mt-6 p-4 sm:p-5 ${card}`}>
      <h2 id="next-step" className={eyebrow}>
        Your next step
      </h2>
      <p className="mt-1 font-display text-xl font-extrabold leading-tight text-ink">{title ? `Start the roadmap: ${title}` : 'Review today’s cards'}</p>
      <p className="mt-1 max-w-2xl text-sm text-ink/80">Every problem solved, card mastered and day of streak adds to your level, skills and badges below.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {roadmap.next && (
          <a href={roadmapHref(roadmap.next.id)} className={`min-h-[40px] ${primaryButton}`}>
            Start
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        )}
        <a href="#/review" className="inline-flex min-h-[40px] items-center gap-1.5 rounded border-bw-1 border-ink bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:bg-pop-yellow/30">
          <Layers size={14} aria-hidden="true" />
          Review cards
        </a>
      </div>
    </section>
  );
}

/** The three badges closest to being earned, named, with what earns them and how far along they are. */
function NextBadges({ badges }: { badges: ProfileBadge[] }) {
  const next = nextBadges(badges);
  if (next.length === 0) return null;
  return (
    <section aria-labelledby="next-badges" className="mt-10">
      <h2 id="next-badges" className="font-display text-2xl font-extrabold text-ink">
        Badges to earn next
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {next.map((b) => (
          <li key={b.id} data-next-badge={b.id} className={`flex items-start gap-3 p-3 ${card}`}>
            <AchievementIcon icon={b.icon} tier={b.tier} earned={false} />
            <div className="min-w-0">
              <p className="font-display text-base font-bold leading-tight text-ink">{b.title}</p>
              <p className="mt-0.5 text-sm text-ink/80">{b.description}</p>
              {b.progress && b.progress.current > 0 && (
                <p className="mt-1 text-xs tabular-nums text-muted">
                  {b.progress.current} / {b.progress.target}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The roadmap's progress: solved of total, the current stage, and the way back to it. */
function RoadmapProgress({ roadmap, stages }: { roadmap: RoadmapState; stages: RoadmapStage[] }) {
  const total = roadmap.steps.length;
  if (total === 0) return null;
  const stage = stages[roadmap.currentStage];
  return (
    <section aria-labelledby="roadmap-progress" className="mt-10">
      <h2 id="roadmap-progress" className="font-display text-2xl font-extrabold text-ink">
        Roadmap
      </h2>
      <div className={`mt-3 p-4 sm:p-5 ${card}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-semibold tabular-nums text-ink">
            {roadmap.solved} of {total} solved
          </p>
          {stage && (
            <p className="text-sm text-ink/80">
              <span className={eyebrow}>{roadmap.next ? 'Current stage' : 'Last stage'}</span>{' '}
              <span className="font-semibold text-ink">
                {roadmap.currentStage + 1}. {stage.title}
              </span>
            </p>
          )}
          <a href={roadmap.next ? roadmapHref(roadmap.next.id) : '#/roadmap'} className={`sm:ml-auto min-h-[40px] ${primaryButton}`}>
            {roadmap.next ? 'Continue the roadmap' : 'Open the roadmap'}
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
        <div
          role="progressbar"
          aria-label="Roadmap progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={roadmap.solved}
          className="mt-3 h-3 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
        >
          <div className="h-full bg-pass" style={{ width: `${(roadmap.solved / total) * 100}%` }} />
        </div>
      </div>
    </section>
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
