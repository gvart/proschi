import { Suspense, lazy, useMemo, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, Flame, Gamepad2, Layers, ListChecks, Play, Briefcase, Sparkles, X, Zap, type LucideIcon } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import type { Progress } from '../progress';
import type { Account } from '../useAccount';
import type { ContinueTarget } from './continue';
import { GOALS, setGoal, wantsInterview, wantsStreak, type Goal, type GoalState } from './goal';
import NextSteps from './NextSteps';
import { useTodayCards, type TodayCards } from './todayCards';
import { mockInterviewHref } from './tabs';
import { useChallengeStatus, useDailyRunStatus, type Played } from './todayStatus';

/**
 * What the practice home (`#/`) shows between its intro and the problem list,
 * all of it optional and decided by the visitor's goal (goal.ts):
 *
 * - the first time, a skippable "What are you here for?" (never a wall: the
 *   list is right under it);
 * - at most one "Continue" line: the last problem left unsolved, or for
 *   interview prep the roadmap's next step, with the roadmap and the mock
 *   interview beside it;
 * - for a daily habit (or the streak switched on), one line with the streak
 *   and today's review, challenge and Arcade run;
 * - once something was started, "Your next steps" (RuleSteps.tsx): up to
 *   three things to do next, each with its reason, never the Continue problem,
 *   nor (with the habit line) today's review or challenge.
 *
 * Solving problems, or no answer, adds nothing else but the Continue line and the next steps.
 */

// The due count needs the whole deck: loaded after the line shows.
const DueCards = lazy(() => import('./DueCards'));

const HABIT_KINDS = ['review', 'challenge'] as const;

const GOAL_ICON: Record<Goal, LucideIcon> = { solve: ListChecks, interview: Briefcase, habit: Flame };
const GOAL_ABOUT: Record<Goal, string> = {
  solve: 'Just the problems',
  interview: 'A roadmap and mock interviews',
  habit: 'A streak and a few minutes a day',
};

const textLink = 'font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue rounded-sm';

export default function HomeExtras({
  goal,
  account,
  next,
  nextTitle,
  streak,
  ask = !goal.asked,
  steps,
}: {
  goal: GoalState;
  account: Account;
  /** Where "Continue" leads, if anywhere (PracticeApp asks for the roadmap's next step only for interview prep). */
  next?: ContinueTarget;
  nextTitle?: string;
  /** The compact streak, or the way to start one, as PracticeApp builds it. */
  streak?: ReactNode;
  /** Whether to ask "What are you here for?" (goal.ts asksGoal: not while an announcement is on the page). */
  ask?: boolean;
  /** What "Your next steps" needs beyond the account; none hides them. */
  steps?: { progress: Progress; skills?: readonly { topic: string; mastery: number }[]; streak?: number };
}) {
  const interview = wantsInterview(goal);
  const nextId = next?.id;
  const exclude = useMemo(() => (nextId ? [nextId] : undefined), [nextId]);
  const habit = wantsStreak(goal);
  const showSteps = !!steps && Object.keys(steps.progress).length > 0;
  // One load of the card states (one request signed in) for the Review chip and the next steps.
  const cards = useTodayCards(account, habit || showSteps);
  return (
    <>
      {ask && <GoalPrompt goal={goal} />}
      {(next || interview) && <ContinueLine next={next} title={nextTitle} interview={interview} />}
      {habit && <HabitLine account={account} streak={streak} cards={cards} />}
      {steps && showSteps && cards && (
        <NextSteps
          account={account}
          {...steps}
          cards={cards}
          exclude={exclude}
          // The habit line offers today's review and challenge already.
          omit={habit ? HABIT_KINDS : undefined}
          limit={3}
          render={(list) =>
            list && (
              <section aria-labelledby="home-next-steps" className="mt-5 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-sm" data-testid="home-next-steps">
                <h2 id="home-next-steps" className={`flex items-center gap-1.5 ${eyebrow}`}>
                  <Sparkles size={13} aria-hidden="true" />
                  Your next steps
                </h2>
                <div className="mt-3">{list}</div>
              </section>
            )
          }
        />
      )}
    </>
  );
}

/** "Interview prep, Daily habit · Change" (or "Personalize") beside the solved count, once the question was answered or skipped. */
export function GoalSummary({ goal }: { goal: GoalState }) {
  if (!goal.asked) return null;
  const names = GOALS.filter((g) => goal.goals.includes(g.id)).map((g) => g.short);
  const reopen = () => setGoal((g) => ({ ...g, asked: false }));
  return (
    <p className="text-sm text-muted">
      {names.length > 0 && <>Your focus: {names.join(', ')} · </>}
      <button type="button" onClick={reopen} className={textLink}>
        {names.length ? 'Change' : 'Personalize this page'}
      </button>
    </p>
  );
}

