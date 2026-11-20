import { parse } from '../../dsl';
import type { Diagram } from '../../dsl/types';
import { addConnection, addNode, renameId, renameNode, uniqueId } from '../../dsl/edit';

/**
 * Adding and naming components on either editable canvas (the editor's
 * DiagramView and practice's EditableCanvas): a component added connected
 * from the selection, a name given in place that the id follows while the id
 * is still the one the canvas made up, and the empty canvas's starters.
 */

/** The id a name or a tech gives: lower case, words joined by `_` (as uniqueId makes them, before numbering). */
export function idFromName(name: string): string {
  return uniqueId('', name);
}

/** Whether `id` is still the one a tech gave it when it was added (`rest_api`, `postgresql2`), not one the reader typed. */
export function isGeneratedId(id: string, tech: string | undefined): boolean {
  if (!tech) return false;
  const stem = idFromName(tech);
  return id === stem || (id.startsWith(stem) && /^\d+$/.test(id.slice(stem.length)));
}

/** Whether a file this document imports names `id` (a problem's tests, say): then the id can't follow a name. */
export function namedElsewhere(diagram: Diagram, id: string): boolean {
  const steps = diagram.useCases.filter((u) => u.loc.file !== undefined).flatMap((u) => u.scenarios.flatMap((s) => s.steps));
  return (
    diagram.edges.some((e) => e.loc.file !== undefined && (e.source === id || e.target === id)) ||
    steps.some((s) => s.fromServiceId === id || s.toServiceId === id) ||
    [...(diagram.tests ?? []), ...(diagram.capacity ?? []), ...(diagram.whatifs ?? [])].some((t) => 'loc' in t && t.loc?.file !== undefined && JSON.stringify(t).includes(`"${id}"`))
  );
}

export interface NameOptions {
  /** Ids the text alone does not show, such as an imported file's nodes. */
  taken?: Iterable<string>;
  /** The id must stay (a file this document imports names it). */
  keepId?: boolean;
}

/**
 * Gives node `id` the display `name`, in one edit. While the id is still the
 * generated one, it follows the name everywhere it is referenced (`rest_api`
 * named "Orders API" becomes `orders_api`). Returns the text and the node's id after.
 */
export function nameNode(source: string, id: string, name: string, { taken, keepId }: NameOptions = {}): { source: string; id: string } {
  const node = parse(source).diagram.nodes.find((n) => n.id === id && n.loc.file === undefined);
  const clean = name.replace(/[\r\n]+/g, ' ').trim();
  if (!node || !clean || clean === node.name) return { source, id };
  const named = renameNode(source, id, clean);
  if (keepId || node.implicit || !isGeneratedId(id, node.techStack)) return { source: named, id };
  if (idFromName(clean) === id) return { source: named, id };
  const next = uniqueId(named, clean, taken);
  const renamed = renameId(named, id, next, taken);
  return renamed.error === undefined ? { source: renamed.source, id: next } : { source: named, id };
}

/**
 * Adds a catalog component named after its tech and, given `from`, connects
 * `from` to it, labelled with its type's protocol (`api -> db : SQL`). One edit.
 */
export function addComponent(source: string, tech: string, { from, taken, position }: { from?: string; taken?: Iterable<string>; position?: { x: number; y: number } } = {}): { source: string; id: string } {
  const id = uniqueId(source, tech, taken);
  const added = addNode(source, { id, name: tech, tech, position }).source;
  if (!from) return { source: added, id };
  const protocol = parse(added).diagram.nodes.find((n) => n.id === id)?.resolvedType?.protocol;
  return { source: addConnection(added, from, id, protocol), id };
}

export interface Starter {
  label: string;
  /** The components, each connected from the one at `from` (an index into this list), if any. */
  parts: { tech: string; from?: number }[];
}

/** The empty editor canvas's starters: small, real designs to grow from. */
export const STARTERS: Starter[] = [
  { label: 'Client → API → Database', parts: [{ tech: 'Actor' }, { tech: 'REST API', from: 0 }, { tech: 'PostgreSQL', from: 1 }] },
  { label: 'Add a cache', parts: [{ tech: 'Actor' }, { tech: 'REST API', from: 0 }, { tech: 'Redis', from: 1 }, { tech: 'PostgreSQL', from: 1 }] },
  { label: 'Add a queue and worker', parts: [{ tech: 'Actor' }, { tech: 'REST API', from: 0 }, { tech: 'Message Queue', from: 1 }, { tech: 'Worker', from: 2 }] },
];

/** `source` with a starter's components and connections added, through the same edits as the canvas. */
export function addStarter(source: string, starter: Starter): string {
  const ids: string[] = [];
  return starter.parts.reduce((text, part) => {
    const result = addComponent(text, part.tech, { from: part.from === undefined ? undefined : ids[part.from] });
    ids.push(result.id);
    return result.source;
  }, source);
}
