/**
 * The Claude Code plugin's raster helper (plugin/hooks/raster.cjs): draws a
 * document as PNG files for terminals with an image protocol (kitty, Ghostty,
 * iTerm2), the way the web canvas draws it: the architecture SVG of
 * `proschi render` (render/architecture.ts) with the load overlay, the
 * selection and use case playback, rasterized with resvg (WebAssembly) and
 * the fonts shipped next to it. The hooks run it in Node, as a session's
 * worker (`--serve`, see serve()) or one shot.
 *
 * Contract (docs/design/terminal-mod-graphics.md):
 *
 *   stdin  RasterInput as JSON:
 *     { source, path?, imports?, view?,            the document (terminal/document.ts Source)
 *       outDir,                                    where the PNGs go (created if missing)
 *       prune?: boolean,                           first delete what in outDir went unused for PRUNE_AFTER_MS
 *       options?: {
 *         theme?: 'light' | 'dark',                default 'light'
 *         scale?: number,                          PNG px per diagram px, default 2
 *         maxWidthPx?: number,                     the PNG is scaled down to fit this width
 *         overlay?: boolean,                       the load overlay (when the document has `traffic`)
 *         selected?: string,                       a node or expanded system id, ringed in the accent
 *         play?: { useCase, scenario?, frames? },  id or name; scenario defaults to the first; frames per step, default 8
 *         cellPx?: { width, height },              the terminal's cell in screen px, for cellHint; default 16×34
 *         grid?: { room, maxRows, cellPx, tile?,   the picture as tiles of whole cells (see RasterGrid):
 *                  fill?, zoom?, window? } } }     at most room × maxRows cells of cellPx, tiles default 16×8;
 *                                                  `fill` sets it on a strip of the UI's surface, `zoom` draws it
 *                                                  that many times larger, `window` draws only the tiles it meets
 *                                                  (GridOptions)
 *   stdout RasterOutput as JSON:
 *     { width, height,                             PNG size in px, the same for every file
 *       base,                                      absolute path of the still image
 *       frames?: string[][],                       with `play`: per step of the scenario, its frames in order
 *                                                  (progress 0..100; the last one shows the call arrived)
 *       cellHint: { columns, rows },               cells the PNG covers at one PNG px per screen px
 *       grid? }                                    with `grid`: RasterGrid (and no `frames`)
 *   exit 1 with the message on stderr when the document has errors or the use case is unknown.
 *
 *   stdin  LayoutInput { kind: 'layout', source, path?, imports?, view? }:
 *   stdout the browser's ELK layout (terminal/layout.ts), which the hooks draw text cells from.
 *
 * Files are named by a hash of their SVG and the zoom, so a frame that
 * repeats (or another call drawing the same thing) is written once; files
 * that exist are not drawn again. A manifest named by a hash of the input
 * and of this helper itself answers a repeated call without laying out
 * anything. Files are written to a temporary name and renamed into place,
 * so a reader never sees half a PNG. A file used again has its time set to
 * now, so `prune` (the hooks ask once a session) deletes only what no call
 * used for a week.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Layout } from '../../../frontend/src/dsl/autoLayout';
import { CANVAS_TOKENS } from '../../../frontend/src/utils/canvasColors';
import { drawArchitecture, type ArchitectureLayout, type ArchitectureOptions } from '../render/architecture';
import type { Theme } from '../render/svg';
import { loadDocument, type Source } from './document';
import { Writer, hash, pngSize, put, touch, type Pixels } from './png';
import { renderPanels } from './panelHost';
import { layoutOf } from './layout';
import { fontsLoaded, loadFonts } from '../render/ui/metrics';
import { rect, surfaceFrame } from '../render/ui/kit';
import { BADGE, legend } from '../render/ui/panels';
import { alpha, paletteOf } from '../render/ui/theme';
import { formatMs } from '../../../frontend/src/sim/format';
import type { PanelsInput, PanelsOutput } from '../render/ui/contract';

export interface RasterOptions {
  theme?: Theme;
  scale?: number;
  maxWidthPx?: number;
  overlay?: boolean;
  selected?: string;
  play?: { useCase: string; scenario?: string; frames?: number };
  cellPx?: { width: number; height: number };
  grid?: GridOptions;
}

/** The picture as tiles of whole cells, for a terminal that swaps keyed Images: playback then blits only the tiles a frame changes. */
export interface GridOptions {
  /** The box the picture may take, in cells: it is scaled down to fit, never up. */
  room: number;
  maxRows: number;
  /** A cell in PNG px (2× a Retina screen's cell: render/ui panelHost's cellPxOf). */
  cellPx: { width: number; height: number };
  /** A tile in cells; default 16×8. */
  tile?: { columns: number; rows: number };
  /**
   * The picture as a strip of the plugin's drawing, which is one continuous
   * surface (render/ui/kit.ts surfaceFrame): `columns` wide, the diagram
   * centred on the UI surface's colour (its paper too), a hairline down each
   * side, the drawing's rounded corners where it is its first or last piece
   * (`top`, `bottom`), else a divider along its top; `legend` adds the load
   * legend as a badge at the bottom left; `controls`, the columns at its
   * bottom right a panel laid over the picture takes (the zoom's pill), keeps
   * the badge's band free under the diagram for it and the legend clear of
   * it. Without it, the picture is a card.
   */
  fill?: { columns: number; top?: boolean; bottom?: boolean; legend?: boolean; controls?: number };
  /**
   * Zoomed in: the picture drawn `zoom` times the size that fits the room
   * (1, the default, fits), re-rendered at that scale, for a viewport the
   * plugin pans over. No whole-picture PNG (`base` is '').
   */
  zoom?: number;
  /**
   * Only the tiles that meet this box of cells get a file (the others '',
   * still listed): the viewport and its neighbours. A worker keeps the
   * pictures it rendered last in memory, so another window of the same
   * picture only cuts and writes tiles.
   */
  window?: { col: number; row: number; columns: number; rows: number };
}

