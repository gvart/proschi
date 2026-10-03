import type { CanvasEdge, CanvasNode, ComponentMetadata } from '../types/canvas';
import type { Diagram, DiagramNode } from './types';

export const NODE_TYPE: Record<DiagramNode['kind'], string> = {
  component: 'componentNode',
  group: 'groupNode',
  text: 'textNode',
};

const GRID_COLUMNS = 4;
const GRID_X = 260;
const GRID_Y = 180;

/**
 * Converts a parsed diagram into canvas nodes and edges. Nodes without an
 * explicit `pos` get a simple grid position until auto-layout replaces it.
 */
export function toCanvas(diagram: Diagram): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  let unplaced = 0;

  const nodes = diagram.nodes.map((node): CanvasNode => {
    const position = node.position ?? {
      x: (unplaced % GRID_COLUMNS) * GRID_X,
      y: Math.floor(unplaced / GRID_COLUMNS) * GRID_Y,
    };
    if (!node.position) unplaced++;

    return { id: node.id, type: NODE_TYPE[node.kind], position, data: toMetadata(node) };
  });

  const edges = diagram.edges.map((edge): CanvasEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  return { nodes, edges };
}

export function toMetadata(node: DiagramNode): ComponentMetadata {
  const data: ComponentMetadata = {
    id: node.id,
    name: node.name,
    type: node.type,
    techStack: node.techStack,
    ownerTeam: node.ownerTeam,
    description: node.description,
  };
  if (node.kind === 'text') {
    data.textContent = node.description ?? node.name;
    data.fontSize = 14;
  }
  return data;
}
