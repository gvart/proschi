import { describe, expect, it } from 'vitest';
import { along, boxOf } from './geometry';

describe('along', () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 200, y: 200, w: 100, h: 40 };

  it('runs from the bottom middle of one box to the top middle of the next', () => {
    expect(along(a, b, 0)).toEqual({ x: 50, y: 40 });
    expect(along(a, b, 1)).toEqual({ x: 250, y: 200 });
    const mid = along(a, b, 0.5);
    expect(mid.x).toBeCloseTo(150);
    expect(mid.y).toBeCloseTo(120);
  });
});

describe('boxOf', () => {
  it('needs a measured node', () => {
    expect(boxOf(undefined)).toBeUndefined();
    expect(boxOf({ id: 'a', position: { x: 0, y: 0 }, data: {} })).toBeUndefined();
    expect(boxOf({ id: 'a', position: { x: 0, y: 0 }, positionAbsolute: { x: 5, y: 6 }, width: 10, height: 20, data: {} })).toEqual({ x: 5, y: 6, w: 10, h: 20 });
  });
});