/**
 * The picture cut on the cell grid: `columns` × `rows` cells, exactly that
 * many cellPx (padded, transparent, right and bottom), in `tiles` row-major.
 * Each tile's file is named by its pixels, so a tile that looks the same is
 * one file. `base` is the still's file per tile; with `play`, per step its
 * `behind` (the step with no packet) per tile, and per frame only the tiles
 * a packet touches, by tile index.
 */
export interface RasterGrid {
  columns: number;
  rows: number;
  tiles: { col: number; row: number; columns: number; rows: number; width: number; height: number }[];
  base: string[];
  steps?: { behind: string[]; frames: Record<string, string>[] }[];
}

export interface RasterInput extends Source {
  outDir: string;
  /** Deletes the files in `outDir` no call used for PRUNE_AFTER_MS first: the cache's only cleanup but the system's. */
  prune?: boolean;
  options?: RasterOptions;
}

/** A document to lay out. */
export interface LayoutInput extends Source {
  kind: 'layout';
}

export interface RasterOutput {
  width: number;
  height: number;
  base: string;
  frames?: string[][];
  cellHint: { columns: number; rows: number };
  grid?: RasterGrid;
}

/** Every file an answer names. */
const filesOf = (o: RasterOutput): string[] => [o.base, ...(o.frames ?? []).flat(), ...(o.grid ? [...o.grid.base, ...(o.grid.steps ?? []).flatMap((s) => [...s.behind, ...s.frames.flatMap((f) => Object.values(f))])] : [])].filter(Boolean);

/**
 * The pictures rendered last, by what they are drawn from: a zoomed picture
 * panned asks for another window of the same pixels. Up to CACHE_BYTES,
 * well under the size at which a worker is recycled (RECYCLE_BYTES).
 */
const pixelCache = new Map<string, unknown>();
let cachedBytes = 0;
const CACHE_BYTES = 160 * 1024 * 1024;
const bytesOf = (v: unknown): number => {
  const px = (v as { px?: Pixels } | undefined)?.px;
  return px?.data instanceof Uint8Array ? px.data.byteLength : 0;
};
function memo<T>(key: string, make: () => T): T {
  if (pixelCache.has(key)) {
    const v = pixelCache.get(key) as T;
    pixelCache.delete(key);
    pixelCache.set(key, v);
    return v;
  }
  const v = make();
  pixelCache.set(key, v);
  cachedBytes += bytesOf(v);
  for (const [k, old] of pixelCache) {
    if (cachedBytes <= CACHE_BYTES || k === key) break;
    pixelCache.delete(k);
    cachedBytes -= bytesOf(old);
  }
  return v;
}

