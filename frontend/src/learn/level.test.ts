import { describe, expect, it } from 'vitest';
import { levelFloor, levelOf } from './level';

describe('practice level', () => {
  it('starts at level 1 with no XP', () => {
    expect(levelOf({ solved: 0, mastered: 0, longestStreak: 0 })).toMatchObject({ level: 1, xp: 0, floor: 0, next: 50, progress: 0 });
  });

  it('adds 100 per solve, 20 per mastered card and 10 per day of the longest streak', () => {
    const l = levelOf({ solved: 2, mastered: 5, longestStreak: 3 });
    expect(l.parts).toEqual({ solves: 200, mastered: 100, streak: 30 });
    expect(l.xp).toBe(330);
    expect(l.level).toBe(3);
    expect(l.floor).toBe(200);
    expect(l.next).toBe(450);
    expect(l.progress).toBeCloseTo(130 / 250);
  });

  it('starts each level at 50 × (L − 1)², exactly on the boundary', () => {
    expect([1, 2, 3, 4, 5, 10].map(levelFloor)).toEqual([0, 50, 200, 450, 800, 4050]);
    expect(levelOf({ solved: 0, mastered: 0, longestStreak: 5 }).level).toBe(2);
    expect(levelOf({ solved: 8, mastered: 0, longestStreak: 0 }).level).toBe(5);
    expect(levelOf({ solved: 7, mastered: 4, longestStreak: 1 }).level).toBe(4);
  });

  it('ignores negative or broken counts', () => {
    expect(levelOf({ solved: -3, mastered: Number.NaN, longestStreak: 2.7 }).xp).toBe(20);
  });
});
