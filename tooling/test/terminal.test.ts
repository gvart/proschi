import { describe, expect, it } from 'vitest';
import { layoutGraph } from '../../frontend/src/dsl/autoLayout';
import { examples } from '../../frontend/src/dsl/examples';
import { keyOf, loadDocument, missingImports } from '../src/terminal/document';
import { DEFAULT, Grid, base64 } from '../src/terminal/grid';
import { COLOR, heatOf, paint } from '../src/terminal/paint';
import { currentStepsOf, playAt, stepPath } from '../src/terminal/playback';
import { buildScene } from '../src/terminal/scene';
import { drawTraffic, gapOf, trafficAt, TRAFFIC_COLOR } from '../src/terminal/traffic';

async function sceneOf(source: string, columns = 150) {
  const doc = loadDocument({ source });
  return { doc, scene: buildScene(doc.diagram, await layoutGraph(doc.diagram), columns) };
}

const example = (id: string) => examples.find((e) => e.id === id)!.source;

describe('terminal grid', () => {
  it('encodes cells as Raster takes them', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    const grid = new Grid(1, 1);
    grid.set(0, 0, '█', 0xff8800);
    expect(grid.toBase64()).toBe(Buffer.from(new Uint32Array([0x2588, 0xff8800, DEFAULT]).buffer).toString('base64'));
  });

  it('joins crossing lines into one glyph', () => {
    const grid = new Grid(1, 1);
    grid.line(0, 0, 1 | 4, 0);
    grid.line(0, 0, 2 | 8, 0);
    expect(grid.toText()).toBe('┼');
  });
});

describe('terminal scene', () => {
  it('draws the browser layout as cards, edges and labels', async () => {
    const { doc, scene } = await sceneOf(example('ecommerce'));
    expect(paint(scene, { overlay: doc.overlay }).toText()).toMatchSnapshot();
  });

  it('draws groups, team lines and every example without throwing', async () => {
    for (const { source } of examples) {
      const { scene } = await sceneOf(source);
      const text = paint(scene).toText();
      for (const node of scene.diagram.nodes) if (node.kind === 'component') expect(text).toContain(node.name.slice(0, 10));
    }
  });

  it('fits a wide diagram into the columns it is given', async () => {
    const wide = await sceneOf(examples[1].source, 70);
    expect(wide.scene.columns).toBeLessThanOrEqual(72);
  });

  it('puts the simulation on the cards of a document with traffic', async () => {
    const { doc, scene } = await sceneOf(example('hello'));
    expect(doc.overlay?.api.utilization).toBeGreaterThan(0);
    expect(doc.tests.length).toBeGreaterThan(0);
    const text = paint(scene, { overlay: doc.overlay }).toText();
    // The numbers and a bar take the team's row; the replicas sit on the card stacked behind.
    expect(text).toMatch(/\d+% ━*─+ │/);
    expect(text).toMatch(/╰─+ ×2 ─╯/);
  });

  it('fills a busy card with its heat, reddens one past capacity and greys one that is down', async () => {
    const { doc, scene } = await sceneOf(STRESSED);
    expect(doc.overlay?.db).toMatchObject({ saturated: true, size: 'L' });
    const overlay = { ...doc.overlay!, api: { ...doc.overlay!.api, down: true } };
    const grid = paint(scene, { overlay });
    const db = scene.nodes.get('db')!.rect;
    const api = scene.nodes.get('api')!.rect;
    expect(grid.bg[(db.y + 1) * grid.columns + db.x + 1]).toBe(COLOR.heatOver);
    expect(grid.fg[db.y * grid.columns + db.x]).toBe(COLOR.fail);
    expect(grid.toText()).toMatch(/L · \d+%/);
    expect(grid.glyph(api.x, api.y + 1)).toBe('┊');
    expect(grid.toText()).toContain('down');
    expect(heatOf({ utilization: 0.5 })).toBeUndefined();
    expect(heatOf({ utilization: 0.95 })).toBe(COLOR.heatHot);
    expect(heatOf({ utilization: 2, down: true })).toBeUndefined();
  });

  it('draws the legend as a panel, dashed and dotted lines apart, and group descriptions', async () => {
    const { scene } = await sceneOf(STRESSED);
    scene.nodes.get('back')!.node.description = 'Behind the gateway';
    const text = paint(scene).toText();
    expect(text).toMatch(/╭─ LEGEND ─+╮/);
    expect(text).toMatch(/│ ╌╌╌ Old +│/);
    expect(text).toMatch(/│ ┈┈┈ Maybe +│/);
    expect(text).toContain('Behind the gateway');
    // The dotted connection runs in dots, the dashed group frame in dashes.
    expect(text).toMatch(/[┊┈]/);
    expect(text).toMatch(/[╎╌]/);
  });
});

const STRESSED = `web "Web" [Actor]
api "API" [REST API] .old
group back "Back end" {
  db "DB" [PostgreSQL] x2
}
q "Q" [Kafka]
web -> api
api -> db .maybe : write
api -> q
legend {
  old   "Old"   dashed
  maybe "Maybe" dotted
}
usecase "Write" {
  web -> api : POST /x
  api -> db : INSERT
  api ->> q : log
}
traffic {
  "Write" 50k rps
}
capacity {
  db size L
}
`;

