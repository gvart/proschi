import { CANVAS_TOKENS } from '../../../../frontend/src/utils/canvasColors';
import type { Tone, UiTheme } from './contract';

/**
 * The UI kit's colours: the canvas's tokens (design/tokens.css, mirrored in
 * CANVAS_TOKENS) plus the ones the editor's panels add (the yellow primary,
 * the blue, the pass green), and the Tailwind tints its chips and callouts
 * use, solid so nothing needs group opacity (which resvg cannot crop).
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
  /** Hairlines: ink at 15% over the surface. */
  line: string;
  /** Ink at 10% over the surface: a hovered quiet control, a progress track. */
  hover: string;
  /** Ink at 6% over the surface: table header rows, code backgrounds. */
  wash: string;
  tone: Record<Tone, string>;
  /** Chip fills and their text: Tailwind's x-100 / x-700 in light, x-900 at 40% / x-300 in dark. */
  chip: Record<'green' | 'orange' | 'purple' | 'red' | 'blue' | 'yellow' | 'pink' | 'gray', { fill: string; text: string }>;
  /** Callout fills and text (amber-50 / amber-900 and kin). */
  callout: Record<'warn' | 'bad' | 'good' | 'info', { fill: string; text: string; icon: string }>;
  /** JSON and XML tokens. */
  code: { key: string; string: string; number: string; literal: string; punct: string; tag: string };
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
  const tint = (x900: string, x100: string, x300: string, x700: string) => (dark ? on(mix(x900, T.surface, 0.4), x300) : on(x100, x700));
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
    line: mix(T.ink, T.surface, 0.15),
    hover: mix(T.ink, T.surface, 0.1),
    wash: mix(T.ink, T.paper, 0.05),
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
      warn: dark ? { fill: mix('#451a03', T.surface, 0.4), text: '#FEF3C7', icon: '#FBBF24' } : { fill: '#FFFBEB', text: '#78350F', icon: '#D97706' },
      bad: dark ? { fill: mix('#450a0a', T.surface, 0.4), text: '#FEE2E2', icon: '#F87171' } : { fill: '#FEF2F2', text: '#7F1D1D', icon: '#DC2626' },
      good: dark ? { fill: mix('#022c22', T.surface, 0.4), text: '#D1FAE5', icon: '#34D399' } : { fill: '#ECFDF5', text: '#064E3B', icon: '#059669' },
      info: dark ? { fill: mix('#172554', T.surface, 0.4), text: '#DBEAFE', icon: '#60A5FA' } : { fill: '#EFF6FF', text: '#1E3A8A', icon: '#2563EB' },
    },
    code: dark
      ? { key: '#8C9BFF', string: '#6EE7B7', number: '#FDBA74', literal: '#F0ABFC', punct: T.muted, tag: '#8C9BFF' }
      : { key: '#3D5AFE', string: '#047857', number: '#C2410C', literal: '#A21CAF', punct: T.muted, tag: '#3D5AFE' },
  };
}
