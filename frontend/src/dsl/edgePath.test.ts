import { describe, expect, it } from 'vitest';
import { fallbackRoute, labelPoint, roundedPath, snapToBottom } from './edgePath';

describe('roundedPath', () => {
  it('rounds each bend and keeps straight lines straight', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toBe('M0,0 L0,100');
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 100, y: 50 }])).toBe('M0,0 L0,42 Q0,50 8,50 L100,50');
  });

  it('never rounds past half a short leg', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 100, y: 4 }])).toBe('M0,0 L0,2 Q0,4 2,4 L100,4');
  });
});

describe('labelPoint', () => {
  it('sits in the middle of the longest leg', () => {
    expect(labelPoint([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 200, y: 10 }, { x: 200, y: 30 }])).toEqual({ x: 100, y: 10 });
  });
});

describe('fallbackRoute', () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 });

  it('joins stacked boxes bottom to top with the turn halfway', () => {
    expect(fallbackRoute(box(0, 0), box(200, 150))).toEqual([{ x: 50, y: 50 }, { x: 50, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 150 }]);
    expect(fallbackRoute(box(0, 150), box(0, 0))).toEqual([{ x: 50, y: 150 }, { x: 50, y: 50 }]);
  });

  it('joins boxes side by side left to right', () => {
    expect(fallbackRoute(box(300, 0), box(0, 20))).toEqual([{ x: 300, y: 25 }, { x: 200, y: 25 }, { x: 200, y: 45 }, { x: 100, y: 45 }]);
  });
});

describe('snapToBottom', () => {
  it('moves an end on the bottom onto the bottom as drawn', () => {
    const points = [{ x: 50, y: 60 }, { x: 50, y: 200 }];
    expect(snapToBottom(points, 'start', { x: 0, y: 0, width: 100, height: 84 })).toEqual([{ x: 50, y: 84 }, { x: 50, y: 200 }]);
  });

  it('leaves ends on the top and the sides alone', () => {
    const top = [{ x: 50, y: -100 }, { x: 50, y: 0 }];
    expect(snapToBottom(top, 'end', { x: 0, y: 0, width: 100, height: 84 })).toBe(top);
    const side = [{ x: 100, y: 30 }, { x: 200, y: 30 }];
    expect(snapToBottom(side, 'start', { x: 0, y: 0, width: 100, height: 84 })).toBe(side);
  });
});
