import { esc, r } from '../svg';
import type { Control, Icon, Rich, Span, Tone, TileControl } from './contract';
import { clip, measure } from './metrics';
import { mix, type Palette } from './theme';

/**
 * The UI kit's drawing: a Surface collects SVG for a panel `columns` cells
 * wide, in CSS px where a cell is CELL (8×16, the terminal's 1:2), and the
 * controls placed on it, each snapped to whole columns so its tile is its
 * own. Controls are drawn by state, so a panel can be drawn again with one
 * of them under the pointer or pressed, for its hover and pressed tiles.
 * Nothing uses nested <svg> or group opacity, which resvg cannot crop.
 */

export const CELL = { width: 8, height: 16 };

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

export class Surface {
  private parts: (string | { control: string } | { svg: string; box: Box })[] = [];
  readonly controls: Placed[] = [];

  constructor(
    readonly P: Palette,
    readonly columns: number,
  ) {}

  get width(): number {
    return this.columns * CELL.width;
  }

  add(...svg: string[]): void {
    for (const s of svg) if (s) this.parts.push(s);
  }

  /** SVG within `box`, left out of a cropped drawing it does not reach: a part resvg cannot crop (nested <svg>) stays out of the crops of controls elsewhere. */
  addWithin(box: Box, svg: string): void {
    this.parts.push({ svg, box });
  }

  place(p: Placed): void {
    if (this.controls.some((c) => c.control.id === p.control.id)) throw new Error(`Two controls with the id '${p.control.id}'`);
    this.controls.push(p);
    this.parts.push({ control: p.control.id });
  }

  /** The panel as SVG `height` px tall, controls in their states (rest unless named); `crop` draws only that window, at its size. */
  svg(height: number, states: Map<string, ControlState> = new Map(), crop?: Box): string {
    const byId = new Map(this.controls.map((c) => [c.control.id, c]));
    const view = crop ?? { x: 0, y: 0, w: this.width, h: height };
    const meets = (b: Box) => b.x < view.x + view.w && b.x + b.w > view.x && b.y < view.y + view.h && b.y + b.h > view.y;
    const body = this.parts
      .map((p) => (typeof p === 'string' ? p : 'control' in p ? byId.get(p.control)!.draw(states.get(p.control) ?? 'rest') : meets(p.box) ? p.svg : ''))
      .filter(Boolean)
      .join('\n');
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${view.w}" height="${view.h}" viewBox="${view.x} ${view.y} ${view.w} ${view.h}" font-family="${SANS}">`,
      `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="${this.P.paper}"/>`,
      body,
      '</svg>',
    ].join('\n');
  }
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
    s.weight && s.weight !== 400 ? `font-weight="${s.mono && s.weight < 700 ? 500 : s.weight}"` : s.mono ? 'font-weight="500"' : '',
    `fill="${s.color ?? '#000'}"`,
    s.mono ? `font-family="${MONO_FAMILY}"` : '',
    s.anchor && s.anchor !== 'start' ? `text-anchor="${s.anchor}"` : '',
    s.spacing ? `letter-spacing="${s.spacing}"` : '',
  ].filter(Boolean);
  return `<text ${attrs.join(' ')} xml:space="preserve">${esc(content)}</text>`;
}

export const width = (content: string, s: TextStyle = {}) => measure(content, s.size ?? 13, s.weight ?? 400, s.mono) + (s.spacing ?? 0) * [...content].length;

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
export function chip(P: Palette, x: number, y: number, text: string, tone: Tone, size = 11): { svg: string; width: number } {
  const c = P.chip[CHIP_OF[tone]];
  const w = width(text, { size, weight: 600 }) + 12;
  const h = size + 7;
  return {
    svg: [rect(x, y - size - 1.5, w, h, { fill: c.fill, rx: 4 }), txt(x + 6, y, text, { size, weight: 600, color: c.text })].join(''),
    width: w,
  };
}

