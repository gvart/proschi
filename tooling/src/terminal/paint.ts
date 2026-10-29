import { nodeBaseColor } from '../../../frontend/src/dsl/palette';
import type { DiagramNode } from '../../../frontend/src/dsl/types';
import type { NodeOverlay } from '../../../frontend/src/sim/overlay';
import { DEFAULT, E, Grid, N, S, W, hex } from './grid';
import { iconOf, type IconStyle } from './icons';
import type { Play } from './playback';
import type { Path, Rect, Scene, SceneNode } from './scene';

/**
 * Paints a scene into a grid the way the canvas draws it: dashed group
 * frames, then the edges with their labels, then the cards on top. Colors
 * follow the canvas's palette (dsl/palette.ts): the base hue of a node's
 * `color`, tag or category for its border, the ink (the terminal's own
 * foreground) for its text. The background stays the terminal's.
 */

export const COLOR = {
  muted: 0x8b8f98,
  line: 0x9ca3af,
  /** Mid grey: reads as a shadow on dark and light terminals alike. */
  shadow: 0x4b5563,
  critical: 0xef4444,
  note: 0xeab308,
  /** Playback, as the canvas's tokens (design/tokens.css): the pink packet and lit node, the fail red. */
  pink: 0xff5da2,
  fail: 0xff3b30,
  onAccent: 0x111111,
  /** What playback fades: the scenario's path a little, the rest more. */
  faded: 0x6b7280,
  fadedMore: 0x3a3f48,
  good: 0x22c55e,
  warn: 0xeab308,
  bad: 0xef4444,
};

export interface PaintOptions {
  /** Utilisation and replicas per node, from the simulation. */
  overlay?: Record<string, NodeOverlay>;
  /** A use case playing over the diagram (playback.ts). */
  play?: Play;
  /** The tech icon in each card's icon tile, as on the canvas; Nerd Font glyphs by default. */
  icons?: IconStyle;
}

const HEAD: Record<number, string> = { [N]: '▲', [S]: '▼', [E]: '►', [W]: '◄' };

/** How a node looks while a use case plays: lit, failing, on the scenario's path, or off it. */
type Look = 'lit' | 'failing' | 'path' | 'off' | undefined;

function lookOf(play: Play | undefined, id: string): Look {
  if (!play) return undefined;
  if (play.failing.has(id)) return 'failing';
  if (play.active.has(id)) return 'lit';
  return play.pathNodes.has(id) ? 'path' : 'off';
}

const fade = (look: Look, color: number) => (look === 'path' ? COLOR.faded : look === 'off' ? COLOR.fadedMore : color);

export function paint(scene: Scene, options: PaintOptions = {}): Grid {
  const grid = new Grid(scene.columns, scene.rows);
  const { play } = options;
  const all = [...scene.nodes.values()];

  for (const g of all.filter((n) => n.node.kind === 'group').sort((a, b) => a.depth - b.depth)) drawGroup(grid, g, play ? 'path' : undefined);

  for (const { edge, path } of scene.edges) {
    const own = edge.style?.color ? hex(edge.style.color) : COLOR.line;
    const color = play ? (play.pathEdges.has(edge.id) ? COLOR.faded : COLOR.fadedMore) : own;
    drawPath(grid, path, color, edge.style?.dash !== undefined);
  }
  // The current step's line: thick ink, red for an error, dashed for a call that never arrived; flowing once the packet is there.
  for (const active of play?.edges ?? []) {
    const color = active.error ? COLOR.fail : DEFAULT;
    const { cells, dirs, head } = active.path;
    for (let i = 0; i < cells.length - 1; i++) {
      const straight = dirs[i] === (N | S) || dirs[i] === (E | W);
      const gap = active.failed ? i % 2 === 1 : active.flowing && (i + 3 * 1000 - play!.tick) % 3 === 0;
      if (straight && gap) grid.set(cells[i].x, cells[i].y, dirs[i] === (N | S) ? '╏' : '╍', color);
      else grid.line(cells[i].x, cells[i].y, dirs[i], color, true);
    }
    const last = cells[cells.length - 1];
    grid.set(last.x, last.y, HEAD[head], color);
  }
  for (const { edge, label } of scene.edges) {
    if (!label || !edge.label) continue;
    const text = ` ${edge.label} `;
    const x = label.x - Math.floor(text.length / 2);
    const color = play && !play.pathEdges.has(edge.id) ? COLOR.fadedMore : COLOR.muted;
    for (let i = 0; i < text.length; i++) if (!onCard(scene, x + i, label.y)) grid.set(x + i, label.y, text[i], color);
  }

  for (const packet of play?.packets ?? []) grid.set(packet.at.x, packet.at.y, packet.cut ? '✗' : '■', packet.error ? COLOR.fail : COLOR.pink);

  for (const n of all) {
    if (n.node.kind === 'group') continue;
    const look = lookOf(play, n.node.id);
    if (n.node.kind === 'text') drawNote(grid, n, look);
    else drawCard(grid, n, options.overlay?.[n.node.id], look, options.icons ?? 'nerd-font');
  }

  drawLegend(grid, scene);
  return grid;
}

