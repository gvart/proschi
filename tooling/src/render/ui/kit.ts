import { esc, r } from '../svg';
import type { Control, Icon, Rich, Span, Tone, TileControl } from './contract';
import { clip, measure } from './metrics';
import { alpha, mix, type Palette } from './theme';

/**
 * The UI kit's drawing: a Surface collects SVG for a panel `columns` cells
 * wide, in CSS px where a cell is CELL (8×17, as a terminal's cell is about
 * 1:2.1: Ghostty's, kitty's and iTerm2's with their default fonts), and the
 * controls placed on it, each snapped to whole columns so its tile is its
 * own. Controls are drawn by state, so a panel can be drawn again with one
 * of them under the pointer or pressed, for its hover and pressed tiles.
 * Nothing uses nested <svg> or group opacity, which resvg cannot crop.
 */

export const CELL = { width: 8, height: 17 };

export const SANS = 'Inter';
export const MONO_FAMILY = 'JetBrains Mono';

export type ControlState = 'rest' | 'hover' | 'pressed';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  control: TileControl;
  /** Its drawn extent, px; its tile is the cells it touches. */
  box: Box;
  draw: (state: ControlState) => string;
}

/**
 * What a strip boundary must not cross, as [top, bottom] px: every line of
 * text, chip, icon, bar and control, and whatever a layout keeps whole. A
 * terminal fits each picture into its cells keeping its aspect ratio, so two
 * strips can meet a pixel or two apart; cut between lines, that never shows
 * in a glyph.
 */
export type Reach = [number, number];

/** A glyph's reach around its baseline, as a share of the type size: Inter's ascender (accents included) and descender. */
const ASCENT = 0.98;
const DESCENT = 0.26;
/** Shapes at most this tall are kept whole (chips, keycaps, bars, buttons); taller ones are cards, cut between their lines. */
const SMALL_SHAPE = 40;

/** The spans of an SVG fragment: its <text> lines, small rects and circles, and the icons (their 16 px box, scaled). */
export function reachOf(svg: string): Reach[] {
  const out: Reach[] = [];
  for (const m of svg.matchAll(/<text [^>]*?y="([-\d.]+)" font-size="([\d.]+)"/g)) {
    const y = Number(m[1]);
    const size = Number(m[2]);
    out.push([y - ASCENT * size, y + DESCENT * size]);
  }
  for (const m of svg.matchAll(/<rect [^>]*?y="([-\d.]+)" width="[\d.]+" height="([\d.]+)"/g)) {
    const h = Number(m[2]);
    if (h <= SMALL_SHAPE) out.push([Number(m[1]), Number(m[1]) + h]);
  }
  for (const m of svg.matchAll(/<circle [^>]*?cy="([-\d.]+)" r="([\d.]+)"/g)) out.push([Number(m[1]) - Number(m[2]), Number(m[1]) + Number(m[2])]);
  for (const m of svg.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/g)) out.push([Number(m[2]), Number(m[2]) + 16 * Number(m[3])]);
  return out;
}

export class Surface {
  private parts: (string | { control: string } | { svg: string; box: Box })[] = [];
  readonly controls: Placed[] = [];
  readonly spans: Reach[] = [];
  private cards: Reach[] = [];

  constructor(
    readonly P: Palette,
    readonly columns: number,
  ) {}

  get width(): number {
    return this.columns * CELL.width;
  }

  /** SVG drawn under everything added so far (the surface's own background). */
  under(svg: string): void {
    this.parts.unshift(svg);
  }

  add(...svg: string[]): void {
    for (const s of svg) {
      if (!s) continue;
      this.parts.push(s);
      this.spans.push(...reachOf(s));
    }
  }

  /** Keeps `top` to `bottom` (px) in one strip: a drawing that must not be cut (a stat card, a code box, a chart). */
  keep(top: number, bottom: number): void {
    if (bottom > top) this.spans.push([top, bottom]);
  }

