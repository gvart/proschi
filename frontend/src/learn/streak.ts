/**
 * Daily goal and streak: pure functions over what a user did each local day,
 * so the practice page, the Worker and a mobile app compute the same streak
 * from the same history.
 *
 * A day **counts** when it meets the daily goal: `goal.reviews` cards
 * reviewed, or `goal.solves` problems solved. The streak is the run of
 * counting days up to today (today may still be in progress: a streak that
 * counted yesterday is still alive). Every `FREEZE_EVERY` counting days in a
 * row earn a **freeze**, up to `MAX_FREEZES` held at once; a missed day uses
 * one automatically and the streak survives it (the frozen day does not add
 * to its length).
 *
 * Also the goals a user can pick, the milestones worth a celebration and the
 * weekly recap. Pure TypeScript with no browser or React dependency, like
 * review.ts, whose day helpers it shares.
 */

import { daysBetween, isDay, localDay as reviewLocalDay, type CardReview } from './review';

export { daysBetween, isDay };

/** A calendar day in the user's own time zone, `YYYY-MM-DD`. */
export type Day = string;

export interface DayActivity {
  day: Day;
  /** Cards reviewed that day. */
  reviews: number;
  /** Problems solved for the first time that day. */
  solves: number;
  /** Of `reviews`, the first reviews of a card (or of its new version): cards learned that day. */
  newCards?: number;
}

export interface DailyGoal {
  reviews: number;
  solves: number;
}

/** 10 cards or 1 problem a day. */
export const DEFAULT_GOAL: DailyGoal = { reviews: 10, solves: 1 };
/** Goals a user can pick, by cards per day; any solve also meets each of them. */
export const GOAL_CHOICES = [5, 10, 20, 30];
export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;
/** Streak lengths worth a celebration. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100];
/** How far back the API answers activity (GET /api/me/activity): longer streaks are counted from this window only. */
export const ACTIVITY_DAYS = 400;

/** Whether `n` is one of GOAL_CHOICES. */
export function isGoalChoice(n: unknown): n is number {
  return typeof n === 'number' && GOAL_CHOICES.includes(n);
}

/** The goal of a user who picked `cards` a day (DEFAULT_GOAL for anything not in GOAL_CHOICES): that many cards, or one problem solved. */
export function goalFor(cards: unknown): DailyGoal {
  return isGoalChoice(cards) ? { reviews: cards, solves: 1 } : DEFAULT_GOAL;
}

/** The milestone a streak reached going from `before` to `after` days, if it crossed one. */
export function milestoneReached(before: number, after: number): number | undefined {
  return [...STREAK_MILESTONES].reverse().find((m) => before < m && after >= m);
}

export interface Streak {
  /** Counting days in the current streak (frozen days not included). */
  current: number;
  longest: number;
  /** Freezes held now. */
  freezes: number;
  /** Days a freeze covered in the current streak, oldest first. */
  frozen: Day[];
  /** Whether today already meets the goal. */
  todayDone: boolean;
  /** Today's activity so far. */
  today: DayActivity;
  /** Today's progress toward the goal, 0–1 (the better of cards and solves). */
  todayProgress: number;
}

/** The local calendar day of `date` (default now) on this device. */
export function localDay(date: Date = new Date()): Day {
  return reviewLocalDay(date);
}

/** `day` moved by `n` days (negative goes back). */
export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function meetsGoal(activity: Pick<DayActivity, 'reviews' | 'solves'>, goal: DailyGoal = DEFAULT_GOAL): boolean {
  return activity.reviews >= goal.reviews || (goal.solves > 0 && activity.solves >= goal.solves);
}

export function goalProgress(activity: Pick<DayActivity, 'reviews' | 'solves'>, goal: DailyGoal = DEFAULT_GOAL): number {
  const cards = goal.reviews > 0 ? activity.reviews / goal.reviews : 0;
  const solves = goal.solves > 0 ? activity.solves / goal.solves : 0;
  return Math.min(1, Math.max(cards, solves));
}

const count = (n: number | undefined) => Math.max(0, (n ?? 0) | 0);

/** Sums activity by day (several entries for one day add up), dropping malformed days. */
export function byDay(activity: DayActivity[]): Map<Day, DayActivity> {
  const out = new Map<Day, DayActivity>();
  for (const a of activity) {
    if (!isDay(a.day)) continue;
    const prev = out.get(a.day) ?? { day: a.day, reviews: 0, solves: 0, newCards: 0 };
    out.set(a.day, {
      day: a.day,
      reviews: prev.reviews + count(a.reviews),
      solves: prev.solves + count(a.solves),
      newCards: (prev.newCards ?? 0) + count(a.newCards),
    });
  }
  return out;
}

/**
 * The streak as of `today`, replaying every day from the first activity.
 * Activity after `today` (a device clock ahead) is ignored.
 */
