/**
 * A grid of terminal cells: a glyph, a foreground and a background each, the
 * shape Claude Code's `Raster` element takes. Colors are `0xRRGGBB`, or
 * DEFAULT for the terminal's own.
 */

export const DEFAULT = 0x01000000;

/** Line directions out of a cell, combined into one box-drawing glyph. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

// Rounded corners, as the canvas draws its edges.
const LINE_GLYPH: Record<number, string> = {
  [N]: '│',
  [S]: '│',
  [N | S]: '│',
  [E]: '─',
  [W]: '─',
  [E | W]: '─',
  [E | S]: '╭',
  [S | W]: '╮',
  [N | E]: '╰',
  [N | W]: '╯',
  [N | E | S]: '├',
  [N | S | W]: '┤',
  [E | S | W]: '┬',
  [N | E | W]: '┴',
  [N | E | S | W]: '┼',
};

// The same joins, heavy: the line a playing step travels.
const HEAVY_GLYPH: Record<number, string> = {
  [N]: '┃',
  [S]: '┃',
  [N | S]: '┃',
  [E]: '━',
  [W]: '━',
  [E | W]: '━',
  [E | S]: '┏',
  [S | W]: '┓',
  [N | E]: '┗',
  [N | W]: '┛',
  [N | E | S]: '┣',
  [N | S | W]: '┫',
  [E | S | W]: '┳',
  [N | E | W]: '┻',
  [N | E | S | W]: '╋',
};

export class Grid {
  readonly glyphs: Uint32Array;
  readonly fg: Uint32Array;
  readonly bg: Uint32Array;
  /** Line directions per cell, for cells drawn by `line`. */
  private readonly lines: Uint8Array;

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    const size = columns * rows;
    this.glyphs = new Uint32Array(size).fill(0x20);
    this.fg = new Uint32Array(size).fill(DEFAULT);
    this.bg = new Uint32Array(size).fill(DEFAULT);
    this.lines = new Uint8Array(size);
  }

  /** A copy to draw one animation frame on. */
  copy(): Grid {
    const grid = new Grid(this.columns, this.rows);
    grid.glyphs.set(this.glyphs);
    grid.fg.set(this.fg);
    grid.bg.set(this.bg);
    grid.lines.set(this.lines);
    return grid;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.columns && y < this.rows;
  }

  set(x: number, y: number, glyph: string, fg = DEFAULT, bg?: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    this.glyphs[i] = glyph.codePointAt(0) ?? 0x20;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
    this.lines[i] = 0;
  }

  /** Recolors a cell, keeping its glyph. */
  paint(x: number, y: number, fg: number, bg?: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    this.fg[i] = fg;
    if (bg !== undefined) this.bg[i] = bg;
  }

  glyph(x: number, y: number): string {
    return this.inside(x, y) ? String.fromCodePoint(this.glyphs[y * this.columns + x]) : ' ';
  }

  /** Writes `text` from (x, y), one cell per character, cut at `max` cells. */
  text(x: number, y: number, text: string, fg = DEFAULT, max = Infinity, bg?: number): void {
    let i = 0;
    for (const ch of text) {
      if (i >= max) break;
      this.set(x + i, y, ch, fg, bg);
      i++;
    }
  }

  /** Adds line directions to a cell and redraws it as the glyph that joins them. */
  line(x: number, y: number, dirs: number, fg: number, heavy = false): void {
    if (!this.inside(x, y)) return;
    const i = y * this.columns + x;
    const merged = this.lines[i] | dirs;
    this.glyphs[i] = (heavy ? HEAVY_GLYPH : LINE_GLYPH)[merged].codePointAt(0)!;
    this.fg[i] = fg;
    this.lines[i] = merged;
  }

  /** The cells as `Raster` takes them: base64 of little-endian u32 triplets. */
  toBase64(): string {
    const words = new Uint32Array(this.glyphs.length * 3);
    for (let i = 0; i < this.glyphs.length; i++) {
      words[i * 3] = this.glyphs[i];
      words[i * 3 + 1] = this.fg[i];
      words[i * 3 + 2] = this.bg[i];
    }
    return base64(new Uint8Array(words.buffer));
  }

  /** The glyphs alone, trailing spaces trimmed: for tests. */
  toText(): string {
    const out: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let row = '';
      for (let x = 0; x < this.columns; x++) row += String.fromCodePoint(this.glyphs[y * this.columns + x]);
      out.push(row.trimEnd());
    }
    return out.join('\n');
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard padded base64, without relying on `btoa` or `Buffer` (the mod runtime may have neither). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[n >> 18] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }
  return out;
}

/** `#rrggbb` as `0xRRGGBB`. */
export function hex(color: string): number {
  return parseInt(color.slice(1), 16);
}