  /** SVG within `box`, left out of a cropped drawing it does not reach: a part resvg cannot crop (nested <svg>) stays out of the crops of controls elsewhere. Kept whole. */
  addWithin(box: Box, svg: string): void {
    this.parts.push({ svg, box });
    this.keep(box.y, box.y + box.h);
  }

  place(p: Placed): void {
    if (this.controls.some((c) => c.control.id === p.control.id)) throw new Error(`Two controls with the id '${p.control.id}'`);
    this.controls.push(p);
    this.parts.push({ control: p.control.id });
    this.keep(p.box.y, p.box.y + p.box.h);
  }

  /** Marks `top` to `bottom` (px) as a card: a strip may end inside it, but better between cards, where the terminal's background is. */
  card(top: number, bottom: number): void {
    this.cards.push([top, bottom]);
  }

  /** Where a strip may end, by row boundary: 0 where a span crosses it, 1 inside a card, 2 between cards (0 and `rows` always 2). */
  cuttable(rows: number): (row: number) => 0 | 1 | 2 {
    const level = new Uint8Array(rows + 1).fill(2);
    const mark = (spans: Reach[], to: 0 | 1) => {
      for (const [top, bottom] of spans) {
        for (let b = Math.max(1, Math.floor(top / CELL.height) + 1); b <= Math.min(rows - 1, Math.ceil(bottom / CELL.height) - 1); b++) {
          const y = b * CELL.height;
          if (top < y - 0.25 && bottom > y + 0.25) level[b] = Math.min(level[b], to);
        }
      }
    };
    mark(this.cards, 1);
    mark(this.spans, 0);
    return (row) => (row <= 0 || row >= rows ? 2 : (level[row] as 0 | 1 | 2));
  }

  /**
   * The panel as SVG `height` px tall, controls in their states (rest unless
   * named); `crop` draws only that window. `px`, the picture's size, may
   * stretch it unevenly (a cell drawn taller or shorter than 8×17 for the
   * terminal's own); absent, it is the window's size. The background is the
   * panel's surface (`surfaceFrame`), drawn first.
   */
  svg(height: number, states: Map<string, ControlState> = new Map(), crop?: Box, px?: { width: number; height: number }): string {
    const byId = new Map(this.controls.map((c) => [c.control.id, c]));
    const view = crop ?? { x: 0, y: 0, w: this.width, h: height };
    const meets = (b: Box) => b.x < view.x + view.w && b.x + b.w > view.x && b.y < view.y + view.h && b.y + b.h > view.y;
    const body = this.parts
      .map((p) => (typeof p === 'string' ? p : 'control' in p ? byId.get(p.control)!.draw(states.get(p.control) ?? 'rest') : meets(p.box) ? p.svg : ''))
      .filter(Boolean)
      .join('\n');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px?.width ?? view.w}" height="${px?.height ?? view.h}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}"${px ? ' preserveAspectRatio="none"' : ''} font-family="${SANS}">`,
      body,
      '</svg>',
    ].join('\n');
  }
}

// ---------- the surface ----------

/** Where a panel or the diagram's strip sits in its drawing: its first (top) or last (bottom) piece, or both. */
export interface Edges {
  top?: boolean;
  bottom?: boolean;
}

/** The radius of a drawing's outer corners, px. */
export const SURFACE_RADIUS = 8;

/**
 * A piece of a drawing's one continuous surface, `w` × `h` px: the opaque
 * fill edge to edge, a hairline down both sides, rounded corners and a
 * hairline across only at the drawing's top and bottom (`edges`), and a
 * divider along its top where another piece is above it. The corners
 * outside a rounded one stay transparent.
 */