/** The one-time question: pick any of the goals, or skip it. Choices apply at once; "Done" or the close button puts it away. */
function GoalPrompt({ goal }: { goal: GoalState }) {
  const toggle = (id: Goal) => setGoal((g) => ({ ...g, goals: g.goals.includes(id) ? g.goals.filter((x) => x !== id) : [...g.goals, id] }));
  const done = () => setGoal((g) => ({ ...g, asked: true }));
  return (
    <section aria-labelledby="goal-title" className="mt-5 rounded-brutal border-bw-2 border-ink bg-surface p-4 shadow-brutal-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="goal-title" className="font-display text-lg font-extrabold leading-tight text-ink">
            What are you here for?
          </h2>
          <p className="mt-0.5 text-sm text-muted">Pick any. It only changes what shows around the problems; change it any time.</p>
        </div>
        <button type="button" onClick={done} aria-label="Skip the question" className="-mr-1.5 -mt-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-ink/70 hover:bg-ink/5 hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div role="group" aria-labelledby="goal-title" className="mt-3 grid gap-2 sm:grid-cols-3">
        {GOALS.map(({ id, label }) => {
          const Icon = GOAL_ICON[id];
          const on = goal.goals.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={`flex items-start gap-2.5 rounded-sm border-bw-2 px-3 py-2.5 text-left transition-colors duration-d1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue ${on ? 'border-ink bg-pop-yellow text-on-accent' : 'border-ink/25 bg-paper text-ink hover:border-ink'}`}
            >
              <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-tight">{label}</span>
                <span className={`block text-xs ${on ? 'opacity-80' : 'text-muted'}`}>{GOAL_ABOUT[id]}</span>
              </span>
              <span aria-hidden="true" className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-bw-1 ${on ? 'border-on-accent bg-on-accent text-pop-yellow' : 'border-ink/40'}`}>
                {on && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={done}
          className="inline-flex min-h-[36px] items-center rounded-sm border-bw-1 border-ink bg-ink px-3 text-sm font-bold text-paper hover:bg-ink/85 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
        >
          {goal.goals.length ? 'Done' : 'Skip'}
        </button>
        <span className="text-xs text-muted">Kept in this browser.</span>
      </div>
    </section>
  );
}

/** The one Continue line; for interview prep, the roadmap and the mock interview beside it. */
function ContinueLine({ next, title, interview }: { next?: ContinueTarget; title?: string; interview: boolean }) {
  return (
    <section aria-label="Continue" className="mt-5 rounded-brutal border-bw-2 border-ink bg-surface px-3 py-2.5 shadow-brutal-sm">
      {next && (
        <a href={next.href} className="group flex items-center gap-3 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-pop-yellow text-on-accent">
            {next.kind === 'last' ? <Play size={15} aria-hidden="true" /> : <CalendarDays size={15} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block ${eyebrow}`}>{next.kind === 'last' ? 'Pick up where you left off' : 'Next on the roadmap'}</span>
            <span className="block truncate font-display text-base font-extrabold leading-tight text-ink">{title ?? next.id}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-ink group-hover:underline">
            Continue
            <ArrowRight size={14} aria-hidden="true" />
          </span>
        </a>
      )}
      {interview && (
        <p className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/80 ${next ? 'mt-2 border-t-bw-1 border-dashed border-ink/25 pt-2' : ''}`}>
          <span className={`max-sm:hidden ${eyebrow}`}>Interview prep</span>
          <a href="#/roadmap" className={textLink}>
            See the roadmap
          </a>
          <a href={mockInterviewHref()} className={textLink}>
            Start a mock interview
          </a>
        </p>
      )}
    </section>
  );
}

const chip =
  'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border-bw-1 border-ink/30 bg-surface px-2.5 py-0.5 text-sm font-semibold text-ink hover:border-ink hover:bg-pop-yellow/30 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue';

function Chip({ href, icon: Icon, label, children }: { href: string; icon: LucideIcon; label: string; children?: ReactNode }) {
  return (
    <a href={href} className={chip}>
      <Icon size={14} aria-hidden="true" />
      {label}
      {children && <span className="font-normal text-ink/75">· {children}</span>}
    </a>
  );
}

/** "· 540" once played (with a check), nothing while unknown or not played yet. */
function PlayedNote({ played }: { played: Played }) {
  if (played.status !== 'ready' || !played.played) return null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Check size={13} aria-hidden="true" className="text-pass" />
      {typeof played.score === 'number' ? played.score.toLocaleString('en-US') : 'played'}
    </span>
  );
}

/** The daily habit's line: the streak, then today's review, challenge and Arcade run. */
function HabitLine({ account, streak, cards }: { account: Account; streak?: ReactNode; cards?: TodayCards }) {
  const challenge = useChallengeStatus(account);
  const daily = useDailyRunStatus(account);
  return (
    <section aria-label="Today" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      {streak}
      <nav aria-label="Also today" className="flex flex-wrap gap-2">
        <Chip href="#/review" icon={Layers} label="Review">
          <Suspense fallback={<span className="text-muted">…</span>}>
            <DueCards today={cards} />
          </Suspense>
        </Chip>
        <Chip href="#/challenge" icon={Zap} label="Challenge">
          {challenge.status === 'ready' && challenge.played && <PlayedNote played={challenge} />}
        </Chip>
        <Chip href="#/arcade/daily" icon={Gamepad2} label="Arcade run">
          {daily.status === 'ready' && daily.played && <PlayedNote played={daily} />}
        </Chip>
      </nav>
    </section>
  );
}
