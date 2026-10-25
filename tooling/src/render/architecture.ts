import { layoutGraph, type Point } from '../../../frontend/src/dsl/autoLayout';
import { fallbackRoute, labelPoint, roundedPath, snapToBottom, withHead } from '../../../frontend/src/dsl/edgePath';
import type { Diagram, DiagramNode } from '../proschi';
import { DASH_ARRAY, nodeBaseColor, tint } from '../../../frontend/src/dsl/palette';
import type { DiagramEdge, LegendEntry } from '../../../frontend/src/dsl/types';
import { techIcon } from './icons';
import { COLORS, MONO, card, esc, fit, r, svgDocument, text, textWidth, wrap } from './svg';

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

export async function renderArchitectureSvg(diagram: Diagram): Promise<string> {
  const layout = await layoutGraph(diagram);
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
    } else placed.set(node.id, { node, x, y, width: box.width, height: node.ownerTeam ? CARD_WITH_TEAM_HEIGHT : CARD_HEIGHT });
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
    const x = p.x + dx;
    const y = p.y + dy;
    const base = nodeBaseColor(p.node);
    const t = base ? tint(base, 'light') : undefined;
    const dash = p.node.style?.dash ? DASH_ARRAY[p.node.style.dash] : '7 5';
    const frame = t
      ? `fill="${t.groupFill}" stroke="${t.line}" stroke-width="2" stroke-dasharray="${dash}"`
      : `fill="${COLORS.text}" fill-opacity="0.03" stroke="${COLORS.text}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="${dash}"`;
    body.push(
      `<g data-node="${esc(p.node.id)}" data-kind="group">`,
      `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="10" ${frame}/>`,
      '</g>',
    );
    // The title and description go over the edges (with a halo), so an edge entering the group does not strike them through.
    titles.push(
      `<g data-group-title="${esc(p.node.id)}">`,
      techIcon('Logical Group', x + 14, y + 13, 14, t?.line ?? COLORS.text),
      halo(text(x + 34, y + 24, fit(p.node.name.toUpperCase(), p.width - 52, 12, true), { size: 12, weight: 700, fill: t?.line ?? COLORS.text, opacity: t ? 1 : 0.8, spacing: 1 })),
      p.node.description ? halo(text(x + 14, y + 48, fit(p.node.description, p.width - 28, 13), { size: 13, fill: COLORS.muted })) : '',
      '</g>',
    );
  }

  for (const edge of diagram.edges) {
    const s = placed.get(edge.source);
    const t = placed.get(edge.target);
    if (!s || !t || s === t) continue;
    const sBox = { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height };
    const tBox = { x: t.x + dx, y: t.y + dy, width: t.width, height: t.height };
    const route = layout.routes[edge.id];
    const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    // Cards here are drawn at their own height, so ends on a bottom move onto it.
    const points = route ? snapToBottom(snapToBottom(route.points.map(shift), 'start', sBox), 'end', tBox) : fallbackRoute(sBox, tBox);
    body.push(drawEdge(edge.id, edge.label, points, route?.label ? shift(route.label) : labelPoint(points), edgeStroke(edge)));
  }

  body.push(...titles);

  for (const p of all) {
    if (p.node.kind === 'group') continue;
    body.push(p.node.kind === 'text' ? drawNote(p, dx, dy) : drawCard(p, dx, dy));
  }

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

function drawCard(p: Placed, dx: number, dy: number): string {
  const { node, width, height } = p;
  const x = p.x + dx;
  const y = p.y + dy;
  const textX = x + PAD_X + ICON + 10;
  const textMax = width - PAD_X * 2 - ICON - 10;
  const base = nodeBaseColor(node);
  const t = base ? tint(base, 'light') : undefined;
  const dash = node.style?.dash ? DASH_ARRAY[node.style.dash].replace(/\d+/g, (n) => String(Number(n) * 1.5)) : undefined;
  return [
    `<g data-node="${esc(node.id)}" data-kind="${esc(node.type)}">`,
    card(x, y, width, height, { fill: t?.fill, line: t?.line, dash }),
    `<rect x="${r(x + PAD_X + 1)}" y="${r(y + PAD_Y + 1)}" width="${ICON - 2}" height="${ICON - 2}" rx="4" fill="${COLORS.background}" stroke="${COLORS.border}" stroke-width="2"/>`,
    techIcon(node.techStack, x + PAD_X + 8, y + PAD_Y + 8, 18, COLORS.text, node.type),
    text(textX, y + PAD_Y + 15, fit(node.name, textMax, 14, true), { size: 14, weight: 700 }),
    text(textX, y + PAD_Y + 31, fit(node.techStack, textMax, 12), { size: 11, weight: 500, fill: COLORS.muted, family: MONO }),
    node.ownerTeam ? text(x + PAD_X, y + PAD_Y + 60, fit(`Team: ${node.ownerTeam}`, width - PAD_X * 2, 12), { size: 12, fill: COLORS.muted }) : '',
    handle(x + width / 2, y),
    handle(x + width / 2, y + height),
    node.critical ? criticalBadge(x + width, y) : '',
    '</g>',
  ]
    .filter(Boolean)
    .join('\n');
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
    `<circle cx="${r(cx + 1)}" cy="${r(cy + 1)}" r="11" fill="${COLORS.border}"/>`,
    `<circle cx="${r(cx)}" cy="${r(cy)}" r="10.5" fill="${CRITICAL_FILL}" stroke="${COLORS.border}" stroke-width="1.5"/>`,
    `<path d="M${r(cx)},${r(cy - 5.5)} L${r(cx + 5.5)},${r(cy + 4)} L${r(cx - 5.5)},${r(cy + 4)} Z" fill="none" stroke="${COLORS.border}" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<path d="M${r(cx)},${r(cy - 1.5)} V${r(cy + 0.8)} M${r(cx)},${r(cy + 2.4)} v0.1" stroke="${COLORS.border}" stroke-width="1.6" stroke-linecap="round"/>`,
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
    const t = entry.color ? tint(entry.color, 'light') : undefined;
    const dash = entry.dash ? ` stroke-dasharray="${DASH_ARRAY[entry.dash]}"` : '';
    out.push(
      `<rect data-entry="${esc(entry.id)}" x="${r(x + LEGEND_PAD + 1)}" y="${r(rowY + 5)}" width="${LEGEND_SWATCH - 2}" height="12" rx="3" fill="${t?.fill ?? COLORS.surface}" stroke="${t?.line ?? COLORS.border}" stroke-width="2"${dash}/>`,
      text(x + LEGEND_PAD + LEGEND_SWATCH + 8, rowY + 15, fit(entry.label, 240, 12), { size: 12, weight: 500 }),
    );
  });
  out.push('</g>');
  return out.join('\n');
}

/** A tagged edge's stroke color and dash, light theme. */
function edgeStroke(edge: DiagramEdge): { color?: string; dash?: string } {
  return {
    ...(edge.style?.color ? { color: tint(edge.style.color, 'light').line } : {}),
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
