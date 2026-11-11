import { layoutGraph, SYSTEM_SIZE, type Layout, type Point } from '../../../frontend/src/dsl/autoLayout';
import { fallbackRoute, labelPoint, roundedPath, snapToBottom, withHead } from '../../../frontend/src/dsl/edgePath';
import type { Diagram, DiagramNode } from '../proschi';
import { DASH_ARRAY, mix, nodeBaseColor, tint } from '../../../frontend/src/dsl/palette';
import type { DiagramEdge, FlowStep, LegendEntry } from '../../../frontend/src/dsl/types';
import { formatMs, formatRps } from '../../../frontend/src/sim/format';
import type { EdgeOverlay, NodeOverlay } from '../../../frontend/src/sim/overlay';
import { currentStepsOf, isErrorStep } from '../terminal/playback';
import { loadText, type SystemBadge, type SystemStatus } from '../terminal/systems';
import { techIcon } from './icons';
import { COLORS, MONO, card, currentTheme, esc, fit, r, svgDocument, text, textWidth, withTheme, wrap, type Theme } from './svg';

/**
 * The architecture as SVG, drawn like the editor's canvas (canvas.css): the
 * canvas's own top-down ELK layout (autoLayout.ts, so pinned `pos x,y`
 * positions hold), ComponentNode's monochrome cards with a thick ink border,
 * hard shadow and square handles, GroupNode's dashed frames, TextNode's notes,
 * and RoutedEdge's orthogonal edges along the layout's routes (edgePath.ts).
 * Colors follow the canvas's light theme (dsl/palette.ts): category tints,
 * `color`, tags, the legend and the critical badge.
 */

const MARGIN = 32;
// ComponentNode: border 2 + py-3, a 36px row (icon tile / name + tech), mb-2, and the team line.
const CARD_HEIGHT = 72;
const CARD_WITH_TEAM_HEIGHT = 92;
const PAD_X = 18;
const PAD_Y = 14;
const NOTE_FONT = 14;
const NOTE_LINE = 21;

const ICON = 34;
// TextNode: `--c-yellow` at 22%.
const NOTE_FILL = '#FFD23F';

interface Placed {
  node: DiagramNode;
  x: number;
  y: number;
  width: number;
  height: number;
  lines?: string[];
}

function noteLines(node: DiagramNode, width: number): string[] {
  return wrap(node.description ?? node.name, width - 36, NOTE_FONT, 12);
}

export interface ArchitectureOptions {
  /** Promise, headroom and status of each system box and expanded frame (terminal/systems.ts), by node id. */
  systems?: Record<string, SystemBadge>;
  /** The load on each card, by node id (terminal/systems.ts viewOverlay): a team's nodes inside an expanded system under what it is sent. */
  nodes?: Record<string, NodeOverlay>;
  /** The canvas's theme to draw in; light by default. */
  theme?: Theme;
  /**
   * The editor's load overlay (sim/overlay.ts): each edge tinted by the load
   * of the node it feeds with an `rps · +latency` chip, the p99 path bold,
   * cards filled with the canvas's heat and the bottleneck ringed. `edges` is
   * edgeOverlays() by edge id; the cards' load comes from `nodes`.
   */
  overlay?: { edges: Record<string, EdgeOverlay> };
  /** A node or expanded system drawn selected, ringed in the accent. */
  selected?: string;
  /** A moment of a scenario's playback (see PlayMoment). */
  play?: PlayMoment;
  /**
   * Drawn for a terminal image (the Claude Code plugin's raster helper), closer
   * to the canvas than `proschi render`: a card with replicas stacked as the
   * canvas stacks it (`[data-stack]`), its load line as the canvas's
   * (`×3 · L · ⧉2 · 42%`), and edge chips opaque, so their own line does not
   * show through the numbers. Off by default, which leaves the SVG as it was.
   */
  terminal?: boolean;
}

/**
 * One moment of playback as the editor's player draws it
 * (components/UseCases): step `index` of `steps` (with the earlier steps of
 * its `par` group) `progress` (0..100) of the way through, its edges in the
 * accent (red for an error) with the packet on them, its nodes lit; steps
 * already played stay half lit, the rest of the scenario fainter, and nodes
 * it never touches fade out.
 */
export interface PlayMoment {
  steps: FlowStep[];
  index: number;
  progress: number;
}

/** A diagram with its layout, so several moments of it draw without laying it out again. */
export interface ArchitectureLayout {
  diagram: Diagram;
  layout: Layout;
}

export async function layoutArchitecture(diagram: Diagram): Promise<ArchitectureLayout> {
  return { diagram, layout: await layoutGraph(diagram) };
}

export async function renderArchitectureSvg(diagram: Diagram, options: ArchitectureOptions = {}): Promise<string> {
  return drawArchitecture(await layoutArchitecture(diagram), options);
}

/** The SVG of a laid-out diagram (layoutArchitecture). */
export function drawArchitecture(laid: ArchitectureLayout, options: ArchitectureOptions = {}): string {
  return withTheme(options.theme ?? 'light', () => draw(laid, options));
}

