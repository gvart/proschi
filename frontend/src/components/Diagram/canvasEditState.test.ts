import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl';
import { canvasKey, historyKey, isShortcutsKey, scalable, stepNode, stepReplicas } from './canvasEditState';

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

  it('reads F2 as rename, but not with a modifier or in a field', () => {
    expect(canvas('F2')).toBe('rename');
    expect(canvas('F2', { shift: true })).toBeNull();
    expect(canvas('F2', { ctrl: true })).toBeNull();
    const input = { closest: () => ({}) } as unknown as EventTarget;
    expect(canvas('F2', {}, input)).toBeNull();
  });

  it('reads the command bar, Tab, connect, type, replicas and layout keys', () => {
    expect(canvas('a')).toBe('quick');
    expect(canvas('k', { meta: true })).toBe('quick');
    expect(canvas('K', { ctrl: true })).toBe('quick');
    expect(canvas('Tab')).toBe('next');
    expect(canvas('Tab', { shift: true })).toBe('previous');
    expect(canvas('c')).toBe('connect');
    expect(canvas('T')).toBe('type');
    expect(canvas('+', { shift: true })).toBe('more');
    expect(canvas('=')).toBe('more');
    expect(canvas('-')).toBe('fewer');
    expect(canvas('r')).toBe('layout');
  });

  it('leaves the browser its Ctrl/Cmd keys and other letters', () => {
    expect(canvas('r', { meta: true })).toBeNull();
    expect(canvas('t', { ctrl: true })).toBeNull();
    expect(canvas('-', { meta: true })).toBeNull();
    expect(canvas('a', { ctrl: true })).toBeNull();
    expect(canvas('x')).toBeNull();
    expect(canvas('Enter')).toBeNull();
  });

  it('ignores other modifiers and typing in a field', () => {
    expect(canvas('c', { ctrl: true, shift: true })).toBeNull();
    expect(canvas('a', { alt: true })).toBeNull();
    const field = { closest: () => ({}) } as unknown as EventTarget;
    for (const k of ['a', 'Tab', 'c', 't', '+', '-', 'r']) expect(canvas(k, {}, field)).toBeNull();
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

describe('stepNode', () => {
  const nodes = [
    { id: 'db', x: 0, y: 200 },
    { id: 'api', x: 0, y: 100 },
    { id: 'cache', x: 300, y: 205 },
    { id: 'client', x: 0, y: 0 },
  ];

  it('goes in reading order, row by row, around the end', () => {
    expect(stepNode(nodes, 'client', false)).toBe('api');
    expect(stepNode(nodes, 'api', false)).toBe('db');
    expect(stepNode(nodes, 'db', false)).toBe('cache');
    expect(stepNode(nodes, 'cache', false)).toBe('client');
    expect(stepNode(nodes, 'client', true)).toBe('cache');
  });

  it('starts at the first, or going back the last, when nothing is selected', () => {
    expect(stepNode(nodes, undefined, false)).toBe('client');
    expect(stepNode(nodes, undefined, true)).toBe('cache');
    expect(stepNode(nodes, 'gone', false)).toBe('client');
    expect(stepNode([], undefined, false)).toBeUndefined();
  });
});

describe('scalable', () => {
  const { diagram } = parse('user [Actor]\napi [REST API]\nnote [Note]\ndb [PostgreSQL]\n');
  const node = (id: string) => diagram.nodes.find((n) => n.id === id)!;

  it('is a component with replicas: not a client or a note', () => {
    expect(scalable(node('api'))).toBe(true);
    expect(scalable(node('db'))).toBe(true);
    expect(scalable(node('user'))).toBe(false);
    expect(scalable(node('note'))).toBe(false);
  });
});

describe('stepReplicas', () => {
  it('counts up and down from the text, never under one', () => {
    const one = 'api "API" [REST API]\n';
    const two = stepReplicas(one, 'api', 1);
    expect(two).toBe('api "API" [REST API] x2\n');
    expect(stepReplicas(two, 'api', 1)).toBe('api "API" [REST API] x3\n');
    expect(stepReplicas(two, 'api', -1)).toBe(one);
    expect(stepReplicas(one, 'api', -1)).toBe(one);
    expect(stepReplicas(one, 'nope', 1)).toBe(one);
  });
});
