import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { examples } from '../src/proschi';
import { renderSequenceSvg } from '../src/render/sequence';
import type { Panel, PanelOutput, PanelsOutput } from '../src/render/ui/contract';
import { analysisPage, hldPage, stepPanelOf, tabBarPanel, testsPage, whatIfPage } from '../src/render/ui/data';
import { CELL } from '../src/render/ui/kit';
import { markdownBlocks } from '../src/render/ui/markdown';
import { loadFonts } from '../src/render/ui/metrics';
import { drawPanel } from '../src/render/ui/panels';
import { cellsOf, cut } from '../src/render/ui/tiles';
import { loadDocument } from '../src/terminal/document';
import { answer } from '../src/terminal/rasterHost';
import { liveOptions } from '../../frontend/src/components/WhatIf/whatIf';
import { hld } from '../../frontend/src/hld/hld';
import { toMarkdown } from '../../frontend/src/hld/markdown';

const HOOKS = fileURLToPath(new URL('../../plugin/hooks/', import.meta.url));
loadFonts(join(HOOKS, 'fonts'));

const src = `${examples.find((e) => e.id === 'url-shortener')!.source}\nwhatif "Launch day" {\n  traffic "Redirect" x3\n}\n`;
const source = { source: src };
const doc = loadDocument(source);
const now = loadDocument(source, liveOptions(doc.root, { multiplier: 3, failed: ['cache'] }));
const name = (id: string) => doc.diagram.nodes.find((n) => n.id === id)?.name ?? id;
const redirect = doc.diagram.useCases[0];

const PANELS: Record<string, Panel> = {
  tabs: tabBarPanel('tests', 2),
  useCaseBar: {
    kind: 'useCaseBar',
    picker: { id: 'uc', value: redirect.id, open: true, options: doc.diagram.useCases.map((u) => ({ value: u.id, label: u.name })) },
    play: { id: 'play', icon: 'play', label: 'Play', variant: 'primary', hotkey: 'p' },
    explore: { id: 'explore', icon: 'explore', label: 'Hide explorer', active: true },
    explorer: [{ label: 'GET /abc123', useCases: [{ name: 'Redirect', current: true, scenarios: redirect.scenarios.map((s) => ({ id: `sc-${s.id}`, name: s.name, outcome: s.outcome === 'error' ? 'error' : 'ok' })) }] }],
  },
  playerHeader: { kind: 'playerHeader', back: { id: 'back', icon: 'back', label: 'Diagram', hotkey: 'd' }, title: 'Redirect', scenarios: redirect.scenarios.map((s, i) => ({ id: `sc-${s.id}`, name: s.name, outcome: 'ok', current: i === 0 })) },
  step: stepPanelOf(redirect.scenarios[1], 2, true, name),
  systemBar: { kind: 'systemBar', inside: 'a › b', selected: { name: 'Ledger', path: 'a.b' }, controls: [{ id: 'next', icon: 'cycle', label: 'Next', hotkey: 's' }] },
  actionBar: { kind: 'actionBar', controls: [{ id: 'src', icon: 'copy', label: 'Copy source' }, { id: 'open', icon: 'open', label: 'Open in Proschi', variant: 'primary' }] },
  notices: { kind: 'notices', notices: [{ text: 'A warning', hint: 'a hint' }], legend: {}, verdict: { passed: 1, total: 3, first: 'p99: too slow' }, details: { id: 'details', label: 'Details' } },
  banner: { kind: 'banner', label: 'What-if: Traffic ×3', reset: { id: 'reset', icon: 'reset', label: 'Reset', hotkey: 'r' } },
  analysis: analysisPage(doc),
  whatIf: whatIfPage(doc, now, { multiplier: 3, failed: ['cache'], sweep: 'redirect', open: 'wi-node' }),
  tests: testsPage(now, true),
  hld: hldPage(toMarkdown(hld(doc.root, doc.analysis, doc.tests))),
  sequence: { kind: 'sequence', source, useCase: redirect.id, current: [2], controls: [{ text: [{ text: 'Scenario', bold: true }] }, { select: { id: 'pick', value: 'redirect', options: [{ value: 'redirect', label: 'Redirect' }] } }, { text: [{ text: 'Step 2 of 3', bold: true }] }] },
};

