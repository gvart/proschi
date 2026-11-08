import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, Dumbbell, Flame, Layers, Lock, LogIn, Map as MapIcon, Mic, RotateCcw, Snowflake, Sparkles, Zap } from 'lucide-react';
import deck from 'virtual:practice-cards';
import problems from 'virtual:practice-listings';
import { MAX_SCORE } from '../../learn/challenge';
import type { AchievementsAnswer } from '../../learn/achievements';
import { percent } from '../../learn/mastery';
import { levelOf, XP_PER_INTERVIEW, XP_PER_MASTERED_CARD, XP_PER_SOLO_INTERVIEW, XP_PER_SOLVE, XP_PER_STREAK_DAY } from '../../learn/level';
import { roadmapHref, type RoadmapStage, type RoadmapState } from '../roadmap';
import PaneLoading from '../../components/PaneLoading';
import { eyebrow, outlineButton, primaryButton } from '../../components/Playground/ui';
import { useFeature } from '../../components/featureState';
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
import WeeklyActivity from './WeeklyActivity';
import { weeklyTotals } from './weekly';
import InterviewHistory, { InterviewVerdictPage } from '../history/InterviewHistory';
import SoloHistory from '../history/SoloHistory';
import { pickHref, pickTitle } from '../history/api';
import { useRoadmapNext } from '../history/useRoadmapNext';
import { setupHref } from '../interview/links';

/**
 * The progress page (`#/progress`), the one place for progress, in five
 * titled sections read top to bottom:
 *
 * 1. The summary: the level and XP (src/learn/level.ts) with the few numbers
 *    that matter (the streak for those who keep one, problems solved,
 *    interviews, badges); the rest of the stats one line below.
 * 2. "What to do next": one primary step (the roadmap's next problem, or the
 *    cards) and at most two more (the weakest topic, a mock interview or the
 *    cards); with the ai_roadmap feature, the picks made after the last
 *    mock interview instead (docs/design/paid-plans.md P9).
 * 3. Skills: the skill map (each topic's mastery as a radar, with a table for
 *    screen readers), the "interview ready" score and the topics to train.
 * 4. History: the cards reviewed and problems solved per week, the streak and
 *    the daily challenge, the AI interview history (history/InterviewHistory.tsx,
 *    Pro-gated, each verdict at `#/progress/interview/<id>`), the interviews
 *    on your own (history/SoloHistory.tsx) and the problems solved.
 * 5. Badges: the earned ones first as a compact grid (BadgeGrid), the next
 *    three to earn, and every badge behind "Show all".
 *
 * Signed out, a locked preview with a sign-in invitation. A tab of the
 * practice hub; the account's settings are on `#/me`.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';
const subCard = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-sm';
const sectionTitle = 'font-display text-2xl font-extrabold text-ink';

/** The badges with no progress: what a signed-out reader sees. */
const preview: ProfileBadge[] = ACHIEVEMENTS.map((a) => ({
  ...a,
  earned: false,
}));

const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;

