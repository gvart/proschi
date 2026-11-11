/**
 * The Claude Code plugin's raster helper (plugin/hooks/raster.cjs): draws a
 * document as PNG files for terminals with an image protocol (kitty, Ghostty,
 * iTerm2), the way the web canvas draws it: the architecture SVG of
 * `proschi render` (render/architecture.ts) with the load overlay, the
 * selection and use case playback, rasterized with resvg (WebAssembly) and
 * the fonts shipped next to it. The hooks run it in Node, one shot.
 *
 * Contract (docs/design/terminal-mod-graphics.md):
 *
 *   stdin  RasterInput as JSON:
 *     { source, path?, imports?, view?,            as layout.cjs (terminal/document.ts Source)
 *       outDir,                                    where the PNGs go (created if missing)
 *       options?: {
 *         theme?: 'light' | 'dark',                default 'light'
 *         scale?: number,                          PNG px per diagram px, default 2
 *         maxWidthPx?: number,                     the PNG is scaled down to fit this width
 *         overlay?: boolean,                       the load overlay (when the document has `traffic`)
 *         selected?: string,                       a node or expanded system id, ringed in the accent
 *         play?: { useCase, scenario?, frames? },  id or name; scenario defaults to the first; frames per step, default 8
 *         cellPx?: { width, height } } }           the terminal's cell in screen px, for cellHint; default 16×32
 *   stdout RasterOutput as JSON:
 *     { width, height,                             PNG size in px, the same for every file
 *       base,                                      absolute path of the still image
 *       frames?: string[][],                       with `play`: per step of the scenario, its frames in order
 *                                                  (progress 0..100; the last one shows the call arrived)
 *       cellHint: { columns, rows } }              cells the PNG covers at one PNG px per screen px
 *   exit 1 with the message on stderr when the document has errors or the use case is unknown.
 *
 * Files are named by a hash of their SVG and the zoom, so a frame that
 * repeats (or another call drawing the same thing) is written once; files
 * that exist are not drawn again. A manifest named by a hash of the input
 * and of this helper itself answers a repeated call without laying out
 * anything. Files are written to a temporary name and renamed into place,
 * so a reader never sees half a PNG.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { edgeOverlays, analysisOverlay } from '../../../frontend/src/sim/overlay';
import { analyze } from '../../../frontend/src/sim';
import { CANVAS_TOKENS } from '../../../frontend/src/utils/canvasColors';
import { drawArchitecture, layoutArchitecture, type ArchitectureOptions } from '../render/architecture';
import type { Theme } from '../render/svg';
import { loadDocument, type Source } from './document';

export interface RasterOptions {
  theme?: Theme;
  scale?: number;
  maxWidthPx?: number;
  overlay?: boolean;
  selected?: string;
  play?: { useCase: string; scenario?: string; frames?: number };
  cellPx?: { width: number; height: number };
}

export interface RasterInput extends Source {
  outDir: string;
  options?: RasterOptions;
}

export interface RasterOutput {
  width: number;
  height: number;
  base: string;
  frames?: string[][];
  cellHint: { columns: number; rows: number };
}

/** Where the helper finds `resvg.wasm` and `fonts/*.ttf`. */
export interface RasterAssets {
  dir: string;
  /** Hashed into the manifest's name, so a new helper never answers from an old one's files. */
  build?: string;
}

const DEFAULT_SCALE = 2;
const DEFAULT_FRAMES = 8;
const DEFAULT_CELL = { width: 16, height: 32 };

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

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 20);

