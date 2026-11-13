import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { examples } from '../src/proschi';
import { drawArchitecture, layoutArchitecture, renderArchitectureSvg } from '../src/render/architecture';
import { COLORS } from '../src/render/svg';
import { loadDocument } from '../src/terminal/document';
import { answer, PRUNE_AFTER_MS, prune, rasterize, serve, STALE_SERVE_MS } from '../src/terminal/rasterHost';
import { layoutOf } from '../src/terminal/layout';
import { analysisOverlay, edgeOverlays } from '../../frontend/src/sim/overlay';
import { analyze } from '../../frontend/src/sim';
import { CANVAS_TOKENS } from '../../frontend/src/utils/canvasColors';

const source = (id: string) => examples.find((e) => e.id === id)!.source;
// build.mjs (pretest) copies resvg.wasm next to the fonts in plugin/hooks.
const HOOKS = fileURLToPath(new URL('../../plugin/hooks/', import.meta.url));

describe('architecture SVG: theme, overlay, playback, selection', () => {
  it('draws the dark theme without changing the light default', async () => {
    const { diagram } = loadDocument({ source: source('ecommerce') });
    const laid = await layoutArchitecture(diagram);
    const light = drawArchitecture(laid);
    expect(light).toBe(await renderArchitectureSvg(diagram));
    const dark = drawArchitecture(laid, { theme: 'dark' });
    expect(dark).toContain(`fill="${CANVAS_TOKENS.dark.paper}"`);
    expect(dark).not.toContain(CANVAS_TOKENS.light.paper);
    // The theme is put back afterwards.
    expect(COLORS.background).toBe(CANVAS_TOKENS.light.paper);
  });

  it('draws the load overlay: chips, the p99 path and the bottleneck', async () => {
    const doc = loadDocument({ source: source('url-shortener') });
    const edges = edgeOverlays(doc.diagram.edges, analysisOverlay(doc.root, analyze(doc.root)));
    const svg = drawArchitecture(await layoutArchitecture(doc.diagram), { nodes: doc.overlay, overlay: { edges } });
    expect(svg).toMatch(/\d+(\.\d+)?k rps/);
    expect(svg).toContain('data-critical="true"');
    const nodes = { ...doc.overlay, api: { ...doc.overlay!.api, bottleneck: true } };
    const ringed = drawArchitecture(await layoutArchitecture(doc.diagram), { nodes, overlay: { edges } });
    expect(ringed).toContain('data-bottleneck="true"');
    expect(ringed).toContain('BOTTLENECK');
  });

  it('plays a step: its nodes lit, the packet on its way, then gone', async () => {
    const { diagram } = loadDocument({ source: source('ecommerce') });
    const laid = await layoutArchitecture(diagram);
    const steps = diagram.useCases[0].scenarios[0].steps;
    const half = drawArchitecture(laid, { play: { steps, index: 0, progress: 25 } });
    expect(half).toContain(`data-node="${steps[0].fromServiceId}" data-kind`);
    expect(half.match(/data-play="active"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(half).toMatch(/<g data-packet="ok" transform="translate\([-\d.]+ [-\d.]+\)">/);
    expect(drawArchitecture(laid, { play: { steps, index: 0, progress: 100 } })).not.toContain('data-packet');
  });

  it('cuts a failed call short with a cross, in red', async () => {
    const { diagram } = loadDocument({ source: source('url-shortener') });
    const laid = await layoutArchitecture(diagram);
    const scenario = diagram.useCases.find((u) => u.name === 'Redirect')!.scenarios.find((s) => s.name.includes('Cache down'))!;
    const index = scenario.steps.findIndex((s) => s.failed);
    const svg = drawArchitecture(laid, { play: { steps: scenario.steps, index, progress: 80 } });
    expect(svg).toContain('data-packet="cut"');
    expect(svg).toContain('data-play="failing"');
  });

  it('draws for a terminal: replica stacks, the canvas load line and opaque chips; the default SVG keeps none of it', async () => {
    const replicated = 'api "API" [REST API] x3\ndb "DB" [PostgreSQL]\napi -> db : SQL\nusecase "Read" {\n  api -> db : SELECT\n}\ntraffic {\n  "Read" 100 rps\n}\n';
    const doc = loadDocument({ source: replicated });
    const laid = await layoutArchitecture(doc.diagram);
    const edges = edgeOverlays(doc.diagram.edges, analysisOverlay(doc.root, analyze(doc.root)));
    const plain = drawArchitecture(laid, { nodes: doc.overlay, overlay: { edges } });
    const terminal = drawArchitecture(laid, { nodes: doc.overlay, overlay: { edges }, terminal: true });
    expect(plain).not.toContain('data-stack');
    expect(plain).toContain('fill-opacity="0.92"');
    // Two cards behind the API's (at most two, as the canvas draws three or more replicas).
    expect(terminal.match(/data-stack="\d"/g)).toEqual(['data-stack="2"', 'data-stack="1"']);
    expect(terminal).toMatch(/×3 · \d+%/);
    expect(terminal).not.toContain('fill-opacity="0.92"');
    // No overlay: the stack still shows the replicas, as the terminal's text cards do.
    expect(drawArchitecture(laid, { terminal: true }).match(/data-stack="\d"/g)).toHaveLength(2);
    expect(drawArchitecture(laid)).toBe(await renderArchitectureSvg(doc.diagram));
  });

  it('rings the selected node', async () => {
    const { diagram } = loadDocument({ source: source('ecommerce') });
    const svg = drawArchitecture(await layoutArchitecture(diagram), { selected: diagram.nodes.find((n) => n.kind !== 'group')!.id });
    expect(svg.match(/data-selected="true"/g)).toHaveLength(1);
  });
});

describe('raster helper', () => {
  const isPng = (file: string) => readFileSync(file).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  it('writes the still and every frame of a scenario as PNGs, and answers again from them', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const input = { source: source('hello'), outDir, options: { theme: 'dark' as const, scale: 1, play: { useCase: 'Create a note', frames: 3 } } };
    const out = await rasterize(input, { dir: HOOKS });
    expect(isPng(out.base)).toBe(true);
    const steps = loadDocument({ source: source('hello') }).diagram.useCases[0].scenarios[0].steps;
    expect(out.frames).toHaveLength(steps.length);
    for (const frames of out.frames!) {
      expect(frames).toHaveLength(3);
      for (const f of frames) expect(isPng(f) && existsSync(f)).toBe(true);
      // A packet moves between the first frame and the last.
      expect(frames[0]).not.toBe(frames[2]);
    }
    const head = readFileSync(out.base);
    expect([head.readUInt32BE(16), head.readUInt32BE(20)]).toEqual([out.width, out.height]);
    expect(out.cellHint).toEqual({ columns: Math.ceil(out.width / 16), rows: Math.ceil(out.height / 34) });
    expect(await rasterize(input, { dir: HOOKS })).toEqual(out);
  });

  it('lays a document out for the worker, as the browser does', async () => {
    const input = { source: source('ecommerce'), view: { expanded: [] } };
    const laid = await answer({ kind: 'layout', ...input }, { dir: HOOKS });
    expect(laid).toEqual(await layoutOf(input));
    expect((laid as { nodes: { id: string }[] }).nodes.map((n) => n.id).sort()).toEqual(loadDocument(input).diagram.nodes.map((n) => n.id).sort());
  });

  it('cuts the picture into tiles of whole cells, and a frame into only the tiles its packets cover', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const grid = { room: 60, maxRows: 30, cellPx: { width: 16, height: 34 }, tile: { columns: 16, rows: 8 } };
    const input = { source: source('url-shortener'), outDir, options: { theme: 'dark' as const, maxWidthPx: 120 * 16, play: { useCase: 'Redirect', frames: 12 }, grid } };
    const out = await rasterize(input, { dir: HOOKS });
    const g = out.grid!;
    expect(out.frames).toBeUndefined();
    // Scaled down into the room, never past it.
    expect(g.columns).toBeLessThanOrEqual(60);
    expect(g.rows).toBeLessThanOrEqual(30);
    // The tiles cover the grid once, each exactly its cells in px.
    expect(g.tiles.reduce((n, t) => n + t.columns * t.rows, 0)).toBe(g.columns * g.rows);
    const size = (f: string) => [readFileSync(f).readUInt32BE(16), readFileSync(f).readUInt32BE(20)];
    for (const [i, t] of g.tiles.entries()) {
      expect([t.width, t.height]).toEqual([t.columns * 16, t.rows * 34]);
      expect(size(g.base[i])).toEqual([t.width, t.height]);
    }
    const steps = loadDocument({ source: source('url-shortener') }).diagram.useCases.find((u) => u.id === 'Redirect' || u.name === 'Redirect')!.scenarios[0].steps;
    expect(g.steps).toHaveLength(steps.length);
    for (const s of g.steps!) {
      expect(s.behind).toHaveLength(g.tiles.length);
      expect(s.frames).toHaveLength(12);
      // The packet moves: some frames cover tiles.
      expect(s.frames.some((f) => Object.keys(f).length > 0)).toBe(true);
      for (const f of s.frames) {
        const dirty = Object.keys(f).map(Number);
        // A packet is small: a frame changes a tile or a few, never the picture.
        expect(dirty.length).toBeLessThanOrEqual(4);
        for (const i of dirty) {
          expect(f[i]).not.toBe(s.behind[i]);
          expect(size(f[i])).toEqual([g.tiles[i].width, g.tiles[i].height]);
        }
      }
    }
    expect(await rasterize(input, { dir: HOOKS })).toEqual(out);
  });

  it('zooms: re-renders larger and draws only the tiles a window meets, the packets too', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const grid = { room: 60, maxRows: 30, cellPx: { width: 16, height: 34 }, fill: { columns: 60 } };
    const options = { theme: 'dark' as const, maxWidthPx: 60 * 16, overlay: true };
    const fit = (await rasterize({ source: source('url-shortener'), outDir, options: { ...options, grid } }, { dir: HOOKS })).grid!;
    const window = { col: 32, row: 8, columns: 40, rows: 16 };
    const out = await rasterize({ source: source('url-shortener'), outDir, options: { ...options, grid: { ...grid, zoom: 2, window } } }, { dir: HOOKS });
    const g = out.grid!;
    // Twice the picture, so about twice the cells each way; no whole PNG.
    expect(out.base).toBe('');
    expect(g.columns).toBeGreaterThan(fit.columns * 1.6);
    expect(g.rows).toBeGreaterThan(fit.rows * 1.6);
    expect(g.tiles.reduce((n, t) => n + t.columns * t.rows, 0)).toBe(g.columns * g.rows);
    const meets = (t: (typeof g.tiles)[number]) => t.col < window.col + window.columns && t.col + t.columns > window.col && t.row < window.row + window.rows && t.row + t.rows > window.row;
    for (const [i, t] of g.tiles.entries()) expect(Boolean(g.base[i])).toBe(meets(t));
    // Crisp: a zoomed tile is new pixels, not a fit tile scaled.
    expect(g.base.filter(Boolean).every((f) => !fit.base.includes(f))).toBe(true);
    // Another window of the same zoom: the tiles both meet are the same files.
    const next = (await rasterize({ source: source('url-shortener'), outDir, options: { ...options, grid: { ...grid, zoom: 2, window: { ...window, col: 48 } } } }, { dir: HOOKS })).grid!;
    for (const [i, f] of next.base.entries()) if (f && g.base[i]) expect(f).toBe(g.base[i]);
    // Playing zoomed: the steps' tiles and frames only within the window.
    const played = (await rasterize({ source: source('url-shortener'), outDir, options: { theme: 'dark' as const, maxWidthPx: 60 * 16, play: { useCase: 'Redirect', frames: 12 }, grid: { ...grid, zoom: 2, window } } }, { dir: HOOKS })).grid!;
    for (const s of played.steps!) {
      for (const [i, t] of played.tiles.entries()) expect(Boolean(s.behind[i])).toBe(meets(t));
      for (const f of s.frames) for (const i of Object.keys(f).map(Number)) expect(meets(played.tiles[i])).toBe(true);
    }
  }, 30_000);

  it('fills a strip as wide as the panels, the diagram centred on it, with the load legend in its corner', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const cellPx = { width: 16, height: 34 };
    const fill = { columns: 100, top: true, legend: true };
    const out = await rasterize({ source: source('url-shortener'), outDir, options: { theme: 'dark' as const, maxWidthPx: 100 * 16, overlay: true, grid: { room: 100, maxRows: 30, cellPx, fill } } }, { dir: HOOKS });
    const g = out.grid!;
    expect(g.columns).toBe(100);
    expect(g.tiles.reduce((n, t) => n + t.columns * t.rows, 0)).toBe(g.columns * g.rows);
    const plain = await rasterize({ source: source('url-shortener'), outDir, options: { theme: 'dark' as const, maxWidthPx: 100 * 16, overlay: true, grid: { room: 100, maxRows: 30, cellPx, fill: { columns: 100, top: true } } } }, { dir: HOOKS });
    expect(plain.grid!.columns).toBe(100);
    // The legend sits in the bottom-left corner, where the strip has nothing else; the strip's right edge is the same bare surface either way.
    const same = (i: number) => readFileSync(g.base[i]).equals(readFileSync(plain.grid!.base[i]));
    const at = (col: number, row: number) => g.tiles.findIndex((t) => col >= t.col && col < t.col + t.columns && row >= t.row && row < t.row + t.rows);
    expect(same(at(0, g.rows - 1))).toBe(false);
    expect(same(at(99, 0))).toBe(true);
    // The diagram is centred: the tiles it changes reach as far from either edge.
    const changed = g.tiles.filter((t, i) => !same(i) && t.row + t.rows < g.rows);
    const left = Math.min(...changed.map((t) => t.col));
    const right = 100 - Math.max(...changed.map((t) => t.col + t.columns));
    expect(Math.abs(left - right)).toBeLessThanOrEqual(16);
  }, 30_000);

  it('fits maxWidthPx, and names an unknown use case', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const out = await rasterize({ source: source('hello'), outDir, options: { maxWidthPx: 300 } }, { dir: HOOKS });
    expect(out.width).toBeLessThanOrEqual(300);
    await expect(rasterize({ source: source('hello'), outDir, options: { play: { useCase: 'nope' } } }, { dir: HOOKS })).rejects.toThrow(/No use case 'nope'/);
  });

  it('prunes what no call used for a week, and a use keeps a file', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const options = { scale: 0.5 };
    const old = new Date(Date.now() - PRUNE_AFTER_MS - 60_000);
    const stale = join(outDir, 'stale.png');
    writeFileSync(stale, 'x');
    utimesSync(stale, old, old);
    const out = await rasterize({ source: source('hello'), outDir, options }, { dir: HOOKS });
    // Drawn a week ago and used again now: kept.
    utimesSync(out.base, old, old);
    await rasterize({ source: source('hello'), outDir, options }, { dir: HOOKS });
    expect(Date.now() - statSync(out.base).mtimeMs).toBeLessThan(60_000);
    // Without prune nothing goes; with it the stale file does.
    expect(existsSync(stale)).toBe(true);
    await rasterize({ source: source('hello'), outDir, options, prune: true }, { dir: HOOKS });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(out.base)).toBe(true);
    expect(prune(outDir)).toBe(0);
  });

  it('prunes the request folders workers left behind, not a live one', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const left = join(outDir, 'serve-old');
    const live = join(outDir, 'serve-new');
    for (const dir of [left, live]) mkdirSync(dir);
    writeFileSync(join(left, 'a.req.json'), '{}');
    const old = new Date(Date.now() - STALE_SERVE_MS - 60_000);
    utimesSync(left, old, old);
    expect(prune(outDir)).toBe(1);
    expect(existsSync(left)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  it('a worker deletes its request folder when it stops, and stops when idle or past its size', async () => {
    const root = mkdtempSync(join(tmpdir(), 'proschi-serve-'));
    const idle = serve(join(root, 'serve-a'), { dir: HOOKS }, () => {}, 100);
    await idle.ready;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(existsSync(join(root, 'serve-a'))).toBe(false);
    // Over its size after an answer, with nothing waiting: it stops, and its folder goes.
    const lines: string[] = [];
    const big = serve(join(root, 'serve-b'), { dir: HOOKS }, (l) => void lines.push(l), 60_000, 1);
    await big.ready;
    writeFileSync(join(root, 'serve-b', 'a.req.json'), JSON.stringify({ kind: 'layout', source: source('hello') }));
    for (let i = 0; i < 100 && !lines.some((l) => l.includes('"id":"a"')); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines.some((l) => l.includes('"id":"a"'))).toBe(true);
    expect(existsSync(join(root, 'serve-b'))).toBe(false);
    big.stop();
  }, 20_000);
});
