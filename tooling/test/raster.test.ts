import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { examples } from '../src/proschi';
import { drawArchitecture, layoutArchitecture, renderArchitectureSvg } from '../src/render/architecture';
import { COLORS } from '../src/render/svg';
import { loadDocument } from '../src/terminal/document';
import { rasterize } from '../src/terminal/rasterHost';
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
    expect(out.cellHint).toEqual({ columns: Math.ceil(out.width / 16), rows: Math.ceil(out.height / 32) });
    expect(await rasterize(input, { dir: HOOKS })).toEqual(out);
  });

  it('draws the load under a live what-if', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const options = { scale: 0.5, overlay: true };
    const written = await rasterize({ source: source('url-shortener'), outDir, options }, { dir: HOOKS });
    const tripled = await rasterize({ source: source('url-shortener'), outDir, options: { ...options, whatIf: { multiplier: 3, failed: [] } } }, { dir: HOOKS });
    const unchanged = await rasterize({ source: source('url-shortener'), outDir, options: { ...options, whatIf: { multiplier: 1, failed: [] } } }, { dir: HOOKS });
    expect(tripled.base).not.toBe(written.base);
    expect(unchanged.base).toBe(written.base);
  });

  it('fits maxWidthPx, and names an unknown use case', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-raster-'));
    const out = await rasterize({ source: source('hello'), outDir, options: { maxWidthPx: 300 } }, { dir: HOOKS });
    expect(out.width).toBeLessThanOrEqual(300);
    await expect(rasterize({ source: source('hello'), outDir, options: { play: { useCase: 'nope' } } }, { dir: HOOKS })).rejects.toThrow(/No use case 'nope'/);
  });
});
