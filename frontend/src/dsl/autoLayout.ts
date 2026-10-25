import type { ElkEdgeSection, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Diagram, DiagramNode } from './types';

/**
 * ELK auto-layout of a diagram, free of React Flow so the canvas
 * (layout.ts) and the static renderer (`proschi render`) place every node and
 * route every edge exactly the same way.
 */

// The canvas cards' rendered sizes (ComponentNode), so edge routes end on their borders.
const COMPONENT_SIZE = { width: 240, height: 60 };
const COMPONENT_WITH_TEAM_SIZE = { width: 240, height: 84 };
const TEXT_SIZE = { width: 240, height: 110 };

/** Edge labels: the canvas draws them in 11px JetBrains Mono on a padded chip. */
const LABEL_CHAR_WIDTH = 6.7;
const LABEL_PAD = 12;
const LABEL_HEIGHT = 18;

/** Labels sit on their edge (the chip covers the line), as on the canvas, not beside it. */
const INLINE_LABEL = { 'elk.edgeLabels.inline': 'true' };

/** Space kept between a group's edge and a member that was dragged near it. */
const GROUP_MARGIN = 24;

/** Where edges flow. Only DOWN is used today; the per-graph and per-group hints will choose others. */
export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

/** Settings that may differ per diagram and per group (later: `direction` and `rank` hints). */
export interface LayoutOptions {
  direction?: LayoutDirection;
  /** Per-group overrides, by group id. */
  groups?: Record<string, { direction?: LayoutDirection }>;
  /** Raw ELK options over the defaults, for trying engine settings in the metrics harness. */
  elk?: Record<string, string>;
}

// ELK reads spacing from each container, so groups repeat it.
const SPACING = {
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.edgeLabel': '4',
  'elk.layered.spacing.nodeNodeBetweenLayers': '40',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
};

function rootOptions(options: LayoutOptions): Record<string, string> {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': options.direction ?? 'DOWN',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    ...SPACING,
    'elk.spacing.componentComponent': '72',
    // Declaration order steers the layout: what comes first goes first, and breaks ties.
    'elk.layered.considerModelOrder.strategy': 'PREFER_NODES',
    'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.thoroughness': '100',
    // Straighter, shorter edges than BRANDES_KOEPF on big graphs.
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
    'elk.layered.nodePlacement.networkSimplex.nodeFlexibility.default': 'PORT_POSITION',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.unnecessaryBendpoints': 'false',
    ...options.elk,
  };
}

function groupOptions(options: LayoutOptions, id: string): Record<string, string> {
  const direction = options.groups?.[id]?.direction;
  return {
    // Matches GroupNode's minimum size so the drawn box and the layout agree.
    'elk.padding': '[top=56,left=24,bottom=24,right=24]',
    'elk.nodeSize.constraints': 'MINIMUM_SIZE',
    'elk.nodeSize.minimum': '(300, 200)',
    ...SPACING,
    ...(direction ? { 'elk.direction': direction } : {}),
  };
}

/** What layoutBoxes needs from ELK: the bundled engine, or one running in a Web Worker (layout.ts). */
export type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
let elkPromise: Promise<ElkInstance> | undefined;

/** ELK on the calling thread. It is large, so it is loaded on first use and kept out of the main bundle. */
export function bundledElk(): Promise<ElkInstance> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  return elkPromise;
}

export interface Point {
  x: number;
  y: number;
}

export interface LaidOutNode {
  id: string;
  /** Top-left corner, relative to the enclosing group when there is one. */
  position: Point;
  width: number;
  /** ELK's height; components are measured by the canvas, so theirs is only nominal. */
  height: number;
  /** The enclosing group, when it exists. */
  parent?: string;
}

/**
 * An edge's orthogonal route, in absolute canvas coordinates: from a point on
 * the source's border, through every bend, to a point on the target's border.
 * `from` and `to` are the absolute top-left corners of the two nodes it was
 * routed for, so a drawing can tell when a node has moved since and the route
 * no longer fits.
 */
export interface EdgeRoute {
  points: Point[];
  /** Centre of the label, placed by ELK in space it kept free. */
  label?: Point;
  from: Point;
  to: Point;
}

export interface Layout {
  nodes: LaidOutNode[];
  /** Routes by diagram edge id; edges without one (pinned or moved ends) are drawn by a fallback. */
  routes: Record<string, EdgeRoute>;
}

/** Positions every node (see layoutDiagram); the edge routes are dropped. */
export async function layoutBoxes(diagram: Diagram, getElk: () => Promise<ElkInstance> = bundledElk): Promise<LaidOutNode[]> {
  return (await layoutGraph(diagram, getElk)).nodes;
}

