import { addDays, byDay, weekStart, type Day, type DayActivity } from '../../learn/streak';

/** The weeks the progress page's "Last 12 weeks" charts (WeeklyActivity.tsx) cover. */
export const WEEKS = 12;

export interface Week {
  start: Day;
  reviews: number;
  solves: number;
}

/** The last `WEEKS` weeks up to `today`'s, oldest first. */
export function weeklyTotals(days: DayActivity[], today: Day): Week[] {
  const last = weekStart(today);
  const weeks: Week[] = Array.from({ length: WEEKS }, (_, i) => ({
    start: addDays(last, -7 * (WEEKS - 1 - i)),
    reviews: 0,
    solves: 0,
  }));
  const first = weeks[0].start;
  for (const a of byDay(days).values()) {
    if (a.day < first) continue;
    const w = weeks.find((x, i) => a.day >= x.start && (i === WEEKS - 1 || a.day < weeks[i + 1].start));
    if (!w) continue;
    w.reviews += a.reviews;
    w.solves += a.solves;
  }
  return weeks;
}
