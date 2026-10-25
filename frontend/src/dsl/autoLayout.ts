import type { ElkEdgeSection, ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Diagram, DiagramNode, LayoutDirection as LayoutHintDirection, Rank } from './types';

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

/** Where edges flow, in ELK's terms. */
export type LayoutDirection = 'DOWN' | 'RIGHT' | 'UP' | 'LEFT';

/** Settings that may differ per diagram and per group; they override the document's layout hints. */
export interface LayoutOptions {
  direction?: LayoutDirection;
  /** Per-group overrides, by group id. */
  groups?: Record<string, { direction?: LayoutDirection }>;
  /** Lay every edge out by declaration order (`layout ordered`). */
  ordered?: boolean;
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

/** `interactive`: the top level is layered by rank hints; `ranked`: some container is, and compaction would undo it. */
function rootOptions(options: LayoutOptions, interactive = false, ranked = false): Record<string, string> {
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
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.unnecessaryBendpoints': 'false',
    ...(interactive ? INTERACTIVE_LAYERING : {}),
    // Compaction slides nodes along the flow, out of the layer their rank put them in.
    ...(ranked ? { 'elk.layered.compaction.postCompaction.strategy': 'NONE' } : {}),
    ...options.elk,
  };
}

const vertical = (direction: LayoutDirection = 'DOWN') => direction === 'DOWN' || direction === 'UP';

/** Padding inside a group (matches GroupNode), and its smallest drawn size. */
const GROUP_PAD = { top: 56, left: 24, side: 24 };
const GROUP_MIN = { width: 300, height: 200 };