describe('UI panels: the cell grid', () => {
  for (const [kind, panel] of Object.entries(PANELS)) {
    it(`cuts ${kind} into strips that cover it exactly`, () => {
      for (const columns of [80, 120, 200]) {
        const { surface, height } = drawPanel(panel, columns, 'dark');
        expect(height % CELL.height).toBe(0);
        const rows = height / CELL.height;
        const strips = cut(rows, surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, columns, rows) })), surface.cuttable(rows));
        let row = 0;
        for (const s of strips) {
          expect(s.row).toBe(row);
          expect(s.rows).toBeLessThanOrEqual(255);
          // Areas side by side, never sharing a column.
          let col = 0;
          for (const a of s.controls) {
            expect(a.col).toBeGreaterThanOrEqual(col);
            col = a.col + a.columns;
          }
          expect(col).toBeLessThanOrEqual(columns);
          row += s.rows;
        }
        expect(row).toBe(rows);
        // Every control has an area of its own, which holds its whole drawing.
        for (const c of surface.controls) {
          const s = strips.find((x) => x.controls.some((a) => a.control.id === c.control.id))!;
          expect(s).toBeDefined();
          const a = s.controls.find((x) => x.control.id === c.control.id)!;
          expect(c.box.x).toBeGreaterThanOrEqual(a.col * CELL.width);
          expect(c.box.x + c.box.w).toBeLessThanOrEqual((a.col + a.columns) * CELL.width);
          expect(c.box.y).toBeGreaterThanOrEqual(s.row * CELL.height - 1e-6);
          expect(c.box.y + c.box.h).toBeLessThanOrEqual((s.row + s.rows) * CELL.height + 1e-6);
        }
      }
    });
  }

  it('ends strips only between lines: no glyph crosses a strip boundary', async () => {
    // The text alone, drawn by resvg with the helper's fonts: a glyph crosses a boundary when a column has ink on both sides of it.
    await answer({ kind: 'panels', outDir: mkdtempSync(join(tmpdir(), 'proschi-ui-')), panels: [] }, { dir: HOOKS });
    const { Resvg } = await import('@resvg/resvg-wasm');
    const fonts = ['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold', 'JetBrainsMono-Medium'].map((f) => new Uint8Array(readFileSync(join(HOOKS, 'fonts', `${f}.ttf`))));
    for (const [kind, panel] of Object.entries(PANELS)) {
      for (const columns of [80, 120]) {
        const { surface, height } = drawPanel(panel, columns, 'dark');
        const rows = height / CELL.height;
        const strips = cut(rows, surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, columns, rows) })), surface.cuttable(rows));
        const textOnly = surface.svg(height).replace(/<(rect|line|circle|path)\b[^>]*\/>/g, '');
        const image = new Resvg(textOnly, { font: { fontBuffers: fonts, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' } }).render();
        const ink = (x: number, y: number) => image.pixels[(y * image.width + x) * 4 + 3] > 24;
        for (const s of strips.slice(1)) {
          const y = s.row * CELL.height;
          const crossing = Array.from({ length: image.width }, (_, x) => x).filter((x) => ink(x, y - 1) && ink(x, y));
          expect(crossing, `${kind} at ${columns} columns: a glyph crosses row ${s.row}`).toEqual([]);
        }
      }
    }
  }, 30_000);

  it('fits a row of controls by shortening them, as the text UI does, rather than wrapping', () => {
    for (const columns of [60, 80, 100]) {
      const { surface } = drawPanel(PANELS.step, columns, 'dark');
      const rowsOf = new Set(surface.controls.map((c) => c.box.y));
      expect(rowsOf.size, `${columns} columns`).toBe(1);
    }
  });

  it('draws each panel as a piece of one surface: rounded only at its outer edges, a divider above unless on top', () => {
    const svgOf = (edges: { top?: boolean; bottom?: boolean }) => {
      const { surface, height } = drawPanel(PANELS.step, 80, 'dark', edges);
      return surface.svg(height);
    };
    const middle = svgOf({});
    const top = svgOf({ top: true });
    const bottom = svgOf({ bottom: true });
    // Arcs only where an outer edge is.
    expect(middle).not.toMatch(/ A ?8/);
    expect(top).toMatch(/ A ?8/);
    expect(bottom).toMatch(/ A ?8/);
    // The top piece has no divider over it; the others do.
    expect(top).not.toBe(middle);
    expect(bottom).not.toBe(top);
  });

  it('refuses controls that share cells', () => {
    const control = (id: string) => ({ id, kind: 'button' as const });
    expect(() => cut(4, [{ control: control('a'), cells: { col: 0, row: 0, columns: 5, rows: 2 } }, { control: control('b'), cells: { col: 4, row: 1, columns: 5, rows: 2 } }])).toThrow(/share cells/);
  });

  it('draws the same panel from its JSON', () => {
    for (const panel of Object.values(PANELS)) {
      const again = JSON.parse(JSON.stringify(panel)) as Panel;
      expect(drawPanel(again, 120, 'light').surface.svg(drawPanel(again, 120, 'light').height)).toBe(drawPanel(panel, 120, 'light').surface.svg(drawPanel(panel, 120, 'light').height));
    }
  });

  it('keeps hotkeys and control ids on the tiles', () => {
    const { surface } = drawPanel(PANELS.tabs, 120, 'dark');
    expect(surface.controls.map((c) => [c.control.id, c.control.hotkey, c.control.kind])).toEqual(['diagram', 'analysis', 'whatif', 'sequence', 'hld', 'tests'].map((id, i) => [id, String(i + 1), 'tab']));
    const step = drawPanel(PANELS.step, 120, 'dark').surface.controls.map((c) => c.control.id);
    expect(step).toEqual(['first', 'prev', 'play', 'next', 'last', 'exit']);
    const menu = drawPanel(PANELS.useCaseBar, 120, 'dark').surface.controls.filter((c) => c.control.kind === 'option');
    expect(menu.map((c) => c.control.id)).toEqual(doc.diagram.useCases.map((u) => `uc=${u.id}`));
  });
});