export function computeStreak(activity: DayActivity[], today: Day, goal: DailyGoal = DEFAULT_GOAL): Streak {
  const days = byDay(activity);
  const todayActivity = days.get(today) ?? { day: today, reviews: 0, solves: 0, newCards: 0 };
  const todayDone = meetsGoal(todayActivity, goal);
  const counting = [...days.values()].filter((a) => a.day <= today && meetsGoal(a, goal)).map((a) => a.day).sort();

  let current = 0;
  let longest = 0;
  let freezes = 0;
  let run = 0; // counting days in a row, for earning freezes
  let frozen: Day[] = [];
  let last: Day | undefined;
  for (const day of counting) {
    if (last !== undefined) {
      const missed = daysBetween(last, day) - 1;
      if (missed > 0 && missed <= freezes) {
        freezes -= missed;
        for (let i = 1; i <= missed; i++) frozen.push(addDays(last, i));
        run = 0;
      } else if (missed > 0) {
        current = 0;
        run = 0;
        freezes = 0;
        frozen = [];
      }
    }
    current++;
    run++;
    if (run % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    longest = Math.max(longest, current);
    last = day;
  }

  // Days missed between the last counting day and today: today itself may still count, so only days before it are missed.
  if (last !== undefined && last !== today) {
    const missed = daysBetween(last, today) - 1;
    if (missed > freezes) {
      current = 0;
      frozen = [];
      freezes = 0;
    } else if (missed > 0) {
      freezes -= missed;
      for (let i = 1; i <= missed; i++) frozen.push(addDays(last, i));
    }
  }

  return { current, longest, freezes, frozen, todayDone, today: todayActivity, todayProgress: goalProgress(todayActivity, goal) };
}

/** Activity with `add` counted on `day` too, e.g. a session's reviews before the server has them. */
export function withActivity(activity: DayActivity[], add: DayActivity): DayActivity[] {
  return [...byDay([...activity, add]).values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The server's activity with the reviews it does not have yet (a device's
 * outbox) added to their days, so the streak counts them before they are
 * sent, as the session summary does. Each review counts once, by id; those
 * in `sent` (answered by the server, whose day counts then include them)
 * are left out, so none counts twice. Pending reviews add to `reviews`
 * only: telling a card's first review needs its state.
 */
export function withPendingReviews(activity: DayActivity[], pending: readonly CardReview[], sent: ReadonlySet<string> = new Set()): DayActivity[] {
  const seen = new Set(sent);
  const added: DayActivity[] = [];
  for (const r of pending) {
    if (seen.has(r.id) || !isDay(r.day)) continue;
    seen.add(r.id);
    added.push({ day: r.day, reviews: 1, solves: 0 });
  }
  return added.length ? [...byDay([...activity, ...added]).values()].sort((a, b) => a.day.localeCompare(b.day)) : activity;
}

/** The Monday of `day`'s week. */
export function weekStart(day: Day): Day {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** A week's totals, Monday to Sunday. */
export interface WeeklyRecap {
  /** The Monday. */
  start: Day;
  /** The Sunday. */
  end: Day;
  reviews: number;
  /** Cards reviewed for the first time. */
  newCards: number;
  solves: number;
  /** Days that met the goal. */
  goalDays: number;
  /** The streak as of the Sunday. */
  streak: number;
}

/** The recap of the week before `today`'s (the last full Monday–Sunday week). */
export function weeklyRecap(activity: DayActivity[], today: Day, goal: DailyGoal = DEFAULT_GOAL): WeeklyRecap {
  const end = addDays(weekStart(today), -1);
  const start = addDays(end, -6);
  const week = [...byDay(activity).values()].filter((a) => a.day >= start && a.day <= end);
  return {
    start,
    end,
    reviews: week.reduce((n, a) => n + a.reviews, 0),
    newCards: week.reduce((n, a) => n + (a.newCards ?? 0), 0),
    solves: week.reduce((n, a) => n + a.solves, 0),
    goalDays: week.filter((a) => meetsGoal(a, goal)).length,
    streak: computeStreak(activity, end, goal).current,
  };
}

/** Whether a recap has anything to show. */
export const recapIsEmpty = (r: WeeklyRecap) => r.reviews === 0 && r.solves === 0 && r.streak === 0;

/**
 * Each day's reviews and new cards from a whole review log (a review is new
 * when it is the first of its card at its version or a higher one, as
 * review.ts's dayCounts and the API count them).
 */
export function activityFromLog(log: readonly CardReview[]): DayActivity[] {
  const seen = new Map<string, number>();
  const days = new Map<Day, DayActivity>();
  for (const r of [...log].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    const isFirst = (seen.get(r.cardId) ?? 0) < r.version;
    if (isFirst) seen.set(r.cardId, r.version);
    const day = days.get(r.day) ?? { day: r.day, reviews: 0, solves: 0, newCards: 0 };
    day.reviews++;
    if (isFirst) day.newCards = (day.newCards ?? 0) + 1;
    days.set(r.day, day);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Each day's solves from the day each problem was first solved, `{[problem id]: day}`. */
export function activityFromSolves(solvedOn: Record<string, Day>): DayActivity[] {
  return [...byDay(Object.values(solvedOn).map((day) => ({ day, reviews: 0, solves: 1 }))).values()].sort((a, b) => a.day.localeCompare(b.day));
}
