import type { FlowOverlay, NodeOverlay } from '../../../frontend/src/sim/overlay';
import { Grid } from './grid';
import { stepPath } from './playback';
import type { Cell, Scene } from './scene';

/**
 * The simulated traffic as the editor's FlowParticles.tsx draws it, in cells:
 * dots stepping one cell a frame along each connection that carries requests,
 * closer together the busier it is, hollow for async work, and red drops
 * falling off the nodes past capacity. Frame by frame and deterministic, so
 * the hooks only count frames.
 */

/** One frame, in ms: the dots move a cell a frame. */
export const TRAFFIC_FRAME_MS = 120;

export interface Particle {
  at: Cell;
  kind: 'sync' | 'async' | 'drop';
}

/** Colors of the canvas's particles (design/tokens.css --c-blue, --c-lilac, --c-fail), mid-tone so they read on dark and light terminals. */
export const TRAFFIC_COLOR = { sync: 0x5c7cfa, async: 0x9775fa, drop: 0xef4444 } as const;
const GLYPH = { sync: '●', async: '○', drop: '•' } as const;

/** Cells between two dots on a connection: 8 for a trickle down to 4 for thousands of requests a second. */
export function gapOf(rps: number): number {
  return Math.max(4, Math.min(8, Math.round(10 - 1.5 * Math.log10(rps + 1))));
}

/** The dots and drops at frame `frame`. */
export function trafficAt(scene: Scene, flows: readonly FlowOverlay[], nodes: Readonly<Record<string, NodeOverlay>>, frame: number): Particle[] {
  const out: Particle[] = [];
  for (const f of flows) {
    if (f.rps <= 0 || f.from === f.to) continue;
    const path = stepPath(scene, f.from, f.to);
    if (!path) continue;
    // Every cell but the arrowhead's.
    const run = path.cells.length - 1;
    const gap = gapOf(f.rps);
    const kind = f.async ? 'async' : 'sync';
    for (let i = ((frame % gap) + gap) % gap; i < run; i += gap) out.push({ at: path.cells[i], kind });
  }
  for (const [id, o] of Object.entries(nodes)) {
    const n = scene.nodes.get(id);
    if (!n || !o.saturated || o.down || o.utilization === undefined || n.rect.w < 4) continue;
    const { x, y, w, h } = n.rect;
    // Two drops, or three well past capacity, each falling two rows over three frames from a spot that moves on each time.
    const count = o.utilization >= 1.5 ? 3 : 2;
    for (let k = 0; k < count; k++) {
      const t = frame + k * 2;
      const fall = t % 3;
      const round = Math.floor(t / 3);
      const column = x + 1 + ((round * 7 + k * 11) % (w - 2));
      if (fall < 2) out.push({ at: { x: column, y: y + h + fall }, kind: 'drop' });
    }
  }
  return out;
}

const onCard = (scene: Scene, c: Cell) => {
  for (const { node, rect } of scene.nodes.values())
    if (node.kind !== 'group' && c.x >= rect.x && c.x < rect.x + rect.w && c.y >= rect.y && c.y < rect.y + rect.h) return true;
  return false;
};

/** Box-drawing lines and the arrowheads: what a dot may sit on, so it never hides a label's letter. */
const isLine = (code: number) => (code >= 0x2500 && code <= 0x257f) || code === 0x25b2 || code === 0x25bc || code === 0x25ba || code === 0x25c4;

/** Draws particles over a painted diagram: dots on the lines, drops in empty cells below their card. */
export function drawTraffic(grid: Grid, scene: Scene, particles: readonly Particle[]): void {
  for (const { at, kind } of particles) {
    if (!grid.inside(at.x, at.y) || onCard(scene, at)) continue;
    const code = grid.glyphs[at.y * grid.columns + at.x];
    if (kind === 'drop' ? code !== 0x20 : !isLine(code)) continue;
    grid.set(at.x, at.y, GLYPH[kind], TRAFFIC_COLOR[kind]);
  }
}
