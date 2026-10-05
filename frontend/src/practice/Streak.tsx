import { useEffect, useRef, type ReactNode } from 'react';
import { CalendarCheck, Flame, LogIn, Snowflake, X } from 'lucide-react';
import { GOAL_CHOICES, type DailyGoal, type Streak, type WeeklyRecap } from '../learn/streak';
import { celebrate } from '../design/celebrate';
import { eyebrow, primaryButton, toolButton } from '../components/Playground/ui';
import { PROVIDER_LABEL } from './account';
import type { Account } from './useAccount';

/**
 * The daily goal and streak on the page (src/learn/streak.ts): the streak
 * widget, the goal picker, the weekly recap and the sign-in invitation shown
 * instead of a streak when signed out.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "7-day streak", or how to start one. */
const streakLabel = (days: number) => (days > 0 ? `${days}-day streak` : 'No streak yet');

/** What today still needs, or that it is done. */
function goalLabel(streak: Streak, goal: DailyGoal): string {
  if (streak.todayDone) return 'Today’s goal is met';
  return `${streak.today.reviews} of ${goal.reviews} cards today${goal.solves > 0 ? ', or solve a problem' : ''}`;
}

/** A ring filling up toward today's goal, around `children`. */
function GoalRing({ progress, done, children }: { progress: number; done: boolean; children: ReactNode }) {
  const r = 17;
  const length = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-11 w-11 flex-shrink-0 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="5" className="stroke-ink/15" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, Math.max(0, progress)))}
          className={`${done ? 'stroke-pass' : 'stroke-pop-yellow'} motion-safe:transition-[stroke-dashoffset] motion-safe:duration-d3`}
        />
      </svg>
      {children}
    </span>
  );
}

/**
 * The streak at a glance: a flame and its length, a ring toward today's
 * goal and the freezes held. `compact` drops the goal line, for tight rows.
 */
export function StreakWidget({ streak, goal, compact = false }: { streak: Streak; goal: DailyGoal; compact?: boolean }) {
  const lit = streak.current > 0 || streak.todayDone;
  return (
    <div role="group" aria-label="Daily streak" className="inline-flex max-w-full items-center gap-3 rounded-brutal border-bw-2 border-ink bg-surface px-3 py-2 shadow-brutal-sm">
      <GoalRing progress={streak.todayProgress} done={streak.todayDone}>
        <Flame size={20} className={lit ? 'fill-pop-yellow text-ink' : 'text-muted'} />
      </GoalRing>
      <div className="min-w-0">
        <p className="font-display text-lg font-extrabold leading-tight text-ink" data-streak={streak.current}>
          {streakLabel(streak.current)}
        </p>
        {!compact && <p className="text-xs text-ink/75">{goalLabel(streak, goal)}</p>}
        {/* The ring is drawn for the eye; this says the same for screen readers. */}
        {compact && <span className="sr-only">{goalLabel(streak, goal)}</span>}
      </div>
      {streak.freezes > 0 && (
        <span
          className="ml-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full border-bw-1 border-ink bg-pop-blue/20 px-2 py-0.5 text-xs font-bold tabular-nums text-ink"
          title="A streak freeze covers a missed day. You earn one for every 7 days in a row, and hold up to 2."
        >
          <Snowflake size={12} aria-hidden="true" />
          {plural(streak.freezes, 'freeze')}
        </span>
      )}
    </div>
  );
}

