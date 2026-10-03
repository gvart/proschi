import colors from 'tailwindcss/colors';
import defaultTheme from 'tailwindcss/defaultTheme';
import { describe, expect, it } from 'vitest';
import { CANVAS_FONT, TAILWIND_HEX } from './canvasColors';
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