describe('UI panels: Markdown and the sequence', () => {
  it('reads the HLD Markdown as blocks', () => {
    const blocks = markdownBlocks('# Title\n\nSome **bold** and `code`.\n\n| A | B |\n|---|---:|\n| ✅ | 2 |\n\n- one\n- two\n\n```mermaid\nsequenceDiagram\n```\n');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'table', 'list', 'paragraph']);
    expect(blocks[1]).toEqual({ type: 'paragraph', text: [{ text: 'Some ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'code', mono: true }, { text: '.' }] });
    expect(blocks[2]).toMatchObject({ columns: [{ title: 'A' }, { title: 'B', align: 'right' }], rows: [{ cells: [[{ text: '✓', tone: 'good' }], '2'] }] });
    expect(blocks[4]).toMatchObject({ text: 'The Sequence tab draws this scenario.' });
  });

  it('leaves the default sequence SVG as it was and lights the current steps on request', () => {
    const scenario = redirect.scenarios[0];
    const plain = renderSequenceSvg(doc.diagram, redirect, scenario);
    expect(renderSequenceSvg(doc.diagram, redirect, scenario, '', {})).toBe(plain);
    expect(plain).not.toContain('data-current');
    const lit = renderSequenceSvg(doc.diagram, redirect, scenario, '', { current: [2] });
    expect(lit.match(/data-current="2"/g)?.length).toBe(2);
  });

  it('points every arrowhead into its receiver, a reply right to left too, as resvg draws it', async () => {
    await answer({ kind: 'panels', outDir: mkdtempSync(join(tmpdir(), 'proschi-ui-')), panels: [] }, { dir: HOOKS });
    const { Resvg } = await import('@resvg/resvg-wasm');
    const svg = renderSequenceSvg(doc.diagram, redirect, redirect.scenarios[0]);
    const image = new Resvg(svg).render();
    const { width, pixels } = { width: image.width, pixels: image.pixels };
    // Ink (unlike the paper at the row's left edge) above the line, so not the line itself, in columns [from, to): the arrowhead's arms reach back from its tip.
    const ink = (from: number, to: number, y: number) => {
      let n = 0;
      for (let row = Math.round(y - 7); row <= Math.round(y - 2); row++) {
        const paper = (row * width + 2) * 4;
        for (let x = Math.round(from); x < Math.round(to); x++) {
          const at = (row * width + x) * 4;
          const d = [0, 1, 2].reduce((m, c) => Math.max(m, Math.abs(pixels[at + c] - pixels[paper + c])), 0);
          n += d > 40 ? 1 : 0;
        }
      }
      return n;
    };
    const lines = [...svg.matchAll(/data-kind="(request|response)"[^>]*>[\s\S]*?<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)"[^>]*marker-end/g)].map(([, kind, x1, y, x2]) => ({ kind, x1: Number(x1), y: Number(y), x2: Number(x2) }));
    expect(lines.some((l) => l.kind === 'response' && l.x2 < l.x1)).toBe(true);
    for (const l of lines) {
      const dir = Math.sign(l.x2 - l.x1);
      // Behind the tip (back along the line) the arms; past it, nothing but the receiver's lifeline (left out).
      const behind = dir > 0 ? ink(l.x2 - 12, l.x2 - 4, l.y) : ink(l.x2 + 4, l.x2 + 12, l.y);
      const past = dir > 0 ? ink(l.x2 + 4, l.x2 + 12, l.y) : ink(l.x2 - 12, l.x2 - 4, l.y);
      expect([l.kind, behind > 0, past]).toEqual([l.kind, true, 0]);
    }
  });
});

describe('UI panels: the raster helper', () => {
  it('writes the tiles at their cell size, and answers a repeat from its manifest', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-ui-'));
    const input = { kind: 'panels' as const, outDir, theme: 'dark' as const, panels: [{ id: 'tabs', panel: PANELS.tabs, columns: 100 }, { id: 'bad', panel: { kind: 'nope' } as unknown as Panel, columns: 100 }] };
    const out = (await answer(input, { dir: HOOKS })) as PanelsOutput;
    const tabs = out.panels[0] as PanelOutput;
    expect(tabs.id).toBe('tabs');
    expect(tabs.cellPx).toEqual({ width: 16, height: 34 });
    expect(tabs.tiles.map((t) => [t.col, t.columns])).toEqual(tabs.tiles.map(() => [0, 100]));
    expect(out.panels[1]).toEqual({ id: 'bad', error: "Unknown panel kind 'nope'" });
    for (const t of tabs.tiles) {
      const head = readFileSync(t.file!).subarray(16, 24);
      expect([head.readUInt32BE(0), head.readUInt32BE(4)]).toEqual([t.columns * 16, t.rows * 34]);
      for (const a of t.controls ?? []) expect(existsSync(a.hoverFile!)).toBe(true);
    }
    // A terminal cell of another shape: the same layout, drawn 16 by round(16 × aspect) px a cell.
    const square = (await answer({ ...input, cellAspect: 2 }, { dir: HOOKS })) as PanelsOutput;
    const t = (square.panels[0] as PanelOutput).tiles[0];
    expect((square.panels[0] as PanelOutput).cellPx).toEqual({ width: 16, height: 32 });
    expect(readFileSync(t.file!).readUInt32BE(20)).toBe(t.rows * 32);
    expect(((await answer(input, { dir: HOOKS })) as PanelsOutput).panels[0]).toEqual(tabs);
  });

  it('serves requests from a folder with --serve', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proschi-serve-'));
    const child = spawn('node', [join(HOOKS, 'raster.cjs'), '--serve', dir], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      const lines: Record<string, unknown>[] = [];
      let buf = '';
      const next = () =>
        new Promise<Record<string, unknown>>((resolve) => {
          const take = () => {
            const nl = buf.indexOf('\n');
            if (nl < 0) return false;
            const line = JSON.parse(buf.slice(0, nl)) as Record<string, unknown>;
            buf = buf.slice(nl + 1);
            lines.push(line);
            resolve(line);
            return true;
          };
          if (take()) return;
          const on = (d: Buffer) => {
            buf += d.toString();
            if (take()) child.stdout.off('data', on);
          };
          child.stdout.on('data', on);
        });
      expect(await next()).toMatchObject({ ready: true });
      writeFileSync(join(dir, 'a.tmp'), JSON.stringify({ kind: 'panels', outDir: join(dir, 'out'), panels: [{ panel: PANELS.banner, columns: 80 }] }));
      renameSync(join(dir, 'a.tmp'), join(dir, 'a.req.json'));
      const reply = (await next()) as { id: string; output: PanelsOutput };
      expect(reply.id).toBe('a');
      expect((reply.output.panels[0] as PanelOutput).tiles.length).toBeGreaterThan(0);
      expect(JSON.parse(readFileSync(join(dir, 'a.res.json'), 'utf8'))).toEqual(reply);
      expect(existsSync(join(dir, 'a.req.json'))).toBe(false);
    } finally {
      child.kill();
    }
  }, 20_000);
});