/** Picks the daily goal, cards a day; a solved problem meets any of them. */
export function GoalPicker({ goal, onPick }: { goal: DailyGoal; onPick: (cards: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span id="goal-picker" className={eyebrow}>
        Daily goal
      </span>
      <div role="radiogroup" aria-labelledby="goal-picker" className="inline-flex overflow-hidden rounded border-bw-1 border-ink shadow-brutal-sm">
        {GOAL_CHOICES.map((n) => {
          const on = n === goal.reviews;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${n} cards a day`}
              onClick={() => onPick(n)}
              className={`min-h-[36px] min-w-[44px] border-l-bw-1 border-ink px-2.5 text-sm font-bold tabular-nums first:border-l-0 ${on ? 'bg-ink text-paper' : 'bg-surface text-ink hover:bg-pop-yellow/30'}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted">cards a day, or one problem solved</span>
    </div>
  );
}

/** Signed out with accounts on: what a streak needs, and the way in. */
export function StreakInvite({ account, compact = false }: { account: Account; compact?: boolean }) {
  const providers = account.state.status === 'signed-out' ? account.state.providers : [];
  return (
    <div role="group" aria-label="Daily streak" className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-brutal border-bw-2 border-dashed border-ink/60 bg-surface px-3 py-2">
      <Flame size={20} className="flex-shrink-0 text-muted" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        <strong>Keep a daily streak.</strong>
        {!compact && ' Sign in to set a daily goal, count your streak and keep it on every device.'}
      </p>
      {providers.slice(0, 1).map((p) => (
        <button key={p} type="button" onClick={() => account.signIn(p)} className={`min-h-[40px] ${primaryButton}`}>
          <LogIn size={14} aria-hidden="true" />
          {providers.length > 1 ? 'Sign in' : `Sign in with ${PROVIDER_LABEL[p]}`}
        </button>
      ))}
    </div>
  );
}

const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`));

/** Last week's totals, Monday to Sunday, until dismissed. */
export function WeeklyRecapCard({ recap, onDismiss }: { recap: WeeklyRecap; onDismiss: () => void }) {
  const items: [string, number | string][] = [
    ['Cards reviewed', recap.reviews],
    ['New cards learned', recap.newCards],
    ['Problems solved', recap.solves],
    ['Goal days', `${recap.goalDays} of 7`],
    ['Streak', streakLabel(recap.streak).replace('No streak yet', '0 days')],
  ];
  return (
    <section aria-labelledby="weekly-recap" className="mt-6 overflow-hidden rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
      <div className="h-2 bg-pop-lilac border-b-bw-2 border-ink" aria-hidden="true" />
      <div className="p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={eyebrow}>
              {shortDay(recap.start)} – {shortDay(recap.end)}
            </p>
            <h2 id="weekly-recap" className="mt-0.5 flex items-center gap-2 font-display text-xl font-bold text-ink">
              <CalendarCheck size={18} aria-hidden="true" />
              Your week in review
            </h2>
          </div>
          <button type="button" onClick={onDismiss} className={`-mr-2 -mt-1 ${toolButton}`} aria-label="Dismiss the weekly recap">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
          {items.map(([label, value]) => (
            <div key={label}>
              <dt className={eyebrow}>{label}</dt>
              <dd className="font-display text-xl font-extrabold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-ink/80">{recapLine(recap)}</p>
      </div>
    </section>
  );
}

/** One encouraging sentence about a week. */
function recapLine(recap: WeeklyRecap): string {
  if (recap.goalDays === 7) return 'Every day of the week met your goal. Keep it going.';
  if (recap.goalDays >= 4) return 'Most days met your goal: steady practice is what makes it stick.';
  if (recap.reviews > 0 || recap.solves > 0) return 'A start. A few cards a day keep what you learned fresh.';
  return 'A quiet week. Today is a good day to start again.';
}

/**
 * A moment worth marking: the burst of confetti (none under reduced motion)
 * from `children`'s box when it first shows, and the text read out politely.
 */
export function Celebration({ label, tone = 'bg-pass/25', className = '', children }: { label: string; tone?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (ref.current) void celebrate(ref.current, { count: 24 });
  }, []);
  return (
    <section
      ref={ref}
      aria-label={label}
      aria-live="polite"
      className={`rounded-brutal border-bw-2 border-ink p-4 shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)] ${tone} ${className}`}
    >
      {children}
    </section>
  );
}
