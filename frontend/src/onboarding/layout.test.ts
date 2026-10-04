import { describe, expect, it } from 'vitest';
import { placePopover } from './layout';

const size = { width: 300, height: 200 };
const desktop = { width: 1440, height: 900 };

describe('placePopover', () => {
  it('puts the popover on the first preferred side that fits', () => {
    const target = { top: 100, left: 100, width: 200, height: 40 };
    expect(placePopover(target, size, desktop, { phone: false, sides: ['right'] })).toEqual({ top: 20, left: 312 });
    expect(placePopover(target, size, desktop, { phone: false, sides: ['bottom'] })).toEqual({ top: 152, left: 50 });
  });

  it('skips sides without room and stays on screen', () => {
    const target = { top: 10, left: 1300, width: 120, height: 36 };
    const { top, left } = placePopover(target, size, desktop, { phone: false, sides: ['right', 'top', 'bottom'] });
    expect(top).toBe(58);
    expect(left + size.width).toBeLessThanOrEqual(desktop.width - 12);
  });

  it('sits inside a target that fills the screen', () => {
    const target = { top: 0, left: 0, width: 1440, height: 900 };
    const { top } = placePopover(target, size, desktop, { phone: false });
    expect(top).toBe(900 - 200 - 12);
  });

  it('docks on phones, away from the target unless told otherwise', () => {
    const phone = { width: 390, height: 844 };
    const low = { top: 700, left: 0, width: 390, height: 60 };
    const high = { top: 60, left: 0, width: 390, height: 40 };
    expect(placePopover(low, size, phone, { phone: true })).toEqual({ top: 12, left: 12 });
    expect(placePopover(high, size, phone, { phone: true })).toEqual({ top: 844 - 200 - 12, left: 12 });
    expect(placePopover(high, size, phone, { phone: true, dock: 'top' })).toEqual({ top: 12, left: 12 });
  });

  it('floats at the bottom centre without a target', () => {
    expect(placePopover(null, size, desktop, { phone: false })).toEqual({ top: 688, left: 570 });
  });
});
