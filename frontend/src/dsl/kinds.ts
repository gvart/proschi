import { componentCatalog } from '../catalog/componentCatalog';
import type { ComponentType } from '../types/canvas';
import type { DiagramNode, Kind } from './types';

/**
 * The simulation class of a node (docs/design/hld-and-practice.md §2.1): what
 * `any cache` selects and which default profile a node gets. Pure, so the
 * parser, the simulation and the HLD generator agree on it.
 */

/** Every kind, in the order of the profile table. */
export const KINDS: readonly Kind[] = ['client', 'edge', 'cdn', 'loadbalancer', 'gateway', 'dns', 'service', 'function', 'cache', 'database', 'search', 'analytics', 'queue', 'storage', 'external', 'other'];

/** Kinds that hold data: where an `entity` may live. */
export const DATA_STORE_KINDS: readonly Kind[] = ['cache', 'database', 'search', 'analytics', 'queue', 'storage'];

/**
 * The sub-kinds of `edge` (§7.5). `any edge` matches all of them, and an edge
 * tech that is none of them (a `cdn`-type component with another tech) stays
 * plain `edge`.
 */
export const EDGE_KINDS: readonly Kind[] = ['edge', 'cdn', 'loadbalancer', 'gateway', 'dns'];

/** Tech stacks whose component type would put them in another kind (the catalog's `kind`). */
const BY_TECH = new Map<string, Kind>(componentCatalog.flatMap((c): [string, Kind][] => ('kind' in c ? [[c.techStack, c.kind]] : [])));

const BY_TYPE: Partial<Record<ComponentType, Kind>> = {
  shape: 'client',
  cdn: 'edge',
  service: 'service',
  compute: 'service',
  container: 'service',
  serverless: 'function',
  cache: 'cache',
  database: 'database',
  queue: 'queue',
  storage: 'storage',
  external: 'external',
};

/**
 * The kind of a node: from its tech stack, falling back to its component type.
 * Shapes (an `Actor`, or a node without a tech) are clients, except the `Note`
 * shape; groups and text nodes are `other`. A tech the catalog does not know
 * has the kind the parser inferred from its name, never `client`.
 */
export function kindOf(node: Pick<DiagramNode, 'kind' | 'type' | 'techStack' | 'inferredKind'>): Kind {
  if (node.kind !== 'component') return 'other';
  return node.inferredKind ?? BY_TECH.get(node.techStack) ?? BY_TYPE[node.type] ?? 'other';
}

/** The component type an inferred kind is drawn as. */
export const TYPE_OF_KIND: Record<Kind, ComponentType> = {
  client: 'shape',
  edge: 'cdn',
  cdn: 'cdn',
  loadbalancer: 'cdn',
  gateway: 'cdn',
  dns: 'cdn',
  service: 'service',
  function: 'serverless',
  cache: 'cache',
  database: 'database',
  search: 'database',
  analytics: 'database',
  queue: 'queue',
  storage: 'storage',
  external: 'external',
  other: 'shape',
};

/**
 * Words in an unknown tech's name that suggest its kind, checked in order
 * (`SMS gateway` is external before it is a gateway). The parser falls back
 * to the kind of the closest catalog tech, then to `service`: an unknown node
 * is never a free, infinitely fast client.
 */
const KIND_WORDS: [RegExp, Kind][] = [
  [/\bsms\b|e-?mail|third.?party|3rd.?party|external|saas|webhook/, 'external'],
  [/\bcdn\b|edge.?cache|content.?delivery/, 'cdn'],
  [/\bdns\b/, 'dns'],
  [/load.?balanc|\blb\b|\balb\b|\bnlb\b|proxy|ingress/, 'loadbalancer'],
  [/gateway|\bapim?\b.*manage/, 'gateway'],
  [/\bwaf\b|firewall/, 'edge'],
  [/cache|memcache/, 'cache'],
  [/queue|\bmq\b|mq$|broker|event.?stream|\bbus\b|topic|pub.?sub|event.?hub|kafka/, 'queue'],
  [/search|lucene|\bindex\b/, 'search'],
  [/warehouse|analytic|olap|data.?lake|lakehouse|time.?series|\btsdb\b/, 'analytics'],
  [/bucket|blob|object.?stor|storage|\bfs\b|file.?system|\bnas\b|\bdisk\b|volume/, 'storage'],
  [/\bdb\b|db$|database|\bsql\b|sql$|nosql|\bstore\b|ledger|key.?value|\bkv\b/, 'database'],
  [/lambda|function|serverless|\bfaas\b/, 'function'],
];

/** The kind the words in an unknown tech stack's name suggest, if any. */
export function kindFromName(tech: string): Kind | undefined {
  const text = tech.toLowerCase();
  return KIND_WORDS.find(([words]) => words.test(text))?.[1];
}

export function isKind(word: string): word is Kind {
  return (KINDS as readonly string[]).includes(word);
}

export function isDataStore(kind: Kind): boolean {
  return DATA_STORE_KINDS.includes(kind);
}

export function isEdge(kind: Kind): boolean {
  return EDGE_KINDS.includes(kind);
}

/** Whether a node of kind `actual` is selected by `any <wanted>`: `any edge` also picks the edge sub-kinds. */
export function kindMatches(actual: Kind, wanted: Kind): boolean {
  return actual === wanted || (wanted === 'edge' && isEdge(actual));
}