export default function ProgressRoute({
  account,
  showStreak = false,
  achievements,
  roadmap,
  stages,
  activity,
  progress,
  verdictId,
}: {
  account: Account;
  /** `#/progress/interview/<id>`: show that AI interview's verdict instead. */
  verdictId?: string;
  /** The streak, for those who keep one (hub/goal.ts). */
  showStreak?: boolean;
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
    // A verdict page names itself.
    if (!verdictId) document.title = 'Your progress · Proschi practice';
  }, [verdictId]);
  // Opening the page checks for anything new.
  useEffect(() => refresh(), [refresh]);

  if (verdictId) return <InterviewVerdictPage id={verdictId} />;
  if (state.status === 'loading') return <PaneLoading label="Loading your progress…" />;

  const answer: AchievementsAnswer | undefined = state.status === 'ready' ? state.answer : undefined;
  const titles = new Map(deck.topics.map((t) => [t.id, t.title]));
  const mastery = new Map(answer?.skills.topics.map((t) => [t.topic, t.mastery]) ?? []);
  // Every topic with cards, in tags.json's order; locked or loading, all at 0.
  const points: RadarPoint[] = deck.topics.filter((t) => deck.cards.some((c) => !c.retired && c.tags.includes(t.id))).map((t) => ({ id: t.id, label: t.title, value: mastery.get(t.id) ?? 0 }));
  const badges: ProfileBadge[] = answer ? answer.achievements.map(profileBadge) : preview;
  const level = levelOf(answer?.stats ?? { solved: 0, mastered: 0, longestStreak: 0 });
  // Problems interviewed with the interviewer, and on your own.
  const interviewed = (answer?.stats.interviews ?? 0) + (answer?.stats.soloInterviews ?? 0);
  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  const streak = showStreak && ready ? summarize(ready).streak : undefined;
  const solved = problems.filter((p) => statusOf(progress, p.id) === 'solved');
  const weakest = answer?.skills.weakest ?? [];

  return (
    <main className="max-w-4xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">Your progress</h1>
      <p className="mt-2 max-w-2xl text-base text-ink/80">Where you stand, what to do next, and how far you have come.</p>

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

      <Summary level={level} answer={answer} streak={streak?.current} solved={answer?.stats.solved ?? 0} interviewed={interviewed} badges={badges} />

      <NextSteps roadmap={roadmap} stages={stages} weakest={weakest[0]} weakestMastery={mastery.get(weakest[0] ?? '') ?? 0} topicTitle={(id) => titles.get(id) ?? id} interviewed={interviewed} />

      <section aria-labelledby="skills-title" className="mt-12">
        <h2 id="skills-title" className={sectionTitle}>
          Skills
        </h2>
        <div className={`mt-3 grid gap-6 p-4 sm:p-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] ${card} ${answer ? '' : 'opacity-60'}`}>
          <div className="min-w-0">
            <h3 id="skill-map" className={eyebrow}>
              Skill map
            </h3>
            <SkillRadar
              points={points}
              summary={`Topic mastery, from 0 to 100%. ${answer ? `Interview ready: ${percent(answer.skills.readiness)}%.` : 'Locked.'} Each topic's value is in the table that follows.`}
            />
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
          </div>
          <div className="min-w-0 md:border-l-bw-1 md:border-dashed md:border-ink/30 md:pl-6">
            <h3 id="readiness-title" className={eyebrow}>
              Interview ready
            </h3>
            <p className="mt-1 font-display text-4xl font-extrabold tabular-nums text-ink" data-testid="readiness">
              {percent(answer?.skills.readiness ?? 0)}%
            </p>
            <div
              role="progressbar"
              aria-labelledby="readiness-title"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent(answer?.skills.readiness ?? 0)}
              className="mt-2 h-2.5 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
            >
              <div className="h-full bg-pass" style={{ width: `${percent(answer?.skills.readiness ?? 0)}%` }} />
            </div>
            <p className="mt-2 text-sm text-ink/80">Every topic’s mastery, weighted by how many cards it has. Reviewing cards and solving problems raise it.</p>
            {weakest.length > 0 && (
              <>
                <h3 className={`mt-5 ${eyebrow}`}>Train next</h3>
                <ul className="mt-2 divide-y divide-ink/15">
                  {weakest.map((id) => (
                    <li key={id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 text-sm text-ink">
                        <span className="font-semibold">{titles.get(id) ?? id}</span>
                        <span className="tabular-nums text-muted"> · {percent(mastery.get(id) ?? 0)}%</span>
                      </span>
                      <a href={`#/review/${id}`} className={`min-h-[40px] ${outlineButton}`} aria-label={`Train this topic: ${titles.get(id) ?? id}`}>
                        <Dumbbell size={14} aria-hidden="true" />
                        Train
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="history-title" className="mt-12">
        <h2 id="history-title" className={sectionTitle}>
          History
        </h2>
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          <WeeklyCard activity={ready} wide={!streak && !challenge} />
          {(streak || challenge) && (
            <section aria-labelledby="streak-title" className={`p-4 sm:p-5 ${subCard}`}>
              <h3 id="streak-title" className={eyebrow}>
                {streak ? 'Streak and daily challenge' : 'Daily challenge'}
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3" aria-label={streak ? 'Streak' : 'Daily challenge'}>
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
              {streak && ready && (
                <div className="mt-4 border-t-bw-1 border-dashed border-ink/30 pt-3">
                  <GoalPicker goal={ready.goal} onPick={(n) => void activity.setGoal(n)} />
                </div>
              )}
            </section>
          )}
        </div>
        {account.state.status === 'signed-in' && <InterviewHistory />}
        <SoloHistory />
        <section aria-labelledby="progress-solved" className="mt-6">
          <h3 id="progress-solved" className="font-display text-lg font-bold text-ink">
            Problems solved
          </h3>
          {solved.length === 0 ? (
            <p className={`mt-2 p-4 text-sm text-ink/80 ${subCard}`}>
              None yet. Each one you solve is listed here, and adds {XP_PER_SOLVE} XP.{' '}
              <a href="#/" className="font-semibold text-ink underline underline-offset-2">
                Pick a problem
              </a>
            </p>
          ) : (
            <ul className={`mt-2 divide-y divide-ink/15 overflow-hidden text-sm ${subCard}`}>
              {solved.map((p) => (
                <li key={p.id}>
                  <a href={`#/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:bg-pop-yellow/25">
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{p.title}</span>
                    <DifficultyBadge difficulty={p.difficulty} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <BadgesSection badges={badges} />
    </main>
  );
}

/** The level, the XP to the next one, and the few numbers that matter; a new learner sees what earns XP instead of a row of zeros. */
function Summary({
  level,
  answer,
  streak,
  solved,
  interviewed,
  badges,
}: {
  level: ReturnType<typeof levelOf>;
  answer?: AchievementsAnswer;
  streak?: number;
  solved: number;
  interviewed: number;
  badges: ProfileBadge[];
}) {
  const earned = badges.filter((b) => b.earned).length;
  const fresh = level.xp === 0;
  return (
    <section aria-labelledby="level-title" className={`mt-6 overflow-hidden ${card} ${answer ? '' : 'opacity-60'}`}>
      <div className="h-1.5 border-b-bw-2 border-ink bg-pop-yellow" aria-hidden="true" />
      <div className="grid gap-x-8 gap-y-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0">
          <h2 id="level-title" className={`flex items-center gap-1.5 ${eyebrow}`}>
            <Sparkles size={13} aria-hidden="true" />
            Your level
          </h2>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <p className="font-display text-4xl font-extrabold tabular-nums text-ink" data-testid="level">
              Level {level.level}
            </p>
            <p className="font-display text-xl font-extrabold tabular-nums text-ink" data-testid="xp">
              {level.xp.toLocaleString('en-US')} XP
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={`Progress to level ${level.level + 1}`}
            aria-valuemin={level.floor}
            aria-valuemax={level.next}
            aria-valuenow={level.xp}
            className="mt-3 h-2.5 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
          >
            <div className="h-full bg-pop-yellow" style={{ width: `${Math.round(level.progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {(level.next - level.xp).toLocaleString('en-US')} XP to level {level.level + 1}
          </p>
          <details className="group mt-2 text-xs text-muted">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-ink/80 hover:text-ink [&::-webkit-details-marker]:hidden">
              How XP is earned
              <ChevronDown size={12} aria-hidden="true" className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
            </summary>
            <p className="mt-1">
              {XP_PER_SOLVE} per problem solved, {XP_PER_MASTERED_CARD} per card mastered (remembered for 21 days or more), {XP_PER_STREAK_DAY} per day of your longest streak, and per problem
              interviewed {XP_PER_INTERVIEW} with the interviewer or {XP_PER_SOLO_INTERVIEW} on your own.
            </p>
          </details>
        </div>

        {fresh ? (
          <div className="min-w-0 self-center rounded-sm border-bw-1 border-dashed border-ink/40 bg-paper p-4 text-sm text-ink/80">
            <p className="font-semibold text-ink">Nothing counted yet</p>
            <p className="mt-1">Solve your first problem for {XP_PER_SOLVE} XP. Problems, cards and mock interviews all add to your level, your skill map and your badges.</p>
          </div>
        ) : (
          <div className="min-w-0">
            <dl className={`grid grid-cols-2 gap-3 ${streak !== undefined ? '' : 'sm:grid-cols-3'}`}>
              {streak !== undefined && <Headline label="Streak" value={streak} unit={streak === 1 ? 'day' : 'days'} />}
              <Headline label="Problems solved" value={solved} unit={`of ${problems.length}`} />
              <Headline label="Interviews" value={interviewed} />
              <Headline label="Badges" value={earned} unit={`of ${badges.length}`} />
            </dl>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t-bw-1 border-dashed border-ink/30 pt-3 text-sm text-ink/80">
              <Small label="Cards reviewed" value={answer?.stats.reviews ?? 0} />
              <Small label="Cards mastered" value={answer?.stats.mastered ?? 0} />
              <Small label="Longest streak" value={answer?.stats.longestStreak ?? 0} unit={answer?.stats.longestStreak === 1 ? 'day' : 'days'} />
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

function Headline({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="min-w-0 rounded-sm border-bw-1 border-ink/25 bg-paper px-3 py-2">
      <dt className={`truncate ${eyebrow}`}>{label}</dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </dd>
    </div>
  );
}

function Small({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums text-ink">
        {value.toLocaleString('en-US')}
        {unit && <span className="ml-1 font-normal text-muted">{unit}</span>}
      </dd>
    </div>
  );
}

/** A streak or challenge total: a label, a number with its unit, an icon and a detail line. */
function Tile({ label, value, unit, icon, detail, testId }: { label: string; value: number; unit?: string; icon?: ReactNode; detail?: string; testId?: string }) {
  return (
    <div className="min-w-0">
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

interface Step {
  key: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  icon: typeof Layers;
}

/**
 * "What to do next": one primary step and at most two more. With the
 * ai_roadmap feature and picks made, the picks; otherwise the roadmap's next
 * problem (or the cards once it is done), the weakest topic, and a mock
 * interview until the first one (the cards after).
 */
function NextSteps({
  roadmap,
  stages,
  weakest,
  weakestMastery,
  topicTitle,
  interviewed,
}: {
  roadmap: RoadmapState;
  stages: RoadmapStage[];
  weakest?: string;
  weakestMastery: number;
  topicTitle: (id: string) => string;
  interviewed: number;
}) {
  const picksOn = useFeature('ai_roadmap').ok;
  const picks = useRoadmapNext(picksOn);
  const picked = picksOn && picks.status === 'ready' ? picks.next : null;

  const total = roadmap.steps.length;
  const stage = stages[roadmap.currentStage];
  let steps: Step[];
  if (picked && picked.picks.length > 0) {
    steps = picked.picks.slice(0, 3).map((p) => ({
      key: `${p.kind}:${p.id}`,
      title: pickTitle(p, titleOf),
      detail: p.reason,
      href: pickHref(p),
      cta: p.kind === 'problem' ? 'Open' : 'Review',
      icon: p.kind === 'problem' ? MapIcon : Layers,
    }));
  } else {
    const first: Step = roadmap.next
      ? {
          key: 'roadmap',
          title: `${roadmap.solved === 0 ? 'Start' : 'Continue'} the roadmap: ${titleOf(roadmap.next.id)}`,
          detail: `${roadmap.solved} of ${total} solved${stage ? ` · Stage ${roadmap.currentStage + 1}, ${stage.title}` : ''}`,
          href: roadmapHref(roadmap.next.id),
          cta: roadmap.solved === 0 ? 'Start' : 'Continue',
          icon: MapIcon,
        }
      : {
          key: 'cards',
          title: 'Review today’s cards',
          detail: 'Spaced review keeps what you learned, a few minutes a day.',
          href: '#/review',
          cta: 'Review',
          icon: Layers,
        };
    const train: Step | undefined = weakest
      ? {
          key: 'train',
          title: `${weakestMastery > 0 ? 'Train' : 'Learn'} ${topicTitle(weakest)}`,
          detail: weakestMastery > 0 ? `Your weakest topic, at ${percent(weakestMastery)}%.` : 'A first topic to learn, with its cards.',
          href: `#/review/${weakest}`,
          cta: 'Train',
          icon: Dumbbell,
        }
      : undefined;
    const interview: Step = {
      key: 'interview',
      title: 'Try a mock interview',
      detail: 'A problem against the clock, from questions to design.',
      href: setupHref(),
      cta: 'Start',
      icon: Mic,
    };
    const cards: Step = {
      key: 'cards',
      title: 'Review cards',
      detail: 'Spaced review keeps what you learned.',
      href: '#/review',
      cta: 'Review',
      icon: Layers,
    };
    const more = [train, interviewed === 0 ? interview : first.key === 'cards' ? interview : cards].filter((s): s is Step => !!s);
    steps = [first, ...more].slice(0, 3);
  }
  const [primary, ...rest] = steps;

  return (
    <section aria-labelledby="next-title" className="mt-12" data-testid="next-steps">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="next-title" className={sectionTitle}>
          What to do next
        </h2>
        {picked && <p className="text-sm text-muted">Picked after your last {picked.source === 'interview' ? 'mock interview' : 'in-depth review'}</p>}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <a
          href={primary.href}
          data-testid="next-primary"
          className={`group flex flex-col gap-3 p-4 sm:p-5 ${card} bg-pop-yellow/15 transition-shadow duration-d1 hover:shadow-brutal-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue`}
        >
          <span className={`flex items-center gap-1.5 ${eyebrow}`}>
            <primary.icon size={13} aria-hidden="true" />
            Recommended
          </span>
          <span className="font-display text-xl font-extrabold leading-tight text-ink">{primary.title}</span>
          <span className="text-sm text-ink/80">{primary.detail}</span>
          {primary.key === 'roadmap' && total > 0 && (
            <span
              role="progressbar"
              aria-label="Roadmap progress"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={roadmap.solved}
              className="block h-2 overflow-hidden rounded-full border-bw-1 border-ink bg-paper"
            >
              <span className="block h-full bg-pass" style={{ width: `${(roadmap.solved / total) * 100}%` }} />
            </span>
          )}
          <span className={`mt-auto self-start ${primaryButton}`}>
            {primary.cta}
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </a>
        {rest.length > 0 && (
          <ul className="grid gap-3">
            {rest.map((s) => (
              <li key={s.key}>
                <a
                  href={s.href}
                  className={`group flex h-full items-start gap-3 p-3.5 ${subCard} transition-colors duration-d1 hover:bg-pop-yellow/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue`}
                >
                  <s.icon size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug text-ink group-hover:underline">{s.title}</span>
                    <span className="mt-0.5 block text-sm text-ink/80">{s.detail}</span>
                  </span>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-ink" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The cards reviewed and problems solved per week; before any, what fills it. */
/** `wide`: alone on its row, so it takes the whole width. */
function WeeklyCard({ activity, wide }: { activity?: Extract<Activity['state'], { status: 'ready' }>; wide: boolean }) {
  const weeks = activity ? weeklyTotals(activity.days, activity.today) : undefined;
  const any = weeks?.some((w) => w.reviews > 0 || w.solves > 0);
  return (
    <section aria-labelledby="weekly-title" className={`p-4 sm:p-5 ${subCard} ${wide ? 'md:col-span-2' : ''}`}>
      <h3 id="weekly-title" className={eyebrow}>
        Last 12 weeks
      </h3>
      {weeks && any ? (
        <div className="mt-3">
          <WeeklyActivity weeks={weeks} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink/80">Your cards reviewed and problems solved, week by week, show up here once you start.</p>
      )}
    </section>
  );
}

/** Earned badges first as a compact grid, the next three to earn, and every badge on demand. */
function BadgesSection({ badges }: { badges: ProfileBadge[] }) {
  const [all, setAll] = useState(false);
  const earned = badges.filter((b) => b.earned);
  const next = nextBadges(badges);
  const shown = all ? [...earned, ...badges.filter((b) => !b.earned)] : earned;
  return (
    <section aria-labelledby="badges-title" className="mt-12">
      <h2 id="badges-title" className={sectionTitle}>
        Badges
      </h2>
      <div className={`mt-3 p-4 sm:p-5 ${card}`}>
        {shown.length > 0 ? (
          <BadgeGrid badges={shown} of={badges.length} headingLevel={3} label={all ? 'All badges' : 'Earned'} />
        ) : (
          <p className="text-sm text-ink/80">No badges yet: your first review or solve earns one. These are the closest:</p>
        )}
        {next.length > 0 && (
          <div className={shown.length > 0 ? 'mt-5 border-t-bw-1 border-dashed border-ink/30 pt-4' : 'mt-3'}>
            {shown.length > 0 && <h3 className={eyebrow}>Next to earn</h3>}
            <ul className={`grid gap-3 sm:grid-cols-3 ${shown.length > 0 ? 'mt-2' : ''}`}>
              {next.map((b) => (
                <li key={b.id} data-next-badge={b.id} className="flex items-start gap-3 rounded-sm border-bw-1 border-ink/25 bg-paper p-3">
                  <AchievementIcon icon={b.icon} tier={b.tier} earned={false} />
                  <div className="min-w-0">
                    <p className="font-semibold leading-tight text-ink">{b.title}</p>
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
          </div>
        )}
        {earned.length < badges.length && (
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className={`mt-4 ${outlineButton}`}>
            <ChevronDown size={14} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${all ? 'rotate-180' : ''}`} />
            {all ? 'Show earned only' : `Show all ${badges.length}`}
          </button>
        )}
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
      <p className="mt-1 max-w-2xl text-sm text-ink/80">Signed in, your reviews and solves build a skill map of every topic, an interview-ready score and badges, kept across devices.</p>
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
