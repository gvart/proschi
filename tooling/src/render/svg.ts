/**
 * Shared pieces of the SVG renderers: escaping, a text width estimate (there
 * is no browser to measure with), colours and the font stack. Everything is
 * written as presentation attributes, so the SVGs need no stylesheet and work
 * under a strict Content-Security-Policy.
 */

import { CANVAS_FONT } from '../../../frontend/src/utils/canvasColors';
import { SKETCH_LIGHT, sketchOf, type RenderTheme, type ThemeColors } from './theme';

/** The editor's font stack (Tailwind's `font-sans`). */
export const FONT = CANVAS_FONT;

/** The canvas's monospace font (`--font-mono`), for tech stacks and edge labels. */
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** The canvas's colourways. Drawing in one draws in its sketch render theme (theme.ts). */
export type Theme = 'light' | 'dark';

/**
 * The design tokens being drawn with (sketch-light unless drawn `withTheme`): paper background, white cards, ink borders; `active` and `error` are what use case playback highlights with.
 * Read at draw time, so code drawing inside `withTheme` gets that theme's values.
 */
export const COLORS: ThemeColors = { ...SKETCH_LIGHT.colors };

let active: RenderTheme = SKETCH_LIGHT;

/** The colourway being drawn (a classic drawing is light). */
export const currentTheme = (): Theme => active.colorway;

/** The render theme being drawn: its non-colour tokens (corners, shadows, icon tiles, fonts). */
export const currentRenderTheme = (): RenderTheme => active;

/**
 * Runs `draw` (synchronous) with COLORS set to `next`'s tokens, then puts the
 * ones before back. `next` is a colourway (its sketch theme) or a render theme.
 */
export function withTheme<T>(next: Theme | RenderTheme, draw: () => T): T {
  const th = typeof next === 'string' ? sketchOf(next) : next;
  if (th === active) return draw();
  const before = { ...COLORS };
  const was = active;
  Object.assign(COLORS, th.colors);
  active = th;
  try {
    return draw();
  } finally {
    Object.assign(COLORS, before);
    active = was;
  }
}

export interface CardOptions {
  fill?: string;
  stroke?: number;
  rx?: number;
  shadow?: boolean;
  line?: string;
  dash?: string;
  /** Recolours the hard shadow (drawn even in a soft-shadow theme). */
  shade?: string;
  /** How far the hard shadow sits off the card (3). */
  depth?: number;
  /** Id of the soft drop-shadow filter (classic); without it a soft-shadow theme draws no shadow. */
  shadowId?: string;
}

/**
 * A card in the theme being drawn: `fill` and a border of `stroke` px, with the
 * canvas's hard 3px shadow (`--sh-sm`), or classic's soft drop shadow when
 * `shadowId` names its filter; `shade` and `depth` recolour and deepen the hard shadow.
 */
export function card(x: number, y: number, w: number, h: number, o: CardOptions = {}): string {
  const th = active;
  const sw = o.stroke ?? th.card.stroke;
  const rx = o.rx ?? th.card.rx;
  const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : '';
  const hard = o.shadow !== false && (th.card.shadow === 'hard' || o.shade !== undefined);
  const soft = o.shadow !== false && !hard && o.shadowId ? ` filter="url(#${o.shadowId})"` : '';
  return [
    hard ? `<rect x="${r(x + (o.depth ?? 3))}" y="${r(y + (o.depth ?? 3))}" width="${r(w)}" height="${r(h)}" rx="${rx}" fill="${o.shade ?? COLORS.shadow}"/>` : '',
    `<rect x="${r(x + sw / 2)}" y="${r(y + sw / 2)}" width="${r(w - sw)}" height="${r(h - sw)}" rx="${rx}" fill="${o.fill ?? COLORS.surface}" stroke="${o.line ?? COLORS.border}" stroke-width="${sw}"${dash}${soft}/>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** classic's card shadow (the canvas's old `shadow-md`), as a filter with id `id`. */
export function softShadow(id: string): string {
  // feDropShadow(dy 3, blur 4, black at 10%) spelled in SVG 1.1 primitives, which Inkscape and librsvg also draw.
  return [
    `<filter id="${id}" x="-10%" y="-10%" width="120%" height="140%">`,
    '<feGaussianBlur in="SourceAlpha" stdDeviation="4"/>',
    '<feOffset dx="0" dy="3" result="blur"/>',
    '<feFlood flood-color="#000000" flood-opacity="0.1"/>',
    '<feComposite in2="blur" operator="in"/>',
    '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>',
    '</filter>',
  ].join('');
}

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Rough advance width of `text` in the system sans-serif font, in px. */
export function textWidth(text: string, size: number, bold = false): number {
  let em = 0;
  for (const c of text) {
    if ("il.,:;|!'`ijtf ()[]{}".includes(c)) em += 0.32;
    else if ('mwMW@%'.includes(c)) em += 0.86;
    else if (c >= 'A' && c <= 'Z') em += 0.68;
    else if (c.charCodeAt(0) > 0x2e7f) em += 1;
    else em += 0.56;
  }
  return em * size * (bold ? 1.07 : 1);
}

/** Cuts `text` so it fits `max` px, ending with an ellipsis. */
export function fit(text: string, max: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= max) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** Splits `text` into at most `maxLines` lines of at most `max` px. */
export function wrap(text: string, max: number, size: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, size) > max) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fit(`${lines[maxLines - 1]} …`, max, size);
  }
  return lines.map((l) => fit(l, max, size));
}

export interface TextOptions {
  size?: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
  opacity?: number;
  spacing?: number;
}

export function text(x: number, y: number, content: string, o: TextOptions = {}): string {
  const attrs = [
    `x="${r(x)}"`,
    `y="${r(y)}"`,
    `font-size="${o.size ?? 13}"`,
    o.weight ? `font-weight="${o.weight}"` : '',
    `fill="${o.fill ?? COLORS.text}"`,
    o.anchor && o.anchor !== 'start' ? `text-anchor="${o.anchor}"` : '',
    o.family ? `font-family="${o.family}"` : '',
    o.opacity !== undefined ? `fill-opacity="${o.opacity}"` : '',
    o.spacing ? `letter-spacing="${o.spacing}"` : '',
  ].filter(Boolean);
  // Always escaped: labels come from the document, and one starting with `<tspan` once went out as raw markup.
  return `<text ${attrs.join(' ')}>${esc(content)}</text>`;
}

/** Rounds coordinates to one decimal so the output stays small and stable. */
export function r(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The outer `<svg>` element with the theme's opaque background, so it reads well in dark viewers too. */
export function svgDocument(width: number, height: number, title: string, body: string[], defs = ''): string {
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${active.font}" role="img">`,
    `<title>${esc(title)}</title>`,
    defs ? `<defs>${defs}</defs>` : '',
    `<rect width="100%" height="100%" fill="${COLORS.background}"/>`,
    ...body,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * An arrowhead marker for `marker-end`; `open` draws a chevron instead of a
 * filled triangle. `orient="auto"` turns it along the line, so a reply drawn
 * right to left points left into its receiver; resvg (the terminal's
 * pictures) reads `auto-start-reverse` as no turn at all.
 */
export function marker(id: string, color: string, open = false): string {
  const shape = open
    ? `<path d="M1,1 L9,5 L1,9" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`
    : `<path d="M0,0 L10,5 L0,10 z" fill="${color}"/>`;
  return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">${shape}</marker>`;
}
