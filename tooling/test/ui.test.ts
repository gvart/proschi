import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { examples } from '../src/proschi';
import { renderSequenceSvg } from '../src/render/sequence';
import type { Panel, PanelOutput, PanelsOutput } from '../src/render/ui/contract';
import { analysisPage, hldPage, stepCardsOf, tabBarPanel } from '../src/render/ui/data';
import { CELL } from '../src/render/ui/kit';
import { loadFonts, measure } from '../src/render/ui/metrics';
import { drawPanel } from '../src/render/ui/panels';
import { cellsOf, cut } from '../src/render/ui/tiles';
import { loadDocument } from '../src/terminal/document';
import { answer } from '../src/terminal/rasterHost';
import { withFigures } from '../src/terminal/panelHost';
import { hld } from '../../frontend/src/hld/hld';

const HOOKS = fileURLToPath(new URL('../../plugin/hooks/', import.meta.url));
loadFonts(join(HOOKS, 'fonts'));

const src = `${examples.find((e) => e.id === 'url-shortener')!.source}\nwhatif "Launch day" {\n  traffic "Redirect" x3\n}\n`;
const source = { source: src };
const doc = loadDocument(source);
// The same design held to a p99 it misses, for the HLD's failing checks.
const failingSource = { source: `${src}\nrequirements {\n  p99 "Redirect" < 1ms\n}\n` };
const now = loadDocument(failingSource);
const name = (id: string) => doc.diagram.nodes.find((n) => n.id === id)?.name ?? id;
const redirect = doc.diagram.useCases[0];

/** The player bar at step `at` (1-based), or before Play. */
function playerBar(at: number | undefined): Panel {
  const playing = at !== undefined;
  const ctl = (id: string, icon: 'first' | 'prev' | 'next' | 'last' | 'exit', hotkey: string) => ({ id, icon, hotkey, keycap: false, variant: 'quiet' as const, ...(playing ? {} : { disabled: true }) });
  return {
    kind: 'playerBar',
    useCase: { id: 'uc', value: redirect.id, options: [...doc.diagram.useCases.map((u) => ({ value: u.id, label: u.name })), { value: '__explore', label: 'Explore all…', icon: 'explore', divider: true }] },
    scenario: { id: 'sc', value: redirect.scenarios[0].id, options: redirect.scenarios.map((s) => ({ value: s.id, label: s.name, icon: s.outcome === 'error' ? ('cross' as const) : ('check' as const), tone: s.outcome === 'error' ? ('bad' as const) : ('good' as const) })) },
    controls: [ctl('first', 'first', 'r'), ctl('prev', 'prev', 'b'), { id: 'play', icon: playing ? 'pause' : 'play', hotkey: 'p', keycap: false, variant: 'primary' }, ctl('next', 'next', 'n'), ctl('last', 'last', 'e'), ctl('stop', 'exit', 'd')],
    step: { ...(playing ? { at } : {}), total: 3 },
    line: playing ? { number: at, text: [{ text: 'GET /abc123', mono: true }, { text: ' · Load Balancer → Shortener API · ', tone: 'muted' }, { text: 'Sync', tone: 'good' }] } : { text: [{ text: 'Press ▶ to play', tone: 'muted' }] },
    body: { id: 'body', label: 'Body', ...(playing ? {} : { disabled: true }) },
  };
}

