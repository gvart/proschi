import type { Edge, Node } from 'reactflow';
import type { ComponentMetadata } from '../types/canvas';
import type { Diagram } from './types';
import { layoutBoxes } from './autoLayout';
import { NODE_TYPE, toMetadata } from './toCanvas';

/**
 * Positions every node for the canvas. The placement itself lives in
 * autoLayout.ts (shared with `proschi render`); this turns it into React Flow
 * nodes, with group members positioned relative to their group.
 */
export async function layoutDiagram(diagram: Diagram): Promise<Node<ComponentMetadata>[]> {
  const boxes = new Map((await layoutBoxes(diagram)).map((b) => [b.id, b]));
  return diagram.nodes.map((node): Node<ComponentMetadata> => {
    const box = boxes.get(node.id)!;
    const rfNode: Node<ComponentMetadata> = {
      id: node.id,
      type: NODE_TYPE[node.kind],
      position: box.position,
      data: toMetadata(node),
    };
    if (box.parent) rfNode.parentNode = box.parent;
    if (node.kind === 'group') {
      rfNode.style = { width: box.width, height: box.height };
      rfNode.zIndex = -1;
    } else {
      rfNode.style = { width: box.width };
    }
    return rfNode;
  });
}

export function toFlowEdges(diagram: Diagram): Edge[] {
  return diagram.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
}