/** Where the helper finds `resvg.wasm` and `fonts/*.ttf`. */
export interface RasterAssets {
  dir: string;
  /** Hashed into the manifest's name, so a new helper never answers from an old one's files. */
  build?: string;
}

const DEFAULT_SCALE = 2;
const DEFAULT_FRAMES = 8;
const DEFAULT_CELL = { width: 16, height: 34 };

let ready: Promise<Uint8Array[]> | undefined;

/** Loads the wasm once per process, and the fonts it draws text with (resvg has no system fonts here). */
function engine(assets: RasterAssets): Promise<Uint8Array[]> {
  ready ??= (async () => {
    await initWasm(readFileSync(join(assets.dir, 'resvg.wasm')));
    const fonts = join(assets.dir, 'fonts');
    return readdirSync(fonts)
      .filter((f) => f.endsWith('.ttf'))
      .sort()
      .map((f) => new Uint8Array(readFileSync(join(fonts, f))));
  })();
  return ready;
}

/** How long a file in the cache lives unused. */
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a worker's request folder (`serve-*`) may go untouched before it counts as left behind: well past IDLE_MS. */
export const STALE_SERVE_MS = 60 * 60 * 1000;

/**
 * Deletes the files in `dir` older than PRUNE_AFTER_MS (by their time, which
 * a use sets to now), and the request folders of workers that are gone (a
 * `serve-*` folder untouched for STALE_SERVE_MS: a worker killed before it
 * could delete its own); one that goes meanwhile is skipped.
 */
export function prune(dir: string, now = Date.now()): number {
  let gone = 0;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    try {
      const stat = statSync(file);
      if (stat.isFile() && now - stat.mtimeMs > PRUNE_AFTER_MS) {
        unlinkSync(file);
        gone++;
      } else if (stat.isDirectory() && name.startsWith('serve-') && now - stat.mtimeMs > STALE_SERVE_MS) {
        rmSync(file, { recursive: true, force: true });
        gone++;
      }
    } catch {
      // Gone already, or another call's: nothing to do.
    }
  }
  return gone;
}

