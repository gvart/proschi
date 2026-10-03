import type { Edge, Node } from 'reactflow';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { ComponentMetadata } from '../types/canvas';
import type { Diagram, DiagramNode } from './types';
import { NODE_TYPE, toMetadata } from './toCanvas';

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

/**
 * Positions every node with ELK's layered algorithm. Groups become containers
 * sized around their members, and an explicit `pos x,y` wins over the layout.
 * Use case steps count as connections, so flows lay out sensibly even when the
 * architecture declares no edges.
 */
export async function layoutDiagram(diagram: Diagram): Promise<Node<ComponentMetadata>[]> {
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

  const rfNodes = diagram.nodes.map((node): Node<ComponentMetadata> => {
    const box = placed.get(node.id);
    const position = node.position ?? { x: box?.x ?? 0, y: box?.y ?? 0 };
    const rfNode: Node<ComponentMetadata> = {
      id: node.id,
      type: NODE_TYPE[node.kind],
      position,
      data: toMetadata(node),
    };
    if (node.parent && byId.has(node.parent)) rfNode.parentNode = node.parent;
    if (node.kind === 'group') {
      rfNode.style = { width: box?.width, height: box?.height };
      rfNode.zIndex = -1;
    } else {
      rfNode.style = { width: box?.width };
    }
    return rfNode;
  });

  growGroupsAroundMembers(rfNodes, placed);
  return rfNodes;
}

/**
 * ELK sizes groups for its own placement; members pinned with `pos` can sit
 * outside that box, so grow each group (innermost first) until it contains them.
 */
function growGroupsAroundMembers(nodes: Node<ComponentMetadata>[], placed: Map<string, ElkNode>) {
  const size = (n: Node) => ({
    width: Number(n.style?.width ?? placed.get(n.id)?.width ?? 0),
    height: Number(n.style?.height ?? placed.get(n.id)?.height ?? 0),
  });
  const depth = (n: Node): number => {
    const parent = nodes.find((p) => p.id === n.parentNode);
    return parent ? depth(parent) + 1 : 0;
  };
  const groups = nodes.filter((n) => n.type === NODE_TYPE.group).sort((a, b) => depth(b) - depth(a));
  for (const group of groups) {
    const { width, height } = size(group);
    let right = width;
    let bottom = height;
    for (const member of nodes.filter((n) => n.parentNode === group.id)) {
      const m = size(member);
      right = Math.max(right, member.position.x + m.width + GROUP_MARGIN);
      bottom = Math.max(bottom, member.position.y + m.height + GROUP_MARGIN);
    }
    group.style = { ...group.style, width: right, height: bottom };
  }
}

export function toFlowEdges(diagram: Diagram): Edge[] {
  return diagram.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
}

function isAncestor(byId: Map<string, DiagramNode>, ancestor: string, id: string): boolean {
  for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) {
    if (p === ancestor) return true;
  }
  return false;
}
