import { layoutBoxes } from '../../../frontend/src/dsl/autoLayout';
import type { Diagram, DiagramNode } from '../proschi';
import { TAILWIND_HEX, techIcon, typeColor } from './icons';
import { esc, fit, r, svgDocument, text, textWidth, wrap } from './svg';

/**
 * The architecture as SVG, drawn like the editor's canvas: the canvas's own
 * top-down ELK layout (autoLayout.ts, so pinned `pos x,y` positions hold),
 * ComponentNode-style cards with the coloured icon tile, GroupNode's dashed
 * boxes, TextNode's sticky notes, and React Flow's bezier edges.
 */

const MARGIN = 32;
// ComponentNode: border 2 + py-3, a 36px row (icon tile / name + tech), mb-2, and the team line.
const CARD_HEIGHT = 72;
const CARD_WITH_TEAM_HEIGHT = 92;
const PAD_X = 18;
const PAD_Y = 14;
const NOTE_FONT = 14;
const NOTE_LINE = 21;

const GRAY = {
  border: TAILWIND_HEX['border-gray-300'],
  name: TAILWIND_HEX['text-gray-800'],
  tech: TAILWIND_HEX['text-gray-500'],
  team: TAILWIND_HEX['text-gray-600'],
  body: TAILWIND_HEX['text-gray-700'],
};
const EDGE = '#b1b1b7';
const GROUP_FILL = '#f0f9ff';
const GROUP_BORDER = '#3b82f6';

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

export async function renderArchitectureSvg(diagram: Diagram, idPrefix = ''): Promise<string> {
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
      `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="8" fill="${GROUP_FILL}" stroke="${GROUP_BORDER}" stroke-width="2" stroke-dasharray="7 5"/>`,
      techIcon('Logical Group', x + 18, y + 22, 20, GROUP_BORDER),
      text(x + 46, y + 38, fit(p.node.name, p.width - 64, 18, true), { size: 18, weight: 600, fill: GROUP_BORDER }),
      p.node.description ? text(x + 18, y + 72, fit(p.node.description, p.width - 36, 14), { size: 14, fill: GRAY.team }) : '',
      '</g>',
    );
  }

  for (const edge of diagram.edges) {
    const s = placed.get(edge.source);
    const t = placed.get(edge.target);
    if (!s || !t || s === t) continue;
    body.push(drawEdge(edge.id, edge.label, s.x + dx + s.width / 2, s.y + dy + s.height, t.x + dx + t.width / 2, t.y + dy, idPrefix));
  }

  for (const p of all) {
    if (p.node.kind === 'group') continue;
    body.push(p.node.kind === 'text' ? drawNote(p, dx, dy) : drawCard(p, dx, dy, idPrefix));
  }

  if (diagram.nodes.length === 0) body.push(text(MARGIN, MARGIN + 16, 'Empty diagram', { fill: GRAY.tech }));
  const defs = [
    `<filter id="${idPrefix}shadow" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000000" flood-opacity="0.1"/></filter>`,
    `<marker id="${idPrefix}arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${EDGE}"/></marker>`,
  ].join('');
  return svgDocument(maxX - minX + MARGIN * 2, maxY - minY + MARGIN * 2, diagram.title ?? 'Architecture', body.filter(Boolean), defs);
}

function drawCard(p: Placed, dx: number, dy: number, idPrefix: string): string {
  const { node, width, height } = p;
  const x = p.x + dx;
  const y = p.y + dy;
  const textX = x + PAD_X + 44;
  const textMax = width - PAD_X * 2 - 44;
  return [
    `<g data-node="${esc(node.id)}" data-kind="${esc(node.type)}">`,
    `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(width - 2)}" height="${r(height - 2)}" rx="8" fill="#ffffff" stroke="${GRAY.border}" stroke-width="2" filter="url(#${idPrefix}shadow)"/>`,
    `<rect x="${r(x + PAD_X)}" y="${r(y + PAD_Y)}" width="36" height="36" rx="4" fill="${typeColor(node.type)}"/>`,
    techIcon(node.techStack, x + PAD_X + 8, y + PAD_Y + 8, 20, '#ffffff', node.type),
    text(textX, y + PAD_Y + 15, fit(node.name, textMax, 14, true), { size: 14, weight: 600, fill: GRAY.name }),
    text(textX, y + PAD_Y + 32, fit(node.techStack, textMax, 12), { size: 12, fill: GRAY.tech }),
    node.ownerTeam ? text(x + PAD_X, y + PAD_Y + 60, fit(`Team: ${node.ownerTeam}`, width - PAD_X * 2, 12), { size: 12, fill: GRAY.team }) : '',
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
    `<rect x="${r(x + 1)}" y="${r(y + 1)}" width="${r(p.width - 2)}" height="${r(p.height - 2)}" rx="8" fill="${TAILWIND_HEX['bg-yellow-100']}" stroke="${TAILWIND_HEX['border-yellow-300']}" stroke-width="2"/>`,
    techIcon('Sticky Note', x + 18, y + 20, 16, TAILWIND_HEX['text-yellow-600']),
    text(x + 42, y + 33, fit(p.node.name, p.width - 60, 14), { size: 14, weight: 500, fill: TAILWIND_HEX['text-yellow-800'] }),
    ...(p.lines ?? []).map((line, i) => text(x + 18, y + 61 + i * NOTE_LINE, line, { size: NOTE_FONT, fill: GRAY.body })),
    '</g>',
  ].join('\n');
}

/** React Flow's default (bezier) edge from the source's bottom to the target's top, label at its middle. */
function drawEdge(id: string, label: string | undefined, sx: number, sy: number, tx: number, ty: number, idPrefix: string): string {
  const offset = (d: number) => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const c1y = sy + offset(ty - sy);
  const c2y = ty - offset(ty - sy);
  const out = [
    `<g data-edge="${esc(id)}">`,
    `<path d="M${r(sx)},${r(sy)} C${r(sx)},${r(c1y)} ${r(tx)},${r(c2y)} ${r(tx)},${r(ty)}" fill="none" stroke="${EDGE}" stroke-width="1.5" marker-end="url(#${idPrefix}arrow)"/>`,
  ];
  if (label) {
    const cx = sx * 0.125 + sx * 0.375 + tx * 0.375 + tx * 0.125;
    const cy = sy * 0.125 + c1y * 0.375 + c2y * 0.375 + ty * 0.125;
    const shown = fit(label, 200, 11);
    const w = textWidth(shown, 11) + 8;
    out.push(
      `<rect x="${r(cx - w / 2)}" y="${r(cy - 9)}" width="${r(w)}" height="18" rx="2" fill="#ffffff"/>`,
      text(cx, cy + 4, shown, { size: 11, fill: GRAY.name, anchor: 'middle' }),
    );
  }
  out.push('</g>');
  return out.join('\n');
}