function onCard(scene: Scene, x: number, y: number): boolean {
  for (const { node, rect } of scene.nodes.values()) {
    if (node.kind === 'group') continue;
    if (x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h) return true;
  }
  return false;
}

function drawPath(grid: Grid, path: Path, color: number, dashed: boolean): void {
  const { cells, dirs, head } = path;
  for (let i = 0; i < cells.length - 1; i++) {
    const { x, y } = cells[i];
    if (dashed && (dirs[i] === (N | S) || dirs[i] === (E | W))) grid.set(x, y, dirs[i] === (N | S) ? '┆' : '╌', color);
    else grid.line(x, y, dirs[i], color);
  }
  const last = cells[cells.length - 1];
  grid.set(last.x, last.y, HEAD[head], color);
}

function baseColor(node: DiagramNode, fallback: number): number {
  const base = nodeBaseColor(node);
  return base ? hex(base) : fallback;
}

const LIGHT = { h: '─', v: '│', dh: '╌', dv: '┆', tl: '╭', tr: '╮', bl: '╰', br: '╯' };
// Cards: the canvas's thick ink border.
const HEAVY = { h: '━', v: '┃', dh: '┅', dv: '┇', tl: '┏', tr: '┓', bl: '┗', br: '┛' };

/** A frame, light with rounded corners or heavy, dashed when `dash`. */
function frame(grid: Grid, r: Rect, color: number, dash: boolean, g = LIGHT): void {
  const right = r.x + r.w - 1;
  const bottom = r.y + r.h - 1;
  const h = dash ? g.dh : g.h;
  const v = dash ? g.dv : g.v;
  for (let x = r.x + 1; x < right; x++) {
    grid.set(x, r.y, h, color);
    grid.set(x, bottom, h, color);
  }
  for (let y = r.y + 1; y < bottom; y++) {
    grid.set(r.x, y, v, color);
    grid.set(right, y, v, color);
  }
  grid.set(r.x, r.y, g.tl, color);
  grid.set(right, r.y, g.tr, color);
  grid.set(r.x, bottom, g.bl, color);
  grid.set(right, bottom, g.br, color);
}

/**
 * The canvas's hard shadow, offset down and right: half a cell wide along the
 * right side and half a row along the bottom. Only on empty cells, so an edge
 * leaving the card keeps its line.
 */
function shadow(grid: Grid, r: Rect, color: number): void {
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  const blank = (x: number, y: number) => grid.glyph(x, y) === ' ';
  for (let y = r.y + 1; y < bottom; y++) if (blank(right, y)) grid.set(right, y, '▌', color);
  for (let x = r.x + 1; x < right; x++) if (blank(x, bottom)) grid.set(x, bottom, '▀', color);
  if (blank(right, bottom)) grid.set(right, bottom, '▘', color);
}

function clear(grid: Grid, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid.set(x, y, ' ');
}

const fit = (text: string, room: number) => (text.length <= room ? text : room <= 1 ? '…'.slice(0, room) : text.slice(0, room - 1) + '…');

function drawGroup(grid: Grid, { node, rect }: SceneNode, look: Look): void {
  const color = fade(look, baseColor(node, COLOR.muted));
  frame(grid, rect, color, true);
  grid.text(rect.x + 2, rect.y, ` ${fit(node.name.toUpperCase(), rect.w - 6)} `, color);
}

/** The canvas's icon tile: a small rounded square left of the name, filled with the accent while its node is lit. */
const TILE = { w: 5, h: 3 };

