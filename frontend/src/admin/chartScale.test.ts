import { describe, expect, it } from 'vitest';
import { change, lineTicks, niceTicks, periods, sum } from './chartScale';

describe('admin chart scales', () => {
  it('picks three clean ticks that cover the largest value', () => {
    expect(niceTicks(0, true)).toEqual([0, 1, 2]);
    expect(niceTicks(1, true)).toEqual([0, 1, 2]);
    expect(niceTicks(7, true)).toEqual([0, 5, 10]);
    expect(niceTicks(11, true)).toEqual([0, 10, 20]);
    expect(niceTicks(38, true)).toEqual([0, 20, 40]);
    expect(niceTicks(4.47, false)).toEqual([0, 2.5, 5]);
    expect(niceTicks(0.3, false)).toEqual([0, 0.2, 0.4]);
    expect(niceTicks(0.3, true)).toEqual([0, 1, 2]);
    expect(niceTicks(2_400_000, true)).toEqual([0, 2_000_000, 4_000_000]);
  });

  it('starts a line’s axis above 0 only when that shows its movement', () => {
    expect(lineTicks(265, 300, true)).toEqual([260, 280, 300]);
    expect(lineTicks(46, 52, true)).toEqual([45, 50, 55]);
    expect(lineTicks(3, 30, true)).toEqual(niceTicks(30, true));
    expect(lineTicks(50, 50, true)).toEqual(niceTicks(50, true));
  });

  it('compares two periods', () => {
    expect(change(12, 10)).toBeCloseTo(0.2);
    expect(change(5, 10)).toBeCloseTo(-0.5);
    expect(change(3, 0)).toBeNull();
    expect(periods([1, 2, 3, 4, 5, 6], 2)).toEqual({ current: [5, 6], previous: [3, 4] });
    expect(sum([1, 2, 3])).toBe(6);
  });
});
