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
import { MAX_STRIP_ROWS, cellsOf, cut } from '../src/render/ui/tiles';
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
  sequence: { kind: 'sequence', source, useCase: redirect.id, current: [2], controls: [{ control: { id: 'play', icon: 'play', label: 'Play' } }] },
};

describe('UI panels: the cell grid', () => {
  for (const [kind, panel] of Object.entries(PANELS)) {
    it(`cuts ${kind} into tiles that cover it exactly`, () => {
      for (const columns of [80, 120, 200]) {
        const { surface, height } = drawPanel(panel, columns, 'dark');
        expect(height % CELL.height).toBe(0);
        const rows = height / CELL.height;
        const strips = cut(columns, rows, surface.controls.map((c) => ({ control: c.control, cells: cellsOf(c.box, columns, rows) })));
        const seen = new Uint8Array(columns * rows);
        let row = 0;
        for (const s of strips) {
          expect(s.row).toBe(row);
          let col = 0;
          for (const t of s.tiles) {
            expect([t.row, t.rows, t.col]).toEqual([s.row, s.rows, col]);
            for (let r = t.row; r < t.row + t.rows; r++) for (let c = t.col; c < t.col + t.columns; c++) seen[r * columns + c]++;
            col += t.columns;
          }
          expect(col).toBe(columns);
          if (s.tiles.every((t) => !t.control)) expect(s.rows).toBeLessThanOrEqual(MAX_STRIP_ROWS);
          row += s.rows;
        }
        expect(row).toBe(rows);
        expect(seen.every((n) => n === 1)).toBe(true);
        // Every control has a tile of its own, which holds its whole drawing.
        const tiles = strips.flatMap((s) => s.tiles);
        for (const c of surface.controls) {
          const t = tiles.find((x) => x.control?.id === c.control.id)!;
          expect(t).toBeDefined();
          expect(c.box.x).toBeGreaterThanOrEqual(t.col * CELL.width);
          expect(c.box.x + c.box.w).toBeLessThanOrEqual((t.col + t.columns) * CELL.width);
          expect(c.box.y).toBeGreaterThanOrEqual(t.row * CELL.height - 1e-6);
          expect(c.box.y + c.box.h).toBeLessThanOrEqual((t.row + t.rows) * CELL.height + 1e-6);
        }
      }
    });
  }

  it('refuses controls that share cells', () => {
    const control = (id: string) => ({ id, kind: 'button' as const });
    expect(() => cut(20, 4, [{ control: control('a'), cells: { col: 0, row: 0, columns: 5, rows: 2 } }, { control: control('b'), cells: { col: 4, row: 1, columns: 5, rows: 2 } }])).toThrow(/share cells/);
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
});

describe('UI panels: the raster helper', () => {
  it('writes the tiles at their cell size, and answers a repeat from its manifest', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'proschi-ui-'));
    const input = { kind: 'panels' as const, outDir, theme: 'dark' as const, panels: [{ id: 'tabs', panel: PANELS.tabs, columns: 100 }, { id: 'bad', panel: { kind: 'nope' } as unknown as Panel, columns: 100 }] };
    const out = (await answer(input, { dir: HOOKS })) as PanelsOutput;
    const tabs = out.panels[0] as PanelOutput;
    expect(tabs.id).toBe('tabs');
    expect(tabs.cellPx).toEqual({ width: 16, height: 32 });
    expect(out.panels[1]).toEqual({ id: 'bad', error: "Unknown panel kind 'nope'" });
    for (const t of tabs.tiles) {
      const head = readFileSync(t.file).subarray(16, 24);
      expect([head.readUInt32BE(0), head.readUInt32BE(4)]).toEqual([t.columns * 16, t.rows * 32]);
      if (t.control) expect(existsSync(t.hoverFile!)).toBe(true);
    }
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