/** A chip of a named tint (Sync green, Async purple, Fire & Forget orange). */
export function tint(P: Palette, x: number, y: number, text: string, color: keyof Palette['chip'], size = 11): { svg: string; width: number } {
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

const pieceWidth = (s: Span, text: string, base: TextStyle) => (s.chip ? width(text, { size: (base.size ?? 13) - 2, weight: 600 }) + 12 : width(text, styleOf(s, base)));

/** Rich text broken into lines of at most `max` px (one line, clipped, with `max` and `wrap` false). */
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
    // Words, each with the spaces before it.
    for (const word of span.text.match(/\s*\S+|\s+$/g) ?? []) {
      let cur = lines.at(-1)!;
      const w = pieceWidth(span, word, base);
      if (cur.pieces.length && cur.width + w > max && word.trim()) {
        lines.push((cur = { pieces: [], width: 0 }));
        const bare = word.trimStart();
        let bw = pieceWidth(span, bare, base);
        let text = bare;
        if (bw > max) {
          text = clip(bare, max, base.size ?? 13, styleOf(span, base).weight, styleOf(span, base).mono);
          bw = pieceWidth(span, text, base);
        }
        cur.pieces.push({ span, text, x: 0, w: bw });
        cur.width = bw;
        continue;
      }
      let text = cur.pieces.length ? word : word.trimStart();
      let tw = pieceWidth(span, text, base);
      if (tw > max - cur.width) {
        text = clip(text, max - cur.width, base.size ?? 13, styleOf(span, base).weight, styleOf(span, base).mono);
        tw = pieceWidth(span, text, base);
      }
      cur.pieces.push({ span, text, x: cur.width, w: tw });
      cur.width += tw;
    }
  }
  return lines;
}