const PANELS: Record<string, Panel> = {
  tabs: tabBarPanel('hld', 2),
  playerBar: playerBar(2),
  playerBarIdle: playerBar(undefined),
  menu: { kind: 'menu', select: { id: 'sc', value: redirect.scenarios[0].id, options: [...redirect.scenarios.map((s) => ({ value: s.id, label: s.name, icon: s.outcome === 'error' ? ('cross' as const) : ('check' as const), tone: s.outcome === 'error' ? ('bad' as const) : ('good' as const) })), { value: '__explore', label: 'Explore all…', icon: 'explore', divider: true }] } },
  drawer: { kind: 'drawer', cards: stepCardsOf(redirect.scenarios[1], name)[1]!, close: { id: 'close', icon: 'exit', variant: 'quiet' } },
  explorer: { kind: 'explorer', groups: [{ label: 'GET /abc123', useCases: [{ name: 'Redirect', current: true, scenarios: redirect.scenarios.map((s) => ({ id: `x-${s.id}`, name: s.name, outcome: s.outcome === 'error' ? 'error' : 'ok' })) }] }], close: { id: 'close', icon: 'exit', variant: 'quiet' } },
  systemBar: { kind: 'systemBar', inside: 'a › b', selected: { name: 'Ledger', path: 'a.b' }, controls: [{ id: 'next', icon: 'cycle', label: 'Next', hotkey: 's' }] },
  actionBar: { kind: 'actionBar', controls: [{ id: 'src', icon: 'copy', label: 'Copy source' }, { id: 'open', icon: 'open', label: 'Open in Proschi', variant: 'primary' }] },
  notices: { kind: 'notices', notices: [{ text: 'A warning', hint: 'a hint' }], legend: {}, verdict: { passed: 1, total: 3, first: 'p99: too slow' }, details: { id: 'details', label: 'Details' } },
  analysis: analysisPage(doc),
  hldFailing: hldPage(hld(now.root, now.analysis, now.tests), failingSource),
  hld: hldPage(hld(doc.root, doc.analysis, doc.tests), source),
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
        // `pixels` copies the whole picture out of wasm on every read: take it once.
        const pixels = image.pixels;
        const ink = (x: number, y: number) => pixels[(y * image.width + x) * 4 + 3] > 24;
        for (const s of strips.slice(1)) {
          const y = s.row * CELL.height;
          const crossing = Array.from({ length: image.width }, (_, x) => x).filter((x) => ink(x, y - 1) && ink(x, y));
          expect(crossing, `${kind} at ${columns} columns: a glyph crosses row ${s.row}`).toEqual([]);
        }
      }
    }
  }, 30_000);

  it('keeps the player bar to one size, its first row never wrapping, before Play and while it plays', () => {
    for (const columns of [40, 60, 80, 100, 140]) {
      const playing = drawPanel(PANELS.playerBar, columns, 'dark');
      const idle = drawPanel(PANELS.playerBarIdle, columns, 'dark');
      expect(playing.height, `${columns} columns`).toBe(5 * CELL.height);
      expect(idle.height).toBe(playing.height);
      const rowsOf = new Set(playing.surface.controls.filter((c) => c.control.id !== 'body').map((c) => c.box.y));
      expect(rowsOf.size, `${columns} columns`).toBe(1);
      // The same controls at the same places, whichever mode.
      expect(idle.surface.controls.map((c) => [c.control.id, c.box.x])).toEqual(playing.surface.controls.map((c) => [c.control.id, c.box.x]));
      expect(idle.surface.controls.filter((c) => c.control.disabled).map((c) => c.control.id)).toEqual(expect.arrayContaining(['stop', 'body']));
    }
  });

  it('draws each panel as a piece of one surface: rounded only at its outer edges, a divider above unless on top', () => {
    const svgOf = (edges: { top?: boolean; bottom?: boolean }) => {
      const { surface, height } = drawPanel(PANELS.drawer, 80, 'dark', edges);
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
    expect(surface.controls.map((c) => [c.control.id, c.control.hotkey, c.control.kind])).toEqual([...['diagram', 'analysis', 'hld'].map((id, i) => [id, String(i + 1), 'tab']), ['open', undefined, 'button']]);
    const bar = drawPanel(PANELS.playerBar, 120, 'dark').surface.controls.map((c) => [c.control.id, c.control.hotkey]);
    expect(bar).toEqual([['uc', undefined], ['sc', undefined], ['first', 'r'], ['prev', 'b'], ['play', 'p'], ['next', 'n'], ['last', 'e'], ['stop', 'd'], ['body', undefined]]);
    const menu = drawPanel(PANELS.menu, 40, 'dark').surface.controls.filter((c) => c.control.kind === 'option');
    expect(menu.map((c) => c.control.id)).toEqual([...redirect.scenarios.map((s) => `sc=${s.id}`), 'sc=__explore']);
  });
});