/**
 * Positions every node with ELK's layered algorithm and routes every edge
 * orthogonally around them. Groups become containers sized around their
 * members, and an explicit `pos x,y` wins over the layout. Use case steps
 * between nodes that no edge connects count as connections, so flows lay out
 * sensibly even when the architecture declares no edges. `getElk` picks the
 * ELK engine (default: bundled, on this thread).
 */
export async function layoutGraph(diagram: Diagram, getElk: () => Promise<ElkInstance> = bundledElk, options: LayoutOptions = {}): Promise<Layout> {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const elkNodes = new Map<string, ElkNode>();

  for (const node of diagram.nodes) {
    const size = node.kind === 'group' ? {} : node.kind === 'text' ? TEXT_SIZE : node.ownerTeam ? COMPONENT_WITH_TEAM_SIZE : COMPONENT_SIZE;
    elkNodes.set(node.id, {
      id: node.id,
      ...size,
      children: node.kind === 'group' ? [] : undefined,
      layoutOptions: node.kind === 'group' ? groupOptions(options, node.id) : undefined,
    });
  }

  const roots: ElkNode[] = [];
  for (const node of diagram.nodes) {
    const elkNode = elkNodes.get(node.id)!;
    const parent = node.parent ? elkNodes.get(node.parent) : undefined;
    if (parent?.children) parent.children.push(elkNode);
    else roots.push(elkNode);
  }

  // Empty groups still need a visible size.
  for (const node of elkNodes.values()) {
    if (node.children && node.children.length === 0) {
      node.width = 300;
      node.height = 200;
    }
  }

  const connected = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const edges: ElkExtendedEdge[] = [];
  const canConnect = (source: string, target: string) =>
    source !== target &&
    byId.has(source) &&
    byId.has(target) &&
    // ELK rejects edges between a group and its own members.
    !isAncestor(byId, source, target) &&
    !isAncestor(byId, target, source);

  for (const e of diagram.edges) {
    if (!canConnect(e.source, e.target)) continue;
    connected.add(pair(e.source, e.target));
    const labels = e.label ? [{ text: e.label, width: Math.ceil(e.label.length * LABEL_CHAR_WIDTH + LABEL_PAD), height: LABEL_HEIGHT, layoutOptions: INLINE_LABEL }] : undefined;
    edges.push({ id: e.id, sources: [e.source], targets: [e.target], ...(labels ? { labels } : {}) });
  }
  // A step only shapes the layout between nodes no edge connects, and once
  // per pair: the reply going back must not pull the two apart.
  for (const uc of diagram.useCases) {
    for (const s of uc.steps) {
      const key = pair(s.fromServiceId, s.toServiceId);
      if (connected.has(key) || !canConnect(s.fromServiceId, s.toServiceId)) continue;
      connected.add(key);
      edges.push({ id: `step\u0000${edges.length}`, sources: [s.fromServiceId], targets: [s.toServiceId] });
    }
  }

  const reversed = orientEdges(edges, new Map(diagram.nodes.map((n, i) => [n.id, i])));

  const elk = await getElk();
  const result = await elk.layout({ id: 'root', layoutOptions: rootOptions(options), children: roots, edges });

  // ELK's absolute positions, before `pos` overrides any of them.
  const placed = new Map<string, ElkNode>();
  const elkAbsolute = new Map<string, Point>([['root', { x: 0, y: 0 }]]);
  const collect = (nodes: ElkNode[] | undefined, origin: Point) =>
    nodes?.forEach((n) => {
      placed.set(n.id, n);
      const at = { x: origin.x + (n.x ?? 0), y: origin.y + (n.y ?? 0) };
      elkAbsolute.set(n.id, at);
      collect(n.children, at);
    });
  collect(result.children, { x: 0, y: 0 });

  const boxes = diagram.nodes.map((node): LaidOutNode => {
    const box = placed.get(node.id);
    return {
      id: node.id,
      position: node.position ?? { x: box?.x ?? 0, y: box?.y ?? 0 },
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      ...(node.parent && byId.has(node.parent) ? { parent: node.parent } : {}),
    };
  });
  growGroupsAroundMembers(boxes, byId);

  // Where every node really ends up, so routes whose ends were pinned elsewhere are dropped.
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const finalAbsolute = (id: string): Point => {
    const b = boxById.get(id)!;
    const origin = b.parent ? finalAbsolute(b.parent) : { x: 0, y: 0 };
    return { x: origin.x + b.position.x, y: origin.y + b.position.y };
  };
  const unmoved = (id: string) => {
    const a = elkAbsolute.get(id);
    const b = finalAbsolute(id);
    return !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  };

  const boxAt = (id: string) => ({ ...elkAbsolute.get(id)!, width: placed.get(id)?.width ?? 0, height: placed.get(id)?.height ?? 0 });
  const routes: Record<string, EdgeRoute> = {};
  for (const edge of result.edges ?? []) {
    const sections = edge.sections ?? [];
    const flipped = reversed.has(edge.id);
    const [source, target] = flipped ? [edge.targets[0], edge.sources[0]] : [edge.sources[0], edge.targets[0]];
    if (edge.id.startsWith('step\u0000') || sections.length === 0 || !unmoved(source) || !unmoved(target)) continue;
    const origin = elkAbsolute.get((edge as ElkExtendedEdge & { container?: string }).container ?? 'root') ?? { x: 0, y: 0 };
    const shift = (p: Point) => ({ x: origin.x + p.x, y: origin.y + p.y });
    const label = edge.labels?.[0];
    routes[edge.id] = {
      points: dropJogs(simplify(flipped ? sectionPoints(sections).map(shift).reverse() : sectionPoints(sections).map(shift)), boxAt(source), boxAt(target)),
      ...(label?.x !== undefined && label.y !== undefined ? { label: shift({ x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }) } : {}),
      from: elkAbsolute.get(source)!,
      to: elkAbsolute.get(target)!,
    };
  }
  return { nodes: boxes, routes };
}

