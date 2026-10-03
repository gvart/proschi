import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Diagram, DiagramNode } from '../proschi';
import { ACCENT, COLORS, esc, fit, marker, r, svgDocument, text, textWidth, wrap } from './svg';

/**
 * The architecture as SVG: ELK's layered layout (as in the web editor, but
 * left to right), boxes with name, tech and team, dashed group rectangles and
 * labelled connections.
 */

const MARGIN = 24;
const NODE_MIN = 150;
const NODE_MAX = 260;
const NOTE_WIDTH = 220;
const LABEL_SIZE = 11;

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.spacing.edgeLabel': '4',
  'elk.spacing.componentComponent': '56',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  // Every coordinate in the result is absolute, so nothing needs offsetting.
  'elk.json.shapeCoords': 'ROOT',
  'elk.json.edgeCoords': 'ROOT',
};

const GROUP_OPTIONS = {
  'elk.padding': '[top=44,left=20,bottom=20,right=20]',
  'elk.nodeSize.constraints': 'MINIMUM_SIZE',
  'elk.nodeSize.minimum': '(200, 100)',
};

let elk: { layout: (graph: ElkNode) => Promise<ElkNode> } | undefined;

interface Box {
  width: number;
  height: number;
  lines: string[];
}

function nodeBox(node: DiagramNode): Box {
  if (node.kind === 'text') {
    const lines = wrap(node.description ?? node.name, NOTE_WIDTH - 24, 12, 6);
    return { width: NOTE_WIDTH, height: 24 + lines.length * 16, lines };
  }
  const parts = [node.name, node.implicit ? '' : `[${node.techStack}]`, node.ownerTeam ? `@${node.ownerTeam}` : ''];
  const width = Math.min(NODE_MAX, Math.max(NODE_MIN, textWidth(parts[0], 14, true) + 32, textWidth(parts[1], 12) + 32, textWidth(parts[2], 12) + 32));
  return { width, height: node.implicit ? 44 : node.ownerTeam ? 74 : 58, lines: parts };
}

function isAncestor(byId: Map<string, DiagramNode>, ancestor: string, id: string): boolean {
  for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) if (p === ancestor) return true;
  return false;
}