function groupOptions(options: LayoutOptions): Record<string, string> {
  return {
    // Matches GroupNode's minimum size so the drawn box and the layout agree.
    'elk.padding': '[top=56,left=24,bottom=24,right=24]',
    'elk.nodeSize.constraints': 'MINIMUM_SIZE',
    // ELK applies this before turning its left-to-right layout to vertical, so a vertical layout needs it transposed.
    'elk.nodeSize.minimum': vertical(options.direction) ? '(200, 300)' : '(300, 200)',
    ...SPACING,
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
 *
 * The document's layout hints steer it (docs/LANGUAGE.md, "Steering the
 * layout"): `direction` turns the flow, `rank` pins nodes to a layer and
 * `layout ordered` lays every edge out by declaration order. Without them
 * the layout is exactly what it was before they existed.
 */
export async function layoutGraph(diagram: Diagram, getElk: () => Promise<ElkInstance> = bundledElk, options: LayoutOptions = {}): Promise<Layout> {
  const { nodes, routes } = await layoutLevel(diagram, getElk, {
    ...options,
    direction: options.direction ?? elkDirection(diagram.layout?.direction),
    ordered: options.ordered ?? diagram.layout?.ordered,
  });
  return { nodes, routes };
}

const elkDirection = (direction: LayoutHintDirection | undefined): LayoutDirection | undefined => direction?.toUpperCase() as LayoutDirection | undefined;

/** A layout, plus the nodes that are where ELK put them (not moved by a `pos`), so routes to them hold. */
interface Level extends Layout {
  unmoved: Set<string>;
}

/** An edge as handed to ELK; an end on a group laid out on its own goes through a port on its border. */
interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** The member inside a separately laid-out `source` group that the edge really starts at. */
  sourceMember?: string;
  targetMember?: string;
  labels?: ElkExtendedEdge['labels'];
}

type Side = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST';

/** A group laid out on its own (its direction differs from the flow around it). */
interface Separate {
  level: Level;
  /** Where its layout's origin sits inside the group's box. */
  offset: Point;
  width: number;
  height: number;
  /** Member boxes relative to the group's top-left, by id. */
  members: Map<string, Box>;
  /** The members that are not groups, which an edge into the group must not cross. */
  leaves: (Box & { id: string })[];
}

async function layoutLevel(diagram: Diagram, getElk: () => Promise<ElkInstance>, options: LayoutOptions): Promise<Level> {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const parentOf = (id: string) => {
    const p = byId.get(id)?.parent;
    return p && byId.has(p) ? p : undefined;
  };
  const flow = options.direction ?? 'DOWN';

  // A group whose own direction differs from the flow around it is laid out on
  // its own, then placed as one box: ELK gives every group the root's direction.
  const ownDirection = (id: string) => (byId.get(id)?.kind === 'group' ? (options.groups?.[id]?.direction ?? elkDirection(byId.get(id)!.direction)) : undefined);
  const flowAt = (id: string | undefined): LayoutDirection => (id === undefined ? flow : (ownDirection(id) ?? flowAt(parentOf(id))));
  const hasMembers = new Set(diagram.nodes.map((n) => parentOf(n.id)));
  const isSeparate = (id: string) => hasMembers.has(id) && ownDirection(id) !== undefined && ownDirection(id) !== flowAt(parentOf(id));
  /** The node itself, or the outermost separately laid-out group around it. */
  const carrierOf = (id: string): string => {
    let carrier = id;
    for (let p = parentOf(id); p; p = parentOf(p)) if (isSeparate(p)) carrier = p;
    return carrier;
  };

  const separate = new Map<string, Separate>();
  for (const group of diagram.nodes.filter((n) => isSeparate(n.id) && carrierOf(n.id) === n.id)) {
    const inside = diagram.nodes.filter((n) => isAncestor(byId, group.id, n.id));
    const ids = new Set(inside.map((n) => n.id));
    // The group's direct members become the sub-layout's top level: their parent is not in it.
    const sub: Diagram = { ...diagram, nodes: inside, edges: diagram.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    const level = await layoutLevel(sub, getElk, { ...options, direction: ownDirection(group.id) });
    const rects = absoluteBoxes(level.nodes);
    // Sized around what the layout placed; members pinned with `pos` are grown around later.
    const top = level.nodes.filter((b) => !b.parent);
    const free = top.filter((b) => !byId.get(b.id)?.position);
    const points = Object.values(level.routes).flatMap((r) => r.points);
    const xs = [...(free.length ? free : top).flatMap((b) => [b.position.x, b.position.x + b.width]), ...points.map((p) => p.x)];
    const ys = [...(free.length ? free : top).flatMap((b) => [b.position.y, b.position.y + b.height]), ...points.map((p) => p.y)];
    const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
    const offset = { x: GROUP_PAD.left - minX, y: GROUP_PAD.top - minY };
    const members = new Map<string, Box>();
    for (const [id, r] of rects) members.set(id, { x: r.x + offset.x, y: r.y + offset.y, width: r.width, height: r.height });
    separate.set(group.id, {
      level,
      offset,
      members,
      leaves: [...members.entries()].filter(([id]) => byId.get(id)?.kind !== 'group').map(([id, b]) => ({ id, ...b })),
      width: Math.max(GROUP_MIN.width, Math.max(...xs) - minX + GROUP_PAD.left + GROUP_PAD.side),
      height: Math.max(GROUP_MIN.height, Math.max(...ys) - minY + GROUP_PAD.top + GROUP_PAD.side),
    });
  }

  const inMain = (id: string) => carrierOf(id) === id;
  const mainNodes = diagram.nodes.filter((n) => inMain(n.id));
  const elkNodes = new Map<string, ElkNode>();
  for (const node of mainNodes) {
    const own = separate.get(node.id);
    if (own) {
      elkNodes.set(node.id, { id: node.id, width: own.width, height: own.height, ports: [], layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } });
      continue;
    }
    const size = node.kind === 'group' ? {} : node.kind === 'text' ? TEXT_SIZE : node.ownerTeam ? COMPONENT_WITH_TEAM_SIZE : COMPONENT_SIZE;
    elkNodes.set(node.id, {
      id: node.id,
      ...size,
      children: node.kind === 'group' ? [] : undefined,
      layoutOptions: node.kind === 'group' ? groupOptions(options) : undefined,
    });
  }

  const roots: ElkNode[] = [];
  for (const node of mainNodes) {
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
  const edges: LayoutEdge[] = [];
  const canConnect = (source: string, target: string) =>
    source !== target &&
    byId.has(source) &&
    byId.has(target) &&
    // ELK rejects edges between a group and its own members.
    !isAncestor(byId, source, target) &&
    !isAncestor(byId, target, source);
  /** The edge between the carriers of its ends; inside one separately laid-out group it belongs to that group's layout. */
  const toLayoutEdge = (id: string, from: string, to: string, labels?: ElkExtendedEdge['labels']): LayoutEdge | undefined => {
    const [source, target] = [carrierOf(from), carrierOf(to)];
    if (!canConnect(source, target)) return undefined;
    return { id, source, target, ...(separate.has(source) ? { sourceMember: from } : {}), ...(separate.has(target) ? { targetMember: to } : {}), ...(labels ? { labels } : {}) };
  };

  for (const e of diagram.edges) {
    if (!canConnect(e.source, e.target)) continue;
    connected.add(pair(e.source, e.target));
    const labels = e.label ? [{ text: e.label, width: Math.ceil(e.label.length * LABEL_CHAR_WIDTH + LABEL_PAD), height: LABEL_HEIGHT, layoutOptions: INLINE_LABEL }] : undefined;
    const edge = toLayoutEdge(e.id, e.source, e.target, labels);
    if (edge) edges.push(edge);
  }
  // A step only shapes the layout between nodes no edge connects, and once
  // per pair: the reply going back must not pull the two apart.
  for (const uc of diagram.useCases) {
    for (const s of uc.steps) {
      const key = pair(s.fromServiceId, s.toServiceId);
      if (connected.has(key) || !canConnect(s.fromServiceId, s.toServiceId)) continue;
      connected.add(key);
      const edge = toLayoutEdge(`step\u0000${edges.length}`, s.fromServiceId, s.toServiceId);
      if (edge) edges.push(edge);
    }
  }

  const reversed = orientEdges(edges, new Map(diagram.nodes.map((n, i) => [n.id, i])), !!options.ordered);
  const interactive = rankLayers(mainNodes, edges, reversed, elkNodes, parentOf, flow);
  // After rankLayers, which may turn edges: a port's side depends on which way its edge runs.
  const ports = attachPorts(edges, separate, elkNodes, flow);

  const elkEdges: ElkExtendedEdge[] = edges.map((e) => ({
    id: e.id,
    sources: [ports.get(`${e.id}\u0000source`) ?? e.source],
    targets: [ports.get(`${e.id}\u0000target`) ?? e.target],
    ...(e.labels ? { labels: e.labels } : {}),
  }));

  const elk = await getElk();
  const result = await elk.layout({ id: 'root', layoutOptions: rootOptions(options, interactive.has(undefined), interactive.size > 0), children: roots, edges: elkEdges });

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

  // Members of a separately laid-out group keep their places inside it.
  const inner = new Map<string, LaidOutNode>();
  for (const [group, own] of separate) {
    for (const b of own.level.nodes) {
      const direct = !b.parent;
      const pinned = byId.get(b.id)?.position;
      inner.set(b.id, direct ? { ...b, position: pinned ?? { x: b.position.x + own.offset.x, y: b.position.y + own.offset.y }, parent: group } : b);
    }
  }
  const boxes = diagram.nodes.map((node): LaidOutNode => {
    const nested = inner.get(node.id);
    if (nested) return nested;
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
  const unmovedInMain = (id: string) => {
    const a = elkAbsolute.get(id);
    const b = finalAbsolute(id);
    return !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  };
  const unmoved = new Set(mainNodes.map((n) => n.id).filter(unmovedInMain));
  for (const [group, own] of separate) {
    if (!unmoved.has(group)) continue;
    for (const id of own.level.unmoved) unmoved.add(id);
  }

  const boxAt = (id: string): Box => ({ ...elkAbsolute.get(id)!, width: placed.get(id)?.width ?? 0, height: placed.get(id)?.height ?? 0 });
  const titles = mainNodes.filter((n) => n.kind === 'group' && unmovedInMain(n.id)).map((n) => titleBand(boxAt(n.id), n.name));
  const routes: Record<string, EdgeRoute> = {};
  const byEdge = new Map(edges.map((e) => [e.id, e]));
  for (const edge of result.edges ?? []) {
    const sections = edge.sections ?? [];
    const layoutEdge = byEdge.get(edge.id)!;
    const flipped = reversed.has(edge.id);
    // The diagram's source and target, which a flipped edge had the other way round.
    const [source, target] = flipped ? [layoutEdge.target, layoutEdge.source] : [layoutEdge.source, layoutEdge.target];
    const [sourceMember, targetMember] = flipped ? [layoutEdge.targetMember, layoutEdge.sourceMember] : [layoutEdge.sourceMember, layoutEdge.targetMember];
    const [from, to] = [sourceMember ?? source, targetMember ?? target];
    if (edge.id.startsWith('step\u0000') || sections.length === 0 || !unmoved.has(source) || !unmoved.has(target) || !unmoved.has(from) || !unmoved.has(to)) continue;
    const origin = elkAbsolute.get((edge as ElkExtendedEdge & { container?: string }).container ?? 'root') ?? { x: 0, y: 0 };
    const shift = (p: Point) => ({ x: origin.x + p.x, y: origin.y + p.y });
    const label = edge.labels?.[0];
    let points = sectionPoints(sections).map(shift);
    if (flipped) points.reverse();
    // An end on a separately laid-out group runs on from the port to the member inside.
    const leg = (group: string, member: string, port: Point) => {
      const box = separate.get(group)!.members.get(member);
      const g = elkAbsolute.get(group)!;
      return box ? sidePoint({ x: g.x + box.x, y: g.y + box.y, width: box.width, height: box.height }, port) : port;
    };
    if (sourceMember && sourceMember !== source) points = [leg(source, sourceMember, points[0]), ...points];
    if (targetMember && targetMember !== target) points = [...points, leg(target, targetMember, points[points.length - 1])];
    points = simplify(points);
    if (!sourceMember && !targetMember) points = dropJogs(points, boxAt(source), boxAt(target));
    routes[edge.id] = {
      points: avoidTitles(points, titles),
      ...(label?.x !== undefined && label.y !== undefined ? { label: shift({ x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }) } : {}),
      from: finalAbsolute(from),
      to: finalAbsolute(to),
    };
  }
  // Routes inside a separately laid-out group move with it.
  for (const [group, own] of separate) {
    const g = finalAbsolute(group);
    const move = (p: Point) => ({ x: p.x + g.x + own.offset.x, y: p.y + g.y + own.offset.y });
    for (const [id, route] of Object.entries(own.level.routes)) {
      routes[id] = { points: route.points.map(move), ...(route.label ? { label: move(route.label) } : {}), from: move(route.from), to: move(route.to) };
    }
  }
  return { nodes: boxes, routes, unmoved };
}

/** Absolute boxes of a layout whose members are placed relative to their group. */
function absoluteBoxes(boxes: LaidOutNode[]): Map<string, Box> {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const out = new Map<string, Box>();
  const at = (b: LaidOutNode): Point => {
    const parent = b.parent ? byId.get(b.parent) : undefined;
    const origin = parent ? at(parent) : { x: 0, y: 0 };
    return { x: origin.x + b.position.x, y: origin.y + b.position.y };
  };
  for (const b of boxes) out.set(b.id, { ...at(b), width: b.width, height: b.height });
  return out;
}

/** The point on `box`'s border straight across from `port`, on the side facing it. */
function sidePoint(box: Box, port: Point): Point {
  const cx = Math.min(Math.max(port.x, box.x), box.x + box.width);
  const cy = Math.min(Math.max(port.y, box.y), box.y + box.height);
  if (port.y <= box.y) return { x: cx, y: box.y };
  if (port.y >= box.y + box.height) return { x: cx, y: box.y + box.height };
  if (port.x <= box.x) return { x: box.x, y: cy };
  return { x: box.x + box.width, y: cy };
}

const IN_SIDE: Record<LayoutDirection, Side> = { DOWN: 'NORTH', UP: 'SOUTH', RIGHT: 'WEST', LEFT: 'EAST' };
const OPPOSITE: Record<Side, Side> = { NORTH: 'SOUTH', SOUTH: 'NORTH', WEST: 'EAST', EAST: 'WEST' };
const ACROSS: Record<Side, Side[]> = { NORTH: ['WEST', 'EAST'], SOUTH: ['WEST', 'EAST'], WEST: ['NORTH', 'SOUTH'], EAST: ['NORTH', 'SOUTH'] };

/**
 * Gives every edge end on a separately laid-out group a fixed port on the
 * group's border, straight across from the member it really ends at: on the
 * side the flow comes in from (targets) or leaves by (sources), else another
 * side whose way in is not blocked by another member. Returns the port id by
 * `<edge id>\0source|target`.
 */
function attachPorts(edges: LayoutEdge[], separate: Map<string, Separate>, elkNodes: Map<string, ElkNode>, flow: LayoutDirection): Map<string, string> {
  const ids = new Map<string, string>();
  const shared = new Map<string, string>();
  const portFor = (group: string, member: string, role: 'source' | 'target') => {
    const own = separate.get(group)!;
    const preferred = role === 'target' ? IN_SIDE[flow] : OPPOSITE[IN_SIDE[flow]];
    const box = own.members.get(member) ?? { x: 0, y: 0, width: own.width, height: own.height };
    const others = own.leaves.filter((b) => b.id !== member);
    const clear = (side: Side) => !others.some((o) => blocks(o, box, side, own));
    const side = member === group ? preferred : ([preferred, ...ACROSS[preferred], OPPOSITE[preferred]].find(clear) ?? preferred);
    const key = `${group}\u0000${member}\u0000${side}`;
    let id = shared.get(key);
    if (!id) {
      id = `${group}\u0000port${shared.size}`;
      shared.set(key, id);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const at = side === 'NORTH' ? { x: cx, y: 0 } : side === 'SOUTH' ? { x: cx, y: own.height } : side === 'WEST' ? { x: 0, y: cy } : { x: own.width, y: cy };
      elkNodes.get(group)!.ports!.push({ id, ...at, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
    }
    return id;
  };
  for (const e of edges) {
    if (e.sourceMember !== undefined) ids.set(`${e.id}\u0000source`, portFor(e.source, e.sourceMember, 'source'));
    if (e.targetMember !== undefined) ids.set(`${e.id}\u0000target`, portFor(e.target, e.targetMember, 'target'));
  }
  return ids;
}

/** `other` stands between `box` and the group's `side` border. */
function blocks(other: Box, box: Box, side: Side, group: { width: number; height: number }): boolean {
  const overlapX = other.x < box.x + box.width / 2 && box.x + box.width / 2 < other.x + other.width;
  const overlapY = other.y < box.y + box.height / 2 && box.y + box.height / 2 < other.y + other.height;
  switch (side) {
    case 'NORTH':
      return overlapX && other.y < box.y && other.y + other.height > 0;
    case 'SOUTH':
      return overlapX && other.y + other.height > box.y + box.height && other.y < group.height;
    case 'WEST':
      return overlapY && other.x < box.x;
    case 'EAST':
      return overlapY && other.x + other.width > box.x + box.width;
  }
}

/** Positions far enough apart that ELK's interactive layering reads each layer as its own. */
const LAYER_STEP = 100_000;

/**
 * `rank` hints. In every container (the top level, or a group) where a child
 * has a rank, the children's layers are computed here and handed to ELK's
 * interactive layering as positions: children of one rank share a layer, a
 * lower rank sits higher (in the flow's direction), `first` and `last` are
 * the outermost layers, and the unranked children go where their edges pull
 * them. An edge that would run against these layers is reversed (and its
 * route turned back afterwards). Returns the containers laid out this way
 * (undefined for the top level).
 */
function rankLayers(
  nodes: DiagramNode[],
  edges: LayoutEdge[],
  reversed: Set<string>,
  elkNodes: Map<string, ElkNode>,
  parentOf: (id: string) => string | undefined,
  flow: LayoutDirection,
): Set<string | undefined> {
  const containers = new Set(nodes.filter((n) => n.rank !== undefined).map((n) => parentOf(n.id)));
  const rankOf = new Map(nodes.map((n) => [n.id, n.rank]));
  for (const container of containers) {
    const children = nodes.filter((n) => parentOf(n.id) === container).map((n) => n.id);
    const childOf = (id: string): string | undefined => {
      for (let a: string | undefined = id; a !== undefined; a = parentOf(a)) if (parentOf(a) === container) return a;
      return undefined;
    };
    const links = edges.flatMap((e) => {
      const [a, b] = [childOf(e.source), childOf(e.target)];
      return a !== undefined && b !== undefined && a !== b ? [{ edge: e, a, b }] : [];
    });
    const layers = assignLayers(children, links.map((l) => [l.a, l.b]), (id) => rankOf.get(id));
    for (const { edge, a, b } of links) {
      if (layers.get(a)! <= layers.get(b)!) continue;
      flipEdge(edge);
      if (reversed.has(edge.id)) reversed.delete(edge.id);
      else reversed.add(edge.id);
    }
    children.forEach((id, i) => {
      const along = layers.get(id)! * LAYER_STEP * (flow === 'UP' || flow === 'LEFT' ? -1 : 1);
      Object.assign(elkNodes.get(id)!, flow === 'DOWN' || flow === 'UP' ? { x: i, y: along } : { x: along, y: i });
    });
    if (container !== undefined) elkNodes.get(container)!.layoutOptions = { ...elkNodes.get(container)!.layoutOptions, ...INTERACTIVE_LAYERING };
  }
  return containers;
}

const INTERACTIVE_LAYERING = { 'elk.layered.layering.strategy': 'INTERACTIVE' };

/**
 * Layers for the children of one container: ranks first (one layer per rank,
 * in order; `first` above and `last` below everything), then each edge in
 * declaration order unless it would close a cycle, laid out longest-path and
 * then each node moved, within what its constraints allow, to where its edges
 * are shortest.
 */
export function assignLayers(children: string[], links: [string, string][], rankOf: (id: string) => Rank | undefined): Map<string, number> {
  const key = (r: Rank) => (r === 'first' ? -Infinity : r === 'last' ? Infinity : r);
  const unitOf = new Map(children.map((c) => [c, rankOf(c) === undefined ? c : `\u0000rank ${key(rankOf(c)!)}`]));
  const units = [...new Set(unitOf.values())];
  const succ = new Map(units.map((u) => [u, new Set<string>()]));
  const pred = new Map(units.map((u) => [u, new Set<string>()]));
  const add = (a: string, b: string) => {
    succ.get(a)!.add(b);
    pred.get(b)!.add(a);
  };
  const reaches = (from: string, to: string) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      for (const next of succ.get(id)!) if (!seen.has(next)) seen.add(next), stack.push(next);
    }
    return false;
  };

  const ranks = [...new Set(children.map(rankOf).filter((r): r is Rank => r !== undefined).map(key))].sort((a, b) => a - b).map((k) => `\u0000rank ${k}`);
  ranks.slice(1).forEach((r, i) => add(ranks[i], r));
  const first = '\u0000rank -Infinity';
  const last = '\u0000rank Infinity';
  for (const u of units) {
    if (succ.has(first) && u !== first) add(first, u);
    if (succ.has(last) && u !== last && u !== first) add(u, last);
  }

  const degree = new Map(units.map((u) => [u, 0]));
  for (const [a, b] of links) {
    const [ua, ub] = [unitOf.get(a)!, unitOf.get(b)!];
    if (ua === ub || (!succ.get(ua)!.has(ub) && reaches(ub, ua))) continue;
    add(ua, ub);
    // Moving a node down lengthens its incoming edges and shortens its outgoing ones.
    degree.set(ua, degree.get(ua)! - 1);
    degree.set(ub, degree.get(ub)! + 1);
  }

  // Longest path from the top, in topological order.
  const layer = new Map<string, number>();
  const waiting = new Map(units.map((u) => [u, pred.get(u)!.size]));
  const ready = units.filter((u) => waiting.get(u) === 0);
  while (ready.length) {
    const u = ready.shift()!;
    layer.set(u, Math.max(0, ...[...pred.get(u)!].map((p) => layer.get(p)! + 1)));
    for (const s of succ.get(u)!) {
      waiting.set(s, waiting.get(s)! - 1);
      if (waiting.get(s) === 0) ready.push(s);
    }
  }

  // Each move shortens the edges in total, so this settles.
  for (let sweep = 0, moved = true; moved && sweep < 100; sweep++) {
    moved = false;
    for (const u of units) {
      const d = degree.get(u)!;
      if (d === 0) continue;
      const bound = d > 0 ? Math.max(...[...pred.get(u)!].map((p) => layer.get(p)! + 1)) : Math.min(...[...succ.get(u)!].map((s) => layer.get(s)! - 1));
      if (Number.isFinite(bound) && bound !== layer.get(u)) {
        layer.set(u, bound);
        moved = true;
      }
    }
  }

  const top = Math.min(...layer.values());
  return new Map(children.map((c) => [c, layer.get(unitOf.get(c)!)! - top]));
}

function flipEdge(e: LayoutEdge) {
  [e.source, e.target] = [e.target, e.source];
  [e.sourceMember, e.targetMember] = [e.targetMember, e.sourceMember];
  if (e.sourceMember === undefined) delete e.sourceMember;
  if (e.targetMember === undefined) delete e.targetMember;
}

/**
 * Breaks cycles by declaration order before ELK sees them: an edge that closes
 * a cycle and points at a node declared earlier is handed to ELK reversed, so
 * the node declared first sits higher and the edge is routed as a short hop up
 * instead of ELK's own feedback routing, which loops around whole groups when
 * the edge crosses them. Edges outside cycles keep their direction whatever
 * the order, unless `ordered` (`layout ordered`) turns every edge that points
 * at an earlier node. Returns the ids of the reversed edges; their routes are
 * turned back afterwards.
 */
function orientEdges(edges: LayoutEdge[], order: Map<string, number>, ordered: boolean): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
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
    if ((order.get(e.target) ?? 0) < (order.get(e.source) ?? 0) && (ordered || reaches(e.target, e.source))) reversed.add(e.id);
  }
  for (const e of edges) if (reversed.has(e.id)) flipEdge(e);
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

/** Where a group draws its name (GroupNode: icon, then the name in 12px bold capitals), plus a few px; the right edge is for edges to step around it. */
interface TitleBand {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Inside the group's right border, where a detour must stay left of. */
  limit: number;
}

function titleBand(group: Box, name: string): TitleBand {
  return { x0: group.x + 8, x1: group.x + 40 + name.length * 11, y0: group.y, y1: group.y + 36, limit: group.x + group.width - 12 };
}

/**
 * ELK routes an edge into a group straight down through its top padding, so
 * it can strike through the group's name. A vertical leg that crosses a name
 * steps right around it, just above the group's border, and back.
 */
function avoidTitles(points: Point[], bands: TitleBand[]): Point[] {
  let out = points;
  for (const band of bands) {
    const next: Point[] = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const [p, q] = [out[i - 1], out[i]];
      const top = Math.min(p.y, q.y);
      const bottom = Math.max(p.y, q.y);
      const xr = band.x1 + 12;
      const crosses = Math.abs(p.x - q.x) < 0.5 && p.x > band.x0 && p.x < band.x1 && top < band.y0 - 10 && bottom > band.y1 + 14 && xr < band.limit;
      if (crosses) {
        const above = band.y0 - 10;
        const below = band.y1 + 4;
        const detour = [
          { x: p.x, y: above },
          { x: xr, y: above },
          { x: xr, y: below },
          { x: p.x, y: below },
        ];
        next.push(...(q.y > p.y ? detour : detour.reverse()));
      }
      next.push(q);
    }
    out = next;
  }
  return out === points ? points : simplify(out);
}

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
