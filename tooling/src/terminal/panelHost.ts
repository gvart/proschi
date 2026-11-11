/**
 * The raster helper's UI panels (docs/impl/terminal-rendered-ui.md): each
 * panel of a PanelsInput laid out by render/ui/panels.ts, drawn with resvg,
 * and cut on the cell grid into tiles (render/ui/tiles.ts), a control's tile
 * also drawn under the pointer and pressed when asked. Tiles are PNGs named
 * by a hash of their pixels, so a tile that repeats (the tab bar's unchanged
 * tabs, a step panel's controls from one step to the next) is written once;
 * a manifest named by a hash of the request answers it again without drawing.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-wasm';
import type { PanelOutput, PanelRequest, PanelsInput, Tile } from '../render/ui/contract';
import { CELL, type ControlState } from '../render/ui/kit';
import { drawPanel } from '../render/ui/panels';
import { cellsOf, cut, type Strip } from '../render/ui/tiles';
import { Writer, hash, put, touch, type Pixels } from './png';

/** PNG px per CSS px: a cell of 8×17 is 16×34 px, a Retina screen's pixels for a terminal cell of 8×17 points (Ghostty's at its default font). */
export const PANEL_SCALE = 2;
/** Rows drawn at once at most: a tall page (the HLD) is drawn a window at a time. */
const PIECE_ROWS = 96;

export interface PanelEnv {
  fonts: Uint8Array[];
  /** Hashed into manifest names, so a new helper never answers from an old one's files. */
  build?: string;
}

/** A panel's SVG as pixels on a transparent background, so the terminal's own colour shows through. */
function draw(svg: string, zoom: number, env: PanelEnv): Pixels {
  const resvg = new Resvg(svg, {
    font: { fontBuffers: env.fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
    fitTo: { mode: 'zoom', value: zoom },
  });
  const image = resvg.render();
  const out = { width: image.width, height: image.height, data: image.pixels };
  image.free();
  resvg.free();
  return out;
}

/** The pixels of `box` (PNG px) out of `from`, whose top is at `top`. */
function crop(from: Pixels, top: number, box: { x: number; y: number; w: number; h: number }): Pixels {
  const data = new Uint8Array(box.w * box.h * 4);
  for (let row = 0; row < box.h; row++) {
    const start = ((box.y - top + row) * from.width + box.x) * 4;
    data.set(from.data.subarray(start, start + box.w * 4), row * box.w * 4);
  }
  return { width: box.w, height: box.h, data };
}

/** Writes `pixels` as a PNG named by their hash in `dir`, unless it is there. */
async function save(dir: string, pixels: Pixels, writer: Writer): Promise<string> {
  const h = createHash('sha1').update(pixels.data).update(`${pixels.width}x${pixels.height}`).digest('hex').slice(0, 24);
  const file = join(dir, `t-${h}.png`);
  if (existsSync(file)) touch([file]);
  else await writer.add(file, pixels);
  return file;
}

async function panel(req: PanelRequest, input: PanelsInput, env: PanelEnv, writer: Writer): Promise<PanelOutput> {
  const theme = input.theme ?? 'light';
  const zoom = PANEL_SCALE;
  const manifest = join(input.outDir, `p-${hash(JSON.stringify([env.build ?? '', theme, zoom, req.panel, req.columns, req.variants ?? null]))}.json`);
  if (existsSync(manifest)) {
    const done = JSON.parse(readFileSync(manifest, 'utf8')) as PanelOutput;
    const files = done.tiles.flatMap((t) => [t.file, t.hoverFile, t.pressedFile].filter((f): f is string => !!f));
    if (files.every((f) => existsSync(f))) {
      touch([manifest, ...files]);
      return { ...done, ...(req.id !== undefined ? { id: req.id } : {}) };
    }
  }
  const { surface, height } = drawPanel(req.panel, req.columns, theme);
  const rows = height / CELL.height;
  const strips = cut(
    req.columns,
    rows,
    surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, req.columns, rows) })),
    surface.cuttable(rows),
  );
  const variants = req.variants ?? ['hover'];
  const px = { width: CELL.width * zoom, height: CELL.height * zoom };
  const tiles: Tile[] = [];
  // Windows of whole strips, each drawn once and cut.
  const pieces: Strip[][] = [];
  for (const s of strips) {
    const last = pieces.at(-1);
    if (last && s.row + s.rows - last[0].row <= PIECE_ROWS) last.push(s);
    else pieces.push([s]);
  }
  for (const piece of pieces) {
    const top = piece[0].row;
    const bottom = piece.at(-1)!.row + piece.at(-1)!.rows;
    const pixels = draw(surface.svg(height, new Map(), { x: 0, y: top * CELL.height, w: surface.width, h: (bottom - top) * CELL.height }), zoom, env);
    for (const s of piece) {
      for (const t of s.tiles) {
        const box = { x: t.col * px.width, y: t.row * px.height, w: t.columns * px.width, h: t.rows * px.height };
        const tile: Tile = { col: t.col, row: t.row, columns: t.columns, rows: t.rows, file: await save(input.outDir, crop(pixels, top * px.height, box), writer) };
        if (t.control) {
          tile.control = t.control;
          for (const state of variants) {
            const window = { x: t.col * CELL.width, y: t.row * CELL.height, w: t.columns * CELL.width, h: t.rows * CELL.height };
            const file = await save(input.outDir, draw(surface.svg(height, new Map<string, ControlState>([[t.control.id, state]]), window), zoom, env), writer);
            if (state === 'hover') tile.hoverFile = file;
            else tile.pressedFile = file;
          }
        }
        tiles.push(tile);
      }
    }
  }
  const out: PanelOutput = { kind: req.panel.kind, columns: req.columns, rows, cellPx: px, tiles };
  await writer.done();
  put(manifest, JSON.stringify(out));
  return { ...out, ...(req.id !== undefined ? { id: req.id } : {}) };
}

/** Every panel of the input, each its tiles or why it could not be drawn. */
export async function renderPanels(input: PanelsInput, env: PanelEnv): Promise<(PanelOutput | { id?: string; error: string })[]> {
  const writer = new Writer();
  const out: (PanelOutput | { id?: string; error: string })[] = [];
  for (const req of input.panels) {
    try {
      out.push(await panel(req, input, env, writer));
    } catch (error) {
      out.push({ ...(req.id !== undefined ? { id: req.id } : {}), error: error instanceof Error ? error.message : String(error) });
    }
  }
  await writer.done();
  return out;
}
