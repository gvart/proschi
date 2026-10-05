import { describe, expect, it } from 'vitest';
import { DAY, DEFAULT_WEIGHTS, forgettingCurve, intervalDays, isRating, nextState, previewIntervals, replay, retrievability, type CardState, type Rating } from './fsrs';

const T0 = 1_800_000_000;
const days = (s: CardState) => (s.due - s.lastReview) / DAY;

describe('FSRS', () => {
  it('starts a new card at the initial weights: the first stability is w0…w3 by rating', () => {
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      const s = nextState(undefined, rating, T0);
      expect(s.stability).toBe(DEFAULT_WEIGHTS[rating - 1]);
      expect(s).toMatchObject({ version: 1, reps: 1, lapses: 0, lastReview: T0 });
    }
    // Rounded to whole days, at least one: again 0.4 → 1, hard 1.18 → 1, good 3.17 → 3, easy 15.7 → 16.
    expect([1, 2, 3, 4].map((r) => days(nextState(undefined, r as Rating, T0)))).toEqual([1, 1, 3, 16]);
  });

  it('gives a first difficulty of w4 − e^(w5·(G−1)) + 1, hand-checked', () => {
    expect(nextState(undefined, 1, T0).difficulty).toBeCloseTo(7.1949, 4);
    expect(nextState(undefined, 3, T0).difficulty).toBeCloseTo(7.1949 - Math.exp(0.5345 * 2) + 1, 6);
    expect(nextState(undefined, 3, T0).difficulty).toBeCloseTo(5.2825, 3);
    expect(nextState(undefined, 4, T0).difficulty).toBeCloseTo(3.2244, 3);
  });

  it('schedules at 90% recall: the interval is the stability, and recall after S days is 0.9', () => {
    expect(forgettingCurve(10, 10)).toBeCloseTo(0.9, 10);
    expect(forgettingCurve(0, 10)).toBe(1);
    expect(intervalDays(10)).toBe(10);
    expect(intervalDays(0.2)).toBe(1);
    expect(intervalDays(1e9)).toBe(36_500);
    const s = nextState(undefined, 3, T0);
    expect(retrievability(s, T0 + 3.173 * DAY)).toBeCloseTo(0.9, 6);
    expect(retrievability(undefined, T0)).toBe(0);
  });

  it('a second good review on time grows stability by the recall formula, hand-checked', () => {
    const first = nextState(undefined, 3, T0);
    const second = nextState(first, 3, first.due);
    // R = (1 + 19/81 · 3 / 3.173)^-0.5 ≈ 0.9047; S' = S·(1 + e^w8·(11 − D)·S^-w9·(e^(w10·(1 − R)) − 1)) ≈ 10.74.
    expect(second.stability).toBeCloseTo(10.74, 1);
    expect(days(second)).toBe(11);
    expect(second.reps).toBe(2);
    // Good keeps the difficulty, but for the slight pull towards an easy card's.
    expect(second.difficulty).toBeCloseTo(0.0046 * 3.2244 + 0.9954 * 5.2825, 3);
  });

  it('grows intervals with each good review, more for easy and less for hard', () => {
    let s = nextState(undefined, 3, T0);
    const intervals = [days(s)];
    for (let i = 0; i < 5; i++) {
      s = nextState(s, 3, s.due);
      intervals.push(days(s));
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    const p = previewIntervals(s, s.due);
    expect(p[1]).toBeLessThan(p[2]);
    expect(p[2]).toBeLessThan(p[3]);
    expect(p[3]).toBeLessThan(p[4]);
  });

  it('a lapse cuts stability, counts a lapse and raises difficulty', () => {
    let s = nextState(undefined, 3, T0);
    for (let i = 0; i < 3; i++) s = nextState(s, 3, s.due);
    const lapsed = nextState(s, 1, s.due);
    expect(lapsed.stability).toBeLessThan(s.stability / 3);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.difficulty).toBeGreaterThan(s.difficulty);
    expect(days(lapsed)).toBeGreaterThanOrEqual(1);
    // Again then easy lowers the difficulty again, never below 1 or above 10.
    let d = lapsed;
    for (let i = 0; i < 30; i++) d = nextState(d, 1, d.due);
    expect(d.difficulty).toBeLessThanOrEqual(10);
    for (let i = 0; i < 30; i++) d = nextState(d, 4, d.due);
    expect(d.difficulty).toBeGreaterThanOrEqual(1);
  });

  it('a review on the same day barely moves stability', () => {
    const s = nextState(undefined, 3, T0);
    const again = nextState(s, 3, T0 + 3600);
    expect(again.stability).toBeCloseTo(3.173 * Math.exp(0.51655 * 0.6621), 6);
    // Reviewing before the last review counts as at the same time.
    expect(nextState(s, 3, T0 - 100).lastReview).toBe(T0);
  });

  it('starts a card over when its version went up', () => {
    let s = nextState(undefined, 3, T0);
    s = nextState(s, 3, s.due);
    const v2 = nextState(s, 1, s.due, 2);
    expect(v2).toMatchObject({ version: 2, reps: 1, lapses: 0, stability: DEFAULT_WEIGHTS[0] });
  });

  it('replays a log in time order to the same state, a newer version resetting, an older one ignored', () => {
    const log = [
      { version: 1, rating: 3 as Rating, reviewedAt: T0 },
      { version: 1, rating: 3 as Rating, reviewedAt: T0 + 3 * DAY },
      { version: 1, rating: 1 as Rating, reviewedAt: T0 + 14 * DAY },
    ];
    let expected: CardState | undefined;
    for (const r of log) expected = nextState(expected, r.rating, r.reviewedAt, r.version);
    expect(replay([...log].reverse())).toEqual(expected);
    expect(replay([])).toBeUndefined();

    const bumped = replay([...log, { version: 2, rating: 4, reviewedAt: T0 + 20 * DAY }, { version: 1, rating: 1, reviewedAt: T0 + 21 * DAY }]);
    expect(bumped).toEqual(nextState(undefined, 4, T0 + 20 * DAY, 2));
  });

  it('knows a rating', () => {
    expect([0, 1, 2, 3, 4, 5, '3', 2.5].map(isRating)).toEqual([false, true, true, true, true, false, false, false]);
  });
});
