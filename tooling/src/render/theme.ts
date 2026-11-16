/**
 * Render themes for `proschi render`: the colours and the few structural
 * choices (card corners and shadow, icon tiles, handles, group titles) the
 * architecture and sequence renderers draw with. One renderer, three token sets.
 *
 * - `sketch-light` (default, alias `sketch`): the editor's canvas look — cream
 *   paper, ink borders, hard shadows, outlined icon tiles, pink step numbers,
 *   monospace tech names. The same as upstream's `light` canvas theme.
 * - `sketch-dark`: the same look in the canvas's dark colourway (upstream's
 *   `dark`, which the Claude Code plugin's terminal pictures use).
 * - `classic`: the look `proschi render` and the VS Code preview had before
 *   the canvas restyle (gvart.proschi ≤ 0.10) — white background, rounded
 *   light-grey cards with a soft shadow, icons on tiles coloured by component
 *   type, blue requests and step numbers, grey dashed lifelines, sans text.
 *
 * svg.ts's `withTheme` draws in one of these: it loads the theme's `colors`
 * into the shared `COLORS`, so code that reads `COLORS` (all of upstream's
 * drawing, the load overlay and playback included) follows it.
 */

import { CANVAS_FONT, CANVAS_TOKENS, TAILWIND_HEX } from '../../../frontend/src/utils/canvasColors';

