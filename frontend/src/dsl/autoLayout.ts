import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { Diagram, DiagramNode } from './types';

/**
 * ELK auto-layout of a diagram, free of React Flow so the canvas
 * (layout.ts) and the static renderer (`proschi render`) place every node at
 * exactly the same spot.
 */

const COMPONENT_SIZE = { width: 240, height: 84 };
const COMPONENT_WITH_TEAM_SIZE = { width: 240, height: 104 };
const TEXT_SIZE = { width: 240, height: 110 };
// Matches GroupNode's minimum size so the drawn box and the layout agree.
const GROUP_OPTIONS = {
  'elk.padding': '[top=56,left=24,bottom=24,right=24]',
  'elk.nodeSize.constraints': 'MINIMUM_SIZE',
  'elk.nodeSize.minimum': '(300, 200)',
};

/** Space kept between a group's edge and a member that was dragged near it. */
const GROUP_MARGIN = 24;

const ROOT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.componentComponent': '72',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
};

type ElkInstance = { layout: (graph: ElkNode) => Promise<ElkNode> };
let elkPromise: Promise<ElkInstance> | undefined;

// ELK is large, so it is loaded on first use and kept out of the main bundle.
function getElk(): Promise<ElkInstance> {
  elkPromise ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  return elkPromise;
}

export interface LaidOutNode {
  id: string;
  /** Top-left corner, relative to the enclosing group when there is one. */
  position: { x: number; y: number };
  width: number;
  /** ELK's height; components are measured by the canvas, so theirs is only nominal. */
  height: number;
  /** The enclosing group, when it exists. */
  parent?: string;
}

/**
 * Positions every node with ELK's layered algorithm. Groups become containers
 * sized around their members, and an explicit `pos x,y` wins over the layout.
 * Use case steps count as connections, so flows lay out sensibly even when the
 * architecture declares no edges.
 */
export async function layoutBoxes(diagram: Diagram): Promise<LaidOutNode[]> {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const elkNodes = new Map<string, ElkNode>();

  for (const node of diagram.nodes) {
    const size = node.kind === 'group' ? {} : node.kind === 'text' ? TEXT_SIZE : node.ownerTeam ? COMPONENT_WITH_TEAM_SIZE : COMPONENT_SIZE;
    elkNodes.set(node.id, {
      id: node.id,
      ...size,
      children: node.kind === 'group' ? [] : undefined,
      layoutOptions: node.kind === 'group' ? GROUP_OPTIONS : undefined,
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

  const pairs = new Set<string>();
  const edges: ElkExtendedEdge[] = [];
  const addEdge = (source: string, target: string) => {
    const key = `${source}\u0000${target}`;
    if (source === target || pairs.has(key) || !byId.has(source) || !byId.has(target)) return;
    // ELK rejects edges between a group and its own members.
    if (isAncestor(byId, source, target) || isAncestor(byId, target, source)) return;
    pairs.add(key);
    edges.push({ id: `e${edges.length}`, sources: [source], targets: [target] });
  };
  diagram.edges.forEach((e) => addEdge(e.source, e.target));
  diagram.useCases.forEach((uc) => uc.steps.forEach((s) => addEdge(s.fromServiceId, s.toServiceId)));

  const elk = await getElk();
  const result = await elk.layout({ id: 'root', layoutOptions: ROOT_OPTIONS, children: roots, edges });

  const placed = new Map<string, ElkNode>();
  const collect = (nodes: ElkNode[] | undefined) =>
    nodes?.forEach((n) => {
      placed.set(n.id, n);
      collect(n.children);
    });
  collect(result.children);

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
  return boxes;
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
