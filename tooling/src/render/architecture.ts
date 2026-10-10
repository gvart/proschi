import { layoutBoxes } from '../../../frontend/src/dsl/autoLayout';
import type { Diagram, DiagramNode } from '../proschi';
import { techIcon } from './icons';
import { COLORS, MONO, card, esc, fit, r, svgDocument, text, textWidth, wrap } from './svg';

/**
 * The architecture as SVG, drawn like the editor's canvas (canvas.css): the
 * canvas's own top-down ELK layout (autoLayout.ts, so pinned `pos x,y`
 * positions hold), ComponentNode's monochrome cards with a thick ink border,
 * hard shadow and square handles, GroupNode's dashed frames, TextNode's notes,
 * and React Flow's bezier edges.
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
  const boxes = new Map((await layoutBoxes(diagram)).map((b) => [b.id, b]));

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
  const minX = Math.min(0, ...all.map((p) => p.x));
  const minY = Math.min(0, ...all.map((p) => p.y));
  const maxX = Math.max(0, ...all.map((p) => p.x + p.width));
  const maxY = Math.max(0, ...all.map((p) => p.y + p.height));
  const dx = MARGIN - minX;
  const dy = MARGIN - minY;
  const body: string[] = [];

  // Groups first (outermost first), then edges, then cards on top, as on the canvas.
  const depth = (n: DiagramNode): number => {
    const parent = n.parent ? placed.get(n.parent) : undefined;
    return parent ? depth(parent.node) + 1 : 0;
  };
  for (const p of all.filter((p) => p.node.kind === 'group').sort((a, b) => depth(a.node) - depth(b.node))) {
    const x = p.x + dx;
    const y = p.y + dy;
    body.push(
      `<g data-node="${esc(p.node.id)}" data-kind="group">`,
      `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="10" fill="${COLORS.text}" fill-opacity="0.03" stroke="${COLORS.text}" stroke-opacity="0.45" stroke-width="2" stroke-dasharray="7 5"/>`,
      techIcon('Logical Group', x + 14, y + 13, 14, COLORS.text),
      text(x + 34, y + 24, fit(p.node.name.toUpperCase(), p.width - 52, 12, true), { size: 12, weight: 700, fill: COLORS.text, opacity: 0.8, spacing: 1 }),
      p.node.description ? text(x + 14, y + 48, fit(p.node.description, p.width - 28, 13), { size: 13, fill: COLORS.muted }) : '',
      '</g>',
    );
  }

  for (const edge of diagram.edges) {
    const s = placed.get(edge.source);
    const t = placed.get(edge.target);
    if (!s || !t || s === t) continue;
    body.push(drawEdge(edge.id, edge.label, s.x + dx + s.width / 2, s.y + dy + s.height, t.x + dx + t.width / 2, t.y + dy));
  }

  for (const p of all) {
    if (p.node.kind === 'group') continue;
    body.push(p.node.kind === 'text' ? drawNote(p, dx, dy) : drawCard(p, dx, dy));
  }

  if (diagram.nodes.length === 0) body.push(text(MARGIN, MARGIN + 16, 'Empty diagram', { fill: COLORS.muted }));
  return svgDocument(maxX - minX + MARGIN * 2, maxY - minY + MARGIN * 2, diagram.title ?? 'Architecture', body.filter(Boolean));
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
  return [
    `<g data-node="${esc(node.id)}" data-kind="${esc(node.type)}">`,
    card(x, y, width, height),
    `<rect x="${r(x + PAD_X + 1)}" y="${r(y + PAD_Y + 1)}" width="${ICON - 2}" height="${ICON - 2}" rx="4" fill="${COLORS.background}" stroke="${COLORS.border}" stroke-width="2"/>`,
    techIcon(node.techStack, x + PAD_X + 8, y + PAD_Y + 8, 18, COLORS.text, node.type),
    text(textX, y + PAD_Y + 15, fit(node.name, textMax, 14, true), { size: 14, weight: 700 }),
    text(textX, y + PAD_Y + 31, fit(node.techStack, textMax, 12), { size: 11, weight: 500, fill: COLORS.muted, family: MONO }),
    node.ownerTeam ? text(x + PAD_X, y + PAD_Y + 60, fit(`Team: ${node.ownerTeam}`, width - PAD_X * 2, 12), { size: 12, fill: COLORS.muted }) : '',
    handle(x + width / 2, y),
    handle(x + width / 2, y + height),
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

/** React Flow's default (bezier) edge from the source's bottom handle to the target's top one, label at its middle. */
function drawEdge(id: string, label: string | undefined, sx: number, sy: number, tx: number, ty: number): string {
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const c1y = sy + offset(ty - sy);
  const c2y = ty - offset(ty - sy);
  const out = [
    `<g data-edge="${esc(id)}">`,
    `<path d="M${r(sx)},${r(sy)} C${r(sx)},${r(c1y)} ${r(tx)},${r(c2y)} ${r(tx)},${r(ty)}" fill="none" stroke="${COLORS.line}" stroke-width="2"/>`,
  ];
  if (label) {
    const cx = sx * 0.125 + sx * 0.375 + tx * 0.375 + tx * 0.125;
    const cy = sy * 0.125 + c1y * 0.375 + c2y * 0.375 + ty * 0.125;
    const shown = fit(label, 200, 11);
    const w = textWidth(shown, 11) + 12;
    out.push(
      `<rect x="${r(cx - w / 2)}" y="${r(cy - 9)}" width="${r(w)}" height="18" rx="2" fill="${COLORS.background}"/>`,
      text(cx, cy + 4, shown, { size: 11, weight: 500, fill: COLORS.text, opacity: 0.8, anchor: 'middle', family: MONO }),
    );
  }
  out.push('</g>');
  return out.join('\n');
}