export const THEME_NAMES = ['sketch-light', 'sketch-dark', 'classic'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export const DEFAULT_THEME: ThemeName = 'sketch-light';
/** Older names still accepted: `sketch` was the only sketch theme before `sketch-dark`. */
export const THEME_ALIASES: Readonly<Record<string, ThemeName>> = { sketch: 'sketch-light' };
/** Every name `--theme` and proschi.json take, for messages. */
export const THEME_CHOICES = [...THEME_NAMES, ...Object.keys(THEME_ALIASES)] as const;

/** The colours a theme draws with; all keys are present in every theme, so loading one into `COLORS` replaces them all. */
export interface ThemeColors {
  background: string;
  surface: string;
  text: string;
  muted: string;
  /** Response arrows. */
  line: string;
  border: string;
  /** Step number discs, and what playback highlights with. */
  active: string;
  error: string;
  par: string;
  /** The hard shadow (sketch). */
  shadow: string;
  /** Request arrows. */
  request: string;
  /** Number inside a step disc. */
  stepText: string;
  /** Outline of a step disc; undefined draws none. */
  stepStroke: string | undefined;
  lifeline: string;
  lifelineOpacity: number | undefined;
  /** Architecture edges. */
  edge: string;
  /** Team line and group description. */
  team: string;
}

export interface RenderTheme {
  name: ThemeName;
  /** The canvas colourway the theme's tints and heat fills follow (dsl/palette.ts `tint`). */
  colorway: 'light' | 'dark';
  font: string;
  /** Font of tech stacks and edge labels; undefined keeps the sans font. */
  mono?: string;
  colors: ThemeColors;
  card: { rx: number; stroke: number; shadow: 'hard' | 'soft' };
  /** `outline`: a paper tile with an ink glyph; `filled`: a tile in the component type's colour with a white glyph. */
  iconTile: 'outline' | 'filled';
  /** React Flow's square handles on top and bottom of each card. */
  handles: boolean;
  /** Width of edges and message arrows. */
  stroke: number;
  /** Cards take their category's default colour (sketch); classic only tints cards with an explicit `color`. */
  categoryTint: boolean;
  group: { fill: string; line: string; fillOpacity?: number; lineOpacity?: number; rx: number; title: 'caps' | 'plain' };
  note: { fill: string; border?: string; icon: string; title: string; body: string };
  /** Text weight of names and titles. */
  bold: number;
  /**
   * CSS custom properties of the `--format html` page, light then dark, and a figure's frame.
   * `document` adds what the HLD page (`--format hld-html`) also needs, per scheme: `--surface`
   * (tables, code), `--rule` (table cells, heading underlines), `--pass`, `--warn` and `--link-decoration`.
   */
  page: { light: string; dark: string; figure: string; document: { light: string; dark: string } };
}

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** A sketch theme in one of the canvas's colourways (CANVAS_TOKENS). */
function sketch(colorway: 'light' | 'dark', page: RenderTheme['page']): RenderTheme {
  const S = CANVAS_TOKENS[colorway];
  return {
    name: colorway === 'light' ? 'sketch-light' : 'sketch-dark',
    colorway,
    font: CANVAS_FONT,
    mono: MONO,
    colors: {
      background: S.paper,
      surface: S.surface,
      text: S.ink,
      muted: S.muted,
      line: S.muted,
      border: S.ink,
      active: S.accent,
      error: S.fail,
      par: S.muted,
      shadow: S.shadow,
      request: S.ink,
      stepText: S.ink,
      stepStroke: S.ink,
      lifeline: S.muted,
      lifelineOpacity: 0.6,
      edge: S.muted,
      team: S.muted,
    },
    card: { rx: 4, stroke: 3, shadow: 'hard' },
    iconTile: 'outline',
    handles: true,
    stroke: 2,
    categoryTint: true,
    group: { fill: S.ink, fillOpacity: 0.03, line: S.ink, lineOpacity: 0.45, rx: 10, title: 'caps' },
    // TextNode: `--c-yellow` at 22% over the surface.
    note: { fill: '#FFD23F', icon: S.ink, title: S.ink, body: S.ink },
    bold: 700,
    page,
  };
}

/** The HLD page's tables and statuses on a dark page (sketch-light for a dark-scheme reader, and sketch-dark). */
const SKETCH_DARK_DOCUMENT = '--surface: #1e1d24; --rule: #3a3744; --pass: #4ade80; --warn: #fbbf24; --link-decoration: underline;';

export const SKETCH_LIGHT: RenderTheme = sketch('light', {
  light: '--bg: #ffffff; --fg: #111111; --muted: #5b5b5b; --card: #fff8e7; --border: #111111; --link: #111111; --error: #ff3b30;',
  dark: '--bg: #141318; --fg: #f4efe3; --muted: #a9a5b4; --card: #fff8e7; --border: #f4efe3; --link: #f4efe3; --error: #ff6b61;',
  figure: 'background: var(--card); border: 2px solid var(--border); border-radius: 4px; box-shadow: 3px 3px 0 var(--border);',
  document: {
    light: '--surface: #fff8e7; --rule: #d6cfbf; --pass: #15803d; --warn: #b45309; --link-decoration: underline;',
    dark: SKETCH_DARK_DOCUMENT,
  },
});

// Dark pictures read best on a dark page whatever the reader's colour scheme, so both sets are dark.
const DARK_PAGE = '--bg: #0d0c10; --fg: #f4efe3; --muted: #a9a5b4; --card: #141318; --border: #605496; --link: #ff7ab4; --error: #ff6b61;';
export const SKETCH_DARK: RenderTheme = sketch('dark', {
  light: DARK_PAGE,
  dark: DARK_PAGE,
  figure: 'background: var(--card); border: 2px solid var(--border); border-radius: 4px; box-shadow: 3px 3px 0 var(--border);',
  document: { light: SKETCH_DARK_DOCUMENT, dark: SKETCH_DARK_DOCUMENT },
});

/** The default theme (`sketch-light`). */
export const SKETCH = SKETCH_LIGHT;

export const CLASSIC: RenderTheme = {
  name: 'classic',
  colorway: 'light',
  font: CANVAS_FONT,
  colors: {
    background: '#ffffff',
    surface: '#ffffff',
    text: TAILWIND_HEX['text-gray-800'],
    muted: TAILWIND_HEX['text-gray-500'],
    line: '#6b7280',
    border: TAILWIND_HEX['border-gray-300'],
    active: '#3b82f6',
    error: '#dc2626',
    par: '#6366f1',
    shadow: '#000000',
    request: '#3b82f6',
    stepText: '#ffffff',
    stepStroke: undefined,
    lifeline: TAILWIND_HEX['border-gray-300'],
    lifelineOpacity: undefined,
    edge: '#b1b1b7',
    team: TAILWIND_HEX['text-gray-600'],
  },
  card: { rx: 8, stroke: 2, shadow: 'soft' },
  iconTile: 'filled',
  handles: false,
  stroke: 1.5,
  categoryTint: false,
  group: { fill: '#f0f9ff', line: '#3b82f6', rx: 8, title: 'plain' },
  note: {
    fill: TAILWIND_HEX['bg-yellow-100'],
    border: TAILWIND_HEX['border-yellow-300'],
    icon: TAILWIND_HEX['text-yellow-600'],
    title: TAILWIND_HEX['text-yellow-800'],
    body: TAILWIND_HEX['text-gray-700'],
  },
  bold: 600,
  page: {
    light: '--bg: #f8fafc; --fg: #1f2937; --muted: #6b7280; --card: #ffffff; --border: #e5e7eb; --link: #2563eb; --error: #dc2626;',
    dark: '--bg: #0f172a; --fg: #e5e7eb; --muted: #94a3b8; --card: #ffffff; --border: #334155; --link: #93c5fd; --error: #f87171;',
    figure: 'background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 8px;',
    document: {
      light: '--surface: #ffffff; --rule: #e5e7eb; --pass: #15803d; --warn: #b45309;',
      dark: '--surface: #1e293b; --rule: #334155; --pass: #4ade80; --warn: #fbbf24;',
    },
  },
};

const THEMES: Record<ThemeName, RenderTheme> = { 'sketch-light': SKETCH_LIGHT, 'sketch-dark': SKETCH_DARK, classic: CLASSIC };

/** A theme name or an alias of one. */
export function isThemeName(name: unknown): name is ThemeName | keyof typeof THEME_ALIASES {
  return typeof name === 'string' && ((THEME_NAMES as readonly string[]).includes(name) || Object.hasOwn(THEME_ALIASES, name));
}

/** The theme called `name` or its alias (default: sketch-light); throws an Error listing the valid names for an unknown one. */
export function getTheme(name: string = DEFAULT_THEME): RenderTheme {
  if (!isThemeName(name)) throw new Error(`Unknown theme '${name}'; use ${THEME_CHOICES.join(', ')}`);
  return THEMES[(THEME_ALIASES[name] ?? name) as ThemeName];
}

/** The sketch theme of a canvas colourway: what upstream's `theme: 'light' | 'dark'` draws in. */
export function sketchOf(colorway: 'light' | 'dark'): RenderTheme {
  return colorway === 'dark' ? SKETCH_DARK : SKETCH_LIGHT;
}

/** A render theme, given one or a canvas colourway; undefined stays undefined. */
export function asRenderTheme(theme: 'light' | 'dark' | RenderTheme | undefined): RenderTheme | undefined {
  return typeof theme === 'string' ? sketchOf(theme) : theme;
}
