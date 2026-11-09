import { describe, expect, it } from 'vitest';
import { canvasKey, historyKey, isShortcutsKey } from './canvasEditState';

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

const canvas = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}, target: EventTarget | null = null) =>
  canvasKey({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, target });

describe('canvasKey', () => {
  it('reads copy, paste, duplicate and find on both platforms', () => {
    expect(canvas('c', { ctrl: true })).toBe('copy');
    expect(canvas('v', { meta: true })).toBe('paste');
    expect(canvas('D', { ctrl: true })).toBe('duplicate');
    expect(canvas('f', { meta: true })).toBe('find');
    expect(canvas('/')).toBe('find');
  });

  it('ignores plain letters, other modifiers and typing in a field', () => {
    expect(canvas('c')).toBeNull();
    expect(canvas('c', { ctrl: true, shift: true })).toBeNull();
    expect(canvas('d', { ctrl: true, alt: true })).toBeNull();
    const editor = { closest: (selector: string) => (selector.includes('[contenteditable]') ? {} : null) } as unknown as EventTarget;
    expect(canvas('/', {}, editor)).toBeNull();
    expect(canvas('v', { ctrl: true }, editor)).toBeNull();
  });
});

describe('isShortcutsKey', () => {
  const shortcuts = (key: string, ctrl = false, target: EventTarget | null = null) =>
    isShortcutsKey({ key, ctrlKey: ctrl, metaKey: false, shiftKey: true, altKey: false, target });

  it('opens on ? outside fields only', () => {
    expect(shortcuts('?')).toBe(true);
    expect(shortcuts('?', true)).toBe(false);
    expect(shortcuts('/')).toBe(false);
    const input = { closest: () => ({}) } as unknown as EventTarget;
    expect(shortcuts('?', false, input)).toBe(false);
  });
});
