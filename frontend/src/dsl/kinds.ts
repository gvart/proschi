import type { ComponentType } from '../types/canvas';
import type { DiagramNode, Kind } from './types';

/**
 * The simulation class of a node (docs/design/hld-and-practice.md §2.1): what
 * `any cache` selects and which default profile a node gets. Pure, so the
 * parser, the simulation and the HLD generator agree on it.
 */

/** Every kind, in the order of the profile table. */
export const KINDS: readonly Kind[] = ['client', 'edge', 'service', 'function', 'cache', 'database', 'search', 'analytics', 'queue', 'storage', 'external', 'other'];

/** Kinds that hold data: where an `entity` may live. */
export const DATA_STORE_KINDS: readonly Kind[] = ['cache', 'database', 'search', 'analytics', 'queue', 'storage'];

/** Tech stacks whose component type would put them in another kind. */
const BY_TECH: Partial<Record<string, Kind>> = {
  'AWS API Gateway': 'edge',
  'Azure API Management': 'edge',
  Redis: 'cache',
  Elasticsearch: 'search',
  'GCP BigQuery': 'analytics',
  InfluxDB: 'analytics',
  TimescaleDB: 'analytics',
};

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
 * Shapes (an `Actor`, or a node without a tech) are clients; groups and text
 * nodes are `other`.
 */
export function kindOf(node: Pick<DiagramNode, 'kind' | 'type' | 'techStack'>): Kind {
  if (node.kind !== 'component') return 'other';
  return BY_TECH[node.techStack] ?? BY_TYPE[node.type] ?? 'other';
}

export function isKind(word: string): word is Kind {
  return (KINDS as readonly string[]).includes(word);
}

export function isDataStore(kind: Kind): boolean {
  return DATA_STORE_KINDS.includes(kind);
}
