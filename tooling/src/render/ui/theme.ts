import { CANVAS_TOKENS } from '../../../../frontend/src/utils/canvasColors';
import type { Tone, UiTheme } from './contract';

/**
 * The UI kit's colours: the canvas's tokens (design/tokens.css, mirrored in
 * CANVAS_TOKENS) plus the ones the editor's panels add (the yellow primary,
 * the blue, the pass green), and the Tailwind tints its chips and callouts
 * use. Fills behind text are see-through paints (rgba, never group opacity,
 * which resvg cannot crop): panels are drawn on a transparent background, so
 * the terminal's own colour shows through.
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
  /** Hairlines: ink at 14%, over whatever the terminal's background is. */
  line: string;
  /** Ink at 10%: a hovered quiet control, a progress track. */
  hover: string;
  /** Ink at 5%: code backgrounds. */
  wash: string;
  /**
   * A card or a control at rest: a faint wash of ink and a hairline, so it
   * reads on the terminal's own background (panels are drawn transparent,
   * never a slab of the canvas's paper).
   */
  card: { fill: string; line: string };
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
  return {
    theme,
    paper: T.paper,
    surface: T.surface,
    ink: T.ink,
    muted: T.muted,
    shadow: T.shadow,
    accent: T.accent,
    fail: T.fail,
    yellow,
    blue,
    pass,
    onAccent: '#111111',
    line: alpha(T.ink, 0.14),
    hover: alpha(T.ink, 0.1),
    wash: alpha(T.ink, 0.05),
    card: { fill: alpha(T.ink, dark ? 0.035 : 0.025), line: alpha(T.ink, dark ? 0.16 : 0.14) },
    tone: {
      ink: T.ink,
      muted: T.muted,
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
      warn: dark ? { fill: alpha('#FBBF24', 0.12), text: '#FEF3C7', icon: '#FBBF24' } : { fill: alpha('#D97706', 0.1), text: '#78350F', icon: '#D97706' },
      bad: dark ? { fill: alpha('#F87171', 0.12), text: '#FEE2E2', icon: '#F87171' } : { fill: alpha('#DC2626', 0.08), text: '#7F1D1D', icon: '#DC2626' },
      good: dark ? { fill: alpha('#34D399', 0.12), text: '#D1FAE5', icon: '#34D399' } : { fill: alpha('#059669', 0.08), text: '#064E3B', icon: '#059669' },
      info: dark ? { fill: alpha('#60A5FA', 0.12), text: '#DBEAFE', icon: '#60A5FA' } : { fill: alpha('#2563EB', 0.08), text: '#1E3A8A', icon: '#2563EB' },
    },
    code: dark
      ? { key: '#8C9BFF', string: '#6EE7B7', number: '#FDBA74', literal: '#F0ABFC', punct: T.muted, tag: '#8C9BFF' }
      : { key: '#3D5AFE', string: '#047857', number: '#C2410C', literal: '#A21CAF', punct: T.muted, tag: '#3D5AFE' },
  };
}
