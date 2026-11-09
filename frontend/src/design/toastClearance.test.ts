import { describe, expect, it } from 'vitest';
import { clearanceOf } from './toastClearance';

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
const box = (top: number, left: number, right: number, height = 44) => ({ top, left, right, width: right - left, height });

describe('clearanceOf', () => {
  it('lifts the toasts 8px above a bar along the bottom', () => {
    // The tests bar, full width: toasts' bottom offset becomes 16px + (900 - 856 - 16 + 8).
    expect(clearanceOf(box(856, 0, 1440), desktop)).toBe(36);
  });

  it('ignores a bar beside the toasts, a hidden one and a full-height pane', () => {
    expect(clearanceOf(box(800, 0, 600), desktop)).toBe(0);
    expect(clearanceOf({ top: 0, left: 0, right: 0, width: 0, height: 0 }, desktop)).toBe(0);
    expect(clearanceOf(box(100, 0, 1440, 800), desktop)).toBe(0);
  });

  it('counts anything across a phone, with its 12px gap', () => {
    expect(clearanceOf(box(700, 0, 390, 144), phone)).toBe(844 - 700 - 12 + 8);
  });
});