export async function rasterize(input: RasterInput, assets: RasterAssets): Promise<RasterOutput> {
  const options = input.options ?? {};
  mkdirSync(input.outDir, { recursive: true });
  if (input.prune) prune(input.outDir);
  const { source, path, imports, view } = input;
  const manifest = join(input.outDir, `${hash(JSON.stringify([assets.build ?? '', source, path, imports, view, options]))}.json`);
  if (existsSync(manifest)) {
    const done = JSON.parse(readFileSync(manifest, 'utf8')) as RasterOutput;
    const files = [...new Set(filesOf(done))];
    if (files.every((f) => existsSync(f))) {
      touch([manifest, ...files]);
      return done;
    }
  }

  const doc = loadDocument({ source, path, imports, view });
  if (doc.errors.length) throw new Error(doc.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
  const draw: ArchitectureOptions = { theme: options.theme ?? 'light', systems: doc.systems, terminal: true };
  if (options.selected !== undefined) draw.selected = options.selected;
  if (options.overlay && doc.overlay) {
    draw.nodes = doc.overlay;
    // The edges' load as the text cells draw it: the flows of the scope drawn, inside an expanded or focused system too.
    draw.overlay = { edges: doc.edges ?? {} };
  }
  let steps;
  if (options.play) {
    const { useCase, scenario } = options.play;
    const u = doc.diagram.useCases.find((c) => c.id === useCase || c.name === useCase);
    if (!u) throw new Error(`No use case '${useCase}'; the use cases are ${doc.diagram.useCases.map((c) => c.id).join(', ') || 'none'}.`);
    const s = scenario === undefined ? u.scenarios[0] : u.scenarios.find((c) => c.id === scenario || c.name === scenario);
    if (!s) throw new Error(`No scenario '${scenario}' in '${u.id}'; its scenarios are ${u.scenarios.map((c) => c.id).join(', ')}.`);
    steps = s.steps;
  }

  const fonts = await engine(assets);
  // ELK takes most of a call (≈2 s for a large design): a worker lays each document out once (layoutOf).
  const layoutKey = hash(JSON.stringify([source, path, imports, view]));
  const laid: ArchitectureLayout = { diagram: doc.diagram, layout: await layoutOf({ source, path, imports, view }) };
  const theme = draw.theme!;
  const resvgOptions = {
    font: { fontBuffers: fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
  };
  const g = options.grid;
  const fill = g?.fill;
  // On a strip of the UI, the paper is the UI's surface and the strip is its frame; else the picture is a card.
  if (fill) draw.background = paletteOf(theme).card.fill;
  if (fill?.legend && !fontsLoaded()) loadFonts(join(assets.dir, 'fonts'));
  const asDrawn = (svg: string) => (fill ? svg : asCard(svg, theme));
  const base = asDrawn(drawArchitecture(laid, draw));
  const svgWidth = Number(/width="(\d+)"/.exec(base)![1]);
  const svgHeight = Number(/height="(\d+)"/.exec(base)![1]);
  const max = options.maxWidthPx;
  const scale = options.scale ?? DEFAULT_SCALE;
  let zoom = max && svgWidth * scale > max ? max / svgWidth : scale;
  // The strip's frame around the picture: a column a side, and the legend's badge under it.
  const strip = fill && g ? stripOf(fill, g, theme, fill.legend && draw.overlay ? doc.critical : undefined) : undefined;
  // On a grid, no wider than the room and no taller than maxRows: the tiles are drawn at the size they are shown.
  if (g) {
    const room = strip ? Math.min(g.room, fill!.columns) * g.cellPx.width - strip.side * 2 : g.room * g.cellPx.width;
    const tall = g.maxRows * g.cellPx.height - (strip ? strip.above + strip.below : 0);
    zoom *= Math.min(1, room / (svgWidth * zoom), Math.max(1, tall) / (svgHeight * zoom));
    // Zoomed: that many times the size that fits, drawn crisp at it.
    if (g.zoom && g.zoom > 1) zoom *= g.zoom;
  }
  const zoomed = !!g?.zoom && g.zoom > 1;
  const fileOf = (svg: string) => join(input.outDir, `${hash(`${zoom}\u0000${svg}`)}.png`);

  const render = (svg: string): Pixels => {
    const resvg = new Resvg(svg, { ...resvgOptions, fitTo: { mode: 'zoom', value: zoom } });
    const image = resvg.render();
    const out = { width: image.width, height: image.height, data: image.pixels };
    image.free();
    resvg.free();
    return out;
  };
  let size: { width: number; height: number } | undefined;
  const writer = new Writer();
  const still = async (svg: string): Promise<string> => {
    const file = fileOf(svg);
    if (existsSync(file)) {
      size ??= pngSize(file);
      touch([file]);
    } else {
      const pixels = render(svg);
      size ??= pixels;
      await writer.add(file, pixels);
    }
    return file;
  };

  // Zoomed, no whole PNG: it would be large and slow to write, and the plugin shows tiles.
  const baseFile = zoomed ? '' : await still(base);
  let frames: string[][] | undefined;
  let grid: RasterGrid | undefined;
  if (g) {
    // On a strip: the picture laid onto it, centred, and the packets with it. Each kept in memory by what
    // it is drawn from (the drawing, the zoom, the strip), so another window of a zoomed picture only cuts tiles.
    const places = new Map<string, { left: number; top: number; compose(p: Pixels): Pixels }>();
    const placeOf = (p: Pixels) => {
      const at = `${p.width}x${p.height}`;
      if (!places.has(at)) places.set(at, strip!.place(p, resvgOptions));
      return places.get(at)!;
    };
    const stripKey = JSON.stringify([theme, fill, g.cellPx, fill?.legend ? doc.critical : undefined]);
    const drawn = (svg: string): { width: number; height: number; left: number; top: number; px: Pixels } =>
      memo(hash(`on\u0000${zoom}\u0000${stripKey}\u0000${svg}`), () => {
        const p = render(svg);
        const place = strip ? placeOf(p) : undefined;
        return { width: p.width, height: p.height, left: place?.left ?? 0, top: place?.top ?? 0, px: place ? place.compose(p) : p };
      });
    const picture = drawn(base);
    size ??= picture;
    const shift = <P extends { left: number; top: number }>(p: P): P => ({ ...p, left: p.left + picture.left, top: p.top + picture.top });
    const still = picture.px;
    const cut = cutter(still, g, input.outDir, writer);
    grid = { columns: cut.columns, rows: cut.rows, tiles: cut.tiles, base: await cut.files(still) };
    for (let index = 0; steps && index < steps.length; index++) {
      const count = Math.max(1, Math.round(options.play!.frames ?? DEFAULT_FRAMES));
      // The step's frames as the step drawn bare and the packets over it per frame: kept, so another window only cuts tiles.
      const played = memo(hash(`play\u0000${layoutKey}\u0000${zoom}\u0000${stripKey}\u0000${JSON.stringify([options, index, count])}`), () => {
        const svgs = Array.from({ length: count }, (_, k) => asDrawn(drawArchitecture(laid, { ...draw, play: { steps, index, progress: count === 1 ? 100 : (k * 100) / (count - 1) } })));
        const bare = svgs[0].replace(PACKET, '');
        const whole = drawn(bare);
        return { bare, packets: svgs.map((svg) => [...svg.matchAll(PACKET)].map(([packet, x, y]) => shift(packetPixels(packet, Number(x), Number(y), zoom, whole)))) };
      });
      const behind = drawn(played.bare).px;
      const step = { behind: await cut.files(behind), frames: [] as Record<string, string>[] };
      for (const packets of played.packets) step.frames.push(await cut.dirty(behind, packets));
      (grid.steps ??= []).push(step);
    }
  }
  for (let index = 0; !g && steps && index < steps.length; index++) {
    const count = Math.max(1, Math.round(options.play!.frames ?? DEFAULT_FRAMES));
    const svgs = Array.from({ length: count }, (_, k) => asCard(drawArchitecture(laid, { ...draw, play: { steps, index, progress: count === 1 ? 100 : (k * 100) / (count - 1) } }), theme));
    const files = svgs.map(fileOf);
    (frames ??= []).push(files);
    if (files.every((f) => existsSync(f))) {
      touch(files);
      continue;
    }
    // Within a step only the packets move, and they are drawn last: the step is drawn once
    // without them, and each frame lays just its packets over a copy of that.
    const behind = render(svgs[0].replace(PACKET, ''));
    for (const [k, svg] of svgs.entries()) {
      if (existsSync(files[k])) continue;
      const frame = { ...behind, data: behind.data.slice() };
      for (const [packet, x, y] of svg.matchAll(PACKET)) over(frame, packetPixels(packet, Number(x), Number(y), zoom, frame));
      await writer.add(files[k], frame);
    }
  }
  await writer.done();
  const cell = options.cellPx ?? DEFAULT_CELL;
  const { width, height } = size!;
  const out: RasterOutput = { width, height, base: baseFile, ...(frames ? { frames } : {}), ...(grid ? { grid } : {}), cellHint: { columns: Math.ceil(width / cell.width), rows: Math.ceil(height / cell.height) } };
  put(manifest, JSON.stringify(out));
  return out;
}

/**
 * The diagram as a card, as the UI panels are (render/ui/theme.ts): the
 * canvas's paper in a rounded rectangle with a clear border, the corners
 * outside it transparent, so the picture stands apart from the terminal's
 * background instead of reading as a slab.
 */
function asCard(svg: string, theme: Theme): string {
  const w = Number(/width="([\d.]+)"/.exec(svg)![1]);
  const h = Number(/height="([\d.]+)"/.exec(svg)![1]);
  const border = theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(17,17,17,0.12)';
  return svg.replace(/^(<svg[^>]*>)/, `$1<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${CANVAS_TOKENS[theme].paper}" stroke="${border}" stroke-width="1"/>`);
}

/**
 * The diagram's strip of the plugin's drawing (GridOptions.fill), in PNG px:
 * a column of the surface a side (`side`), room above (and below, with the
 * legend's badge in it); `place` sizes the strip to whole cells around a
 * picture and lays pictures that size onto it, centred.
 */
function stripOf(fill: NonNullable<GridOptions['fill']>, g: GridOptions, theme: Theme, critical: { useCase: string; p99Ms: number } | undefined) {
  const P = paletteOf(theme);
  const { width: cw, height: ch } = g.cellPx;
  // CSS px: the UI kit's 8×17 cell, stretched to cellPx as the panels are.
  const kx = cw / 8;
  const badge = BADGE;
  const side = cw;
  const above = Math.round(ch * 0.5);
  const below = critical !== undefined || fill.legend || fill.controls ? Math.round((badge.height + 2 * badge.margin) * kx) : above;
  return {
    side,
    above,
    below,
    place(picture: Pixels, resvgOptions: object) {
      const columns = Math.max(fill.columns, Math.ceil((picture.width + 2 * side) / cw));
      const rows = Math.max(1, Math.ceil((picture.height + above + below) / ch));
      const width = columns * cw;
      const height = rows * ch;
      const left = Math.round((width - picture.width) / 2);
      const top = above + Math.round((height - above - below - picture.height) / 2);
      // The frame in CSS px over a viewBox stretched to the strip's pixels, the badge in its bottom left corner.
      const w = width / kx;
      const h = height / (ch / 17);
      const parts = [surfaceFrame(P, w, h, { top: fill.top === true, bottom: fill.bottom === true })];
      if (fill.legend) {
        const y = h - badge.margin - badge.height;
        const drawn = legend(P, critical ? { useCase: critical.useCase, p99: formatMs(critical.p99Ms) } : undefined, badge.margin + 10, y + 16, w - 2 * badge.margin - 20 - (fill.controls ?? 0) * 8);
        parts.push(rect(badge.margin + 0.5, y + 0.5, drawn.width + 20 - 1, badge.height - 1, { fill: alpha(P.surface, 0.85), stroke: P.card.line, sw: 1, rx: 6 }), drawn.svg);
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" font-family="Inter">${parts.join('')}</svg>`;
      const resvg = new Resvg(svg, resvgOptions);
      const image = resvg.render();
      const frame: Pixels = { width: image.width, height: image.height, data: image.pixels };
      image.free();
      resvg.free();
      return {
        left,
        top,
        compose: (p: Pixels): Pixels => {
          const out = { ...frame, data: frame.data.slice() };
          over(out, { ...p, left, top });
          return out;
        },
      };
    },
  };
}

/** A packet as render/architecture.ts draws it (drawPacket): its own group, centred on its translate. */
const PACKET = /<g data-packet="[^"]*" transform="translate\(([-\d.]+) ([-\d.]+)\)"[^>]*>[\s\S]*?<\/g>\n?/g;
/** How far a packet reaches from its centre, in diagram px: the tumbling square and its shadow, or the cross's disc. */
const PACKET_REACH = 20;

/**
 * A packet alone on a transparent square around (x, y), at its place in the
 * whole image. (Rendering the whole drawing through a small viewBox would be
 * simpler, but resvg 2.6 panics on layers, nested <svg> and group opacity,
 * that reach out of the canvas.)
 */
function packetPixels(packet: string, x: number, y: number, zoom: number, whole: { width: number; height: number }): Pixels & { left: number; top: number } {
  const left = Math.max(0, Math.floor((x - PACKET_REACH) * zoom));
  const top = Math.max(0, Math.floor((y - PACKET_REACH) * zoom));
  const width = Math.min(whole.width, Math.ceil((x + PACKET_REACH) * zoom)) - left;
  const height = Math.min(whole.height, Math.ceil((y + PACKET_REACH) * zoom)) - top;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left / zoom} ${top / zoom} ${width / zoom} ${height / zoom}">${packet}</svg>`;
  const resvg = new Resvg(svg);
  const image = resvg.render();
  const out = { left, top, width: image.width, height: image.height, data: image.pixels };
  image.free();
  resvg.free();
  return out;
}

/** Lays `piece` over `into` (source-over, premultiplied). */
function over(into: Pixels, piece: Pixels & { left: number; top: number }): void {
  const { data } = into;
  const from = Math.max(0, -piece.left);
  const to = Math.min(piece.width, into.width - piece.left);
  for (let row = Math.max(0, -piece.top); row < piece.height && piece.top + row < into.height; row++) {
    // An opaque run (a zoomed picture is drawn on the surface's fill) is copied, not blended.
    const start = (row * piece.width + from) * 4;
    let opaque = to > from;
    for (let s = start + 3; opaque && s < (row * piece.width + to) * 4; s += 4) opaque = piece.data[s] === 255;
    if (opaque) {
      data.set(piece.data.subarray(start, (row * piece.width + to) * 4), ((piece.top + row) * into.width + piece.left + from) * 4);
      continue;
    }
    for (let col = from; col < to; col++) {
      const s = (row * piece.width + col) * 4;
      const a = piece.data[s + 3];
      if (a === 0) continue;
      const d = ((piece.top + row) * into.width + piece.left + col) * 4;
      const keep = 255 - a;
      for (let c = 0; c < 4; c++) data[d + c] = piece.data[s + c] + Math.round((data[d + c] * keep) / 255);
    }
  }
}

/**
 * Cuts pictures the size of `first` into the grid's tiles: every tile of a
 * picture, or only the ones the packets cover (a frame over its `behind`).
 */
function cutter(first: Pixels, g: GridOptions, outDir: string, writer: Writer) {
  const { width: cw, height: ch } = g.cellPx;
  const columns = Math.max(1, Math.ceil(first.width / cw));
  const rows = Math.max(1, Math.ceil(first.height / ch));
  const tc = g.tile?.columns ?? 16;
  const tr = g.tile?.rows ?? 8;
  const tiles: RasterGrid['tiles'] = [];
  for (let row = 0; row < rows; row += tr) {
    for (let col = 0; col < columns; col += tc) {
      const c = Math.min(tc, columns - col);
      const r = Math.min(tr, rows - row);
      tiles.push({ col, row, columns: c, rows: r, width: c * cw, height: r * ch });
    }
  }
  /** A tile of `from`, the transparent padding where it reaches past it. */
  const crop = (from: Pixels, t: RasterGrid['tiles'][number]): Pixels => {
    const data = new Uint8Array(t.width * t.height * 4);
    const x = t.col * cw;
    const y = t.row * ch;
    const w = Math.max(0, Math.min(t.width, from.width - x)) * 4;
    for (let r = 0; r < t.height && y + r < from.height; r++) data.set(from.data.subarray(((y + r) * from.width + x) * 4, ((y + r) * from.width + x) * 4 + w), r * t.width * 4);
    return { width: t.width, height: t.height, data };
  };
  const save = async (p: Pixels): Promise<string> => {
    const name = createHash('sha256').update(`${p.width}x${p.height}:`).update(p.data).digest('hex').slice(0, 20);
    const file = join(outDir, `t-${name}.png`);
    if (existsSync(file)) touch([file]);
    else await writer.add(file, p);
    return file;
  };
  // Only the tiles that meet the window, if there is one; the others ''.
  const w = g.window;
  const shown = (t: RasterGrid['tiles'][number]) => !w || (t.col < w.col + w.columns && t.col + t.columns > w.col && t.row < w.row + w.rows && t.row + t.rows > w.row);
  const files = async (p: Pixels): Promise<string[]> => {
    const out: string[] = [];
    for (const t of tiles) out.push(shown(t) ? await save(crop(p, t)) : '');
    return out;
  };
  const dirty = async (behind: Pixels, packets: (Pixels & { left: number; top: number })[]): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const [i, t] of tiles.entries()) {
      if (!shown(t)) continue;
      const x = t.col * cw;
      const y = t.row * ch;
      const on = packets.filter((p) => p.left < x + t.width && p.left + p.width > x && p.top < y + t.height && p.top + p.height > y);
      if (on.length === 0) continue;
      const tile = crop(behind, t);
      for (const p of on) over(tile, { ...p, left: p.left - x, top: p.top - y });
      out[i] = await save(tile);
    }
    return out;
  };
  return { columns, rows, tiles, files, dirty };
}