/** Draws one laid-out line with its baseline at y. */
export function drawLaid(P: Palette, laid: Laid, x: number, y: number, base: TextStyle, color: string): string {
  return laid.pieces
    .map((p) => {
      if (p.span.chip) return chip(P, x + p.x, y, p.text, p.span.chip, (base.size ?? 13) - 2).svg;
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

/** A control's height and its type size. */
export const CONTROL = { height: 26, size: 12.5, pad: 10, icon: 14, gap: 6, keycap: 15 };

/** A keycap with `key` in it, its left at x, centred on cy. */
function keycap(x: number, cy: number, key: string, on: string, border: string): string {
  const w = Math.max(CONTROL.keycap, width(key, { size: 9.5, mono: true }) + 7);
  return [rect(x, cy - 7.5, w, 15, { fill: on, stroke: border, sw: 1, rx: 3 }), txt(x + w / 2, cy + 3.4, key, { size: 9.5, mono: true, weight: 700, color: border, anchor: 'middle' })].join('');
}

/** The px a button's contents take. */
export function buttonContent(c: Pick<Control, 'label' | 'icon' | 'hotkey'>): number {
  let w = 0;
  if (c.icon) w += CONTROL.icon;
  if (c.label) w += (w ? CONTROL.gap : 0) + width(c.label, { size: CONTROL.size, weight: 600 });
  if (c.hotkey) w += (w ? 8 : 0) + Math.max(CONTROL.keycap, width(c.hotkey, { size: 9.5, mono: true }) + 7);
  return w;
}

/** Columns a button takes: its contents, padding and shadow, rounded up to whole cells; `columns` when fixed. */
export const buttonColumns = (c: Control) => c.columns ?? Math.ceil((buttonContent(c) + 2 * CONTROL.pad + 4) / CELL.width);

/**
 * A button as the editor draws one (border-bw-1, shadow-brutal-sm, rounded):
 * surface with an ink border, or the yellow primary; `quiet` without chrome
 * until hovered. Hover lifts it a pixel onto a deeper shadow, pressed sinks it
 * onto its shadow; an `active` toggle is drawn pressed in.
 */
export function drawButton(P: Palette, c: Control, box: Box, state: ControlState): string {
  const variant = c.variant ?? 'default';
  const disabled = c.disabled === true;
  const pressed = (state === 'pressed' || c.active === true) && !disabled;
  const hover = state === 'hover' && !disabled;
  const depth = variant === 'quiet' || disabled ? 0 : pressed ? 0 : hover ? 3 : 2;
  const shift = variant === 'quiet' || disabled ? 0 : pressed ? 2 : hover ? -1 : 0;
  const x = box.x + 1 + shift;
  const y = box.y + shift;
  const w = box.w - 5;
  const h = box.h;
  const ink = disabled ? mix(P.ink, P.surface, 0.35) : P.ink;
  let fill: string;
  let text: string;
  let border: string | undefined = ink;
  if (variant === 'primary') {
    fill = hover ? mix(P.yellow, P.surface, 0.85) : P.yellow;
    text = P.onAccent;
    border = disabled ? border : P.theme === 'dark' ? P.yellow : P.ink;
    if (disabled) fill = mix(P.yellow, P.surface, 0.35);
  } else if (variant === 'quiet') {
    fill = hover || pressed ? P.hover : 'none';
    text = hover || pressed ? P.ink : disabled ? mix(P.muted, P.surface, 0.5) : P.muted;
    border = undefined;
  } else {
    fill = pressed ? P.hover : hover ? mix(P.ink, P.surface, 0.05) : P.surface;
    text = ink;
  }
  const out: string[] = [];
  if (depth) out.push(rect(x + depth, y + depth, w, h, { fill: P.shadow, rx: 6 }));
  out.push(rect(x + (border ? 1 : 0), y + (border ? 1 : 0), w - (border ? 2 : 0), h - (border ? 2 : 0), { fill, rx: 5, ...(border ? { stroke: border, sw: 2 } : {}) }));
  // Contents centred in the box.
  const content = buttonContent(c);
  let cx = x + (w - content) / 2;
  const cy = y + h / 2;
  if (c.icon) {
    out.push(icon(c.icon, cx, cy - CONTROL.icon / 2, CONTROL.icon, text));
    cx += CONTROL.icon + CONTROL.gap;
  }
  if (c.label) {
    out.push(txt(cx, cy + CONTROL.size * 0.36, c.label, { size: CONTROL.size, weight: 600, color: text }));
    cx += width(c.label, { size: CONTROL.size, weight: 600 }) + 8;
  }
  if (c.hotkey) {
    const capBorder = variant === 'primary' ? mix(P.onAccent, fill, 0.55) : mix(text, fill === 'none' ? P.paper : fill, 0.55);
    out.push(keycap(c.label || c.icon ? cx : x + (w - CONTROL.keycap) / 2, cy, c.hotkey, variant === 'primary' ? mix('#ffffff', fill, 0.35) : fill === 'none' ? P.paper : fill, capBorder));
  }
  return out.join('');
}

/** A closed dropdown: the value, a chevron; drawn as a default button. */
export function selectColumns(value: string, hotkey?: string): number {
  return Math.ceil((width(value, { size: CONTROL.size, weight: 500 }) + 2 * CONTROL.pad + 6 + 14 + (hotkey ? 23 : 0) + 12) / CELL.width);
}

export function drawSelect(P: Palette, value: string, box: Box, state: ControlState, open: boolean, hotkey?: string): string {
  const hover = state === 'hover';
  const pressed = state === 'pressed' || open;
  const depth = pressed ? 0 : hover ? 3 : 2;
  const shift = pressed ? 2 : hover ? -1 : 0;
  const x = box.x + 1 + shift;
  const y = box.y + shift;
  const w = box.w - 5;
  const h = box.h;
  const cy = y + h / 2;
  const room = w - 2 * CONTROL.pad - 20 - (hotkey ? 23 : 0);
  return [
    depth ? rect(x + depth, y + depth, w, h, { fill: P.shadow, rx: 6 }) : '',
    rect(x + 1, y + 1, w - 2, h - 2, { fill: hover && !pressed ? mix(P.ink, P.surface, 0.05) : P.surface, stroke: P.ink, sw: 2, rx: 5 }),
    txt(x + CONTROL.pad, cy + CONTROL.size * 0.36, clip(value, room, CONTROL.size, 500), { size: CONTROL.size, weight: 500, color: P.ink }),
    hotkey ? keycap(x + w - CONTROL.pad - 14 - 8 - CONTROL.keycap, cy, hotkey, P.surface, mix(P.ink, P.surface, 0.55)) : '',
    icon('chevron-down', x + w - CONTROL.pad - 14, cy - 7, 14, P.ink, 2),
  ].join('');
}