/**
 * Breaks cycles by declaration order before ELK sees them: an edge that closes
 * a cycle and points at a node declared earlier is handed to ELK reversed, so
 * the node declared first sits higher and the edge is routed as a short hop up
 * instead of ELK's own feedback routing, which loops around whole groups when
 * the edge crosses them. Edges outside cycles keep their direction whatever
 * the order. Returns the ids of the reversed edges; their routes are turned
 * back afterwards.
 */
function orientEdges(edges: ElkExtendedEdge[], order: Map<string, number>): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.sources[0], [...(out.get(e.sources[0]) ?? []), e.targets[0]]);
  const reaches = (from: string, to: string) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      for (const next of out.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  const reversed = new Set<string>();
  for (const e of edges) {
    const [source, target] = [e.sources[0], e.targets[0]];
    if ((order.get(target) ?? 0) < (order.get(source) ?? 0) && reaches(target, source)) reversed.add(e.id);
  }
  for (const e of edges) {
    if (reversed.has(e.id)) [e.sources, e.targets] = [e.targets, e.sources];
  }
  return reversed;
}

/** The sections of a routed edge joined into one polyline. */
function sectionPoints(sections: ElkEdgeSection[]): Point[] {
  const points: Point[] = [];
  for (const s of sections) {
    for (const p of [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]) {
      const last = points[points.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) points.push({ x: p.x, y: p.y });
    }
  }
  return points;
}

/** Drops points that do not turn (on a straight run), so every inner point is a bend. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (b && Math.abs(b.x - p.x) < 0.01 && Math.abs(b.y - p.y) < 0.01) continue;
    if (a && b && Math.abs((b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x)) < 0.01) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * ELK sometimes ends a route with a jog of a few pixels just before a node
 * (where ports are spread out); slide that last (or first) leg over so the
 * line runs straight in, as long as it still meets the node's side.
 */
function dropJogs(points: Point[], source: Box, target: Box): Point[] {
  const JOG = 10;
  const MARGIN = 6;
  const fix = (pts: Point[], box: Box): Point[] => {
    const n = pts.length;
    if (n < 4) return pts;
    const [a, b, c, d] = pts.slice(n - 4);
    const vertical = Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - b.x) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    const horizontal = Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    if (vertical && Math.abs(b.x - c.x) < JOG && b.x > box.x + MARGIN && b.x < box.x + box.width - MARGIN) {
      return simplify([...pts.slice(0, n - 3), { x: b.x, y: d.y }]);
    }
    if (horizontal && Math.abs(b.y - c.y) < JOG && b.y > box.y + MARGIN && b.y < box.y + box.height - MARGIN) {
      return simplify([...pts.slice(0, n - 3), { x: d.x, y: b.y }]);
    }
    return pts;
  };
  return fix(fix(points, target).reverse(), source).reverse();
}

type Box = Point & { width: number; height: number };

/**
 * ELK sizes groups for its own placement; members pinned with `pos` can sit
 * outside that box, so grow each group (innermost first) until it contains them.
 */
function growGroupsAroundMembers(boxes: LaidOutNode[], byId: Map<string, DiagramNode>) {
  const depth = (b: LaidOutNode): number => {
    const parent = boxes.find((p) => p.id === b.parent);
    return parent ? depth(parent) + 1 : 0;
  };
  const groups = boxes.filter((b) => byId.get(b.id)?.kind === 'group').sort((a, b) => depth(b) - depth(a));
  for (const group of groups) {
    for (const member of boxes.filter((b) => b.parent === group.id)) {
      group.width = Math.max(group.width, member.position.x + member.width + GROUP_MARGIN);
      group.height = Math.max(group.height, member.position.y + member.height + GROUP_MARGIN);
    }
  }
}

function isAncestor(byId: Map<string, DiagramNode>, ancestor: string, id: string): boolean {
  for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) {
    if (p === ancestor) return true;
  }
  return false;
}