function drawCard(grid: Grid, { node, rect }: SceneNode, overlay: NodeOverlay | undefined, look: Look, icons: IconStyle): void {
  const accent = look === 'failing' ? COLOR.fail : look === 'lit' ? COLOR.pink : undefined;
  const color = look === 'failing' ? COLOR.fail : fade(look, baseColor(node, COLOR.line));
  const ink = look === 'path' || look === 'off' ? fade(look, DEFAULT) : DEFAULT;
  const muted = fade(look, COLOR.muted);
  clear(grid, rect);
  // Lit, the card casts the accent's shadow, as `.pc-active` does on the canvas.
  shadow(grid, rect, accent ?? (look === 'off' ? COLOR.fadedMore : COLOR.shadow));
  frame(grid, rect, color, node.style?.dash !== undefined && !accent, HEAVY);

  const icon = iconOf(node, icons);
  const tiled = icon !== undefined && rect.w >= 22;
  if (tiled) {
    const tile = { x: rect.x + 2, y: rect.y + 1, w: TILE.w, h: TILE.h };
    if (accent) for (let y = tile.y; y < tile.y + tile.h; y++) for (let x = tile.x; x < tile.x + tile.w; x++) grid.set(x, y, ' ', DEFAULT, accent);
    frame(grid, tile, accent ? COLOR.onAccent : muted, false);
    if (accent) for (let y = tile.y; y < tile.y + tile.h; y++) for (let x = tile.x; x < tile.x + tile.w; x++) grid.paint(x, y, COLOR.onAccent, accent);
    grid.set(tile.x + 2, tile.y + 1, icon, accent ? COLOR.onAccent : color, accent);
  }
  const left = rect.x + (tiled ? 2 + TILE.w + 1 : 2);
  const room = rect.x + rect.w - 2 - left;
  grid.text(left, rect.y + 1, fit(node.name, room), ink);
  grid.text(left, rect.y + 2, fit(node.techStack, room), muted);
  if (node.ownerTeam) grid.text(left, rect.y + 3, fit(`Team: ${node.ownerTeam}`, room), muted);
  if (node.critical) grid.text(rect.x + rect.w - 4, rect.y, ' ! ', look === 'path' || look === 'off' ? muted : COLOR.critical);

  // The simulation's numbers sit in the bottom border: replicas, then how busy.
  const badges: { text: string; color: number }[] = [];
  const replicas = overlay?.replicas ?? (node.replicas && node.replicas > 1 ? node.replicas : undefined);
  if (replicas) badges.push({ text: `x${replicas}`, color: muted });
  if (overlay?.shards) badges.push({ text: `${overlay.shards} shards`, color: muted });
  if (overlay?.utilization !== undefined) {
    const u = overlay.utilization;
    badges.push({ text: `${Math.round(u * 100)}%`, color: fade(look, overlay.saturated || u >= 1 ? COLOR.bad : u >= 0.7 ? COLOR.warn : COLOR.good) });
  }
  let x = rect.x + 2;
  const end = rect.x + rect.w - 2;
  for (const b of badges) {
    const text = ` ${b.text} `;
    if (x + text.length > end) break;
    grid.text(x, rect.y + rect.h - 1, text, b.color);
    x += text.length;
  }
}

function drawNote(grid: Grid, { node, rect }: SceneNode, look: Look): void {
  clear(grid, rect);
  shadow(grid, rect, COLOR.shadow);
  frame(grid, rect, fade(look, COLOR.note), false, HEAVY);
  const room = rect.w - 4;
  grid.text(rect.x + 2, rect.y + 1, fit(node.name, room));
  const words = (node.description ?? '').split(/\s+/).filter(Boolean);
  let y = rect.y + 2;
  let line = '';
  for (const word of words) {
    if (y >= rect.y + rect.h - 1) break;
    if (line && line.length + 1 + word.length > room) {
      grid.text(rect.x + 2, y++, line, COLOR.muted);
      line = '';
    }
    line = line ? `${line} ${word}` : fit(word, room);
  }
  if (line && y < rect.y + rect.h - 1) grid.text(rect.x + 2, y, line, COLOR.muted);
}

function drawLegend(grid: Grid, scene: Scene): void {
  const legend = scene.diagram.legend;
  if (!legend?.length) return;
  let x = 1;
  for (const entry of legend) {
    const color = entry.color ? hex(entry.color) : DEFAULT;
    grid.text(x, scene.legendRow, entry.dash ? '╌╌' : '■', color);
    x += entry.dash ? 3 : 2;
    grid.text(x, scene.legendRow, entry.label, COLOR.muted);
    x += entry.label.length + 3;
  }
}
