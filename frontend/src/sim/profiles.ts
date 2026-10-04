import type { TechStack } from '../types/canvas';
import type { CapacityOverride, DiagramNode, Kind } from '../dsl/types';
import { kindOf } from './kinds';

/**
 * Per-replica numbers the simulation starts from (docs/design/hld-and-practice.md
 * §2.1). They are teaching values, right to an order of magnitude, not
 * benchmarks; `capacity { … }` overrides them per node.
 */
export interface Profile {
  kind: Kind;
  /** Requests per second one replica handles; Infinity for clients. */
  rps: number;
  /** Time one request spends in the node when it is idle. */
  latencyMs: number;
  /** Fraction of time one replica is up, 0..1. */
  availability: number;
  costUsd: number;
  /** Data written here survives a restart. */
  durable: boolean;
}

type Numbers = Omit<Profile, 'kind'>;

const NEUTRAL: Numbers = { rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, durable: false };

/** Defaults by kind. */
export const KIND_PROFILES: Record<Kind, Numbers> = {
  client: NEUTRAL,
  edge: { rps: 100_000, latencyMs: 2, availability: 0.9999, costUsd: 50, durable: false },
  service: { rps: 2_000, latencyMs: 10, availability: 0.995, costUsd: 100, durable: false },
  function: { rps: 10_000, latencyMs: 25, availability: 0.9995, costUsd: 200, durable: false },
  cache: { rps: 100_000, latencyMs: 1, availability: 0.999, costUsd: 150, durable: false },
  database: { rps: 5_000, latencyMs: 5, availability: 0.9995, costUsd: 400, durable: true },
  search: { rps: 3_000, latencyMs: 15, availability: 0.999, costUsd: 400, durable: true },
  analytics: { rps: 200, latencyMs: 500, availability: 0.999, costUsd: 300, durable: true },
  queue: { rps: 50_000, latencyMs: 5, availability: 0.9999, costUsd: 200, durable: true },
  storage: { rps: 5_000, latencyMs: 30, availability: 0.9999, costUsd: 50, durable: true },
  external: { rps: 1_000, latencyMs: 200, availability: 0.999, costUsd: 0, durable: false },
  other: NEUTRAL,
};

const NOSQL: Numbers = { rps: 20_000, latencyMs: 5, availability: 0.9999, costUsd: 500, durable: true };

/** Techs whose numbers differ from their kind's. */
export const TECH_PROFILES: Partial<Record<TechStack, Numbers>> = {
  DynamoDB: NOSQL,
  'AWS DynamoDB': NOSQL,
  Cassandra: NOSQL,
  MongoDB: NOSQL,
  CouchDB: NOSQL,
  'Azure Cosmos DB': NOSQL,
  'GCP Bigtable': NOSQL,
  'GCP Firestore': NOSQL,
  'GCP Spanner': NOSQL,
};

/** The node's per-replica profile: tech table, else kind table, then the `capacity` override. */
export function profileOf(node: DiagramNode, override?: CapacityOverride): Profile {
  const kind = kindOf(node);
  const base = TECH_PROFILES[node.techStack] ?? KIND_PROFILES[kind];
  return {
    kind,
    rps: override?.rps ?? base.rps,
    latencyMs: override?.latencyMs ?? base.latencyMs,
    availability: override?.availability !== undefined ? override.availability / 100 : base.availability,
    costUsd: override?.costUsd ?? base.costUsd,
    durable: override?.durable ?? base.durable,
  };
}
