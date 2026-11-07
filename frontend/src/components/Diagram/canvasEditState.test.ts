import { describe, expect, it } from 'vitest';
import { historyKey } from './canvasEditState';

const key = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}, target: EventTarget | null = null) =>
  historyKey({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, target });

describe('historyKey', () => {
  it('reads undo and redo on both platforms', () => {
    expect(key('z', { ctrl: true })).toBe('undo');
    expect(key('z', { meta: true })).toBe('undo');
    expect(key('Z', { meta: true, shift: true })).toBe('redo');
    expect(key('y', { ctrl: true })).toBe('redo');
  });

  it('ignores other keys and typing in a field', () => {
    expect(key('z')).toBeNull();
    expect(key('z', { ctrl: true, alt: true })).toBeNull();
    expect(key('a', { ctrl: true })).toBeNull();
    const input = { closest: (selector: string) => (selector.includes('input') ? {} : null) } as unknown as EventTarget;
    expect(key('z', { ctrl: true }, input)).toBeNull();
  });
});
