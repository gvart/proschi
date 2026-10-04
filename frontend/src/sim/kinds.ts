import type { ComponentType, TechStack } from '../types/canvas';
import type { DiagramNode, Kind } from '../dsl/types';

/**
 * Simulation class of a node (docs/design/hld-and-practice.md §2.1): the tech
 * stack decides where the component type is ambiguous (a `serverless` API
 * gateway is an edge, a `database` Redis is a cache), the type decides the rest.
 *
 * Kept in step with frontend/src/dsl/kinds.ts from the language work; the two
 * are meant to become one module.
 */

const BY_TECH: Partial<Record<TechStack, Kind>> = {
  'AWS API Gateway': 'edge',
  'Azure API Management': 'edge',
  'AWS Lambda': 'function',
  'GCP Cloud Functions': 'function',
  'GCP Cloud Run': 'function',
  'GCP App Engine': 'function',
  'Azure Functions': 'function',
  'Azure Logic Apps': 'function',
  Redis: 'cache',
  Elasticsearch: 'search',
  'GCP BigQuery': 'analytics',
  InfluxDB: 'analytics',
  TimescaleDB: 'analytics',
  Note: 'other',
};

const BY_TYPE: Record<ComponentType, Kind> = {
  shape: 'client',
  service: 'service',
  compute: 'service',
  container: 'service',
  serverless: 'function',
  cdn: 'edge',
  cache: 'cache',
  database: 'database',
  queue: 'queue',
  storage: 'storage',
  external: 'external',
  text: 'other',
  group: 'other',
};

export function kindOf(node: Pick<DiagramNode, 'kind' | 'type' | 'techStack'>): Kind {
  if (node.kind !== 'component') return 'other';
  return BY_TECH[node.techStack] ?? BY_TYPE[node.type] ?? 'other';
}

/** Every kind, in the order of the §2.1 table; `any <kind>` selectors accept these. */
export const KINDS: Kind[] = ['client', 'edge', 'service', 'function', 'cache', 'database', 'search', 'analytics', 'queue', 'storage', 'external', 'other'];
