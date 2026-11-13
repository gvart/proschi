/**
 * The raster helper's UI panels (docs/design/terminal-mod.md D12): each
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
import { drawArchitecture, type ArchitectureLayout } from '../render/architecture';
import { renderSequenceSvg } from '../render/sequence';
import { withTheme } from '../render/svg';
import { CELL_ASPECT, type Block, type Panel, type PanelOutput, type PanelRequest, type PanelsInput, type Tile, type TileArea, type UiTheme } from '../render/ui/contract';
import { CELL, type Box, type ControlState } from '../render/ui/kit';
import { drawPanel } from '../render/ui/panels';
import { paletteOf } from '../render/ui/theme';
import { cellsOf, cut } from '../render/ui/tiles';
import { loadDocument } from './document';
import { layoutOf } from './layout';
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

/**
 * A page with its figures drawn (Block `figure`): the architecture as the
 * diagram's strip draws it, on the figure's wash, and a use case's sequence
 * as `proschi render` draws it. A figure that cannot be drawn is left
 * without its SVG, which the page says.
 */
export async function withFigures(p: Panel, theme: UiTheme): Promise<Panel> {
  if (p.kind !== 'page' || !p.source || !p.blocks.some((b) => b.type === 'figure')) return p;
  // The same page at another width, or with another control lit, draws the same figures: drawn once.
  const key = JSON.stringify([theme, p.source, p.blocks.filter((b) => b.type === 'figure').map((b) => b.of)]);
  const known = figured.get(key);
  if (known) {
    figured.delete(key);
    figured.set(key, known);
    let k = 0;
    return { ...p, blocks: p.blocks.map((b) => (b.type === 'figure' ? known[k++]! : b)) };
  }
  const doc = loadDocument(p.source);
  if (doc.errors.length) return p;
  let laid: ArchitectureLayout | undefined;
  const out: Block[] = [];
  for (const [i, b] of p.blocks.entries()) {
    if (b.type !== 'figure') {
      out.push(b);
      continue;
    }
    try {
      let svg: string;
      if ('architecture' in b.of) {
        // Laid out once for the diagram's strip and its figure alike (layoutOf).
        laid ??= { diagram: doc.diagram, layout: await layoutOf(p.source) };
        svg = drawArchitecture(laid, { theme, systems: doc.systems, terminal: true, background: paletteOf(theme).wash });
      } else {
        const { useCase, scenario } = b.of;
        const u = doc.diagram.useCases.find((c) => c.id === useCase || c.name === useCase);
        const s = scenario === undefined ? u?.scenarios[0] : u?.scenarios.find((c) => c.id === scenario || c.name === scenario);
        if (!u || !s) throw new Error(`No scenario '${scenario ?? ''}' in '${useCase}'`);
        svg = withTheme(theme, () => renderSequenceSvg(doc.diagram, u, s, `fig${i}-`));
      }
      out.push({ ...b, svg });
    } catch {
      out.push(b);
    }
  }
  figured.set(key, out.filter((b) => b.type === 'figure'));
  if (figured.size > FIGURED) figured.delete(figured.keys().next().value!);
  return { ...p, blocks: out };
}

/** Pages' figures drawn, by theme, source and what they show, the last FIGURED used. */
const figured = new Map<string, Block[]>();
const FIGURED = 8;

async function panel(req: PanelRequest, input: PanelsInput, env: PanelEnv, writer: Writer): Promise<PanelOutput> {
  const theme = input.theme ?? 'light';
  const px = cellPxOf(input.cellAspect);
  const manifest = join(input.outDir, `p-${hash(JSON.stringify([env.build ?? '', theme, px, req.panel, req.columns, req.variants ?? null, req.edges ?? null]))}.json`);
  if (existsSync(manifest)) {
    const done = JSON.parse(readFileSync(manifest, 'utf8')) as PanelOutput;
    const files = done.tiles.flatMap((t) => [t.file, ...(t.controls ?? []).flatMap((a) => [a.hoverFile, a.pressedFile])].filter((f): f is string => !!f));
    if (files.every((f) => existsSync(f))) {
      touch([manifest, ...files]);
      return { ...done, ...(req.id !== undefined ? { id: req.id } : {}) };
    }
  }
  const { surface, height } = drawPanel(await withFigures(req.panel, theme), req.columns, theme, req.edges);
  // As wide as asked, but a menu, which is as wide as its options (at most that).
  const columns = surface.columns;
  const rows = height / CELL.height;
  const anchors = Object.entries(surface.anchors);
  const strips = cut(
    rows,
    surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, columns, rows) })),
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
    const whole = picture(new Map(), 0, s.row, columns, s.rows);
    const file = await save(input.outDir, whole, writer);
    const tile: Tile = { col: 0, row: s.row, columns: columns, rows: s.rows, ...(file ? { file } : {}) };
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
  const out: PanelOutput = { kind: req.panel.kind, columns: columns, rows, cellPx: px, tiles, ...(anchors.length ? { anchors: Object.fromEntries(anchors.map(([id, y]) => [id, Math.floor(y / CELL.height)])) } : {}) };
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