describe('UI panels: the sequence', () => {
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

  const svgOf = ({ surface, height }: { surface: { svg(h: number): string }; height: number }) => surface.svg(height);

  it('draws the HLD as the editor does: numbered sections a table of contents scrolls to, the architecture and each sequence as figures', async () => {
    const page = PANELS.hld as Extract<Panel, { kind: 'page' }>;
    const toc = page.blocks.find((b) => b.type === 'controls' && b.items.some((it) => 'control' in it && it.control.id.startsWith('toc=')));
    const kinds = hld(doc.root, doc.analysis, doc.tests).sections.map((s) => s.kind);
    expect(toc && toc.type === 'controls' && toc.items.map((it) => ('control' in it ? it.control.id : ''))).toEqual(kinds.map((k) => `toc=${k}`));
    expect(page.blocks.filter((b) => b.type === 'heading' && b.level === 2).map((b) => b.type === 'heading' && b.anchor)).toEqual(kinds.map((k) => `hld-${k}`));
    const figures = page.blocks.filter((b) => b.type === 'figure');
    expect(figures.map((b) => b.type === 'figure' && ('architecture' in b.of ? 'architecture' : b.of.useCase))).toEqual(['architecture', ...doc.diagram.useCases.filter((u) => u.scenarios.some((s) => s.steps.length)).map((u) => u.id)]);
    const out = (await answer({ kind: 'panels', outDir: mkdtempSync(join(tmpdir(), 'proschi-ui-')), theme: 'dark', panels: [{ panel: page, columns: 100 }] }, { dir: HOOKS })) as PanelsOutput;
    const drawn = out.panels[0] as PanelOutput;
    // Each section's row, in order, inside the page.
    const rows = kinds.map((k) => drawn.anchors![`hld-${k}`]);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(rows.at(-1)).toBeLessThan(drawn.rows);
    // The figures drawn by the helper, not their placeholder.
    expect(svgOf(drawPanel(page, 100, 'dark'))).toMatch(/> ?could\b/);
    const resolved = await withFigures(page, 'dark');
    expect(resolved.kind === 'page' && resolved.blocks.filter((b) => b.type === 'figure').every((b) => b.type === 'figure' && b.svg?.startsWith('<svg'))).toBe(true);
    expect(svgOf(drawPanel(resolved, 100, 'dark'))).not.toMatch(/> ?could\b/);
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
      writeFileSync(join(dir, 'a.tmp'), JSON.stringify({ kind: 'panels', outDir: join(dir, 'out'), panels: [{ panel: PANELS.actionBar, columns: 80 }] }));
      renameSync(join(dir, 'a.tmp'), join(dir, 'a.req.json'));
      const reply = (await next()) as { id: string; output: PanelsOutput };
      expect(reply.id).toBe('a');
      expect((reply.output.panels[0] as PanelOutput).tiles.length).toBeGreaterThan(0);
      expect(existsSync(join(dir, 'a.req.json'))).toBe(false);
    } finally {
      child.kill();
    }
  }, 20_000);
});

describe('UI panels: every block within the pane width', () => {
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  /** Every <text> of a panel's SVG with how far left and right it reaches, px. */
  const texts = (svg: string) =>
    [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
      const a = m[1];
      const x = Number(/(?:^| )x="([-\d.]+)"/.exec(a)![1]);
      const t = unescape(m[2]);
      const w = measure(t, Number(/font-size="([\d.]+)"/.exec(a)![1]), Number(/font-weight="(\d+)"/.exec(a)![1]), a.includes('JetBrains'));
      const anchor = /text-anchor="(\w+)"/.exec(a)?.[1];
      return { text: t, left: anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x, right: anchor === 'end' ? x : anchor === 'middle' ? x + w / 2 : x + w };
    });

  it('wraps the HLD of every example to the pane, tables and code included: nothing past the edge, nothing cut off with an ellipsis', () => {
    for (const e of examples) {
      const d = loadDocument({ source: e.source });
      if (d.errors.length) continue;
      const page = hldPage(hld(d.root, d.analysis, d.tests), { source: e.source });
      for (const columns of [60, 80, 100, 140]) {
        const { surface, height } = drawPanel(page, columns, 'dark');
        for (const t of texts(surface.svg(height))) {
          expect(t.right, `${e.id} at ${columns} columns: "${t.text}" reaches past the edge`).toBeLessThanOrEqual(columns * CELL.width - 1);
          expect(t.left).toBeGreaterThanOrEqual(0);
          expect(t.text, `${e.id} at ${columns} columns`).not.toMatch(/…$/);
        }
      }
    }
  });

  it('keeps every other panel, a long table cell, a long code line and a long word within the pane, drawn whole', () => {
    const long = 'x'.repeat(300);
    const extra: Panel = {
      kind: 'page',
      blocks: [
        { type: 'table', columns: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'].map((title) => ({ title })), rows: [{ cells: ['a long cell of words that has to wrap over several lines', long, 'c', 'd', 'e', 'f', 'g'] }] },
        { type: 'code', text: `{"key": "${long}", "n": 1}`, language: 'json' },
        { type: 'paragraph', text: `see ${long}` },
      ],
    };
    for (const [kind, panel] of Object.entries({ ...PANELS, extra })) {
      for (const columns of [60, 80, 140]) {
        const { surface, height } = drawPanel(panel, columns, 'dark');
        for (const t of texts(surface.svg(height))) expect(t.right, `${kind} at ${columns} columns: "${t.text}"`).toBeLessThanOrEqual(columns * CELL.width - 1);
      }
    }
    const { surface, height } = drawPanel(extra, 80, 'dark');
    const all = texts(surface.svg(height))
      .map((t) => t.text)
      .join('');
    expect(all.split('x').length - 1).toBe(3 * 300);
  });
});
