import { componentCatalog, type TechProfileKey } from '../catalog/componentCatalog';
import type { CapacityOverride, DiagramNode, Kind } from '../dsl/types';
import { isDataStore, kindOf } from '../dsl/kinds';

/**
 * Per-replica numbers the simulation starts from (docs/design/hld-and-practice.md
 * §2.1, §7.2–§7.5). They are teaching values, right to an order of magnitude,
 * not benchmarks; `capacity { … }` overrides them per node.
 */
export interface Profile {
  kind: Kind;
  /** Requests per second one replica handles (its read capacity); Infinity for clients. */
  rps: number;
  /** Reads per second one replica serves (§7.2). */
  readRps: number;
  /** Writes per second one write node (the primary, or every replica of a partitioned store) takes (§7.2). */
  writeRps: number;
  /**
   * How write capacity grows (§7.2): `replicas` for partitioned stores and
   * everything that is not a store (reads and writes share every replica);
   * `shards` for single-primary stores (relational databases), whose
   * replicas serve reads while every write goes to one primary per shard.
   */
  writeScaling: 'replicas' | 'shards';
  /** Independent partitions, each with its own primary and replicas; 1 unless overridden. */
  shards: number;
  /** Time one request spends in the node when it is idle. */
  latencyMs: number;
  /** Fraction of time one replica is up, 0..1. */
  availability: number;
  costUsd: number;
  /** Data written here survives a restart. */
  durable: boolean;
  /** Data stores only (§7.4): whether a read sees every acknowledged write. */
  consistency?: 'strong' | 'eventual';
  /** Network bandwidth per replica, in megabytes per second (§7.3). */
  bandwidthMBps: number;
  /** Price of data this node sends to clients and third parties (internet egress), USD per GB (§7.3). */
  egressUsdPerGb: number;
  /** What a failed call (`-x`) to this node costs, from `capacity { n timeout … }`; absent means the analysis default. */
  timeoutMs?: number;
}

/** The numbers of a profile table row; `kind` comes from the node, read/write capacity from `rps` unless given. */
type Row = Pick<Profile, 'rps' | 'latencyMs' | 'availability' | 'costUsd' | 'durable'> &
  Partial<Pick<Profile, 'readRps' | 'writeRps' | 'writeScaling' | 'consistency' | 'bandwidthMBps' | 'egressUsdPerGb'>>;

const NEUTRAL: Row = { rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, durable: false };

/** Internet egress, USD per GB: what a cloud charges for data a node you run sends to the internet (§7.3). */
export const INTERNET_EGRESS_USD_PER_GB = 0.09;
/** A CDN's price per GB delivered. */
export const CDN_EGRESS_USD_PER_GB = 0.02;

/** Single-primary (relational) store: 20k reads per replica, 5k writes per shard (§7.2). */
const RELATIONAL: Row = {
  rps: 20_000,
  readRps: 20_000,
  writeRps: 5_000,
  writeScaling: 'shards',
  latencyMs: 5,
  availability: 0.9995,
  costUsd: 400,
  durable: true,
  consistency: 'strong',
};

/** Defaults by kind. */
export const KIND_PROFILES: Record<Kind, Row> = {
  client: { ...NEUTRAL, bandwidthMBps: 10 },
  // A firewall or accelerator in front of everything else (WAF, Global Accelerator); `any edge` also selects the four below.
  edge: { rps: 100_000, latencyMs: 2, availability: 0.9999, costUsd: 50, durable: false },
  cdn: { rps: 200_000, latencyMs: 5, availability: 0.9999, costUsd: 100, durable: false, egressUsdPerGb: CDN_EGRESS_USD_PER_GB },
  loadbalancer: { rps: 100_000, latencyMs: 2, availability: 0.9999, costUsd: 50, durable: false },
  gateway: { rps: 10_000, latencyMs: 10, availability: 0.9995, costUsd: 100, durable: false },
  // Name resolution happens before the request and is cached: off the request path.
  dns: { rps: Infinity, latencyMs: 0, availability: 1, costUsd: 0, durable: false },
  service: { rps: 2_000, latencyMs: 10, availability: 0.995, costUsd: 100, durable: false },
  function: { rps: 10_000, latencyMs: 25, availability: 0.9995, costUsd: 200, durable: false },
  cache: { rps: 100_000, latencyMs: 1, availability: 0.999, costUsd: 150, durable: false, consistency: 'eventual' },
  database: RELATIONAL,
  search: { rps: 3_000, latencyMs: 15, availability: 0.999, costUsd: 400, durable: true, consistency: 'eventual' },
  analytics: { rps: 200, latencyMs: 500, availability: 0.999, costUsd: 300, durable: true, consistency: 'eventual' },
  queue: { rps: 50_000, latencyMs: 5, availability: 0.9999, costUsd: 200, durable: true, consistency: 'strong' },
  storage: { rps: 5_000, latencyMs: 30, availability: 0.9999, costUsd: 50, durable: true, consistency: 'eventual' },
  external: { rps: 1_000, latencyMs: 200, availability: 0.999, costUsd: 0, durable: false },
  other: NEUTRAL,
};

