import { CANVAS_TOKENS } from '../utils/canvasColors';
import { kindOf } from './kinds';
import type { DiagramNode, Kind } from './types';

/**
 * Colors of nodes, groups and edges: the named palette of `color <name>`, the
 * default color of each node category, and how a base color becomes a calm
 * fill and a matching border in the light and the dark theme.
 *
 * Every color, named or `#hex`, is a base hue. The fill is a little of it
 * mixed into the card surface and the border is mostly it mixed with the ink,
 * so text stays the theme's ink on a near-surface fill (WCAG AA for any base)
 * and the same rule works in both themes. The canvas does the mix in CSS
 * (`color-mix`, so it follows a theme switch); exporters without CSS get the
 * same values in hex.
 */

/** `color <name>`: base hues, mid-tone so they mix well into both themes. */
export const PALETTE = {
  gray: '#6b7280',
  blue: '#3b82f6',
  teal: '#14b8a6',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
  purple: '#a855f7',
  pink: '#ec4899',
} as const;

export type ColorName = keyof typeof PALETTE;
export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The base hex of a palette name or a `#rgb` / `#rrggbb` value, lower case and six digits; undefined when it is neither. */
export function resolveColor(text: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(PALETTE, text)) return PALETTE[text as ColorName];
  if (!HEX.test(text)) return undefined;
  const digits = text.slice(1).toLowerCase();
  return '#' + (digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits);
}

/** The node categories that get a default color (D1). */
export type Category = 'client' | 'edge' | 'service' | 'data' | 'queue' | 'external';

const CATEGORY_OF_KIND: Record<Kind, Category | undefined> = {
  client: 'client',
  edge: 'edge',
  cdn: 'edge',
  loadbalancer: 'edge',
  gateway: 'edge',
  dns: 'edge',
  service: 'service',
  function: 'service',
  cache: 'data',
  database: 'data',
  search: 'data',
  analytics: 'data',
  storage: 'data',
  queue: 'queue',
  broker: 'queue',
  external: 'external',
  other: undefined,
};

/** The palette color of each category. */
export const CATEGORY_COLOR: Record<Category, ColorName> = {
  client: 'gray',
  edge: 'purple',
  service: 'blue',
  data: 'green',
  queue: 'orange',
  external: 'pink',
};

export function categoryOf(kind: Kind): Category | undefined {
  return CATEGORY_OF_KIND[kind];
}

/**
 * The base color a node is drawn with: its own `color`, else its tag's, else
 * its category's (D4). Groups and notes have no category color.
 */
export function nodeBaseColor(node: Pick<DiagramNode, 'kind' | 'type' | 'techStack' | 'inferredKind' | 'style'>): string | undefined {
  if (node.style?.color) return node.style.color;
  if (node.kind !== 'component') return undefined;
  const category = categoryOf(kindOf(node));
  return category ? PALETTE[CATEGORY_COLOR[category]] : undefined;
}

/** How much of the base goes into a node's fill, a group's fill, and a border or edge stroke. */
export const MIX = { fill: 0.12, groupFill: 0.06, line: 0.72 } as const;

export type Theme = 'light' | 'dark';

export interface Tint {
  fill: string;
  groupFill: string;
  /** Border of a node or group, stroke of an edge, a group's name. */
  line: string;
  /** Text on the fill: the theme's ink. */
  text: string;
}

/** The fill, border and text of a base color in one theme, in hex: for exporters without CSS. */
export function tint(base: string, theme: Theme): Tint {
  const { surface, ink } = CANVAS_TOKENS[theme];
  return {
    fill: mix(base, surface, MIX.fill),
    groupFill: mix(base, surface, MIX.groupFill),
    line: mix(base, ink, MIX.line),
    text: ink,
  };
}

/** The same mix as `tint`, as CSS that follows the theme's tokens. */
export function cssTint(base: string): Omit<Tint, 'text'> {
  const pct = (share: number) => `${Math.round(share * 100)}%`;
  return {
    fill: `color-mix(in srgb, ${base} ${pct(MIX.fill)}, rgb(var(--c-surface)))`,
    groupFill: `color-mix(in srgb, ${base} ${pct(MIX.groupFill)}, rgb(var(--c-surface)))`,
    line: `color-mix(in srgb, ${base} ${pct(MIX.line)}, rgb(var(--c-ink)))`,
  };
}

/** SVG `stroke-dasharray` of a dash, for a stroke of width 2. */
export const DASH_ARRAY: Record<'dashed' | 'dotted', string> = { dashed: '7 5', dotted: '2 4' };

/** `share` of `a` mixed with `1 - share` of `b`, per sRGB channel, like CSS `color-mix(in srgb, …)`. */
export function mix(a: string, b: string, share: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((c, i) => Math.round(c * share + y[i] * (1 - share)).toString(16).padStart(2, '0')).join('');
}

/** WCAG contrast ratio of two hex colors. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgb(hex: string): number[] {
  const full = resolveColor(hex) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The closest palette name to a misspelt one, for "Did you mean …?". */
export function suggestColor(text: string): ColorName | undefined {
  const word = text.toLowerCase();
  let best: { name: ColorName; distance: number } | undefined;
  for (const name of COLOR_NAMES) {
    const distance = editDistance(word, name);
    if (distance <= 2 && (!best || distance < best.distance)) best = { name, distance };
  }
  return best?.name;
}

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}