describe('terminal traffic', () => {
  it('spaces the dots by how busy a connection is', () => {
    expect(gapOf(1)).toBe(8);
    expect(gapOf(100)).toBeLessThan(gapOf(1));
    expect(gapOf(1e6)).toBe(4);
  });

  it('moves the dots a cell a frame along their edge, hollow for async, and drops requests off a saturated node', async () => {
    const { doc, scene } = await sceneOf(STRESSED);
    const flows = doc.flows!;
    expect(flows.some((f) => f.async)).toBe(true);
    const at = (frame: number) => trafficAt(scene, flows, doc.overlay!, frame);
    const path = scene.edges.find((e) => e.edge.source === 'web')!.path.cells;
    const onWeb = (frame: number) => at(frame).filter((p) => path.includes(p.at));
    expect(onWeb(0).length).toBeGreaterThan(0);
    const before = onWeb(0).map((p) => path.indexOf(p.at));
    for (const p of onWeb(1)) expect(before).toContain(path.indexOf(p.at) - 1);
    expect(at(0).some((p) => p.kind === 'async')).toBe(true);
    expect([0, 1, 2].some((f) => at(f).some((p) => p.kind === 'drop'))).toBe(true);

    const base = paint(scene, { overlay: doc.overlay });
    const frame = base.copy();
    drawTraffic(frame, scene, at(0));
    expect(frame.toText()).toContain('●');
    expect(frame.toText()).toContain('○');
    expect(base.toText()).not.toContain('●');
    const dot = at(0).find((p) => p.kind === 'sync' && frame.glyph(p.at.x, p.at.y) === '●')!;
    expect(frame.fg[dot.at.y * frame.columns + dot.at.x]).toBe(TRAFFIC_COLOR.sync);
  });
});

describe('terminal playback', () => {
  it('plays one step per call, the packet out and back, as the editor does', async () => {
    const { doc, scene } = await sceneOf(examples[0].source);
    const steps = doc.diagram.useCases[0].scenarios[0].steps;
    const first = steps[0];

    const out = playAt(scene, steps, 0, 25);
    expect([...out.active].sort()).toEqual([first.fromServiceId, first.toServiceId].sort());
    expect(out.packets).toHaveLength(1);
    const path = stepPath(scene, first.fromServiceId, first.toServiceId)!;
    // A request-response call is half way out at 25% and back at the caller by 100%.
    expect(out.packets[0].at).toEqual(path.cells[Math.round(0.5 * (path.cells.length - 1))]);
    expect(playAt(scene, steps, 0, 100).packets).toHaveLength(0);
    expect(playAt(scene, steps, 0, 100).edges[0].flowing).toBe(true);

    const text = paint(scene, { play: out }).toText();
    expect(text).toContain('■');
    expect(text).toMatch(/[┃━]/);
  });

  it('fades what the scenario does not touch', async () => {
    const { doc, scene } = await sceneOf(example('ecommerce'));
    const steps = doc.diagram.useCases[0].scenarios[0].steps;
    const play = playAt(scene, steps, 0, 50);
    const off = doc.diagram.nodes.find((n) => n.kind === 'component' && !play.pathNodes.has(n.id));
    expect(off).toBeDefined();
    const grid = paint(scene, { play });
    const rect = scene.nodes.get(off!.id)!.rect;
    expect(grid.fg[rect.y * grid.columns + rect.x]).toBe(COLOR.fadedMore);
  });

  it('cuts a failed call off part way with a cross', async () => {
    const { doc, scene } = await sceneOf('a "A" [REST API]\nb "B" [REST API]\na -> b\nusecase "U" {\n  a -x b : GET /x\n}\n');
    const steps = doc.diagram.useCases[0].scenarios[0].steps;
    expect(playAt(scene, steps, 0, 80).packets[0]).toMatchObject({ cut: true, error: true });
    expect(paint(scene, { play: playAt(scene, steps, 0, 80) }).toText()).toContain('✗');
  });

  it('keeps the earlier steps of a parallel group current', () => {
    const step = (parallelGroup?: number) => ({ parallelGroup }) as never;
    expect(currentStepsOf([step(), step(1), step(1), step()], 2)).toHaveLength(2);
  });
});

describe('terminal document', () => {
  it('lists the imports it still needs, relative to the document', () => {
    expect(missingImports({ source: 'import "shared/infra.proschi"\n', path: 'app/main.proschi' })).toEqual(['app/shared/infra.proschi']);
  });

  it('links to the editor, at a playback step when asked', () => {
    const doc = loadDocument({ source: examples[0].source });
    expect(doc.link()).toMatch(/^https:\/\/proschi\.app\/app\/#code=/);
    expect(doc.link({ useCase: 'x', step: 2 })).toContain('&step=2');
    expect(keyOf({ source: 'a' })).not.toBe(keyOf({ source: 'b' }));
  });
});
