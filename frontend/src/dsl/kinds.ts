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

/** Tech stacks whose component type would put them in another kind. */
const BY_TECH: Partial<Record<string, Kind>> = {
  'AWS CloudFront': 'cdn',
  'Azure CDN': 'cdn',
  'GCP Cloud CDN': 'cdn',
  'Azure Front Door': 'cdn',
  'AWS Load Balancer': 'loadbalancer',
  'GCP Load Balancing': 'loadbalancer',
  'AWS API Gateway': 'gateway',
  'Azure API Management': 'gateway',
  'AWS Route53': 'dns',
  'Azure DNS': 'dns',
  'GCP Cloud DNS': 'dns',
  Redis: 'cache',
  Elasticsearch: 'search',
  'GCP BigQuery': 'analytics',
  InfluxDB: 'analytics',
  TimescaleDB: 'analytics',
  // A note shape annotates the diagram; it is not a client.
  Note: 'other',
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
 * Shapes (an `Actor`, or a node without a tech) are clients, except the `Note`
 * shape; groups and text nodes are `other`.
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

export function isEdge(kind: Kind): boolean {
  return EDGE_KINDS.includes(kind);
}

/** Whether a node of kind `actual` is selected by `any <wanted>`: `any edge` also picks the edge sub-kinds. */
export function kindMatches(actual: Kind, wanted: Kind): boolean {
  return actual === wanted || (wanted === 'edge' && isEdge(actual));
}