export function surfaceFrame(P: Palette, w: number, h: number, edges: Edges = {}): string {
  const R = SURFACE_RADIUS;
  const t = edges.top === true;
  const b = edges.bottom === true;
  const rt = t ? R : 0;
  const rb = b ? R : 0;
  const fill = [`M0 ${rt}`, t ? `A${R} ${R} 0 0 1 ${R} 0` : '', `H${w - rt}`, t ? `A${R} ${R} 0 0 1 ${w} ${R}` : '', `V${h - rb}`, b ? `A${R} ${R} 0 0 1 ${w - R} ${h}` : '', `H${rb}`, b ? `A${R} ${R} 0 0 1 0 ${h - R}` : '', 'Z'].filter(Boolean).join(' ');
  const r = R - 0.5;
  const strokes = [`M0.5 ${t ? R : 0} V${b ? h - R : h}`, `M${w - 0.5} ${t ? R : 0} V${b ? h - R : h}`];
  if (t) strokes.push(`M0.5 ${R} A${r} ${r} 0 0 1 ${R} 0.5 H${w - R} A${r} ${r} 0 0 1 ${w - 0.5} ${R}`);
  if (b) strokes.push(`M${w - 0.5} ${h - R} A${r} ${r} 0 0 1 ${w - R} ${h - 0.5} H${R} A${r} ${r} 0 0 1 0.5 ${h - R}`);
  return [
    `<path d="${fill}" fill="${P.card.fill}"/>`,
    `<path d="${strokes.join(' ')}" fill="none" stroke="${P.card.line}" stroke-width="1"/>`,
    t ? '' : line(1, 0.5, w - 1, 0.5, P.line, 1),
  ].join('');
}

// ---------- text ----------

export interface TextStyle {
  size?: number;
  weight?: number;
  color?: string;
  mono?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  spacing?: number;
}

