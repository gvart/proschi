import { CANVAS_TOKENS } from '../../../../frontend/src/utils/canvasColors';
import type { Tone, UiTheme } from './contract';

/**
 * The UI kit's colours: the canvas's tokens (design/tokens.css, mirrored in
 * CANVAS_TOKENS) plus the ones the editor's panels add (the yellow primary,
 * the blue, the pass green), and the Tailwind tints its chips and callouts
 * use. Every panel is an opaque rounded card (`card`), a touch lighter than
 * a dark terminal's background (white on a light one) with a clear border,
 * so it never melts into the terminal and its text is never anti-aliased onto
 * transparency (which a terminal blends thin). Ink and muted text are a step
 * stronger than the canvas's, for small type on a screen. Tints inside a
 * card are see-through paints (rgba, never group opacity, which resvg cannot
 * crop) over its opaque fill.
 */

export interface Palette {
  theme: UiTheme;
  paper: string;
  surface: string;
  ink: string;
  muted: string;
  shadow: string;
  accent: string;
  fail: string;
  yellow: string;
  blue: string;
  pass: string;
  onAccent: string;
  /** Hairlines and row separators inside a card. */
  line: string;
  /** Ink at 10%: a hovered quiet control, a progress track. */
  hover: string;
  /** Ink at 5%: code backgrounds. */
  wash: string;
  /** A panel's card: an opaque fill (`surface`) and its border. */
  card: { fill: string; line: string };
  /** A button at rest, under the pointer, pressed: opaque fills a step off the card, and their borders. */
  button: { fill: string; hover: string; pressed: string; line: string; lineHover: string };
  tone: Record<Tone, string>;
  /** Chip fills and their text: Tailwind's x-100 / x-700 in light, x-900 at 40% / x-300 in dark. */
  chip: Record<'green' | 'orange' | 'purple' | 'red' | 'blue' | 'yellow' | 'pink' | 'gray', { fill: string; text: string }>;
  /** Callout fills and text (amber-50 / amber-900 and kin). */
  callout: Record<'warn' | 'bad' | 'good' | 'info', { fill: string; text: string; icon: string }>;
  /** JSON and XML tokens. */
  code: { key: string; string: string; number: string; literal: string; punct: string; tag: string };
}

/** `hex` (#rrggbb) at opacity `a`, as an SVG paint. */
export function alpha(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${a})`;
}

/** `a` over `b` at `t` (0..1), both #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * t + ch(b, i) * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}

export function paletteOf(theme: UiTheme): Palette {
  const T = CANVAS_TOKENS[theme];
  const dark = theme === 'dark';
  const yellow = '#FFD23F';
  const blue = dark ? '#8C9BFF' : '#3D5AFE';
  const pass = dark ? '#2EE6B6' : '#00B894';
  const on = (fill: string, text: string) => ({ fill, text });
  // Chip fills are see-through, so a chip sits on any background the terminal has.
  const tint = (_x900: string, _x100: string, x300: string, x700: string) => (dark ? on(alpha(x300, 0.16), x300) : on(alpha(x700, 0.12), x700));
  // Text a step stronger than the canvas's (#F4EFE3 / #A9A5B4 on dark), the card a touch lighter than a dark terminal.
  const ink = dark ? '#ECECEF' : '#18181B';
  const muted = dark ? '#A8A8B3' : '#52525B';
  const surface = dark ? '#1C1C21' : '#FFFFFF';
  const solid = (a: number) => mix(ink, surface, a);
  return {
    theme,
    paper: T.paper,
    surface,
    ink,
    muted,
    shadow: T.shadow,
    accent: T.accent,
    fail: T.fail,
    yellow,
    blue,
    pass,
    onAccent: '#111111',
    line: alpha(ink, dark ? 0.13 : 0.12),
    hover: alpha(ink, 0.1),
    wash: alpha(ink, dark ? 0.05 : 0.04),
    card: { fill: surface, line: dark ? 'rgba(255,255,255,0.14)' : alpha('#111111', 0.12) },
    button: dark
      ? { fill: solid(0.09), hover: solid(0.15), pressed: solid(0.05), line: 'rgba(255,255,255,0.22)', lineHover: 'rgba(255,255,255,0.36)' }
      : { fill: mix('#F4F4F5', surface, 1), hover: '#E9E9EC', pressed: '#DEDEE2', line: alpha('#111111', 0.2), lineHover: alpha('#111111', 0.34) },
    tone: {
      ink,
      muted,
      accent: T.accent,
      good: dark ? '#6EE7B7' : '#047857',
      warn: dark ? '#FCD34D' : '#B45309',
      bad: dark ? '#FCA5A5' : '#B91C1C',
      info: blue,
    },
    chip: {
      green: tint('#14532d', '#dcfce7', '#86efac', '#15803d'),
      orange: tint('#7c2d12', '#ffedd5', '#fdba74', '#c2410c'),
      purple: tint('#581c87', '#f3e8ff', '#d8b4fe', '#7e22ce'),
      red: tint('#7f1d1d', '#fee2e2', '#fca5a5', '#b91c1c'),
      blue: tint('#1e3a8a', '#dbeafe', '#93c5fd', '#1d4ed8'),
      yellow: on(yellow, '#111111'),
      pink: on(T.accent, '#111111'),
      gray: tint('#374151', '#f3f4f6', '#d1d5db', '#374151'),
    },
    callout: {
      warn: dark ? { fill: mix('#FBBF24', surface, 0.12), text: '#FEF3C7', icon: '#FBBF24' } : { fill: mix('#D97706', surface, 0.1), text: '#78350F', icon: '#D97706' },
      bad: dark ? { fill: mix('#F87171', surface, 0.12), text: '#FEE2E2', icon: '#F87171' } : { fill: mix('#DC2626', surface, 0.08), text: '#7F1D1D', icon: '#DC2626' },
      good: dark ? { fill: mix('#34D399', surface, 0.12), text: '#D1FAE5', icon: '#34D399' } : { fill: mix('#059669', surface, 0.08), text: '#064E3B', icon: '#059669' },
      info: dark ? { fill: mix('#60A5FA', surface, 0.12), text: '#DBEAFE', icon: '#60A5FA' } : { fill: mix('#2563EB', surface, 0.08), text: '#1E3A8A', icon: '#2563EB' },
    },
    code: dark
      ? { key: '#8C9BFF', string: '#6EE7B7', number: '#FDBA74', literal: '#F0ABFC', punct: T.muted, tag: '#8C9BFF' }
      : { key: '#3D5AFE', string: '#047857', number: '#C2410C', literal: '#A21CAF', punct: T.muted, tag: '#3D5AFE' },
  };
}