/** Answers one input: a diagram (RasterInput), panels (PanelsInput) with the diagram it carries drawn in the same run, or a layout (LayoutInput). */
export async function answer(input: RasterInput | PanelsInput | LayoutInput, assets: RasterAssets): Promise<RasterOutput | PanelsOutput | Layout> {
  if ('kind' in input && input.kind === 'layout') return layoutOf(input);
  if (!('kind' in input) || input.kind !== 'panels') return rasterize(input as RasterInput, assets);
  mkdirSync(input.outDir, { recursive: true });
  if (input.prune) prune(input.outDir);
  if (!fontsLoaded()) loadFonts(join(assets.dir, 'fonts'));
  const fonts = await engine(assets);
  const out: PanelsOutput = { panels: await renderPanels(input, { fonts, ...(assets.build ? { build: assets.build } : {}) }) };
  if (input.diagram) {
    out.diagram = await rasterize({ ...(input.diagram as unknown as RasterInput), outDir: input.outDir }, assets).then(
      (o) => o as unknown as Record<string, unknown>,
      (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
    );
  }
  return out;
}

/** How long a worker waits for a request before it exits: the plugin starts another on its next request. */
const IDLE_MS = 5 * 60 * 1000;
/** Past this resident size, a worker with no request waiting exits after its answer, and the plugin's next request starts a fresh one. */
export const RECYCLE_BYTES = 1024 * 1024 * 1024;

/**
 * The session-long worker: `raster.cjs --serve <dir>`. The mod's stdin is
 * one-shot, so requests come as files: `<id>.req.json` (an input as stdin
 * takes it) put into `dir`, best written under another name and renamed in,
 * answered lowest name first (the folder read again after each, so a request
 * named lower overtakes those waiting), each by a line on stdout, `{"id","output"}` or
 * `{"id","error"}`. The first line, `{"ready":true}`, comes once the wasm and
 * the fonts are loaded. It stops when idle for `idleMs`, once its parent is
 * gone (it is re-parented), or after an answer that leaves it over
 * `recycleBytes` with nothing waiting; stopping deletes `dir`.
 */
export function serve(dir: string, assets: RasterAssets, write: (line: string) => void = (l) => void process.stdout.write(l), idleMs = IDLE_MS, recycleBytes = RECYCLE_BYTES): { stop(): void; ready: Promise<void> } {
  mkdirSync(dir, { recursive: true });
  const parent = process.ppid;
  let busy = false;
  let again = false;
  let stopped = false;
  let last = Date.now();
  const tries = new Map<string, number>();
  const reply = (id: string, body: { output?: unknown; error?: string }) => write(`${JSON.stringify({ id, ...body })}\n`);
  const waiting = () => readdirSync(dir).some((f) => f.endsWith('.req.json'));
  const scan = async (): Promise<void> => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        for (const name of readdirSync(dir).filter((f) => f.endsWith('.req.json')).sort()) {
          const file = join(dir, name);
          const id = name.slice(0, -'.req.json'.length);
          let input: RasterInput | PanelsInput | LayoutInput;
          try {
            input = JSON.parse(readFileSync(file, 'utf8')) as RasterInput | PanelsInput | LayoutInput;
          } catch (error) {
            // Half written: read again on the next scans, for two seconds.
            const n = (tries.get(name) ?? 0) + 1;
            tries.set(name, n);
            if (n < 40 && existsSync(file)) continue;
            tries.delete(name);
            safeUnlink(file);
            reply(id, { error: `Unreadable request: ${error instanceof Error ? error.message : String(error)}` });
            continue;
          }
          tries.delete(name);
          safeUnlink(file);
          try {
            reply(id, { output: await answer(input, assets) });
          } catch (error) {
            reply(id, { error: error instanceof Error ? error.message : String(error) });
          }
          last = Date.now();
          if (process.memoryUsage().rss > recycleBytes && !waiting()) {
            stop();
            return;
          }
          // Read the folder again after each answer: a request named lower that came meanwhile (a press's, over prefetches) goes next.
          again = true;
          break;
        }
      } while (again);
    } finally {
      busy = false;
    }
  };
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dir, () => void scan());
  } catch {
    // The poll below finds the requests.
  }
  const poll = setInterval(() => {
    if (Date.now() - last > idleMs || process.ppid !== parent) stop();
    else void scan();
  }, 50);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(poll);
    watcher?.close();
    rmSync(dir, { recursive: true, force: true });
  };
  const ready = (async () => {
    if (!fontsLoaded()) loadFonts(join(assets.dir, 'fonts'));
    await engine(assets);
    write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`);
    void scan();
  })();
  return { stop, ready };
}

function safeUnlink(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Taken already, or gone.
  }
}

async function main(): Promise<void> {
  const self = readFileSync(__filename);
  const assets = { dir: __dirname, build: hash(self.toString('latin1')) };
  const at = process.argv.indexOf('--serve');
  if (at >= 0) {
    const dir = process.argv[at + 1];
    if (!dir) throw new Error('Usage: raster.cjs --serve <dir>');
    const worker = serve(dir, assets);
    // Killed (the session ended, the plugin stopped it): its folder goes with it.
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
      process.on(signal, () => {
        worker.stop();
        process.exit(0);
      });
    await worker.ready;
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RasterInput | PanelsInput | LayoutInput;
  process.stdout.write(JSON.stringify(await answer(input, assets)));
}

// Run as the helper, not when a test imports it.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
