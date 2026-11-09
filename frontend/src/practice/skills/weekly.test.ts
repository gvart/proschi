import { describe, expect, it } from 'vitest';
import { WEEKS, weeklyTotals } from './weekly';

describe('weeklyTotals', () => {
  // 2026-11-08 is a Sunday: its week starts on Monday 2026-11-02.
  const today = '2026-11-08';

  it('covers the last 12 weeks, Monday to Sunday, this week last', () => {
    const weeks = weeklyTotals([], today);
    expect(weeks).toHaveLength(WEEKS);
    expect(weeks[WEEKS - 1].start).toBe('2026-11-02');
    expect(weeks[0].start).toBe('2026-08-17');
    expect(weeks.every((w) => w.reviews === 0 && w.solves === 0)).toBe(true);
  });

  it('sums each day into its week and leaves out older days', () => {
    const weeks = weeklyTotals(
      [
        { day: '2026-11-02', reviews: 5, solves: 1 },
        { day: '2026-11-08', reviews: 3, solves: 0 },
        { day: '2026-11-01', reviews: 7, solves: 2 },
        { day: '2026-08-16', reviews: 100, solves: 9 },
      ],
      today,
    );
    expect(weeks[WEEKS - 1]).toMatchObject({ reviews: 8, solves: 1 });
    expect(weeks[WEEKS - 2]).toMatchObject({ start: '2026-10-26', reviews: 7, solves: 2 });
    expect(weeks.reduce((n, w) => n + w.reviews, 0)).toBe(15);
  });
});
