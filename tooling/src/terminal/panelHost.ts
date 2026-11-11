/**
 * The raster helper's UI panels (docs/impl/terminal-rendered-ui.md): each
 * panel of a PanelsInput laid out by render/ui/panels.ts, cut on the cell
 * grid into full-width strips (render/ui/tiles.ts), each drawn with resvg,
 * and each control's strip drawn again with the control under the pointer
 * and pressed when asked (its own columns drawn in that state, laid over a
 * copy of the strip). Strips are PNGs named by a hash of their pixels, so a
 * strip that repeats (a step panel's controls from one step to the next) is
 * written once; a strip with nothing drawn is no file at all; a manifest
 * named by a hash of the request answers it again without drawing.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-wasm';
import { CELL_ASPECT, type PanelOutput, type PanelRequest, type PanelsInput, type Tile, type TileArea } from '../render/ui/contract';
import { CELL, type Box, type ControlState } from '../render/ui/kit';
import { drawPanel } from '../render/ui/panels';
import { cellsOf, cut } from '../render/ui/tiles';
import { Writer, hash, put, touch, type Pixels } from './png';

/** PNG px per CSS px across: 16 a column, a Retina screen's pixels for a terminal cell 8 points wide. */
export const PANEL_SCALE = 2;

/** PNG px per cell for a terminal cell `aspect` times as tall as wide: 16 across, round(16 × aspect) down. */
export function cellPxOf(aspect = CELL_ASPECT): { width: number; height: number } {
  const a = Number.isFinite(aspect) ? Math.max(1.5, Math.min(3, aspect)) : CELL_ASPECT;
  return { width: CELL.width * PANEL_SCALE, height: Math.round(CELL.width * PANEL_SCALE * a) };
}

export interface PanelEnv {
  fonts: Uint8Array[];
  /** Hashed into manifest names, so a new helper never answers from an old one's files. */
  build?: string;
}

/** A panel's SVG as pixels on a transparent background, at the size its root names. */
function draw(svg: string, env: PanelEnv): Pixels {
  const resvg = new Resvg(svg, { font: { fontBuffers: env.fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' } });
  const image = resvg.render();
  const out = { width: image.width, height: image.height, data: image.pixels };
  image.free();
  resvg.free();
  return out;
}

/** Writes `pixels` as a PNG named by their hash in `dir`, unless it is there; nothing for a picture with no pixel drawn. */
async function save(dir: string, pixels: Pixels, writer: Writer): Promise<string | undefined> {
  let drawn = false;
  for (let i = 3; i < pixels.data.length && !drawn; i += 4) drawn = pixels.data[i] !== 0;
  if (!drawn) return undefined;
  const h = createHash('sha1').update(pixels.data).update(`${pixels.width}x${pixels.height}`).digest('hex').slice(0, 24);
  const file = join(dir, `t-${h}.png`);
  if (existsSync(file)) touch([file]);
  else await writer.add(file, pixels);
  return file;
}

/** `piece` laid into a copy of `whole` at x (both the same height). */
function inset(whole: Pixels, piece: Pixels, x: number): Pixels {
  const data = whole.data.slice();
  for (let row = 0; row < piece.height; row++) data.set(piece.data.subarray(row * piece.width * 4, (row + 1) * piece.width * 4), (row * whole.width + x) * 4);
  return { width: whole.width, height: whole.height, data };
}

async function panel(req: PanelRequest, input: PanelsInput, env: PanelEnv, writer: Writer): Promise<PanelOutput> {
  const theme = input.theme ?? 'light';
  const px = cellPxOf(input.cellAspect);
  const manifest = join(input.outDir, `p-${hash(JSON.stringify([env.build ?? '', theme, px, req.panel, req.columns, req.variants ?? null]))}.json`);
  if (existsSync(manifest)) {
    const done = JSON.parse(readFileSync(manifest, 'utf8')) as PanelOutput;
    const files = done.tiles.flatMap((t) => [t.file, ...(t.controls ?? []).flatMap((a) => [a.hoverFile, a.pressedFile])].filter((f): f is string => !!f));
    if (files.every((f) => existsSync(f))) {
      touch([manifest, ...files]);
      return { ...done, ...(req.id !== undefined ? { id: req.id } : {}) };
    }
  }
  const { surface, height } = drawPanel(req.panel, req.columns, theme);
  const rows = height / CELL.height;
  const strips = cut(
    rows,
    surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, req.columns, rows) })),
    surface.cuttable(rows),
  );
  const variants = req.variants ?? ['hover'];
  // A window of whole cells as pixels: 16 a column, px.height a row (stretched from the 8×17 layout where the terminal's cell differs).
  const picture = (states: Map<string, ControlState>, col: number, row: number, columns: number, n: number) => {
    const window: Box = { x: col * CELL.width, y: row * CELL.height, w: columns * CELL.width, h: n * CELL.height };
    return draw(surface.svg(height, states, window, { width: columns * px.width, height: n * px.height }), env);
  };
  const tiles: Tile[] = [];
  for (const s of strips) {
    const whole = picture(new Map(), 0, s.row, req.columns, s.rows);
    const file = await save(input.outDir, whole, writer);
    const tile: Tile = { col: 0, row: s.row, columns: req.columns, rows: s.rows, ...(file ? { file } : {}) };
    if (s.controls.length) {
      tile.controls = [];
      for (const a of s.controls) {
        const area: TileArea = { control: a.control, col: a.col, columns: a.columns };
        for (const state of variants) {
          const f = await save(input.outDir, inset(whole, picture(new Map([[a.control.id, state]]), a.col, s.row, a.columns, s.rows), a.col * px.width), writer);
          if (f && state === 'hover') area.hoverFile = f;
          else if (f) area.pressedFile = f;
        }
        tile.controls.push(area);
      }
    }
    tiles.push(tile);
  }
  const out: PanelOutput = { kind: req.panel.kind, columns: req.columns, rows, cellPx: px, tiles };
  await writer.done();
  put(manifest, JSON.stringify(out));
  return { ...out, ...(req.id !== undefined ? { id: req.id } : {}) };
}

/** Every panel of the input, each its strips or why it could not be drawn. */
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