function draw({ diagram, layout }: ArchitectureLayout, options: ArchitectureOptions): string {
  const theme = currentTheme();
  const play = options.play ? playState(options.play) : undefined;
  const boxes = new Map(layout.nodes.map((b) => [b.id, b]));

  // Absolute positions: group members are laid out relative to their group.
  const absolute = (id: string): { x: number; y: number } => {
    const b = boxes.get(id)!;
    const parent = b.parent ? absolute(b.parent) : { x: 0, y: 0 };
    return { x: parent.x + b.position.x, y: parent.y + b.position.y };
  };
  const placed = new Map<string, Placed>();
  for (const node of diagram.nodes) {
    const box = boxes.get(node.id)!;
    const { x, y } = absolute(node.id);
    if (node.kind === 'group') placed.set(node.id, { node, x, y, width: box.width, height: box.height });
    else if (node.kind === 'text') {
      const lines = noteLines(node, box.width);
      placed.set(node.id, { node, x, y, width: box.width, height: 46 + lines.length * NOTE_LINE + 18, lines });
    } else placed.set(node.id, { node, x, y, width: box.width, height: node.kind === 'system' ? SYSTEM_SIZE.height : node.ownerTeam ? CARD_WITH_TEAM_HEIGHT : CARD_HEIGHT });
  }

  const all = [...placed.values()];
  // Routes can run outside every box (around a group), so they count towards the size too.
  const bends = Object.values(layout.routes).flatMap((route) => route.points);
  const minX = Math.min(0, ...all.map((p) => p.x), ...bends.map((p) => p.x));
  const minY = Math.min(0, ...all.map((p) => p.y), ...bends.map((p) => p.y));
  let maxX = Math.max(0, ...all.map((p) => p.x + p.width), ...bends.map((p) => p.x));
  let maxY = Math.max(0, ...all.map((p) => p.y + p.height), ...bends.map((p) => p.y));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const body: string[] = [];
  const titles: string[] = [];

  // Groups first (outermost first), then edges, then cards on top, as on the canvas.
  const depth = (n: DiagramNode): number => {
    const parent = n.parent ? placed.get(n.parent) : undefined;
    return parent ? depth(parent.node) + 1 : 0;
  };
  for (const p of all.filter((p) => p.node.kind === 'group').sort((a, b) => depth(a.node) - depth(b.node))) {
    if (play) body.push(`<g opacity="${GROUP_OPACITY}">`);
    if (options.selected === p.node.id) body.push(selectionRing(p.x + dx, p.y + dy, p.width, p.height, 10));
    const x = p.x + dx;
    const y = p.y + dy;
    const base = nodeBaseColor(p.node);
    const t = base ? tint(base, theme) : undefined;
    if (p.node.system === p.node.id) {
      // An expanded system: a solid double frame in its status color, its status, team, promise and load after the name.
      const badge = options.systems?.[p.node.id];
      const color = statusColor(badge?.status) ?? t?.line ?? COLORS.text;
      body.push(
        `<g data-node="${esc(p.node.id)}" data-kind="system-frame"${badge ? ` data-status="${badge.status}"` : ''}>`,
        `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="10" fill="${t?.groupFill ?? COLORS.text}" fill-opacity="${t ? 1 : 0.03}" stroke="${color}" stroke-width="2"/>`,
        `<rect x="${r(x + 5)}" y="${r(y + 5)}" width="${r(p.width - 10)}" height="${r(p.height - 10)}" rx="7" fill="none" stroke="${color}" stroke-width="1.5"/>`,
        '</g>',
      );
      const name = fit(p.node.name.toUpperCase(), p.width - 52, 12, true);
      const about = badge ? [STATUS[badge.status], badge.team ? `@${badge.team}` : '', badge.promise ?? '', loadText(badge)].filter(Boolean).join(' · ') : '';
      const after = x + 34 + textWidth(name, 12, true) + 12;
      titles.push(
        `<g data-group-title="${esc(p.node.id)}">`,
        techIcon('Logical Group', x + 14, y + 13, 14, color),
        halo(text(x + 34, y + 24, name, { size: 12, weight: 700, fill: color, spacing: 1 })),
        about ? halo(text(after, y + 24, fit(about, x + p.width - 14 - after, 12), { size: 12, weight: 600, fill: statusColor(badge?.status) ?? COLORS.muted })) : '',
        '</g>',
      );
      if (play) body.push('</g>');
      continue;
    }
    const dash = p.node.style?.dash ? DASH_ARRAY[p.node.style.dash] : '7 5';
    const frame = t
      ? `fill="${t.groupFill}" stroke="${t.line}" stroke-width="2" stroke-dasharray="${dash}"`
      : `fill="${COLORS.text}" fill-opacity="0.03" stroke="${COLORS.text}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="${dash}"`;
    body.push(
      `<g data-node="${esc(p.node.id)}" data-kind="group">`,
      `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="10" ${frame}/>`,
      '</g>',
    );
    if (play) body.push('</g>');
    // The title and description go over the edges (with a halo), so an edge entering the group does not strike them through.
    titles.push(
      `<g data-group-title="${esc(p.node.id)}">`,
      techIcon('Logical Group', x + 14, y + 13, 14, t?.line ?? COLORS.text),
      halo(text(x + 34, y + 24, fit(p.node.name.toUpperCase(), p.width - 52, 12, true), { size: 12, weight: 700, fill: t?.line ?? COLORS.text, opacity: t ? 1 : 0.8, spacing: 1 })),
      p.node.description ? halo(text(x + 14, y + 48, fit(p.node.description, p.width - 28, 13), { size: 13, fill: COLORS.muted })) : '',
      '</g>',
    );
  }

  const boxOf = (p: Placed) => ({ x: p.x + dx, y: p.y + dy, width: p.width, height: p.height });
  const routed = new Map<string, Point[]>();
  for (const edge of diagram.edges) {
    const s = placed.get(edge.source);
    const t = placed.get(edge.target);
    if (!s || !t || s === t) continue;
    const sBox = boxOf(s);
    const tBox = boxOf(t);
    const route = layout.routes[edge.id];
    const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    // Cards here are drawn at their own height, so ends on a bottom move onto it.
    const points = route ? snapToBottom(snapToBottom(route.points.map(shift), 'start', sBox), 'end', tBox) : fallbackRoute(sBox, tBox);
    routed.set(edge.id, points);
    const at = route?.label ? shift(route.label) : labelPoint(points);
    const load = options.overlay?.edges[edge.id];
    const move = play?.moveOn(edge);
    if (!load && !play) {
      body.push(drawEdge(edge.id, edge.label, points, at, edgeStroke(edge)));
      continue;
    }
    if (play) body.push(`<g opacity="${play.edgeOpacity(edge)}">`);
    body.push(drawLiveEdge(edge, points, at, load, move, options.terminal));
    if (play) body.push('</g>');
  }
  // The packets go over the cards, so one leaving or reaching a card stays in sight.
  const packets: string[] = [];
  for (const move of play?.moves ?? []) {
    const edge = diagram.edges.find((e) => routed.has(e.id) && connects(e, move.step));
    let points = edge && routed.get(edge.id);
    if (!edge || !points) {
      // A step between nodes no edge connects still plays, along a route of its own.
      const s = placed.get(move.step.fromServiceId);
      const t = placed.get(move.step.toServiceId);
      if (!s || !t || s === t) continue;
      points = fallbackRoute(boxOf(s), boxOf(t));
      body.push(drawLiveEdge(undefined, points, labelPoint(points), undefined, move));
    } else if (edge.source !== move.step.fromServiceId) points = points.slice().reverse();
    packets.push(drawPacket(points, move, options.play!.progress));
  }

  body.push(...titles);

  for (const p of all) {
    if (p.node.kind === 'group') continue;
    const id = p.node.id;
    if (!play && options.selected === undefined) {
      body.push(p.node.kind === 'text' ? drawNote(p, dx, dy) : p.node.kind === 'system' ? drawSystem(p, dx, dy, options.systems?.[id]) : drawCard(p, dx, dy, options.nodes?.[id], { overlay: !!options.overlay, ...(options.terminal ? { terminal: true } : {}) }));
      continue;
    }
    const mark: Mark | undefined = play?.failing.has(id) ? 'failing' : play?.active.has(id) ? 'active' : undefined;
    if (play) body.push(`<g opacity="${play.nodeOpacity(id)}">`);
    if (options.selected === id) body.push(selectionRing(p.x + dx, p.y + dy, p.width, p.height, 8));
    body.push(
      p.node.kind === 'text'
        ? drawNote(p, dx, dy)
        : p.node.kind === 'system'
          ? drawSystem(p, dx, dy, options.systems?.[id], mark)
          : drawCard(p, dx, dy, options.nodes?.[id], { overlay: !!options.overlay, mark, ...(options.terminal ? { terminal: true } : {}) }),
    );
    if (play) body.push('</g>');
  }
  body.push(...packets);

  if (diagram.legend && diagram.nodes.length > 0) {
    const size = legendSize(diagram.legend);
    const lx = maxX + dx + LEGEND_GAP;
    const ly = Math.max(MARGIN, maxY + dy - size.height);
    body.push(drawLegend(diagram.legend, lx, ly, size.width));
    maxX += LEGEND_GAP + size.width;
    maxY = Math.max(maxY, ly - dy + size.height);
  }

  if (diagram.nodes.length === 0) body.push(text(MARGIN, MARGIN + 16, 'Empty diagram', { fill: COLORS.muted }));
  return svgDocument(maxX - minX + MARGIN * 2, maxY - minY + MARGIN * 2, diagram.title ?? 'Architecture', body.filter(Boolean));
}

