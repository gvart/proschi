import { describe, expect, it } from 'vitest';
import { CANVAS_TOKENS } from '../utils/canvasColors';
import { KINDS } from './kinds';
import { parse } from './parser';
import { CATEGORY_COLOR, COLOR_NAMES, PALETTE, categoryOf, contrast, cssTint, mix, nodeBaseColor, resolveColor, suggestColor, tint, type Theme } from './palette';

const THEMES: Theme[] = ['light', 'dark'];

describe('resolveColor', () => {
  it('resolves palette names and hex values', () => {
    expect(resolveColor('teal')).toBe(PALETTE.teal);
    expect(resolveColor('#ABC')).toBe('#aabbcc');
    expect(resolveColor('#3B82F6')).toBe('#3b82f6');
    expect(resolveColor('tael')).toBeUndefined();
    expect(resolveColor('#abcd')).toBeUndefined();
    expect(resolveColor('toString')).toBeUndefined();
  });

  it('suggests close names only', () => {
    expect(suggestColor('Grey')).toBe('gray');
    expect(suggestColor('magenta')).toBeUndefined();
  });
});

describe('category colors', () => {
  it('maps every kind but other to one of six categories', () => {
    const categories = new Set(KINDS.map(categoryOf).filter(Boolean));
    expect(categories.size).toBe(6);
    expect(categoryOf('other')).toBeUndefined();
    expect(new Set(Object.values(CATEGORY_COLOR)).size).toBe(6);
  });

  it('follows the precedence color > tag > category', () => {
    const src = 'legend {\n  t red\n}\na [PostgreSQL]\nb [PostgreSQL] .t\nc [PostgreSQL] .t color blue\ng "G" [Note]\ngroup grp {\n}';
    const nodes = parse(src).diagram.nodes;
    expect(nodes.map(nodeBaseColor)).toEqual([PALETTE.green, PALETTE.red, PALETTE.blue, undefined, undefined]);
  });
});

describe('tint', () => {
  it('mixes like CSS color-mix in sRGB', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mix('#3b82f6', '#ffffff', 1)).toBe('#3b82f6');
    expect(cssTint('#3b82f6').fill).toBe('color-mix(in srgb, #3b82f6 12%, rgb(var(--c-surface)))');
  });

  // Text stays the ink, so the fill must stay close to the surface for any base, in both themes.
  const bases = [...COLOR_NAMES.map((n) => PALETTE[n]), '#000000', '#ffffff', '#ffff00', '#0000ff', '#ff00ff'];
  it.each(THEMES)('keeps ink and muted text readable (WCAG AA) on every fill, %s', (theme) => {
    for (const base of bases) {
      const t = tint(base, theme);
      expect(contrast(t.text, t.fill), base).toBeGreaterThanOrEqual(7);
      expect(contrast(CANVAS_TOKENS[theme].muted, t.fill), base).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('draws palette borders that stand out from the surface, %s', (theme) => {
    for (const name of COLOR_NAMES) {
      const t = tint(PALETTE[name], theme);
      expect(contrast(t.line, CANVAS_TOKENS[theme].surface), name).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)('keeps category fills apart from each other, %s', (theme) => {
    const fills = Object.values(CATEGORY_COLOR).map((n) => tint(PALETTE[n], theme).line);
    expect(new Set(fills).size).toBe(fills.length);
  });
});