/** Writes `bytes` to `file` unless it is there already, through a temporary name. */
function put(file: string, bytes: Uint8Array | string): void {
  if (existsSync(file)) return;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

export async function rasterize(input: RasterInput, assets: RasterAssets): Promise<RasterOutput> {
  const options = input.options ?? {};
  mkdirSync(input.outDir, { recursive: true });
  const { source, path, imports, view } = input;
  const manifest = join(input.outDir, `${hash(JSON.stringify([assets.build ?? '', source, path, imports, view, options]))}.json`);
  if (existsSync(manifest)) {
    const done = JSON.parse(readFileSync(manifest, 'utf8')) as RasterOutput;
    if ([done.base, ...(done.frames ?? []).flat()].every((f) => existsSync(f))) return done;
  }

  const doc = loadDocument({ source, path, imports, view });
  if (doc.errors.length) throw new Error(doc.errors.map((e) => `${e.line}:${e.col} ${e.message}`).join('\n'));
  const draw: ArchitectureOptions = { theme: options.theme ?? 'light', systems: doc.systems };
  if (options.selected !== undefined) draw.selected = options.selected;
  if (options.overlay && doc.overlay) {
    draw.nodes = doc.overlay;
    // The edges' load is the root document's; inside a focused system only the cards carry it.
    const edges = view?.focus === undefined ? edgeOverlays(doc.diagram.edges, analysisOverlay(doc.root, analyze(doc.root))) : {};
    draw.overlay = { edges };
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
  const laid = await layoutArchitecture(doc.diagram);
  const theme = draw.theme!;
  const resvgOptions = {
    font: { fontBuffers: fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
    background: CANVAS_TOKENS[theme].paper,
  };
  const base = drawArchitecture(laid, draw);
  const svgWidth = Number(/width="(\d+)"/.exec(base)![1]);
  const max = options.maxWidthPx;
  const scale = options.scale ?? DEFAULT_SCALE;
  const zoom = max && svgWidth * scale > max ? max / svgWidth : scale;
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
  const still = (svg: string): string => {
    const file = fileOf(svg);
    if (existsSync(file)) size ??= pngSize(file);
    else {
      const pixels = render(svg);
      size ??= pixels;
      put(file, encodePng(pixels));
    }
    return file;
  };

  const baseFile = still(base);
  const frames = steps?.map((_, index) => {
    const count = Math.max(1, Math.round(options.play!.frames ?? DEFAULT_FRAMES));
    const svgs = Array.from({ length: count }, (_, k) => drawArchitecture(laid, { ...draw, play: { steps: steps!, index, progress: count === 1 ? 100 : (k * 100) / (count - 1) } }));
    const files = svgs.map(fileOf);
    if (files.every((f) => existsSync(f))) return files;
    // Within a step only the packets move, and they are drawn last: the step is drawn once
    // without them, and each frame lays just its packets over a copy of that.
    const behind = render(svgs[0].replace(PACKET, ''));
    svgs.forEach((svg, k) => {
      if (existsSync(files[k])) return;
      const frame = { ...behind, data: behind.data.slice() };
      for (const [packet, x, y] of svg.matchAll(PACKET)) over(frame, packetPixels(packet, Number(x), Number(y), zoom, frame));
      put(files[k], encodePng(frame));
    });
    return files;
  });
  const cell = options.cellPx ?? DEFAULT_CELL;
  const { width, height } = size!;
  const out: RasterOutput = { width, height, base: baseFile, ...(frames ? { frames } : {}), cellHint: { columns: Math.ceil(width / cell.width), rows: Math.ceil(height / cell.height) } };
  put(manifest, JSON.stringify(out));
  return out;
}

/** RGBA pixels, row by row, premultiplied (as resvg gives them). */
interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
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
function packetPixels(packet: string, x: number, y: number, zoom: number, whole: Pixels): Pixels & { left: number; top: number } {
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
  for (let row = 0; row < piece.height && piece.top + row < into.height; row++) {
    for (let col = 0; col < piece.width && piece.left + col < into.width; col++) {
      const s = (row * piece.width + col) * 4;
      const a = piece.data[s + 3];
      if (a === 0) continue;
      const d = ((piece.top + row) * into.width + piece.left + col) * 4;
      const keep = 255 - a;
      for (let c = 0; c < 4; c++) data[d + c] = piece.data[s + c] + Math.round((data[d + c] * keep) / 255);
    }
  }
}

/** Width and height from a PNG's IHDR. */
function pngSize(file: string): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * An RGBA PNG, unfiltered at zlib level 3: three times as fast as resvg's
 * own encoder for files a third larger, which is the better trade for frames
 * that go to a terminal right away.
 */
function encodePng({ width, height, data }: Pixels): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 3 })), chunk('IEND', new Uint8Array(0))]);
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RasterInput;
  const self = readFileSync(__filename);
  process.stdout.write(JSON.stringify(await rasterize(input, { dir: __dirname, build: hash(self.toString('latin1')) })));
}

// Run as the helper, not when a test imports it.
if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