/** Partitioned NoSQL stores: 20k reads and 20k writes per replica (§7.2). */
const NOSQL: Row = { rps: 20_000, latencyMs: 5, availability: 0.9999, costUsd: 500, durable: true, consistency: 'eventual' };
const NOSQL_STRONG: Row = { ...NOSQL, consistency: 'strong' };
const PROFILE_ROWS: Record<TechProfileKey, Row> = { nosql: NOSQL, nosqlStrong: NOSQL_STRONG };

/** Techs whose numbers differ from their kind's (the catalog's `profile`). Relational techs use the `database` row. */
export const TECH_PROFILES: Readonly<Record<string, Row>> = Object.fromEntries(
  componentCatalog.flatMap((c) => ('profile' in c ? [[c.techStack, PROFILE_ROWS[c.profile]]] : [])),
);

/** Bandwidth per replica by kind, MB/s (§7.3); kinds not listed get 100. */
const BANDWIDTH: Partial<Record<Kind, number>> = {
  client: 10,
  edge: 1000,
  cdn: 1000,
  loadbalancer: 1000,
  gateway: 1000,
  dns: 1000,
  service: 200,
};
const DEFAULT_BANDWIDTH_MBPS = 100;

/** Kinds you run and pay egress for; clients and third parties send at their own cost, DNS and annotations send nothing. */
const CHARGES_EGRESS = (kind: Kind): boolean => kind !== 'client' && kind !== 'external' && kind !== 'dns' && kind !== 'other';

/** The node's per-replica profile: tech table, else kind table, then the `capacity` override. */
export function profileOf(node: DiagramNode, override?: CapacityOverride): Profile {
  const kind = kindOf(node);
  const base = (Object.hasOwn(TECH_PROFILES, node.techStack) ? TECH_PROFILES[node.techStack] : undefined) ?? KIND_PROFILES[kind];
  const baseRead = base.readRps ?? base.rps;
  const baseWrite = base.writeRps ?? base.rps;
  const readRps = override?.readRps ?? override?.rps ?? baseRead;
  const writeRps = override?.writeRps ?? override?.rps ?? baseWrite;
  const consistency = override?.consistency ?? base.consistency;
  return {
    kind,
    rps: readRps,
    readRps,
    writeRps,
    writeScaling: base.writeScaling ?? 'replicas',
    shards: Math.max(1, Math.floor(override?.shards ?? 1)),
    latencyMs: override?.latencyMs ?? base.latencyMs,
    availability: override?.availability !== undefined ? override.availability / 100 : base.availability,
    costUsd: override?.costUsd ?? base.costUsd,
    durable: override?.durable ?? base.durable,
    ...(consistency && isDataStore(kind) ? { consistency } : {}),
    bandwidthMBps: override?.bandwidthMBps ?? base.bandwidthMBps ?? BANDWIDTH[kind] ?? DEFAULT_BANDWIDTH_MBPS,
    egressUsdPerGb: override?.egressUsdPerGb ?? base.egressUsdPerGb ?? (CHARGES_EGRESS(kind) ? INTERNET_EGRESS_USD_PER_GB : 0),
    ...(override?.timeoutMs !== undefined ? { timeoutMs: override.timeoutMs } : {}),
  };
}

/** Read and write capacity of all replicas and shards together (§7.2). */
export function capacityOf(p: Profile, replicas: number): { readRps: number; writeRps: number } {
  return {
    readRps: p.readRps * replicas * p.shards,
    writeRps: p.writeRps * (p.writeScaling === 'shards' ? 1 : replicas) * p.shards,
  };
}

/**
 * How busy a node is, 0..1+ (§7.2). Single-primary stores serve reads on the
 * replicas and writes on the primaries, so the busier side counts; everything
 * else serves both on the same replicas, so the shares add up (for a node
 * with equal read and write capacity this is total load ÷ capacity).
 */
export function combinedUtilization(p: Profile, readUtilization: number, writeUtilization: number): number {
  return p.writeScaling === 'shards' ? Math.max(readUtilization, writeUtilization) : readUtilization + writeUtilization;
}
