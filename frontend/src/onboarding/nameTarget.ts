import { kindOf, type DiagramNode } from '../dsl';

export interface NameTarget {
  id: string;
  name: string;
  /** 1-based line and column of the first character inside the quotes. */
  line: number;
  col: number;
}

/** A node of this document whose quoted name the tour asks the user to change: a service when there is one. */
export function nameTarget(source: string, nodes: DiagramNode[]): NameTarget | undefined {
  const lines = source.split('\n');
  const candidates = nodes.filter((n) => n.kind === 'component' && !n.implicit && n.loc.file === undefined && n.name && n.name !== n.id);
  const services = candidates.filter((n) => kindOf(n) === 'service');
  for (const node of [...services, ...candidates]) {
    const text = lines[node.loc.line - 1] ?? '';
    const at = text.indexOf(`"${node.name}"`);
    if (at >= 0) return { id: node.id, name: node.name, line: node.loc.line, col: at + 2 };
  }
  return undefined;
}