/** A paper-coloured outline behind the letters, so lines underneath stop short of them. */
function halo(textElement: string): string {
  return textElement.replace('<text ', `<text paint-order="stroke" stroke="${COLORS.background}" stroke-width="5" stroke-linejoin="round" `);
}

/** React Flow's handle (`.pc-handle`): a 9px square centred on (cx, cy). */
function handle(cx: number, cy: number): string {
  return `<rect x="${r(cx - 4.5)}" y="${r(cy - 4.5)}" width="9" height="9" rx="1" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="2"/>`;
}

/** How playback lights a card: one of the current step's nodes, or the one whose call failed. */
type Mark = 'active' | 'failing';

function drawCard(p: Placed, dx: number, dy: number, load?: NodeOverlay, live: { overlay?: boolean; mark?: Mark; terminal?: boolean } = {}): string {
  const { node, width, height } = p;
  const { overlay, mark, terminal } = live;
  // Lit by playback, a card lifts off its shadow (canvas.css `.pc-active`).
  const lift = mark ? 2 : 0;
  const x = p.x + dx - lift;
  const y = p.y + dy - lift;
  const textX = x + PAD_X + ICON + 10;
  const base = nodeBaseColor(node);
  const t = base ? tint(base, currentTheme()) : undefined;
  const dash = node.style?.dash ? DASH_ARRAY[node.style.dash].replace(/\d+/g, (n) => String(Number(n) * 1.5)) : undefined;
  // The load, as on the terminal's cards: how busy (or down) after the tech, a bar along the bottom, and the heat as the fill.
  const u = load?.utilization;
  const percent = load?.down ? 'down' : u !== undefined ? `${Math.round(u * 100)}%` : '';
  const replicas = terminal ? (load?.replicas ?? node.replicas ?? 1) : 1;
  // For a terminal, the canvas's load line (LoadBadge): replicas, size, shards, then how busy.
  const busy = terminal && load ? [replicas > 1 ? `×${replicas}` : '', load.size ?? '', load.shards && load.shards > 1 ? `⧉${load.shards}` : '', percent].filter(Boolean).join(' · ') : percent;
  // Lit by playback, the accent shadow takes the stack's place, as on the canvas (`.pc-active` wins over `[data-stack]`).
  const stack = node.kind === 'component' && !mark ? Math.min(2, replicas - 1) : 0;
  // Under the load overlay, the canvas's heat scale (utils/heat.ts) and, on its solid fills, the dark text drawn on accents.
  const scale = overlay ? canvasHeat(load) : undefined;
  const heat = scale ? scale.fill : heatOf(load);
  const fg = scale?.accent ? ON_ACCENT : COLORS.text;
  const dim = scale?.fill ? fg : COLORS.muted;
  const textMax = width - PAD_X * 2 - ICON - 10;
  const techMax = busy ? textMax - textWidth(busy, 11, true) - 8 : textMax;
  const ink = load?.saturated || (u ?? 0) >= 1 ? (scale?.accent ? ON_ACCENT : COLORS.error) : load?.down ? COLORS.muted : fg;
  const bar = u !== undefined && !load?.down ? loadBar(x + PAD_X, y + height - 11, width - PAD_X * 2, u, ink) : '';
  const lit = mark === 'failing' ? COLORS.error : mark === 'active' ? COLORS.active : undefined;
  const ringed = overlay && load?.bottleneck;
  return [
    `<g data-node="${esc(node.id)}" data-kind="${esc(node.type)}"${busy ? ` data-load="${busy}"` : ''}${mark ? ` data-play="${mark}"` : ''}>`,
    ringed ? bottleneckRing(x, y, width, height) : '',
    stack > 0 ? stackOf(x, y, width, height, stack) : '',
    card(x, y, width, height, { fill: heat ?? t?.fill, line: mark === 'failing' ? COLORS.error : t?.line, dash, ...(lit ? { shade: lit, depth: 5 } : stack > 0 ? { shadow: false } : {}) }),
    `<rect x="${r(x + PAD_X + 1)}" y="${r(y + PAD_Y + 1)}" width="${ICON - 2}" height="${ICON - 2}" rx="4" fill="${lit ?? COLORS.background}" stroke="${lit ?? COLORS.border}" stroke-width="2"/>`,
    techIcon(node.techStack, x + PAD_X + 8, y + PAD_Y + 8, 18, lit ? ON_ACCENT : COLORS.text, node.type),
    text(textX, y + PAD_Y + 15, fit(node.name, textMax, 14, true), { size: 14, weight: 700, ...(fg !== COLORS.text ? { fill: fg } : {}) }),
    text(textX, y + PAD_Y + 31, fit(node.techStack, techMax, 12), { size: 11, weight: 500, fill: dim, family: MONO }),
    busy ? text(x + width - PAD_X, y + PAD_Y + 31, busy, { size: 11, weight: 700, fill: ink, anchor: 'end', family: MONO }) : '',
    bar,
    node.ownerTeam ? text(x + PAD_X, y + PAD_Y + 60, fit(`Team: ${node.ownerTeam}`, width - PAD_X * 2, 12), { size: 12, fill: dim }) : '',
    ringed ? bottleneckTag(x, y) : '',
    handle(x + width / 2, y),
    handle(x + width / 2, y + height),
    node.critical ? criticalBadge(x + width, y) : '',
    '</g>',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The cards behind a card with replicas, as the canvas stacks them in place of
 * its shadow (canvas.css `.pc-node[data-stack]`): one outlined card per extra
 * replica, at most two, each 4px further right and down.
 */
function stackOf(x: number, y: number, w: number, h: number, count: number): string {
  const out: string[] = [];
  for (let k = count; k >= 1; k--) {
    out.push(
      `<rect data-stack="${k}" x="${r(x + 4 * k)}" y="${r(y + 4 * k)}" width="${r(w)}" height="${r(h)}" rx="4" fill="${COLORS.border}"/>`,
      `<rect x="${r(x + 4 * k + 2)}" y="${r(y + 4 * k + 2)}" width="${r(w - 4)}" height="${r(h - 4)}" rx="3" fill="${COLORS.surface}"/>`,
    );
  }
  return out.join('\n');
}

/** The status word of a system, and its color: red past capacity or its SLA, amber running hot (as the terminal's, paint.ts). */
const STATUS: Record<SystemStatus, string> = { ok: '✓ ok', hot: '▲ hot', saturated: '✗ saturated', breach: '✗ breaks SLA', idle: 'not simulated' };
const STATUS_COLOR: Partial<Record<SystemStatus, string>> = { hot: '#B7791F' };
const statusColor = (status: SystemStatus | undefined) =>
  status === 'saturated' || status === 'breach' ? COLORS.error : status === 'hot' && currentTheme() === 'dark' ? '#E0A43A' : status ? STATUS_COLOR[status] : undefined;
// The canvas's load fills (utils/heat.ts), light theme; the dark theme's are the same hues over its surface.
const LIGHT_HEAT = { warm: '#FFF1BF', hot: '#FFD6E8', over: '#FFD9D6' };
const heatColors = () =>
  currentTheme() === 'light'
    ? LIGHT_HEAT
    : { warm: mix(YELLOW, COLORS.surface, 0.28), hot: mix(COLORS.active, COLORS.surface, 0.3), over: mix(COLORS.error, COLORS.surface, 0.3) };

/** The canvas's yellow (`--c-yellow`), the same in both themes, and the dark text drawn on its accents (`--c-on-accent`). */
const YELLOW = '#FFD23F';
const ON_ACCENT = '#111111';

/**
 * A collapsed system (docs/design/team-systems-and-imports.md D3): a card
 * with a second border inside the first, its name and @team, the team's
 * promise, what it is sent against its headroom with a bar, and its status;
 * the border goes red past capacity or its SLA, amber running hot, and the
 * card fills with its heat as a busy card does on the canvas.
 */
/** How busy a card is, as a thin bar: the track, and the share it is busy. */
function loadBar(x: number, y: number, w: number, u: number, ink: string): string {
  const share = Math.min(1, u);
  return [
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="3" rx="1.5" fill="${ink === ON_ACCENT ? ON_ACCENT : COLORS.text}" fill-opacity="0.12"/>`,
    `<rect x="${r(x)}" y="${r(y)}" width="${r(Math.max(share > 0 ? 3 : 0, w * share))}" height="3" rx="1.5" fill="${ink}"/>`,
  ].join('\n');
}

/** A card's fill for its load: the canvas's heat past 70%, 90% and capacity. */
function heatOf(load: NodeOverlay | undefined): string | undefined {
  const u = load?.utilization;
  if (!load || load.down || u === undefined) return undefined;
  const HEAT = heatColors();
  return load.saturated || u >= 1 ? HEAT.over : u >= 0.9 ? HEAT.hot : u >= 0.7 ? HEAT.warm : undefined;
}

function drawSystem(p: Placed, dx: number, dy: number, badge: SystemBadge | undefined, mark?: Mark): string {
  const { node, width, height } = p;
  const lift = mark ? 2 : 0;
  const x = p.x + dx - lift;
  const y = p.y + dy - lift;
  const base = nodeBaseColor(node);
  const t = base ? tint(base, currentTheme()) : undefined;
  const status = badge?.status;
  const lit = mark === 'failing' ? COLORS.error : mark === 'active' ? COLORS.active : undefined;
  const line = (mark === 'failing' ? COLORS.error : undefined) ?? statusColor(status) ?? t?.line ?? COLORS.border;
  const u = badge?.utilization;
  const HEAT = heatColors();
  const heat = u === undefined ? undefined : status === 'saturated' || u >= 1 ? HEAT.over : u >= 0.9 ? HEAT.hot : u >= 0.7 ? HEAT.warm : undefined;
  const textX = x + PAD_X + ICON + 10;
  const textMax = width - PAD_X * 2 - ICON - 10;
  const out = [
    `<g data-node="${esc(node.id)}" data-kind="system"${status ? ` data-status="${status}"` : ''}>`,
    card(x, y, width, height, { fill: heat ?? t?.fill, line, ...(lit ? { shade: lit, depth: 5 } : {}) }),
    `<rect x="${r(x + 6)}" y="${r(y + 6)}" width="${r(width - 12)}" height="${r(height - 12)}" rx="2" fill="none" stroke="${line}" stroke-width="1.5"/>`,
    `<rect x="${r(x + PAD_X + 1)}" y="${r(y + PAD_Y + 1)}" width="${ICON - 2}" height="${ICON - 2}" rx="4" fill="${lit ?? COLORS.background}" stroke="${lit ?? COLORS.border}" stroke-width="2"/>`,
    techIcon(node.techStack, x + PAD_X + 8, y + PAD_Y + 8, 18, lit ? ON_ACCENT : COLORS.text, node.type),
    text(textX, y + PAD_Y + 15, fit(node.name, textMax, 14, true), { size: 14, weight: 700 }),
    text(textX, y + PAD_Y + 31, fit(badge?.team ? `@${badge.team}` : 'system', textMax, 12), { size: 12, weight: 600, fill: COLORS.muted }),
  ];
  if (badge) {
    const word = STATUS[badge.status];
    const pill = textWidth(word, 11, true) + 14;
    const ink = statusColor(badge.status) ?? COLORS.text;
    out.push(
      `<rect x="${r(x + width - 14 - pill)}" y="${r(y - 9)}" width="${r(pill)}" height="18" rx="9" fill="${COLORS.surface}" stroke="${ink}" stroke-width="1.5"/>`,
      text(x + width - 14 - pill / 2, y + 4, word, { size: 11, weight: 700, fill: ink, anchor: 'middle' }),
      text(x + PAD_X, y + PAD_Y + 52, fit(badge.promise ? `promise ${badge.promise}` : 'no promise', width - PAD_X * 2, 12), { size: 12, weight: 500, fill: badge.promise ? COLORS.text : COLORS.muted, family: MONO }),
      text(x + PAD_X, y + PAD_Y + 68, loadText(badge), { size: 12, weight: 600, family: MONO }),
      text(x + width - PAD_X, y + PAD_Y + 68, 'sent / headroom', { size: 11, fill: COLORS.muted, anchor: 'end' }),
    );
    if (Number.isFinite(badge.headroomRps) && badge.headroomRps > 0) {
      const w = width - PAD_X * 2;
      const share = Math.min(1, badge.sentRps / badge.headroomRps);
      out.push(
        `<rect x="${r(x + PAD_X)}" y="${r(y + PAD_Y + 74)}" width="${r(w)}" height="4" rx="2" fill="${COLORS.text}" fill-opacity="0.12"/>`,
        `<rect x="${r(x + PAD_X)}" y="${r(y + PAD_Y + 74)}" width="${r(Math.max(share > 0 ? 3 : 0, w * share))}" height="4" rx="2" fill="${ink}"/>`,
      );
    }
  }
  out.push(handle(x + width / 2, y), handle(x + width / 2, y + height), '</g>');
  return out.join('\n');
}

function drawNote(p: Placed, dx: number, dy: number): string {
  const x = p.x + dx;
  const y = p.y + dy;
  return [
    `<g data-node="${esc(p.node.id)}" data-kind="text">`,
    card(x, y, p.width, p.height, { fill: COLORS.surface, stroke: 2 }),
    `<rect x="${r(x + 2)}" y="${r(y + 2)}" width="${r(p.width - 4)}" height="${r(p.height - 4)}" rx="3" fill="${NOTE_FILL}" fill-opacity="0.22"/>`,
    techIcon('Sticky Note', x + 18, y + 20, 16, COLORS.text),
    text(x + 42, y + 33, fit(p.node.name, p.width - 60, 14), { size: 14, weight: 600 }),
    ...(p.lines ?? []).map((line, i) => text(x + 18, y + 61 + i * NOTE_LINE, line, { size: NOTE_FONT })),
    '</g>',
  ].join('\n');
}

/** `critical`: ComponentNode's warning badge, a yellow disc with a triangle centred on the card's top-right corner. */
function criticalBadge(cx: number, cy: number): string {
  return [
    `<g data-critical="true">`,
    `<circle cx="${r(cx + 1)}" cy="${r(cy + 1)}" r="11" fill="${COLORS.shadow}"/>`,
    `<circle cx="${r(cx)}" cy="${r(cy)}" r="10.5" fill="${CRITICAL_FILL}" stroke="${ON_ACCENT}" stroke-width="1.5"/>`,
    `<path d="M${r(cx)},${r(cy - 5.5)} L${r(cx + 5.5)},${r(cy + 4)} L${r(cx - 5.5)},${r(cy + 4)} Z" fill="none" stroke="${ON_ACCENT}" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<path d="M${r(cx)},${r(cy - 1.5)} V${r(cy + 0.8)} M${r(cx)},${r(cy + 2.4)} v0.1" stroke="${ON_ACCENT}" stroke-width="1.6" stroke-linecap="round"/>`,
    '</g>',
  ].join('\n');
}

const CRITICAL_FILL = '#FFD23F';
const LEGEND_GAP = 32;
const LEGEND_ROW = 22;
const LEGEND_PAD = 12;
const LEGEND_SWATCH = 22;

function legendSize(entries: LegendEntry[]): { width: number; height: number } {
  const label = Math.max(...entries.map((e) => textWidth(fit(e.label, 240, 12), 12)), textWidth('LEGEND', 10) + 8);
  return { width: Math.ceil(LEGEND_PAD * 2 + LEGEND_SWATCH + 8 + label), height: LEGEND_PAD * 2 + 16 + entries.length * LEGEND_ROW };
}

/** The legend panel (Legend.tsx): a card with one swatch and label per entry. */
function drawLegend(entries: LegendEntry[], x: number, y: number, width: number): string {
  const { height } = legendSize(entries);
  const out = [`<g data-legend="true">`, card(x, y, width, height, { stroke: 2 })];
  out.push(text(x + LEGEND_PAD, y + LEGEND_PAD + 8, 'LEGEND', { size: 10, weight: 700, fill: COLORS.muted, spacing: 1 }));
  entries.forEach((entry, i) => {
    const rowY = y + LEGEND_PAD + 16 + i * LEGEND_ROW;
    const t = entry.color ? tint(entry.color, currentTheme()) : undefined;
    const dash = entry.dash ? ` stroke-dasharray="${DASH_ARRAY[entry.dash]}"` : '';
    out.push(
      `<rect data-entry="${esc(entry.id)}" x="${r(x + LEGEND_PAD + 1)}" y="${r(rowY + 5)}" width="${LEGEND_SWATCH - 2}" height="12" rx="3" fill="${t?.fill ?? COLORS.surface}" stroke="${t?.line ?? COLORS.border}" stroke-width="2"${dash}/>`,
      text(x + LEGEND_PAD + LEGEND_SWATCH + 8, rowY + 15, fit(entry.label, 240, 12), { size: 12, weight: 500 }),
    );
  });
  out.push('</g>');
  return out.join('\n');
}

/** A tagged edge's stroke color and dash. */
function edgeStroke(edge: DiagramEdge): { color?: string; dash?: string } {
  return {
    ...(edge.style?.color ? { color: tint(edge.style.color, currentTheme()).line } : {}),
    ...(edge.style?.dash ? { dash: DASH_ARRAY[edge.style.dash] } : {}),
  };
}

/** RoutedEdge: the route with rounded bends and an arrowhead at the target, the label on the line. */
function drawEdge(id: string, label: string | undefined, points: Point[], at: Point, stroke: { color?: string; dash?: string } = {}): string {
  const color = stroke.color ?? COLORS.line;
  const { points: line, head } = withHead(points);
  const out = [
    `<g data-edge="${esc(id)}">`,
    `<path d="${roundedPath(line)}" fill="none" stroke="${color}" stroke-width="2"${stroke.dash ? ` stroke-dasharray="${stroke.dash}"` : ''}/>`,
  ];
  if (head) out.push(`<path d="${head}" fill="${color}"/>`);
  if (label) {
    const shown = fit(label, 200, 11);
    const w = textWidth(shown, 11) + 12;
    out.push(
      `<rect x="${r(at.x - w / 2)}" y="${r(at.y - 9)}" width="${r(w)}" height="18" rx="2" fill="${COLORS.background}"/>`,
      text(at.x, at.y + 4, shown, { size: 11, weight: 500, fill: COLORS.text, opacity: 0.8, anchor: 'middle', family: MONO }),
    );
  }
  out.push('</g>');
  return out.join('\n');
}

// ---- Live state: the load overlay, playback and selection (ArchitectureOptions `overlay`, `play`, `selected`).

/** Groups while a scenario plays, as the editor fades them (playbackView.ts). */
const GROUP_OPACITY = 0.45;
/** How far along the edge (in %) a failed call gets before it is cut off (AnimatedPlaybackEdge.tsx). */
const FAIL_AT = 55;

/** A call of the current moment: the step, and how it plays. */
interface Move {
  step: FlowStep;
  /** Failed, or answered with a 4xx/5xx: drawn red. */
  error: boolean;
  /** Never answered: dashed, the packet cut off part way. */
  failed: boolean;
  /** Request-response: the packet goes out and comes back. */
  roundTrip: boolean;
}

interface PlayState {
  active: Set<string>;
  failing: Set<string>;
  moves: Move[];
  nodeOpacity: (id: string) => number;
  edgeOpacity: (edge: DiagramEdge) => number;
  moveOn: (edge: DiagramEdge) => Move | undefined;
}

const connects = (edge: { source: string; target: string }, step: FlowStep) =>
  (edge.source === step.fromServiceId && edge.target === step.toServiceId) || (edge.target === step.fromServiceId && edge.source === step.toServiceId);

function playState({ steps, index }: PlayMoment): PlayState {
  const current = currentStepsOf(steps, index);
  const done = steps.slice(0, index).filter((step) => !current.includes(step));
  const active = new Set<string>();
  const failing = new Set<string>();
  for (const step of current) {
    active.add(step.fromServiceId);
    active.add(step.toServiceId);
    if (isErrorStep(step)) failing.add(step.toServiceId);
  }
  const visited = new Set(done.flatMap((s) => [s.fromServiceId, s.toServiceId]));
  const path = new Set(steps.flatMap((s) => [s.fromServiceId, s.toServiceId]));
  const moves = current.map((step) => ({
    step,
    error: isErrorStep(step),
    failed: !!step.failed,
    roundTrip: step.executionType === 'SYNC_REQUEST_RESPONSE' && !step.failed,
  }));
  return {
    active,
    failing,
    moves,
    nodeOpacity: (id) => (active.has(id) ? 1 : visited.has(id) ? 0.75 : path.has(id) ? 0.45 : 0.15),
    edgeOpacity: (edge) =>
      moves.some((m) => connects(edge, m.step)) ? 1 : done.some((s) => connects(edge, s)) ? 0.75 : steps.some((s) => connects(edge, s)) ? 0.45 : 0.12,
    moveOn: (edge) => moves.find((m) => connects(edge, m.step)),
  };
}

/** The canvas's heat fill for a card under the load overlay (utils/heat.ts), and whether it is solid enough to take the dark text. */
function canvasHeat(load: NodeOverlay | undefined): { fill?: string; accent: boolean } | undefined {
  if (!load) return undefined;
  const u = load.utilization;
  if (load.down) return { fill: mix(COLORS.muted, COLORS.surface, 0.35), accent: false };
  if (u === undefined || u < 0.4) return { accent: false };
  if (u < 0.7) return { fill: mix(YELLOW, COLORS.surface, 0.4), accent: false };
  if (u < 0.9) return { fill: YELLOW, accent: true };
  if (u < 1) return { fill: COLORS.active, accent: true };
  return { fill: COLORS.error, accent: true };
}

/** An edge's colour for the load of the node it feeds (heatStroke): none below 40%, then yellow, pink and red. */
function heatStroke(load: EdgeOverlay): string | undefined {
  const u = load.utilization;
  if (load.saturated || (u !== undefined && u >= 1)) return COLORS.error;
  if (u === undefined || u < 0.4) return undefined;
  return u < 0.9 ? YELLOW : COLORS.active;
}

/** The accent ring of a selected node (`outline` around it). */
function selectionRing(x: number, y: number, w: number, h: number, rx: number): string {
  return `<rect data-selected="true" x="${r(x - 7)}" y="${r(y - 7)}" width="${r(w + 14)}" height="${r(h + 14)}" rx="${rx}" fill="none" stroke="${COLORS.active}" stroke-width="3"/>`;
}

/** The load overlay's bottleneck: a dashed red ring around the card (canvas.css `[data-bottleneck]`)… */
function bottleneckRing(x: number, y: number, w: number, h: number): string {
  return `<rect data-bottleneck="true" x="${r(x - 6)}" y="${r(y - 6)}" width="${r(w + 12)}" height="${r(h + 12)}" rx="6" fill="none" stroke="${COLORS.error}" stroke-width="2" stroke-dasharray="6 4"/>`;
}

/** …and its name on a tab above (`.pc-node__tag`). */
function bottleneckTag(x: number, y: number): string {
  const word = 'BOTTLENECK';
  const w = textWidth(word, 9, true) + word.length * 0.7 + 12;
  return [
    `<rect x="${r(x + 10)}" y="${r(y - 10)}" width="${r(w)}" height="15" rx="3" fill="${COLORS.error}"/>`,
    text(x + 16, y + 1, word, { size: 9, weight: 700, fill: ON_ACCENT, spacing: 0.7 }),
  ].join('\n');
}

/** Advance width of `text` in the canvas's monospace font (JetBrains Mono: 0.6 em a character). */
const monoWidth = (content: string, size: number) => [...content].length * size * 0.6;

/**
 * An edge under the load overlay or during playback: tinted and bold by its
 * load with a dark casing under a tint, its label swapped for the chip of
 * what it carries; on the current step in the accent (red for an error),
 * dashed when the call fails (it never arrives).
 */
function drawLiveEdge(edge: DiagramEdge | undefined, points: Point[], at: Point, load: EdgeOverlay | undefined, move: Move | undefined, opaque = false): string {
  const own = edge ? edgeStroke(edge) : {};
  let color = own.color ?? COLORS.line;
  let width = 2;
  let dash = own.dash;
  let casing = false;
  if (load) {
    const heat = heatStroke(load);
    if (heat) [color, casing] = [heat, true];
    else if (load.critical) color = COLORS.text;
    width = load.critical ? 5 : 2.5;
  }
  if (move) {
    color = move.error ? COLORS.error : COLORS.active;
    width = Math.max(width, 3.5);
    casing = false;
    dash = move.failed ? '6 4' : undefined;
  }
  const { points: line, head } = withHead(points);
  const d = roundedPath(line);
  const id = edge?.id ?? `step:${move?.step.fromServiceId}->${move?.step.toServiceId}`;
  const out = [`<g data-edge="${esc(id)}"${load?.critical ? ' data-critical="true"' : ''}${move ? ' data-play="active"' : ''}>`];
  if (casing) out.push(`<path d="${d}" fill="none" stroke="${COLORS.text}" stroke-opacity="0.85" stroke-width="${width + 2}"/>`);
  out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
  if (head) out.push(`<path d="${head}" fill="${color}"${casing ? ` stroke="${COLORS.text}" stroke-opacity="0.85" stroke-width="1"` : ''}/>`);
  const label = edge?.label;
  if (load && load.rps > 0) {
    // The chip (EdgeLoadLabel): the label, then its requests and the latency they add, one a
    // line under a label so it is no wider than the room the layout kept for that.
    const latency = load.latencyMs !== undefined ? `+${formatMs(load.latencyMs)}` : undefined;
    const numbers = label ? [formatRps(load.rps), ...(latency ? [latency] : [])] : [[formatRps(load.rps), latency].filter(Boolean).join(' · ')];
    const lines = label ? [fit(label, 200, 11), ...numbers] : numbers;
    const w = Math.max(...lines.map((l) => monoWidth(l, 11))) + 12;
    const h = lines.length * 14 + 4;
    out.push(
      `<rect x="${r(at.x - w / 2)}" y="${r(at.y - h / 2)}" width="${r(w)}" height="${h}" rx="3" fill="${COLORS.background}" fill-opacity="${opaque ? 1 : 0.92}" stroke="${COLORS.text}" stroke-opacity="${load.critical ? 1 : 0.35}" stroke-width="${load.critical ? 1.5 : 1}"/>`,
      ...lines.map((l, i) =>
        text(at.x, at.y - h / 2 + 13 + i * 14, l, { size: 11, weight: label && i === 0 ? 500 : 600, anchor: 'middle', family: MONO, ...(label && i === 0 ? { opacity: 0.75 } : {}) }),
      ),
    );
  } else if (label) {
    const shown = fit(label, 200, 11);
    const w = textWidth(shown, 11) + 12;
    out.push(
      `<rect x="${r(at.x - w / 2)}" y="${r(at.y - 9)}" width="${r(w)}" height="18" rx="2" fill="${COLORS.background}"/>`,
      text(at.x, at.y + 4, shown, { size: 11, weight: 500, fill: COLORS.text, opacity: 0.8, anchor: 'middle', family: MONO }),
    );
  }
  out.push('</g>');
  return out.join('\n');
}

/** The point `share` (0..1) of the way along a polyline. */
function along(points: Point[], share: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = Math.max(0, Math.min(1, share)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(1, left / lengths[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k };
    }
    left -= lengths[i];
  }
  return points[0];
}

/**
 * The packet on a step's route, caller to callee (AnimatedPlaybackEdge's
 * Packet): an ink-outlined square in the accent that tumbles as it goes,
 * out and back for a request-response, red on an error answer; a failed call
 * stops short under a cross. Nothing once it has arrived.
 */
function drawPacket(points: Point[], move: Move, progress: number): string {
  const share = move.failed ? Math.min(progress, FAIL_AT) / 100 : move.roundTrip ? (progress <= 50 ? progress / 50 : 1 - (progress - 50) / 50) : progress / 100;
  const at = along(points, share);
  const where = `translate(${r(at.x)} ${r(at.y)})`;
  if (move.failed && progress >= FAIL_AT) {
    return [
      `<g data-packet="cut" transform="${where}" stroke-linecap="round">`,
      `<circle r="13" fill="${COLORS.surface}" stroke="${COLORS.text}" stroke-width="2.5"/>`,
      `<path d="M-5.5,-5.5 L5.5,5.5 M-5.5,5.5 L5.5,-5.5" stroke="${COLORS.error}" stroke-width="3.5"/>`,
      '</g>',
    ].join('\n');
  }
  if (progress >= 100) return '';
  const color = move.error && (!move.roundTrip || progress > 50) ? COLORS.error : COLORS.active;
  const spin = r((progress / 100) * 180);
  return [
    `<g data-packet="${move.error ? 'error' : 'ok'}" transform="${where}">`,
    `<rect x="-6" y="-4" width="16" height="16" rx="3" transform="rotate(${spin})" fill="${COLORS.shadow}"/>`,
    `<rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(${spin})" fill="${color}" stroke="${COLORS.text}" stroke-width="2.5"/>`,
    '</g>',
  ].join('\n');
}
