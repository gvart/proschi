import colors from 'tailwindcss/colors';
import defaultTheme from 'tailwindcss/defaultTheme';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANVAS_FONT, CANVAS_TOKENS, CANVAS_TOKEN_VARS, TAILWIND_HEX } from './canvasColors';
import { componentTypeColors } from './iconMapping';

describe('TAILWIND_HEX', () => {
  it('matches Tailwind’s palette', () => {
    for (const [cls, hex] of Object.entries(TAILWIND_HEX)) {
      const [, color, shade] = cls.match(/^(?:bg|text|border)-([a-z]+)-(\d+)$/)!;
      expect(hex, cls).toBe((colors as unknown as Record<string, Record<string, string>>)[color][shade]);
    }
  });

  it('covers every component type colour', () => {
    for (const cls of Object.values(componentTypeColors)) expect(TAILWIND_HEX[cls], cls).toBeDefined();
  });

  it('uses Tailwind’s sans font stack', () => {
    expect(CANVAS_FONT.replace(/'/g, '"')).toBe(defaultTheme.fontFamily.sans.join(', '));
  });
});

describe('CANVAS_TOKENS', () => {
  const css = readFileSync(new URL('../design/tokens.css', import.meta.url), 'utf8');
  /** `--name: r g b;` in the first block after `selector`, as #RRGGBB. */
  const tokenHex = (selector: string, name: string) => {
    const block = css.slice(css.indexOf(selector));
    const m = block.match(new RegExp(`${name}:\\s*(\\d+) (\\d+) (\\d+);`));
    if (!m) throw new Error(`${name} not found after ${selector}`);
    return `#${m.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  };

  it('mirrors the light and dark design tokens', () => {
    for (const [key, name] of Object.entries(CANVAS_TOKEN_VARS) as [keyof typeof CANVAS_TOKENS.light, string][]) {
      expect(CANVAS_TOKENS.light[key], `light ${key}`).toBe(tokenHex(':root,', name));
      expect(CANVAS_TOKENS.dark[key], `dark ${key}`).toBe(tokenHex(":root[data-theme='dark']", name));
    }
  });
});
