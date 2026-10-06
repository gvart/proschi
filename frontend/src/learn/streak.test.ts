import { describe, expect, it } from 'vitest';
import type { CardReview } from './review';
import {
  activityFromLog,
  activityFromPlay,
  activityFromSolves,
  byDay,
  addDays,
  computeStreak,
  DEFAULT_GOAL,
  daysBetween,
  goalFor,
  goalProgress,
  isDay,
  isGoalChoice,
  localDay,
  meetsGoal,
  milestoneReached,
  recapIsEmpty,
  weeklyRecap,
  weekStart,
  withActivity,
  withPendingReviews,
  type DayActivity,
} from './streak';

const T = '2026-10-20';
/** 10 reviews on each of `n` days ending `end` days before T (0 = today). */
const run = (n: number, end = 0, reviews = 10): DayActivity[] => Array.from({ length: n }, (_, i) => ({ day: addDays(T, -end - i), reviews, solves: 0 }));

describe('days', () => {
  it('validates, moves and measures calendar days', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('26-2-1')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-20')).toBe(19);
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('goal', () => {
  it('is met by enough reviews or a solve', () => {
    expect(meetsGoal({ reviews: 9, solves: 0 })).toBe(false);
    expect(meetsGoal({ reviews: 10, solves: 0 })).toBe(true);
    expect(meetsGoal({ reviews: 0, solves: 1 })).toBe(true);
    expect(goalProgress({ reviews: 5, solves: 0 })).toBe(0.5);
    expect(goalProgress({ reviews: 50, solves: 0 })).toBe(1);
  });
});

describe('any daily practice meets the goal', () => {
  it('a completed daily challenge or a finished Arcade run meets any goal on its own', () => {
    for (const goal of [goalFor(5), goalFor(10), goalFor(30)]) {
      expect(meetsGoal({ reviews: 0, solves: 0, challenges: 1 }, goal)).toBe(true);
      expect(meetsGoal({ reviews: 0, solves: 0, runs: 1 }, goal)).toBe(true);
      expect(goalProgress({ reviews: 2, solves: 0, challenges: 1 }, goal)).toBe(1);
      expect(goalProgress({ reviews: 0, solves: 0, runs: 3 }, goal)).toBe(1);
    }
    // Nothing played: as before.
    expect(meetsGoal({ reviews: 9, solves: 0, challenges: 0, runs: 0 })).toBe(false);
    expect(goalProgress({ reviews: 5, solves: 0, challenges: 0, runs: 0 })).toBe(0.5);
  });

  it('counts each kind of practice toward one streak, with freezes and milestones as before', () => {
    const days: DayActivity[] = [
      { day: addDays(T, -7), reviews: 10, solves: 0 }, // cards
      { day: addDays(T, -6), reviews: 0, solves: 1 }, // a solve
      ...activityFromPlay({ challenges: [addDays(T, -5), addDays(T, -3)], runs: [addDays(T, -4), addDays(T, -2), addDays(T, -2)] }),
      { day: addDays(T, -1), reviews: 3, solves: 0, challenges: 1 }, // 3 cards would not do; the challenge does
    ];
    expect(computeStreak(days, T)).toMatchObject({ current: 7, longest: 7, freezes: 1, todayDone: false, todayProgress: 0 });
    // Today's run keeps it going and crosses no milestone between 7 and 8.
    const today = computeStreak([...days, ...activityFromPlay({ runs: [T] })], T);
    expect(today).toMatchObject({ current: 8, todayDone: true, todayProgress: 1 });
    expect(milestoneReached(7, today.current)).toBeUndefined();
    // A missed day after it is covered by the freeze the 7 days earned.
    expect(computeStreak([...days, ...activityFromPlay({ runs: [addDays(T, 1)] })], addDays(T, 1))).toMatchObject({ current: 8, frozen: [T] });
  });

  it('adds up challenges and runs by day, leaving them out of days without any', () => {
    expect(activityFromPlay({ challenges: [T, 'not a day'], runs: [T, addDays(T, -1), T] })).toEqual([
      { day: addDays(T, -1), reviews: 0, solves: 0, newCards: 0, runs: 1 },
      { day: T, reviews: 0, solves: 0, newCards: 0, challenges: 1, runs: 2 },
    ]);
    expect([...byDay([{ day: T, reviews: 2, solves: 0 }, { day: T, reviews: 1, solves: 0, challenges: 0, runs: -3 }]).values()]).toEqual([
      { day: T, reviews: 3, solves: 0, newCards: 0 },
    ]);
    expect(activityFromPlay({})).toEqual([]);
  });

  it('lists challenges and runs in the weekly recap', () => {
    const monday = addDays(weekStart(T), -7);
    const recap = weeklyRecap(activityFromPlay({ challenges: [monday], runs: [addDays(monday, 1), addDays(monday, 1)] }), T);
    expect(recap).toMatchObject({ reviews: 0, solves: 0, challenges: 1, runs: 2, goalDays: 2 });
    expect(recapIsEmpty(recap)).toBe(false);
  });
});

describe('computeStreak', () => {
  it('is zero with no activity', () => {
    expect(computeStreak([], T)).toMatchObject({ current: 0, longest: 0, freezes: 0, todayDone: false, todayProgress: 0 });
  });

  it('counts consecutive days, today included', () => {
    expect(computeStreak(run(3), T)).toMatchObject({ current: 3, longest: 3, todayDone: true });
  });

  it('stays alive while today is still in progress', () => {
    const s = computeStreak([...run(3, 1), { day: T, reviews: 4, solves: 0 }], T);
    expect(s).toMatchObject({ current: 3, todayDone: false, todayProgress: 0.4 });
  });

  it('breaks after a missed day without a freeze, keeping the longest', () => {
    expect(computeStreak([...run(5, 3), ...run(2, 0)], T)).toMatchObject({ current: 2, longest: 5 });
    expect(computeStreak(run(5, 2), T)).toMatchObject({ current: 0, longest: 5 });
  });

  it('adds activity of the same day and ignores days below the goal', () => {
    const s = computeStreak([{ day: T, reviews: 6, solves: 0 }, { day: T, reviews: 4, solves: 0 }, { day: addDays(T, -1), reviews: 3, solves: 0 }], T);
    expect(s).toMatchObject({ current: 1, todayDone: true });
  });

  it('earns a freeze every 7 days in a row, at most 2', () => {
    expect(computeStreak(run(7), T).freezes).toBe(1);
    expect(computeStreak(run(14), T).freezes).toBe(2);
    expect(computeStreak(run(28), T).freezes).toBe(2);
  });

  it('uses a freeze for a missed day, which keeps the streak but does not lengthen it', () => {
    // 7 days, a missed day, then 2 more ending today.
    const s = computeStreak([...run(7, 3), ...run(2, 0)], T);
    expect(s).toMatchObject({ current: 9, freezes: 0, frozen: [addDays(T, -2)] });
  });

  it('uses freezes for days missed up to yesterday', () => {
    const s = computeStreak(run(7, 2), T);
    expect(s).toMatchObject({ current: 7, freezes: 0, frozen: [addDays(T, -1)] });
    expect(computeStreak(run(7, 3), T)).toMatchObject({ current: 0 });
    expect(computeStreak(run(14, 3), T)).toMatchObject({ current: 14, freezes: 0, frozen: [addDays(T, -2), addDays(T, -1)] });
  });

  it('ignores activity after today and malformed days', () => {
    const s = computeStreak([...run(2), { day: addDays(T, 1), reviews: 99, solves: 0 }, { day: 'nope', reviews: 99, solves: 0 }], T);
    expect(s).toMatchObject({ current: 2, longest: 2 });
  });
});

describe('goal choices and milestones', () => {
  it('takes only the offered goals, with one solve always enough', () => {
    expect(isGoalChoice(20)).toBe(true);
    expect(isGoalChoice(7)).toBe(false);
    expect(isGoalChoice('10')).toBe(false);
    expect(goalFor(5)).toEqual({ reviews: 5, solves: 1 });
    expect(goalFor(undefined)).toEqual(DEFAULT_GOAL);
    expect(goalFor(1000)).toEqual(DEFAULT_GOAL);
    expect(computeStreak([{ day: T, reviews: 5, solves: 0 }], T, goalFor(5)).todayDone).toBe(true);
  });

  it('names the milestone a streak crossed', () => {
    expect(milestoneReached(2, 3)).toBe(3);
    expect(milestoneReached(3, 4)).toBeUndefined();
    expect(milestoneReached(6, 7)).toBe(7);
    expect(milestoneReached(0, 0)).toBeUndefined();
    expect(milestoneReached(99, 100)).toBe(100);
    // A jump over two (activity from another device) names the larger.
    expect(milestoneReached(2, 8)).toBe(7);
  });
});

describe('activity', () => {
  const review = (cardId: string, day: string, at: number, version = 1): CardReview => ({ id: `${cardId}-${at}`, cardId, version, rating: 3, reviewedAt: at, durationMs: 1000, day });

  it('counts reviews and new cards per day from a log', () => {
    const log = [review('a', '2026-10-01', 10), review('b', '2026-10-01', 11), review('a', '2026-10-02', 20), review('a', '2026-10-03', 30, 2)];
    expect(activityFromLog(log)).toEqual([
      { day: '2026-10-01', reviews: 2, solves: 0, newCards: 2 },
      { day: '2026-10-02', reviews: 1, solves: 0, newCards: 0 },
      { day: '2026-10-03', reviews: 1, solves: 0, newCards: 1 },
    ]);
  });

  it('counts solves per day and adds activity to a day', () => {
    expect(activityFromSolves({ a: T, b: T, c: addDays(T, -1) })).toEqual([
      { day: addDays(T, -1), reviews: 0, solves: 1, newCards: 0 },
      { day: T, reviews: 0, solves: 2, newCards: 0 },
    ]);
    expect(withActivity([{ day: T, reviews: 4, solves: 0 }], { day: T, reviews: 6, solves: 0, newCards: 2 })).toEqual([{ day: T, reviews: 10, solves: 0, newCards: 2 }]);
  });
});

describe('pending reviews', () => {
  const pending = (id: string, day = T): CardReview => ({ id, cardId: `card-${id}`, version: 1, rating: 3, reviewedAt: 100, durationMs: 1000, day });
  const server: DayActivity[] = [
    { day: addDays(T, -1), reviews: 10, solves: 0, newCards: 3 },
    { day: T, reviews: 7, solves: 1, newCards: 1 },
  ];

  it('adds each pending review to its day, keeping solves and new cards', () => {
    expect(withPendingReviews(server, [pending('a'), pending('b', addDays(T, -1)), pending('c', addDays(T, -3))])).toEqual([
      { day: addDays(T, -3), reviews: 1, solves: 0, newCards: 0 },
      { day: addDays(T, -1), reviews: 11, solves: 0, newCards: 3 },
      { day: T, reviews: 8, solves: 1, newCards: 1 },
    ]);
  });

  it('counts a review once by id, leaves out those already sent and those with a bad day', () => {
    const merged = withPendingReviews(server, [pending('a'), pending('a'), pending('b'), pending('c'), { ...pending('d'), day: 'soon' }], new Set(['b']));
    expect(merged.find((d) => d.day === T)).toEqual({ day: T, reviews: 9, solves: 1, newCards: 1 });
  });

  it('answers the activity itself when nothing is pending', () => {
    expect(withPendingReviews(server, [])).toBe(server);
    expect(withPendingReviews(server, [pending('a')], new Set(['a']))).toBe(server);
  });

  it('lets pending reviews meet today’s goal and keep a streak going', () => {
    const days = [...run(3, 1), { day: T, reviews: 8, solves: 0 }];
    expect(computeStreak(days, T, DEFAULT_GOAL)).toMatchObject({ current: 3, todayDone: false });
    expect(computeStreak(withPendingReviews(days, [pending('a'), pending('b')]), T, DEFAULT_GOAL)).toMatchObject({ current: 4, todayDone: true });
  });
});

describe('weekly recap', () => {
  it('starts weeks on Monday', () => {
    // 2026-10-20 is a Tuesday.
    expect(weekStart(T)).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19');
  });

  it('sums the previous Monday–Sunday week', () => {
    const activity: DayActivity[] = [
      { day: '2026-10-11', reviews: 50, solves: 0, newCards: 5 }, // the Sunday before: not in it
      { day: '2026-10-12', reviews: 10, solves: 0, newCards: 4 },
      { day: '2026-10-13', reviews: 3, solves: 1, newCards: 3 },
      { day: '2026-10-14', reviews: 2, solves: 0, newCards: 0 },
      { day: '2026-10-18', reviews: 12, solves: 0, newCards: 1 },
      { day: T, reviews: 30, solves: 0, newCards: 9 }, // this week: not in it
    ];
    const recap = weeklyRecap(activity, T);
    expect(recap).toEqual({ start: '2026-10-12', end: '2026-10-18', reviews: 27, newCards: 8, solves: 1, challenges: 0, runs: 0, goalDays: 3, streak: 1 });
    expect(recapIsEmpty(recap)).toBe(false);
    expect(recapIsEmpty(weeklyRecap([], T))).toBe(true);
  });
});