export async function renderArchitectureSvg(diagram: Diagram, idPrefix = ''): Promise<string> {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const boxes = new Map(diagram.nodes.filter((n) => n.kind !== 'group').map((n) => [n.id, nodeBox(n)]));
  const elkNodes = new Map<string, ElkNode>();
  for (const node of diagram.nodes) {
    const box = boxes.get(node.id);
    elkNodes.set(node.id, node.kind === 'group' ? { id: node.id, children: [], layoutOptions: GROUP_OPTIONS } : { id: node.id, width: box!.width, height: box!.height });
  }
  const roots: ElkNode[] = [];
  for (const node of diagram.nodes) {
    const parent = node.parent ? elkNodes.get(node.parent) : undefined;
    (parent?.children ?? roots).push(elkNodes.get(node.id)!);
  }
  for (const n of elkNodes.values()) {
    if (n.children?.length === 0) Object.assign(n, { width: 200, height: 100 });
  }

  // Connections are drawn; use case steps only steer the layout, as in the editor.
  const edges: ElkExtendedEdge[] = [];
  const drawn = new Map<string, (typeof diagram.edges)[number]>();
  const pairs = new Set<string>();
  const add = (source: string, target: string, label?: string, edgeId?: string) => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    if (isAncestor(byId, source, target) || isAncestor(byId, target, source)) return;
    const key = `${source}\u0000${target}`;
    if (!edgeId && pairs.has(key)) return;
    pairs.add(key);
    const id = edgeId ?? `layout${edges.length}`;
    edges.push({
      id,
      sources: [source],
      targets: [target],
      labels: label ? [{ text: label, width: textWidth(fit(label, 180, LABEL_SIZE), LABEL_SIZE) + 8, height: 16 }] : undefined,
    });
  };
  diagram.edges.forEach((e, i) => {
    drawn.set(`edge${i}`, e);
    add(e.source, e.target, e.label, `edge${i}`);
  });
  diagram.useCases.forEach((uc) => uc.scenarios.forEach((s) => s.steps.forEach((step) => add(step.fromServiceId, step.toServiceId))));

  elk ??= new ELK();
  const result = await elk.layout({ id: 'root', layoutOptions: ROOT_OPTIONS, children: roots, edges });

  const placed = new Map<string, ElkNode>();
  const collect = (nodes: ElkNode[] | undefined) =>
    nodes?.forEach((n) => {
      placed.set(n.id, n);
      collect(n.children);
    });
  collect(result.children);

  const width = (result.width ?? 0) + MARGIN * 2;
  const height = (result.height ?? 0) + MARGIN * 2;
  const at = (n: number) => n + MARGIN;
  const body: string[] = [];

  // Groups first (outermost first), so nested groups and nodes draw on top.
  const depth = (n: DiagramNode): number => (n.parent && byId.has(n.parent) ? depth(byId.get(n.parent)!) + 1 : 0);
  for (const group of diagram.nodes.filter((n) => n.kind === 'group').sort((a, b) => depth(a) - depth(b))) {
    const b = placed.get(group.id);
    if (!b) continue;
    const style = group.techStack && group.techStack !== 'Logical Group' ? `[${group.techStack}]` : '';
    body.push(
      `<g data-node="${esc(group.id)}" data-kind="group">`,
      `<rect x="${r(at(b.x!))}" y="${r(at(b.y!))}" width="${r(b.width!)}" height="${r(b.height!)}" rx="10" fill="${COLORS.groupFill}" stroke="${COLORS.group}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      text(at(b.x!) + 14, at(b.y!) + 22, fit(group.name, b.width! - 28, 13, true), { size: 13, weight: 600, fill: COLORS.badge }),
      style ? text(at(b.x!) + 14, at(b.y!) + 36, fit(style, b.width! - 28, 11), { size: 11, fill: COLORS.muted }) : '',
      '</g>',
    );
  }

  for (const edge of result.edges ?? []) {
    const source = drawn.get(edge.id);
    const section = edge.sections?.[0];
    if (!source || !section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${r(at(p.x))},${r(at(p.y))}`).join(' ');
    body.push(`<g data-edge="${esc(source.id)}">`, `<path d="${d}" fill="none" stroke="${COLORS.line}" stroke-width="1.5" marker-end="url(#${idPrefix}arrow)"/>`);
    const label = edge.labels?.[0];
    if (label && source.label) {
      const shown = fit(source.label, 180, LABEL_SIZE);
      body.push(
        `<rect x="${r(at(label.x!))}" y="${r(at(label.y!))}" width="${r(label.width!)}" height="${r(label.height!)}" rx="3" fill="${COLORS.background}" opacity="0.9"/>`,
        text(at(label.x!) + label.width! / 2, at(label.y!) + 12, shown, { size: LABEL_SIZE, fill: COLORS.muted, anchor: 'middle' }),
      );
    }
    body.push('</g>');
  }

  for (const node of diagram.nodes) {
    const b = placed.get(node.id);
    const box = boxes.get(node.id);
    if (!b || !box) continue;
    const x = at(b.x!);
    const y = at(b.y!);
    if (node.kind === 'text') {
      body.push(
        `<g data-node="${esc(node.id)}" data-kind="text">`,
        `<rect x="${r(x)}" y="${r(y)}" width="${r(box.width)}" height="${r(box.height)}" rx="4" fill="${COLORS.noteFill}" stroke="${COLORS.noteBorder}"/>`,
        ...box.lines.map((line, i) => text(x + 12, y + 22 + i * 16, line, { size: 12 })),
        '</g>',
      );
      continue;
    }
    const accent = ACCENT[node.type] ?? COLORS.line;
    const cx = x + box.width / 2;
    const [name, tech, team] = box.lines;
    const max = box.width - 20;
    body.push(
      `<g data-node="${esc(node.id)}" data-kind="${esc(node.type)}">`,
      `<rect x="${r(x)}" y="${r(y)}" width="${r(box.width)}" height="${r(box.height)}" rx="8" fill="${COLORS.background}" stroke="${node.implicit ? COLORS.border : accent}" stroke-width="1.5"/>`,
      node.implicit ? '' : `<rect x="${r(x + 1)}" y="${r(y + 6)}" width="3" height="${r(box.height - 12)}" rx="1.5" fill="${accent}"/>`,
      text(cx, y + (node.implicit ? 27 : 24), fit(name, max, 14, true), { size: 14, weight: 600, anchor: 'middle' }),
      tech ? text(cx, y + 42, fit(tech, max, 12), { size: 12, fill: COLORS.muted, anchor: 'middle' }) : '',
      team ? text(cx, y + 60, fit(team, max, 12), { size: 12, fill: accent, anchor: 'middle' }) : '',
      '</g>',
    );
  }

  if (diagram.nodes.length === 0) body.push(text(MARGIN, MARGIN + 16, 'Empty diagram', { fill: COLORS.muted }));
  return svgDocument(
    Math.max(width, 200),
    Math.max(height, 64),
    diagram.title ?? 'Architecture',
    body.filter(Boolean),
    marker(`${idPrefix}arrow`, COLORS.line),
  );
}
