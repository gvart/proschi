import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textWidth } from '../svg';

/**
 * Text widths from the fonts the raster helper draws with (Inter and
 * JetBrains Mono in plugin/hooks/fonts): each glyph's advance from the
 * font's `cmap` (format 4) and `hmtx` tables. Kerning is left out, so a
 * measured run is at most a pixel or two wider than resvg draws it. Until
 * `loadFonts` runs, widths are the SVG renderers' estimate (render/svg.ts).
 */

interface Face {
  upem: number;
  advances: Map<number, number>;
  fallback: number;
}

/** Inter's weights by CSS weight, JetBrains Mono's one advance. */
const faces = new Map<number, Face>();
let mono: Face | undefined;

function parse(bytes: Buffer): Face {
  const tables = new Map<string, number>();
  for (let i = 0; i < bytes.readUInt16BE(4); i++) tables.set(bytes.toString('latin1', 12 + i * 16, 16 + i * 16), bytes.readUInt32BE(20 + i * 16));
  const head = tables.get('head')!;
  const hhea = tables.get('hhea')!;
  const hmtx = tables.get('hmtx')!;
  const cmap = tables.get('cmap')!;
  const upem = bytes.readUInt16BE(head + 18);
  const metrics = bytes.readUInt16BE(hhea + 34);
  const advanceOf = (glyph: number) => bytes.readUInt16BE(hmtx + 4 * Math.min(glyph, metrics - 1));
  const advances = new Map<number, number>();
  for (let i = 0; i < bytes.readUInt16BE(cmap + 2); i++) {
    const platform = bytes.readUInt16BE(cmap + 4 + i * 8);
    const encoding = bytes.readUInt16BE(cmap + 6 + i * 8);
    const at = cmap + bytes.readUInt32BE(cmap + 8 + i * 8);
    if (platform !== 3 || encoding !== 1 || bytes.readUInt16BE(at) !== 4) continue;
    const segments = bytes.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const offsets = deltas + segments * 2;
    for (let s = 0; s < segments; s++) {
      const end = bytes.readUInt16BE(ends + s * 2);
      const start = bytes.readUInt16BE(starts + s * 2);
      const delta = bytes.readInt16BE(deltas + s * 2);
      const offset = bytes.readUInt16BE(offsets + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (offset === 0) glyph = (c + delta) & 0xffff;
        else {
          const g = bytes.readUInt16BE(offsets + s * 2 + offset + (c - start) * 2);
          glyph = g === 0 ? 0 : (g + delta) & 0xffff;
        }
        if (glyph !== 0) advances.set(c, advanceOf(glyph));
      }
    }
  }
  return { upem, advances, fallback: advanceOf(0) };
}

/** Reads the fonts in `dir` (plugin/hooks/fonts); missing files leave the estimate in place. */
export function loadFonts(dir: string): void {
  const files: [number | 'mono', string][] = [
    [400, 'Inter-Regular.ttf'],
    [500, 'Inter-Medium.ttf'],
    [600, 'Inter-SemiBold.ttf'],
    [700, 'Inter-Bold.ttf'],
    ['mono', 'JetBrainsMono-Medium.ttf'],
  ];
  for (const [weight, name] of files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      continue;
    }
    if (weight === 'mono') mono = parse(bytes);
    else faces.set(weight, parse(bytes));
  }
}

export const fontsLoaded = () => faces.size > 0;

/** The nearest weight loaded. */
function faceOf(weight: number): Face | undefined {
  let best: Face | undefined;
  let gap = Infinity;
  for (const [w, face] of faces) {
    if (Math.abs(w - weight) < gap) {
      gap = Math.abs(w - weight);
      best = face;
    }
  }
  return best;
}

/** The advance width of `text` at `size` px, in Inter of `weight` or, with `isMono`, JetBrains Mono. */
export function measure(text: string, size: number, weight = 500, isMono = false): number {
  if (isMono) return text.length > 0 ? [...text].length * size * (mono ? (mono.advances.get(0x30) ?? mono.fallback) / mono.upem : 0.6) : 0;
  const face = faceOf(weight);
  if (!face) return textWidth(text, size, weight >= 600);
  let units = 0;
  for (const c of text) units += face.advances.get(c.codePointAt(0)!) ?? face.fallback;
  return (units / face.upem) * size;
}

/** `text` cut to `max` px with an ellipsis. */
export function clip(text: string, max: number, size: number, weight = 500, isMono = false): string {
  if (measure(text, size, weight, isMono) <= max) return text;
  const chars = [...text];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join('').trimEnd()}…`, size, weight, isMono) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? (measure('…', size, weight, isMono) <= max ? '…' : '') : `${chars.slice(0, lo).join('').trimEnd()}…`;
}