export function txt(x: number, y: number, content: string, s: TextStyle = {}): string {
  if (!content) return '';
  const attrs = [
    `x="${r(x)}"`,
    `y="${r(y)}"`,
    `font-size="${s.size ?? 13}"`,
    `font-weight="${s.mono && (s.weight ?? 500) < 700 ? 500 : (s.weight ?? 500)}"`,
    `fill="${s.color ?? '#000'}"`,
    s.mono ? `font-family="${MONO_FAMILY}"` : '',
    s.anchor && s.anchor !== 'start' ? `text-anchor="${s.anchor}"` : '',
    s.spacing ? `letter-spacing="${s.spacing}"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')} xml:space="preserve">${esc(content)}</text>`;
}

export const width = (content: string, s: TextStyle = {}) => measure(content, s.size ?? 13, s.weight ?? 500, s.mono) + (s.spacing ?? 0) * [...content].length;

export function rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string } = {}): string {
  const sw = o.sw ?? 0;
  return `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(0, w))}" height="${r(Math.max(0, h))}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${o.fill ?? 'none'}"${o.stroke && sw ? ` stroke="${o.stroke}" stroke-width="${sw}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, color: string, sw = 1, dash?: string): string {
  return `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${color}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
}

export const toneColor = (P: Palette, tone: Tone | undefined, fallback = P.ink) => (tone ? P.tone[tone] : fallback);

const CHIP_OF: Record<Tone, keyof Palette['chip']> = { ink: 'gray', muted: 'gray', accent: 'pink', good: 'green', warn: 'yellow', bad: 'red', info: 'blue' };

/** A chip: a pill of `text` in a tone, `size` px type, its left at x and its text's baseline at y. */
export function chip(P: Palette, x: number, y: number, text: string, tone: Tone, size = 12): { svg: string; width: number } {
  const c = P.chip[CHIP_OF[tone]];
  const w = width(text, { size, weight: 600 }) + 12;
  const h = size + 7;
  return {
    svg: [rect(x, y - size - 1.5, w, h, { fill: c.fill, rx: 4 }), txt(x + 6, y, text, { size, weight: 600, color: c.text })].join(''),
    width: w,
  };
}

/** A chip of a named tint (Sync green, Async purple, Fire & Forget orange). */
export function tint(P: Palette, x: number, y: number, text: string, color: keyof Palette['chip'], size = 12): { svg: string; width: number } {
  const c = P.chip[color];
  const w = width(text, { size, weight: 600 }) + 12;
  return { svg: [rect(x, y - size - 1.5, w, size + 7, { fill: c.fill, rx: 4 }), txt(x + 6, y, text, { size, weight: 600, color: c.text })].join(''), width: w };
}

export const spansOf = (rich: Rich): Span[] => (typeof rich === 'string' ? [{ text: rich }] : rich);

export const plain = (rich: Rich) => spansOf(rich).map((s) => s.text).join('');

/** A piece of a laid-out line: a span's words, or a chip, at `x` from the line's start. */
interface Piece {
  span: Span;
  text: string;
  x: number;
  w: number;
}

interface Laid {
  pieces: Piece[];
  width: number;
}

const styleOf = (s: Span, base: TextStyle): TextStyle => ({ ...base, weight: s.bold ? Math.max(600, base.weight ?? 400) : base.weight, mono: s.mono ?? base.mono });

const pieceWidth = (s: Span, text: string, base: TextStyle) => (s.chip ? width(text, { size: (base.size ?? 13) - 1.5, weight: 600 }) + 12 : width(text, styleOf(s, base)));

/** `text` cut into pieces each at most `max` px wide (at least one character each): a word too long for its line, broken rather than clipped. */
export function breakWord(text: string, max: number, s: TextStyle): string[] {
  const chars = [...text];
  const out: string[] = [];
  let cur = '';
  for (const ch of chars) {
    if (cur && measure(cur + ch, s.size ?? 13, s.weight ?? 500, s.mono) > max) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Rich text broken into lines of at most `max` px (one line, clipped, with `max` and `wrap` false); a word wider than a line is broken. */
export function layoutRich(rich: Rich, max: number, base: TextStyle, wrap = true): Laid[] {
  const lines: Laid[] = [{ pieces: [], width: 0 }];
  const gap = width(' ', base);
  for (const span of spansOf(rich)) {
    if (span.chip) {
      const w = pieceWidth(span, span.text, base);
      let cur = lines.at(-1)!;
      if (wrap && cur.pieces.length && cur.width + gap + w > max) lines.push((cur = { pieces: [], width: 0 }));
      const x = cur.width + (cur.pieces.length ? 4 : 0);
      cur.pieces.push({ span, text: span.text, x, w });
      cur.width = x + w + 4;
      continue;
    }
    if (!wrap) {
      const cur = lines[0];
      const text = clip(span.text, Math.max(0, max - cur.width), base.size ?? 13, styleOf(span, base).weight, styleOf(span, base).mono);
      const w = pieceWidth(span, text, base);
      if (text) cur.pieces.push({ span, text, x: cur.width, w });
      cur.width += w;
      continue;
    }
    // Words, each with the spaces before it; one wider than a whole line goes on in pieces on the lines after.
    for (const word of span.text.match(/\s*\S+|\s+$/g) ?? []) {
      let cur = lines.at(-1)!;
      const w = pieceWidth(span, word, base);
      if (cur.width + w <= max || !word.trim()) {
        const text = cur.pieces.length ? word : word.trimStart();
        const tw = pieceWidth(span, text, base);
        cur.pieces.push({ span, text, x: cur.width, w: tw });
        cur.width += tw;
        continue;
      }
      const bare = word.trimStart();
      if (cur.pieces.length) lines.push((cur = { pieces: [], width: 0 }));
      const parts = pieceWidth(span, bare, base) <= max ? [bare] : breakWord(bare, max, styleOf(span, base));
      parts.forEach((text, i) => {
        if (i > 0) lines.push((cur = { pieces: [], width: 0 }));
        const tw = pieceWidth(span, text, base);
        cur.pieces.push({ span, text, x: 0, w: tw });
        cur.width = tw;
      });
    }
  }
  return lines;
}

/** Draws one laid-out line with its baseline at y. */
export function drawLaid(P: Palette, laid: Laid, x: number, y: number, base: TextStyle, color: string): string {
  return laid.pieces
    .map((p) => {
      if (p.span.chip) return chip(P, x + p.x, y, p.text, p.span.chip, (base.size ?? 13) - 1.5).svg;
      const s = styleOf(p.span, base);
      return txt(x + p.x, y, p.text, { ...s, color: p.span.tone ? P.tone[p.span.tone] : color });
    })
    .join('');
}

/** Rich text from (x, top) in lines `lineHeight` apart; returns the SVG and the height used. */
export function paragraph(P: Palette, rich: Rich, x: number, top: number, max: number, base: TextStyle, color: string, lineHeight = Math.round((base.size ?? 13) * 1.5), maxLines = Infinity): { svg: string; height: number; lines: number } {
  let lines = layoutRich(rich, max, base);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines.at(-1)!;
    const tail = last.pieces.at(-1);
    if (tail) tail.text = clip(`${tail.text}…`, max - tail.x, base.size ?? 13, styleOf(tail.span, base).weight);
  }
  const size = base.size ?? 13;
  const svg = lines.map((l, i) => drawLaid(P, l, x, top + i * lineHeight + (lineHeight + size * 0.72) / 2, base, color)).join('');
  return { svg, height: lines.length * lineHeight, lines: lines.length };
}

// ---------- icons ----------

/** Lucide-like glyphs in a 16 px box: strokes unless filled. */
const ICONS: Record<Icon, { d: string; fill?: boolean; extra?: string }> = {
  play: { d: 'M5 2.8 L13.2 8 L5 13.2 Z', fill: true },
  pause: { d: 'M4 3 H7 V13 H4 Z M9 3 H12 V13 H9 Z', fill: true },
  first: { d: 'M3.5 3 V13', extra: 'M13 3.2 L6 8 L13 12.8 Z' },
  prev: { d: 'M10 3 L5 8 L10 13' },
  next: { d: 'M6 3 L11 8 L6 13' },
  last: { d: 'M12.5 3 V13', extra: 'M3 3.2 L10 8 L3 12.8 Z' },
  exit: { d: 'M4 4 L12 12 M12 4 L4 12' },
  cross: { d: 'M4 4 L12 12 M12 4 L4 12' },
  back: { d: 'M13 8 H3 M7 4 L3 8 L7 12' },
  copy: { d: 'M6 5.5 H12 A1.5 1.5 0 0 1 13.5 7 V12.5 A1.5 1.5 0 0 1 12 14 H6 A1.5 1.5 0 0 1 4.5 12.5 V7 A1.5 1.5 0 0 1 6 5.5 Z M2.5 10.5 V3.5 A1.5 1.5 0 0 1 4 2 H10' },
  open: { d: 'M9.5 2.5 H13.5 V6.5 M13.5 2.5 L7.5 8.5 M11.5 9.5 V13.5 H2.5 V4.5 H6.5' },
  focus: { d: 'M2.5 6 V2.5 H6 M10 2.5 H13.5 V6 M13.5 10 V13.5 H10 M6 13.5 H2.5 V10' },
  explore: { d: 'M2.5 4 H13.5 M2.5 8 H13.5 M2.5 12 H13.5' },
  reset: { d: 'M2.8 8 A5.2 5.2 0 1 0 4.4 4.3 M2.5 2 V5.2 H5.7' },
  power: { d: 'M8 1.8 V7.5 M4.6 4.2 A5.2 5.2 0 1 0 11.4 4.2' },
  expand: { d: 'M3 3 H13 V13 H3 Z M8 5.5 V10.5 M5.5 8 H10.5' },
  collapse: { d: 'M3 3 H13 V13 H3 Z M5.5 8 H10.5' },
  enter: { d: 'M2.5 2.5 H6 M2.5 2.5 V6 M13.5 13.5 H10 M13.5 13.5 V10 M3 3 L7 7 M13 13 L9 9' },
  leave: { d: 'M8 13.5 V2.5 M3.5 7 L8 2.5 L12.5 7' },
  cycle: { d: 'M2.5 8 H11.5 M8.5 4.5 L12 8 L8.5 11.5 M13.8 3.5 V12.5' },
  'chevron-down': { d: 'M4 6 L8 10 L12 6' },
  check: { d: 'M3 8.5 L6.5 12 L13 4.5' },
  warn: { d: 'M8 2 L14.6 13.6 H1.4 Z', extra: 'M8 6.3 V9.6 M8 11.6 V11.7' },
  bolt: { d: 'M9.2 1.5 L3.5 9 H8 L6.8 14.5 L12.5 7 H8 Z', fill: true },
};

/** An icon `size` px square at (x, y) in `color`. */
export function icon(name: Icon, x: number, y: number, size: number, color: string, sw = 1.8): string {
  const g = ICONS[name];
  const k = size / 16;
  const stroke = `fill="none" stroke="${color}" stroke-width="${r(sw / k)}" stroke-linecap="round" stroke-linejoin="round"`;
  const main = g.fill ? `<path d="${g.d}" fill="${color}" stroke="${color}" stroke-width="${r(1 / k)}" stroke-linejoin="round"/>` : `<path d="${g.d}" ${stroke}/>`;
  const extra = g.extra ? (name === 'warn' ? `<path d="${g.extra}" ${stroke}/>` : `<path d="${g.extra}" fill="${color}" stroke="${color}" stroke-width="${r(1 / k)}" stroke-linejoin="round"/>`) : '';
  return `<g transform="translate(${r(x)} ${r(y)}) scale(${Math.round(k * 1000) / 1000})">${main}${extra}</g>`;
}

// ---------- controls ----------

/**
 * A control's height and its type size: the label as large as the terminal's
 * own text (a cell is 8×16 px, so 14 px type), the control in a row three
 * cells tall (CONTROL_ROW in blocks.ts).
 */
export const CONTROL = { height: 34, size: 14, pad: 12, icon: 16, gap: 7, keycap: 18 };

const KEY = { size: 10.5, mono: true, weight: 700 } as const;

/** A keycap with `key` in it, its left at x, centred on cy, in `color` (#rrggbb). */
function keycap(x: number, cy: number, key: string, color: string): string {
  const w = Math.max(CONTROL.keycap, width(key, KEY) + 8);
  return [rect(x + 0.5, cy - 8.5, w - 1, 17, { stroke: alpha(color, 0.42), sw: 1, rx: 4 }), txt(x + w / 2, cy + 3.8, key, { ...KEY, color: alpha(color, 0.85), anchor: 'middle' })].join('');
}

/** The px a button's contents take. */
export function buttonContent(c: Pick<Control, 'label' | 'icon' | 'hotkey' | 'keycap'>): number {
  let w = 0;
  if (c.icon) w += CONTROL.icon;
  if (c.label) w += (w ? CONTROL.gap : 0) + width(c.label, { size: CONTROL.size, weight: 600 });
  if (c.hotkey && c.keycap !== false) w += (w ? 9 : 0) + Math.max(CONTROL.keycap, width(c.hotkey, KEY) + 8);
  return w;
}

/** Columns a button takes: its contents and padding, rounded up to whole cells; `columns` when fixed. */
export const buttonColumns = (c: Control) => c.columns ?? Math.ceil((buttonContent(c) + 2 * (c.variant === 'quiet' ? 8 : CONTROL.pad) + 2) / CELL.width);

/**
 * A button: a faint rounded surface with a hairline (the terminal's
 * background shows through), the yellow primary, or `quiet` without chrome
 * until hovered. Hover deepens the wash, pressed deepens it more and sinks
 * the contents a pixel; an `active` toggle is drawn pressed in.
 */
export function drawButton(P: Palette, c: Control, box: Box, state: ControlState): string {
  const variant = c.variant ?? 'default';
  const disabled = c.disabled === true;
  const pressed = (state === 'pressed' || c.active === true) && !disabled;
  const hover = state === 'hover' && !disabled;
  const x = box.x + 1;
  const y = box.y;
  const w = box.w - 2;
  const h = box.h;
  let fill: string;
  let stroke: string | undefined;
  let text: string;
  const B = P.button;
  if (variant === 'primary') {
    fill = disabled ? mix(P.yellow, P.surface, 0.35) : pressed ? mix('#000000', P.yellow, 0.14) : hover ? mix('#ffffff', P.yellow, 0.22) : P.yellow;
    stroke = mix('#000000', P.yellow, 0.18);
    text = P.onAccent;
  } else if (variant === 'quiet') {
    fill = pressed ? B.pressed : hover ? B.hover : 'none';
    if (hover || pressed) stroke = B.line;
    text = disabled ? mix(P.muted, P.surface, 0.5) : hover || pressed ? P.ink : P.muted;
  } else {
    fill = disabled ? P.surface : pressed ? B.pressed : hover ? B.hover : B.fill;
    stroke = pressed || hover ? B.lineHover : B.line;
    text = disabled ? mix(P.ink, P.surface, 0.4) : P.ink;
  }
  const out: string[] = [rect(x + 0.5, y + 0.5, w - 1, h - 1, { fill, rx: 7, ...(stroke ? { stroke, sw: 1 } : {}) })];
  // Contents centred in the box, a pixel lower while pressed.
  const content = buttonContent(c);
  let cx = x + (w - content) / 2;
  const cy = y + h / 2 + (pressed && state === 'pressed' ? 1 : 0);
  if (c.icon) {
    out.push(icon(c.icon, cx, cy - CONTROL.icon / 2, CONTROL.icon, text, 2));
    cx += CONTROL.icon + CONTROL.gap;
  }
  if (c.label) {
    out.push(txt(cx, cy + CONTROL.size * 0.36, c.label, { size: CONTROL.size, weight: 600, color: text }));
    cx += width(c.label, { size: CONTROL.size, weight: 600 }) + 9;
  }
  if (c.hotkey && c.keycap !== false && !disabled) out.push(keycap(c.label || c.icon ? cx : x + (w - CONTROL.keycap) / 2, cy, c.hotkey, variant === 'primary' ? P.onAccent : variant === 'quiet' && !hover && !pressed ? P.muted : P.ink));
  return out.join('');
}

/** A closed dropdown: the value (a mark before it), a chevron; drawn as a default button. */
export function selectColumns(value: string, hotkey?: string, marked = false): number {
  return Math.ceil((width(value, { size: CONTROL.size, weight: 500 }) + 2 * CONTROL.pad + 8 + 16 + (hotkey ? 27 : 0) + (marked ? 22 : 0) + 2) / CELL.width);
}

export function drawSelect(P: Palette, value: string, box: Box, state: ControlState, open: boolean, hotkey?: string, mark?: { icon: Icon; color: string }, disabled = false): string {
  const hover = state === 'hover' && !disabled;
  const pressed = (state === 'pressed' || open) && !disabled;
  const x = box.x + 1;
  const y = box.y;
  const w = box.w - 2;
  const h = box.h;
  const cy = y + h / 2;
  // A compact one (the player bar's Body) in smaller type.
  const size = h < 30 ? 13 : CONTROL.size;
  const pad = h < 30 ? 10 : CONTROL.pad;
  const room = w - 2 * pad - 24 - (hotkey ? 27 : 0) - (mark ? 22 : 0);
  const tx = x + pad + (mark ? 22 : 0);
  return [
    rect(x + 0.5, y + 0.5, w - 1, h - 1, { fill: disabled ? 'none' : pressed ? P.button.pressed : hover ? P.button.hover : P.button.fill, stroke: open && !disabled ? P.accent : pressed || hover ? P.button.lineHover : P.button.line, sw: open && !disabled ? 1.5 : 1, rx: 7 }),
    mark ? icon(mark.icon, x + pad, cy - 7, 14, disabled ? mix(mark.color, P.surface, 0.5) : mark.color, 2.2) : '',
    txt(tx, cy + size * 0.36, clip(value, room, size, 500), { size, weight: 500, color: disabled ? mix(P.muted, P.surface, 0.6) : P.ink }),
    hotkey && !disabled ? keycap(x + w - pad - 16 - 9 - CONTROL.keycap, cy, hotkey, P.ink) : '',
    icon('chevron-down', x + w - pad - 16, cy - 8, 16, disabled ? mix(P.muted, P.surface, 0.5) : P.muted, 2),
  ].join('');
}
