import type { Diagram, DiagramNode, DiagramStep, DiagramUseCase, Kind, Percentile } from '../dsl/types';
import { kindOf as nodeKind } from '../dsl/kinds';
import { accessIn } from './access';
import { criticalPath, fallbacksFor, findScenario, findUseCase, needs, pathNodes, type Hop } from './flow';
import { formatCount, formatPercent, formatRps } from './format';
import { capacityOf, combinedUtilization, profileOf, type Profile } from './profiles';
import { analyzeSystems, type SharedSystemLoad, type SystemAnalysis } from './systems';

/**
 * A deterministic, analytical model of the design under its traffic
 * (docs/design/hld-and-practice.md §2, §7; the "How the simulation works"
 * page, model/index.html, states every rule with its numbers): read and
 * write load and utilisation per node, M/M/c queueing per hop, latency
 * percentiles per scenario and of each use case's scenario mixture,
 * availability with single-primary failover, cost with internet egress.
 */

export interface NodeAnalysis {
  id: string;
  kind: Kind;
  replicas: number;
  /** Partitions (`capacity { n shards 4 }`), each with `replicas` instances; 1 by default. */
  shards: number;
  /** Reads and writes together, fan-out included; failed calls (`-x`) add nothing. */
  loadRps: number;
  /**
   * All replicas and shards together. When reads and writes have different
   * capacities, the effective capacity under the current mix
   * (`loadRps / utilization`), or the read capacity without load. Infinity
   * for clients.
   */
  capacityRps: number;
  /** How busy the node is, 0..1+: the larger of its request utilisation and its bandwidth utilisation. */
  utilization: number;
  /** Utilisation by requests alone (see `combinedUtilization`, §7.2). */
  requestUtilization: number;
  /** At or past 100% utilisation. */
  saturated: boolean;
  /** Read and write load and capacity (all replicas and shards together), and their utilisation (§7.2). */
  readLoadRps: number;
  writeLoadRps: number;
  readCapacityRps: number;
  writeCapacityRps: number;
  readUtilization: number;
  writeUtilization: number;
  /**
   * Payload megabytes per second the node sends and receives, the bandwidth
   * of all its replicas and shards, and their ratio (§7.3). Only nodes you
   * run on instances have a bandwidth limit; 0 for clients, third parties,
   * DNS, object storage and CDNs (see `BANDWIDTH_BOUND`).
   */
  bandwidthLoadMBps: number;
  bandwidthCapacityMBps: number;
  bandwidthUtilization: number;
  /** `shards`: writes go to one primary per shard and replicas only add reads (relational databases). */
  writeScaling: 'replicas' | 'shards';
  /** Data stores only (§7.4). */
  consistency?: 'strong' | 'eventual';
  /**
   * Servers one request can queue for: the replicas of its shard, or the one
   * primary when writes bind a single-primary store (see `serversOf`).
   */
  servers: number;
  /** Probability that a request waits in the queue (Erlang C for `servers` at this utilisation). */
  waitProbability: number;
  /** Mean hop latency under the current load: service time plus mean queueing delay (payload transfer not included). */
  latencyMs: number;
  /** With replicas, as a fraction 0..1. */
  availability: number;
  /**
   * What a write needs: the same as `availability`, except for a
   * single-primary store, whose writes need the primary; with a replica to
   * promote, only the failover window counts (`FAILOVER_SHARE`).
   */
  writeAvailability: number;
  /** All replicas and shards together, per month, egress included. */
  costUsd: number;
  /** Data this node sends to clients and third parties per month (§7.3), in GB, and what it costs (included in `costUsd`). */
  egressGbPerMonth: number;
  egressUsd: number;
  durable: boolean;
  /** Down in a what-if (`AnalyzeOptions.failed`): its availability is 0. Absent otherwise. */
  failed?: true;
  /**
   * `capacity { n errors 2% retries 3 }` (or a what-if's `n errors 20%`):
   * the error rate of one call, 0..1, the retries a caller makes, the calls
   * each request makes on average (`Σ e^k` for k = 0..retries, in `loadRps`
   * already) and the chance that a call succeeds in the end
   * (`1 − e^(retries + 1)`, in the use cases' availability). Absent without an
   * error rate.
   */
  retry?: RetryAnalysis;
  /** A queue or broker with a `drain` rate: its backlog and consumer lag. Absent otherwise. */
  queue?: QueueAnalysis;
}

export interface RetryAnalysis {
  errorRate: number;
  retries: number;
  attempts: number;
  success: number;
  /** Hot (`HOT` or more) with retries: saturation raises the error rate, and each failure comes back up to `retries` more times. */
  stormRisk: boolean;
}

/**
 * A queue or broker with consumers (`capacity { events drain 5k rps }`):
 * what flows in (every request to it, `loadRps`), what the consumers take
 * off, and what that leads to. With more inflow than drain the backlog
 * grows; otherwise a message waits the M/M/1 queueing delay of a consumer
 * pool that drains at `drainRps`.
 */
export interface QueueAnalysis {
  inflowRps: number;
  drainRps: number;
  /** `inflowRps ÷ drainRps`; at 1 or more the backlog grows. */
  utilization: number;
  /** Messages the backlog grows by per hour, `(inflow − drain) × 3600`; 0 while the consumers keep up. */
  backlogPerHour: number;
  /** The mean wait before a consumer takes a message, `ρ ÷ (drain − inflow)`; Infinity while the backlog grows. */
  lagMs: number;
}

/** The backlog and lag of a queue with `inflow` requests per second and consumers that drain `drain`. */
export function queueOf(inflow: number, drain: number): QueueAnalysis {
  const utilization = drain > 0 ? inflow / drain : inflow > 0 ? Infinity : 0;
  if (inflow >= drain && inflow > 0) return { inflowRps: inflow, drainRps: drain, utilization, backlogPerHour: (inflow - drain) * 3600, lagMs: Infinity };
  return { inflowRps: inflow, drainRps: drain, utilization, backlogPerHour: 0, lagMs: drain > 0 ? (utilization / (drain - inflow)) * 1000 : 0 };
}

export type Percentiles = Record<'p50' | 'p90' | 'p95' | 'p99' | 'p999', number>;

export interface ScenarioAnalysis {
  id: string;
  name: string;
  /** Share of the use case's traffic, 0..1. */
  share: number;
  meanMs: number;
  percentiles: Percentiles;
}

export interface UseCaseAnalysis {
  id: string;
  name: string;
  /** The rate the design is loaded with: the peak, for a traffic line with `peak`. */
  rps: number;
  /** `"U" 20k rps peak x3`: the average rate, which egress is costed at. Absent for a flat rate. */
  avgRps?: number;
  scenarios: ScenarioAnalysis[];
  /** Percentiles of the mixture of the scenarios, weighted by their shares. */
  percentiles: ScenarioAnalysis['percentiles'];
  /** For each percentile, the index of the scenario that contributes most to the requests slower than it. */
  tailScenario: Record<keyof Percentiles, number>;
  /** Fraction 0..1. */
  availability: number;
}

export interface Analysis {
  nodes: NodeAnalysis[];
  useCases: UseCaseAnalysis[];
  /** Instances and egress together, per month. */
  totalCostUsd: number;
  /** The egress part of `totalCostUsd` (§7.3). */
  totalEgressUsd: number;
  /** Ids of single-replica nodes a use case needs and cannot do without. */
  singlePointsOfFailure: string[];
  warnings: string[];
  /** Each `system` under what the diagram sends it (sim/systems.ts); absent when there are none. */
  systems?: SystemAnalysis[];
}

export interface AnalyzeOptions {
  /** What a failed call (`-x`) costs unless `capacity { n timeout … }` says otherwise; 1 000 ms by default. */
  timeoutMs?: number;
  /** Replica counts to use instead of the declared ones, by node id (`survive` analyses the design with one instance fewer). */
  replicas?: ReadonlyMap<string, number>;
  /**
   * Use case percentiles to compute; the others are NaN and their
   * `tailScenario` is 0. The mixture quantile is the costly part of an
   * analysis, so a caller that analyses many times (the game, once per tick)
   * asks only for what it reads. All of them by default.
   */
  percentiles?: readonly Percentile[];
  /**
   * Requests per second to use instead of the `traffic` block's, by use case
   * id (a what-if's `traffic "X" x3`, sim/whatif.ts). Scenario shares stay.
   */
  trafficRps?: ReadonlyMap<string, number>;
  /**
   * Node ids that are down (a what-if's `fail X`): their availability is 0,
   * and the traffic of each scenario that needs one moves to the use case's
   * fallback scenarios for it (§7.6). Without a fallback, that share of the
   * use case's requests fails.
   */
  failed?: ReadonlySet<string>;
  /** Cache hit rates (0..100) to use instead of `capacity { n hit … }`, by node id (a what-if's `cache hit 40%`). */
  hitRates?: ReadonlyMap<string, number>;
  /** Error rates (0..100) to use instead of `capacity { n errors … }`, by node id (a what-if's `pay errors 20%`). */
  errorRates?: ReadonlyMap<string, number>;
  /** Internal: the load on every team design of the document being analysed (sim/systems.ts), passed to the team designs' own analyses. */
  sharedSystems?: SharedSystemLoad;
}

export const DEFAULT_TIMEOUT_MS = 1000;
/** Utilisation above which a node counts as hot (amber in the editor). */
export const HOT = 0.7;
/** Queueing delay is computed at most at this utilisation, so a saturated node still has a finite latency. */
export const QUEUE_CAP = 0.95;
/**
 * The part of a single-primary store's per-replica downtime that writes
 * still see when a replica can be promoted: failover takes a minute or two
 * of an outage that would otherwise last the whole repair.
 */
export const FAILOVER_SHARE = 0.1;
/**
 * How variable a service time is: half of it is fixed, half exponential, so
 * an idle hop's p50 is 0.85× its mean, p99 2.8× and p999 4.0×.
 */
export const SERVICE_SPREAD = 0.5;

/** Seconds in the 30-day month that monthly costs are quoted for. */
export const SECONDS_PER_MONTH = 2_592_000;
const BYTES_PER_MB = 1e6;
const BYTES_PER_GB = 1e9;

export const PERCENTILE_KEYS: Record<Percentile, keyof Percentiles> = { 50: 'p50', 90: 'p90', 95: 'p95', 99: 'p99', 99.9: 'p999' };
const PERCENTILES = Object.keys(PERCENTILE_KEYS).map(Number) as Percentile[];

/** Components the model covers: groups and text nodes are ignored. */
export function components(diagram: Diagram): DiagramNode[] {
  return diagram.nodes.filter((n) => n.kind === 'component');
}

export const replicasOf = (node: DiagramNode): number => Math.max(1, node.replicas ?? 1);

/** Traffic of a use case: requests per second, and each scenario's share (aligned with `useCase.scenarios`). */
export interface UseCaseTraffic {
  rps: number;
  shares: number[];
  /** `peak` traffic: the average as a fraction of `rps` (the peak), 0..1. Absent for a flat rate. */
  average?: number;
  /** Steps on a cache's miss path, with the share of the rate that reaches them (`1 − hit`, see `cacheLookups`). Absent without hit rates. */
  miss?: Map<DiagramStep, number>;
  /** Each scenario's reads of caches with a hit rate (aligned with `useCase.scenarios`), for the hit and miss latency mixture. Absent without hit rates. */
  lookups?: CacheLookup[][];
  /** With failed nodes: the share of requests whose scenario needs a failed node and has no fallback, 0..1. Absent otherwise. */
  stranded?: number;
  /** Steps to a node with an error rate and retries, with the calls each makes on average (`attempts`). Absent without error rates. */
  retry?: Map<DiagramStep, number>;
}

/**
 * Applies `traffic { … }`: without `mix` all traffic goes to the first
 * scenario; shares that do not add up to 100% are normalised. Use cases
 * without a traffic line get 0 rps, with the first scenario as their shape.
 */
export function resolveTraffic(diagram: Diagram, warnings: string[] = []): Map<string, UseCaseTraffic> {
  const result = new Map<string, UseCaseTraffic>();
  for (const u of diagram.useCases) result.set(u.id, { rps: 0, shares: u.scenarios.map((_, i) => (i === 0 ? 1 : 0)) });
  const seen = new Set<string>();
  for (const entry of diagram.traffic ?? []) {
    const useCase = findUseCase(diagram, entry.useCase);
    if (!useCase) {
      warnings.push(`Traffic for unknown use case "${entry.useCase}" is ignored`);
      continue;
    }
    if (seen.has(useCase.id)) continue;
    seen.add(useCase.id);
    const shares = useCase.scenarios.map(() => 0);
    for (const { scenario, share } of entry.mix ?? []) {
      const found = findScenario(useCase, scenario);
      if (found) shares[useCase.scenarios.indexOf(found)] += share;
      else warnings.push(`"${useCase.name}" has no scenario "${scenario}"; its traffic share is ignored`);
    }
    const total = shares.reduce((a, b) => a + b, 0);
    if (total <= 0) shares[0] = 1;
    else {
      if (Math.abs(total - 1) > 1e-6) warnings.push(`Traffic mix of "${useCase.name}" adds up to ${formatPercent(total)}; shares are scaled to 100%`);
      for (let i = 0; i < shares.length; i++) shares[i] /= total;
    }
    const average = entry.avgRps === undefined ? undefined : entry.rps > 0 ? entry.avgRps / entry.rps : 1;
    result.set(useCase.id, { rps: entry.rps, shares: useCase.scenarios.length ? shares : [], ...(average !== undefined ? { average } : {}) });
  }
  return result;
}

/**
 * `resolveTraffic` with the what-if options applied: `trafficRps` overrides
 * the rates, and `failed` moves the shares of scenarios that need a failed
 * node to their fallback scenarios. Without either option it is exactly
 * `resolveTraffic`.
 */
export function trafficFor(diagram: Diagram, options: AnalyzeOptions = {}, warnings: string[] = []): Map<string, UseCaseTraffic> {
  const traffic = resolveTraffic(diagram, warnings);
  for (const [id, rps] of options.trafficRps ?? []) {
    const t = traffic.get(id);
    if (t) t.rps = Math.max(0, rps);
  }
  const hits = hitRatesOf(diagram, options);
  if (hits.size) {
    const kinds = new Map(diagram.nodes.map((n) => [n.id, nodeKind(n)]));
    const access = accessIn(diagram);
    for (const u of diagram.useCases) {
      // A use case that splits its traffic over scenarios models hits and misses itself: the mix wins.
      if (diagram.traffic?.some((e) => e.mix?.length && findUseCase(diagram, e.useCase) === u)) continue;
      const lookups = cacheLookups(u, hits, (id) => kinds.get(id), (step) => access(step) === 'read');
      const miss = missFactors(lookups);
      if (miss.size) traffic.set(u.id, { ...traffic.get(u.id)!, miss, lookups });
    }
  }
  const retries = retriesOf(diagram, options);
  if (retries.size) {
    for (const u of diagram.useCases) {
      const retry = new Map<DiagramStep, number>();
      for (const s of u.scenarios) for (const step of s.steps) if (!step.failed && retries.has(step.toServiceId)) retry.set(step, retries.get(step.toServiceId)!.attempts);
      if (retry.size) traffic.set(u.id, { ...traffic.get(u.id)!, retry });
    }
  }
  const failed = options.failed;
  if (!failed?.size) return traffic;
  for (const u of diagram.useCases) {
    const t = traffic.get(u.id)!;
    const down = (s: DiagramUseCase['scenarios'][number]) => pathNodes(u, s).filter((id) => failed.has(id));
    const shares = [...t.shares];
    let stranded = 0;
    u.scenarios.forEach((s, i) => {
      if (!(shares[i] > 0)) return;
      const ids = down(s);
      if (ids.length === 0) return;
      // Fallbacks for the failed node this scenario needs, that do not need another failed node.
      const targets = u.scenarios.filter((f) => f.outcome === 'success' && down(f).length === 0 && ids.every((id) => fallbacksFor(u, id).includes(f)));
      if (targets.length === 0) {
        stranded += shares[i];
        return;
      }
      const indexes = targets.map((f) => u.scenarios.indexOf(f));
      const weight = indexes.reduce((sum, j) => sum + t.shares[j], 0);
      for (const j of indexes) shares[j] += shares[i] * (weight > 0 ? t.shares[j] / weight : 1 / indexes.length);
      shares[i] = 0;
    });
    traffic.set(u.id, { ...t, shares, stranded: Math.min(1, stranded) });
  }
  return traffic;
}

/** Hit rates (0..100) by node: `capacity { n hit … }`, with the what-if's `hitRates` on top. */
function hitRatesOf(diagram: Diagram, options: AnalyzeOptions): Map<string, number> {
  const hits = new Map<string, number>();
  for (const o of diagram.capacity ?? []) if (o.hitPercent !== undefined) hits.set(o.node, o.hitPercent);
  for (const [id, percent] of options.hitRates ?? []) hits.set(id, percent);
  return hits;
}

/** A node's error rate (0..1) and retries, with what they lead to; see `RetryAnalysis`. */
export interface Retry {
  errorRate: number;
  retries: number;
  attempts: number;
  success: number;
}

/** `Σ e^k` for k = 0..retries: the calls a request makes on average when each fails with probability e. */
export const expectedAttempts = (e: number, retries: number): number => {
  let sum = 0;
  for (let k = 0; k <= retries; k++) sum += e ** k;
  return sum;
};

/**
 * Error rates and retries by node: `capacity { n errors … retries … }`, with
 * the what-if's `errorRates` on top. Only nodes with an error rate; a what-if
 * error rate on a node without `retries` has none.
 */
export function retriesOf(diagram: Diagram, options: AnalyzeOptions = {}): Map<string, Retry> {
  const out = new Map<string, Retry>();
  const set = (id: string, percent: number, retries: number) => {
    const e = Math.min(100, Math.max(0, percent)) / 100;
    out.set(id, { errorRate: e, retries, attempts: expectedAttempts(e, retries), success: 1 - e ** (retries + 1) });
  };
  const declared = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (o.errorPercent !== undefined) set(o.node, o.errorPercent, o.retries ?? 0);
  for (const [id, percent] of options.errorRates ?? []) set(id, percent, declared.get(id)?.retries ?? 0);
  return out;
}

/**
 * A path's variants under retries (§1.5 of the model page): each hop to a
 * node with an error rate and retries takes k + 1 attempts, with probability
 * `e^k (1 − e)` for k < retries and `e^retries` for the last. Combinations
 * are independent; past `MAX_RETRY_VARIANTS` the least likely are dropped
 * and the rest scaled up.
 */
export function retryVariants(hops: Hop[][], retries: ReadonlyMap<string, Retry>): { share: number; hops: Hop[][] }[] {
  let out: { share: number; hops: Hop[][] }[] = [{ share: 1, hops }];
  hops.forEach((part, p) =>
    part.forEach((h, i) => {
      const r = retries.get(h.target);
      if (!r || h.failed || r.retries === 0 || r.errorRate <= 0) return;
      const next: typeof out = [];
      for (const v of out) {
        for (let k = 0; k <= r.retries; k++) {
          const share = v.share * (k < r.retries ? r.errorRate ** k * (1 - r.errorRate) : r.errorRate ** k);
          if (share <= 0) continue;
          if (k === 0) {
            next.push({ share, hops: v.hops });
            continue;
          }
          const changed = v.hops.map((q, j) => (j === p ? q.map((x, n) => (n === i ? { ...x, attempts: k + 1 } : x)) : q));
          next.push({ share, hops: changed });
        }
      }
      out = next;
      if (out.length > MAX_RETRY_VARIANTS) {
        out = out
          .map((v, n) => ({ v, n }))
          .sort((a, b) => b.v.share - a.v.share || a.n - b.n)
          .slice(0, MAX_RETRY_VARIANTS)
          .map(({ v }) => v);
        const total = out.reduce((sum, v) => sum + v.share, 0);
        out = out.map((v) => ({ ...v, share: v.share / total }));
      }
    }),
  );
  return out;
}

/** The most retry variants one scenario path is split into. */
export const MAX_RETRY_VARIANTS = 256;

/** Kinds a cache-aside miss falls through to: the stores behind a cache. */
const BACKING_STORES: readonly Kind[] = ['database', 'search', 'analytics', 'storage'];

/** One read of a cache with a hit rate: the hit rate, 0..1, and the steps only a miss takes. */
export interface CacheLookup {
  hit: number;
  miss: Set<DiagramStep>;
}

/**
 * The miss path of every read of a cache with a hit rate, per scenario of
 * `useCase`: later steps sent by the cache itself (read-through, a CDN's
 * origin fetch), later reads by the caller from a backing store (cache-aside),
 * the steps those nodes send in turn, and the caller's write back to the
 * cache once it has missed (the fill).
 */
export function cacheLookups(
  useCase: DiagramUseCase,
  hits: ReadonlyMap<string, number>,
  kindOf: (id: string) => Kind | undefined,
  isRead: (step: DiagramStep) => boolean,
): CacheLookup[][] {
  return useCase.scenarios.map((s) => {
    const lookups: CacheLookup[] = [];
    s.steps.forEach((lookup, i) => {
      const hit = hits.get(lookup.toServiceId);
      if (hit === undefined || lookup.failed || !isRead(lookup)) return;
      const caller = lookup.fromServiceId;
      const reached = new Set([lookup.toServiceId]);
      const miss = new Set<DiagramStep>();
      for (const step of s.steps.slice(i + 1)) {
        const fill = miss.size > 0 && step.fromServiceId === caller && step.toServiceId === lookup.toServiceId && !isRead(step);
        const fallsThrough = reached.has(step.fromServiceId) || (step.fromServiceId === caller && isRead(step) && BACKING_STORES.includes(kindOf(step.toServiceId)!));
        if (fill) miss.add(step);
        if (!fallsThrough || step.toServiceId === caller) continue;
        reached.add(step.toServiceId);
        miss.add(step);
      }
      if (miss.size) lookups.push({ hit: Math.min(100, Math.max(0, hit)) / 100, miss });
    });
    return lookups;
  });
}

/** The share of the rate each miss-path step gets: `1 − hit`, and behind two caches the product. */
export function missFactors(lookups: CacheLookup[][]): Map<DiagramStep, number> {
  const factors = new Map<DiagramStep, number>();
  for (const l of lookups.flat()) for (const step of l.miss) factors.set(step, (factors.get(step) ?? 1) * (1 - l.hit));
  return factors;
}

/**
 * A scenario's paths under its cache reads: every combination of hits and
 * misses (independent, by each cache's hit rate), the steps of a hit's miss
 * path left out. Combinations of probability 0 are dropped.
 */
export function cacheVariants(hops: Hop[][], lookups: CacheLookup[]): { share: number; hops: Hop[][] }[] {
  const out: { share: number; hops: Hop[][] }[] = [];
  const n = Math.min(lookups.length, 10);
  for (let mask = 0; mask < 1 << n; mask++) {
    let share = 1;
    const skipped = new Set<DiagramStep>();
    for (let k = 0; k < n; k++) {
      const hit = (mask >> k) & 1;
      share *= hit ? lookups[k].hit : 1 - lookups[k].hit;
      if (hit) for (const step of lookups[k].miss) skipped.add(step);
    }
    if (share <= 0) continue;
    out.push({ share, hops: hops.map((part) => part.filter((h) => !skipped.has(h.step))).filter((part) => part.length) });
  }
  return out;
}

/**
 * Requests per second each use case sends each node (fan-out and cache
 * misses included, failed calls not): by node id, then use case name. The
 * same rates `computeLoad` adds up.
 */
export function loadByUseCase(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, Map<string, number>> {
  const loadBy = new Map<string, Map<string, number>>();
  forEachStepRate(diagram, traffic, (step, rate, u) => {
    const byUseCase = loadBy.get(step.toServiceId) ?? new Map<string, number>();
    byUseCase.set(u.name, (byUseCase.get(u.name) ?? 0) + rate * multiplierOf(step));
    loadBy.set(step.toServiceId, byUseCase);
  });
  return loadBy;
}

/**
 * The traffic at its average: each use case with `peak` traffic at its
 * average rate, the others unchanged. Egress, a monthly bill, is costed at
 * it; everything else is taken at the peak. Without `peak` traffic it is
 * `traffic` itself.
 */
export function averageTraffic(traffic: Map<string, UseCaseTraffic>): Map<string, UseCaseTraffic> {
  if (![...traffic.values()].some((t) => t.average !== undefined)) return traffic;
  return new Map([...traffic].map(([id, t]) => [id, t.average === undefined ? t : { ...t, rps: t.rps * t.average }]));
}

/** Times the step happens per request (`x200 …`, §7.3); 1 when absent. */
export const multiplierOf = (step: DiagramStep): number => (step.multiplier !== undefined && step.multiplier > 0 ? step.multiplier : 1);

/** The `latency` multiplier of the target type's operation a step names (`op read Scan latency 8`); 1 without one. */
export const opLatencyOf = (step: DiagramStep): number => (step.op?.latency !== undefined && step.op.latency > 0 ? step.op.latency : 1);

/** The `cost` multiplier of the operation a step names: how many requests of load one call puts on the target; 1 without one. */
export const opCostOf = (step: DiagramStep): number => (step.op?.cost !== undefined && step.op.cost > 0 ? step.op.cost : 1);

/** Requests per second a node receives, split by access (§7.2). */
export interface Load {
  read: number;
  write: number;
}

/**
 * Calls `visit` with every request step that carries traffic and its rate
 * `R · m(s)` (fan-out not applied). A failed call (`-x`) is skipped: its
 * target is down in that scenario, so it receives nothing, and nothing is
 * sent back.
 */
export function forEachStepRate(diagram: Diagram, traffic: Map<string, UseCaseTraffic>, visit: (step: DiagramStep, rate: number, useCase: DiagramUseCase) => void) {
  for (const u of diagram.useCases) {
    const { rps, shares, miss, retry } = traffic.get(u.id) ?? { rps: 0, shares: [] };
    u.scenarios.forEach((s, i) => {
      const rate = rps * (shares[i] ?? 0);
      if (!(rate > 0)) return;
      for (const step of s.steps) {
        if (step.failed) continue;
        const r = miss?.has(step) ? rate * miss.get(step)! : rate;
        visit(step, retry?.has(step) ? r * retry.get(step)! : r, u);
      }
    });
  }
}

/**
 * `R · m(s) · multiplier · cost` on the target of every request step that
 * gets through (`->`, `->>`; not `-x`), split into reads and writes (§2.2,
 * §7.2, §7.3). `cost` is the `cost` multiplier of the target type's operation
 * the step names (1 without one): a costlier operation uses more of the
 * node's capacity, and so of the replicas its monthly cost pays for.
 */
export function computeLoad(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, Load> {
  const load = new Map<string, Load>();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    const entry = load.get(step.toServiceId) ?? { read: 0, write: 0 };
    entry[access(step)] += rate * multiplierOf(step) * opCostOf(step);
    load.set(step.toServiceId, entry);
  });
  return load;
}

/**
 * Where a step's payload goes (§7.3): from the target back to the sender
 * for a read (it answers with the payload), from the sender to the target
 * for a write (it sends it).
 */
export const payloadDirection = (step: DiagramStep, access: 'read' | 'write'): { from: string; to: string } =>
  access === 'read' ? { from: step.toServiceId, to: step.fromServiceId } : { from: step.fromServiceId, to: step.toServiceId };

/** Kinds outside your network: a payload sent to one of them leaves it, and is charged as internet egress. */
export const OUTSIDE = (kind: Kind): boolean => kind === 'client' || kind === 'external';

/**
 * GB per month each node sends out of your network:
 * `rps × share × multiplier × size × 2 592 000 s ÷ 10⁹`, for payloads that go
 * to a client or a third party. Payloads between your own nodes (storage to a
 * service, a CDN's origin fetch) are internal and free; payloads a client or
 * a third party sends are not your bill.
 */
export function computeEgressGb(diagram: Diagram, traffic: Map<string, UseCaseTraffic>, kindOf: (id: string) => Kind = (id) => profileOfId(diagram, id)): Map<string, number> {
  const gb = new Map<string, number>();
  const access = accessIn(diagram);
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (!step.sizeBytes || step.sizeBytes <= 0) return;
    const { from, to } = payloadDirection(step, access(step));
    if (OUTSIDE(kindOf(from)) || !OUTSIDE(kindOf(to))) return;
    gb.set(from, (gb.get(from) ?? 0) + (rate * multiplierOf(step) * step.sizeBytes * SECONDS_PER_MONTH) / BYTES_PER_GB);
  });
  return gb;
}

/**
 * Kinds whose bandwidth is a limit: the ones you run on instances. Object
 * storage and CDNs scale out behind one name (their bandwidth is the speed of
 * one connection, for transfer time); clients, third parties and DNS are not
 * yours to size.
 */
export const BANDWIDTH_BOUND = (kind: Kind): boolean => !['client', 'external', 'dns', 'other', 'storage', 'cdn'].includes(kind);

/** Bytes per second each node sends or receives in payloads (both ends of every sized step). */
export function computeBytesPerSecond(diagram: Diagram, traffic: Map<string, UseCaseTraffic>): Map<string, number> {
  const bytes = new Map<string, number>();
  forEachStepRate(diagram, traffic, (step, rate) => {
    if (!step.sizeBytes || step.sizeBytes <= 0) return;
    const b = rate * multiplierOf(step) * step.sizeBytes;
    for (const id of new Set([step.fromServiceId, step.toServiceId])) bytes.set(id, (bytes.get(id) ?? 0) + b);
  });
  return bytes;
}

function profileOfId(diagram: Diagram, id: string): Kind {
  const node = diagram.nodes.find((n) => n.id === id);
  return node ? profileOf(node).kind : 'client';
}

/**
 * Time to move a step's payload (§7.3): `N × size ÷ bandwidth`, at the
 * slower of the sender's and the receiver's per-replica bandwidth. A fan-out
 * of N moves N payloads over the caller's link, batched or in parallel.
 */
export function transferMs(step: DiagramStep, bandwidthOf: (id: string) => number): number {
  if (!step.sizeBytes || step.sizeBytes <= 0) return 0;
  const mbps = Math.min(bandwidthOf(step.fromServiceId), bandwidthOf(step.toServiceId));
  return mbps > 0 && Number.isFinite(mbps) ? ((multiplierOf(step) * step.sizeBytes) / BYTES_PER_MB / mbps) * 1000 : 0;
}

export const utilizationOf = (load: number, capacity: number): number => (Number.isFinite(capacity) && capacity > 0 ? load / capacity : 0);

/**
 * Erlang C: the probability that a request waits in an M/M/c queue with
 * `servers` servers at utilisation `rho` (per server), computed through the
 * stable Erlang B recurrence. 0 when idle, 1 at or past saturation; for one
 * server it is `rho`.
 */
export function erlangC(servers: number, rho: number): number {
  if (rho <= 0) return 0;
  if (rho >= 1) return 1;
  const c = Math.max(1, Math.round(servers));
  const a = c * rho;
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  return b / (1 - rho * (1 - b));
}

/**
 * One hop's response time (§1.4, §1.5 of the model page), as a fixed part
 * plus an exponential tail: `fixed + Exp(tail)`. The mean is the M/M/c
 * response time, a service time `base` plus the mean queueing delay
 * `C · base ÷ (c · (1 − ρ))`; half the service time is fixed
 * (`SERVICE_SPREAD`) and the rest of the mean is the tail. An idle hop's
 * p99 is 2.8× its mean; as queueing grows, the tail grows with it, towards
 * the 4.6× of an exponential.
 */
export interface HopModel {
  fixedMs: number;
  tailMs: number;
  /** Erlang C: the probability that a request waits in the queue. */
  waitProbability: number;
}

/** The hop model of a node with base latency `baseMs`, at utilisation `rho` (capped at 95%), with `servers` servers. */
export function hopModel(baseMs: number, rho: number, servers = 1): HopModel {
  const r = Math.min(Math.max(rho, 0), QUEUE_CAP);
  const c = Math.max(1, Math.round(servers));
  const waitProbability = erlangC(c, r);
  const meanMs = baseMs + (waitProbability * baseMs) / (c * (1 - r));
  const fixedMs = (1 - SERVICE_SPREAD) * baseMs;
  return { fixedMs, tailMs: meanMs - fixedMs, waitProbability };
}

/** Mean response time of a hop: `base + C · base ÷ (c(1 − ρ))`, which is `base ÷ (1 − ρ)` for one server. */
export const hopMean = (h: Pick<HopModel, 'fixedMs' | 'tailMs'>): number => h.fixedMs + h.tailMs;

/** `ln(1 ÷ (1 − p))`: the p-quantile of an exponential with mean 1 (0.69 at p50, 4.6 at p99). */
export const tailFactor = (p: number): number => -Math.log(1 - p);

/** The p-quantile (0 ≤ p < 1) of a hop's response time: `fixed + tail · ln(1 ÷ (1 − p))`. */
export const hopQuantile = (h: Pick<HopModel, 'fixedMs' | 'tailMs'>, p: number): number => h.fixedMs + h.tailMs * tailFactor(p);

/** Mean hop latency for base latency `baseMs` at utilisation `rho` with `servers` servers (M/M/1 for one). */
export const hopLatency = (baseMs: number, utilization: number, servers = 1): number => hopMean(hopModel(baseMs, utilization, servers));

/** `A = 1 − (1 − a)^replicas` */
export const replicatedAvailability = (a: number, replicas: number): number => 1 - (1 - a) ** replicas;

/**
 * Availability of a single-primary store's writes: the primary's, except
 * that with another replica to promote only the failover window is lost:
 * `1 − (1 − a) × FAILOVER_SHARE`.
 */
export const primaryAvailability = (a: number, replicas: number): number => (replicas >= 2 ? 1 - (1 - a) * FAILOVER_SHARE : a);

/** The load and capacity fields of a node analysis. */
export type Usage = Pick<
  NodeAnalysis,
  | 'loadRps'
  | 'capacityRps'
  | 'utilization'
  | 'requestUtilization'
  | 'saturated'
  | 'readLoadRps'
  | 'writeLoadRps'
  | 'readCapacityRps'
  | 'writeCapacityRps'
  | 'readUtilization'
  | 'writeUtilization'
  | 'bandwidthLoadMBps'
  | 'bandwidthCapacityMBps'
  | 'bandwidthUtilization'
  | 'writeScaling'
>;

/**
 * Load, capacity and utilisation of a node with `replicas` replicas under the
 * given read and write load (§7.2) and payload bytes per second (§7.3).
 */
export function usageOf(p: Profile, replicas: number, readLoadRps: number, writeLoadRps: number, bytesPerSecond = 0): Usage {
  const { readRps: readCapacityRps, writeRps: writeCapacityRps } = capacityOf(p, replicas);
  const readUtilization = utilizationOf(readLoadRps, readCapacityRps);
  const writeUtilization = utilizationOf(writeLoadRps, writeCapacityRps);
  const requestUtilization = combinedUtilization(p, readUtilization, writeUtilization);
  const loadRps = readLoadRps + writeLoadRps;
  const bound = BANDWIDTH_BOUND(p.kind);
  const bandwidthLoadMBps = bound ? bytesPerSecond / BYTES_PER_MB : 0;
  const bandwidthCapacityMBps = bound ? p.bandwidthMBps * replicas * p.shards : 0;
  const bandwidthUtilization = utilizationOf(bandwidthLoadMBps, bandwidthCapacityMBps);
  const utilization = Math.max(requestUtilization, bandwidthUtilization);
  return {
    loadRps,
    capacityRps: readCapacityRps === writeCapacityRps || requestUtilization === 0 ? readCapacityRps : loadRps / requestUtilization,
    utilization,
    requestUtilization,
    saturated: utilization >= 1,
    readLoadRps,
    writeLoadRps,
    readCapacityRps,
    writeCapacityRps,
    readUtilization,
    writeUtilization,
    bandwidthLoadMBps,
    bandwidthCapacityMBps,
    bandwidthUtilization,
    writeScaling: p.writeScaling,
  };
}

/** Bandwidth, not requests, is what fills the node. */
export const bandwidthBound = (n: Usage): boolean => n.bandwidthUtilization > n.requestUtilization;

/**
 * How many servers a request queues for (§1.4): load is spread evenly over
 * the shards, and a key's requests can only go to its own shard, so the pool
 * is one shard's replicas; a single-primary store whose writes are the busier
 * side queues them for its one primary.
 */
export const serversOf = (n: Usage, replicas: number): number => (writeBound(n) ? 1 : replicas);

/**
 * `12k of 20k, 60%`; for a single-primary store that takes writes, reads and
 * writes separately: `reads 10k of 20k, 50%; writes 2k of 5k, 40%`.
 */
export function usageText(n: Usage): string {
  const part = (load: number, capacity: number, rho: number) => `${formatRps(load)} of ${formatRps(capacity)}, ${formatPercent(rho)}`;
  if (bandwidthBound(n)) {
    const mb = (x: number) => `${Number(x.toPrecision(3)).toLocaleString('en-US')} MB/s`;
    return `bandwidth ${mb(n.bandwidthLoadMBps)} of ${mb(n.bandwidthCapacityMBps)}, ${formatPercent(n.bandwidthUtilization)}`;
  }
  if (n.writeScaling === 'shards' && n.writeLoadRps > 0) {
    // Only the dimension that is loaded: no "reads 0 rps of 60k rps, 0%".
    if (n.readLoadRps <= 0) return `writes ${part(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization)}`;
    return `reads ${part(n.readLoadRps, n.readCapacityRps, n.readUtilization)}; writes ${part(n.writeLoadRps, n.writeCapacityRps, n.writeUtilization)}`;
  }
  return part(n.loadRps, n.capacityRps, n.requestUtilization);
}

/** Writes are what saturates the node, and replicas cannot help with them (a single-primary store). */
export const writeBound = (n: Usage): boolean => n.writeScaling === 'shards' && n.writeUtilization >= n.readUtilization && n.writeLoadRps > 0;

/**
 * A scenario's synchronous critical path: parts in sequence, each the
 * slowest of its parallel items. An item is a fixed time (a timeout, a
 * transfer, the fixed half of a service time) plus an exponential tail.
 */
export interface PathModel {
  parts: { fixedMs: number; tailMs: number }[][];
}

/** Mean of a path: per part the largest item mean, summed. */
export function pathMean(path: PathModel): number {
  return path.parts.reduce((sum, part) => sum + Math.max(0, ...part.map((i) => i.fixedMs + i.tailMs)), 0);
}

/** A path's quantile at tail factor `l` (`ln(1 ÷ (1 − p))`): per part the largest item, summed. */
function pathAt(path: PathModel, l: number): number {
  let sum = 0;
  for (const part of path.parts) {
    let most = 0;
    for (const i of part) most = Math.max(most, i.fixedMs + i.tailMs * l);
    sum += most;
  }
  return sum;
}

/**
 * The p-quantile of a path: each item at its own p-quantile, the largest of
 * each part, summed. Fixed costs (timeouts, transfer time) add once; only the
 * hops' tails grow with p. Taking every hop at the same quantile treats slow
 * hops as coming together, which errs on the slow side for long paths.
 */
export const pathQuantile = (path: PathModel, p: number): number => pathAt(path, tailFactor(p));

/** `P(latency ≤ t)` for a path: `1 − e^(−l)` for the largest tail factor l whose quantile is at most t. */
export function pathCdf(path: PathModel, t: number): number {
  if (pathAt(path, 0) > t) return 0;
  // Without par groups the quantile is linear in l, `F + T·l`, so l = (t − F) / T exactly.
  if (path.parts.every((part) => part.length <= 1)) {
    let fixed = 0;
    let tail = 0;
    for (const part of path.parts) {
      if (part.length) {
        fixed += part[0].fixedMs;
        tail += part[0].tailMs;
      }
    }
    if (tail <= 0) return 1;
    const l = (t - fixed) / tail;
    return l > 1e6 ? 1 : 1 - Math.exp(-l);
  }
  let hi = 1;
  while (pathAt(path, hi) <= t) {
    hi *= 2;
    if (hi > 1e6) return 1; // no tail, or t is past any quantile that matters
  }
  let lo = 0;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (pathAt(path, mid) <= t) lo = mid;
    else hi = mid;
  }
  return 1 - Math.exp(-lo);
}

/**
 * The q-quantile (0..1) of a use case's latency, the mixture of its
 * scenarios weighted by their shares: the t with `Σ share(s) · P(s ≤ t) = q`,
 * found by bisection. A single scenario is its own quantile.
 */
export function mixtureQuantile(paths: { share: number; path: PathModel }[], q: number): number {
  const live = paths.filter((s) => s.share > 0);
  if (live.length === 0) return 0;
  if (live.length === 1) return pathQuantile(live[0].path, q);
  const total = live.reduce((sum, s) => sum + s.share, 0);
  const cdf = (t: number) => live.reduce((sum, s) => sum + s.share * pathCdf(s.path, t), 0) / total;
  let lo = Math.min(...live.map((s) => pathQuantile(s.path, 0)));
  let hi = Math.max(...live.map((s) => pathQuantile(s.path, q)));
  for (let i = 0; i < 60 && hi - lo > 1e-9 * Math.max(1, hi); i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) >= q) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Index of the scenario with the largest share (the first on ties). */
export function mainScenarioIndex(shares: number[]): number {
  let best = 0;
  shares.forEach((share, i) => {
    if (share > shares[best]) best = i;
  });
  return best;
}

/** Profiles of every component, with `capacity` overrides; warns about overrides for unknown nodes. */
export function profilesOf(diagram: Diagram, warnings: string[] = []): Map<string, Profile> {
  const nodes = components(diagram);
  const ids = new Set(nodes.map((n) => n.id));
  const overrides = new Map((diagram.capacity ?? []).map((o) => [o.node, o]));
  for (const o of diagram.capacity ?? []) if (!ids.has(o.node)) warnings.push(`Capacity for unknown node '${o.node}' is ignored`);
  return new Map<string, Profile>(nodes.map((n) => [n.id, profileOf(n, overrides.get(n.id))]));
}

export function analyze(diagram: Diagram, options: AnalyzeOptions = {}): Analysis {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const warnings: string[] = [];
  const nodes = components(diagram);
  const profiles = profilesOf(diagram, warnings);
  const kindOf = (id: string): Kind => profiles.get(id)?.kind ?? 'client';

  const traffic = trafficFor(diagram, options, warnings);
  const retries = retriesOf(diagram, options);
  const drains = new Map((diagram.capacity ?? []).flatMap((o) => (o.drainRps !== undefined ? [[o.node, o.drainRps] as const] : [])));
  const load = computeLoad(diagram, traffic);
  const egress = computeEgressGb(diagram, averageTraffic(traffic), kindOf);
  const bytes = computeBytesPerSecond(diagram, traffic);
  const systems = diagram.systems?.length ? analyzeSystems(diagram, traffic, options) : undefined;

  const hops = new Map<string, HopModel>();
  const nodeResults: NodeAnalysis[] = nodes.map((n) => {
    const p = profiles.get(n.id)!;
    const replicas = Math.max(1, options.replicas?.get(n.id) ?? replicasOf(n));
    const { read, write } = load.get(n.id) ?? { read: 0, write: 0 };
    const usage = usageOf(p, replicas, read, write, bytes.get(n.id) ?? 0);
    const servers = serversOf(usage, replicas);
    const hop = hopModel(p.latencyMs, usage.utilization, servers);
    hops.set(n.id, hop);
    const egressGbPerMonth = egress.get(n.id) ?? 0;
    const egressUsd = egressGbPerMonth * p.egressUsdPerGb;
    const down = options.failed?.has(n.id) ?? false;
    const availability = down ? 0 : replicatedAvailability(p.availability, replicas);
    return {
      id: n.id,
      kind: p.kind,
      replicas,
      shards: p.shards,
      ...usage,
      ...(p.consistency ? { consistency: p.consistency } : {}),
      servers,
      waitProbability: hop.waitProbability,
      latencyMs: hopMean(hop),
      availability,
      writeAvailability: down ? 0 : p.writeScaling === 'shards' ? primaryAvailability(p.availability, replicas) : availability,
      costUsd: replicas * p.shards * p.costUsd + egressUsd,
      egressGbPerMonth,
      egressUsd,
      durable: p.durable,
      ...(down ? { failed: true as const } : {}),
      ...(drains.has(n.id) ? { queue: queueOf(read + write, drains.get(n.id)!) } : {}),
      ...(retries.has(n.id) ? { retry: { ...retries.get(n.id)!, stormRisk: usage.utilization >= HOT && retries.get(n.id)!.retries > 0 && retries.get(n.id)!.errorRate > 0 } } : {}),
    };
  });
  const nodeById = new Map(nodeResults.map((n) => [n.id, n]));
  const bandwidthOf = (id: string) => profiles.get(id)?.bandwidthMBps ?? Infinity;
  const timeoutOf = (id: string) => profiles.get(id)?.timeoutMs ?? defaultTimeoutMs;

  for (const n of nodeResults) {
    const usage = usageText(n);
    if (n.saturated) warnings.push(`'${n.id}' is saturated: ${usage}. ${writeBound(n) ? 'Add shards for writes' : 'Add replicas'} or take load off it.`);
    else if (n.utilization > HOT) warnings.push(`'${n.id}' runs hot: ${usage}.`);
  }
  for (const n of nodeResults) {
    if (!n.queue || n.queue.backlogPerHour <= 0) continue;
    warnings.push(
      `'${n.id}' falls behind: ${formatRps(n.queue.inflowRps)} flows in and its consumers drain ${formatRps(n.queue.drainRps)}, so the backlog grows by ${formatCount(n.queue.backlogPerHour)} messages an hour. Drain faster or send it less.`,
    );
  }
  for (const n of nodeResults) {
    if (!n.retry?.stormRisk) continue;
    const { errorRate, retries: r } = n.retry;
    warnings.push(
      `'${n.id}' risks a retry storm: it runs at ${formatPercent(n.utilization)} with ${formatPercent(errorRate)} errors and ${r} ${r === 1 ? 'retry' : 'retries'}. Once it saturates, more calls fail and each comes back up to ${r} more times, up to ${formatRps((n.loadRps / n.retry.attempts) * (r + 1))}. Add capacity, retry less, or back off.`,
    );
  }
  for (const s of systems?.systems ?? []) warnings.push(...s.warnings);

  const access = accessIn(diagram);
  const pathOf = (hopsOfPath: Hop[][]): PathModel => ({
    parts: hopsOfPath.map((part) =>
      part.map((h) => {
        if (h.failed) return { fixedMs: timeoutOf(h.target), tailMs: 0 };
        const hop = systems?.hop(h.target, h.step.toPort) ?? hops.get(h.target) ?? { fixedMs: 0, tailMs: 0 };
        // The operation's `latency` multiplier scales the target's service time, not the transfer.
        const op = opLatencyOf(h.step);
        const item = { fixedMs: transferMs(h.step, bandwidthOf) + hop.fixedMs * op, tailMs: hop.tailMs * op };
        // A retry variant: each attempt takes the whole hop again (no backoff).
        return h.attempts === undefined ? item : { fixedMs: item.fixedMs * h.attempts, tailMs: item.tailMs * h.attempts };
      }),
    ),
  });

  const useCases: UseCaseAnalysis[] = diagram.useCases.map((u) => {
    const { rps, shares, stranded, average, lookups, retry } = traffic.get(u.id)!;
    const availabilityOf = (id: string, writes: Set<string>) => {
      const n = nodeById.get(id);
      if (!n && systems) return systemAvailability(u, id, systems.availability);
      return !n ? 1 : writes.has(id) ? n.writeAvailability : n.availability;
    };
    // With retries, a call fails only when every attempt does.
    const withRetries = (writes: Set<string>) => (id: string) => (retries.has(id) ? availabilityOf(id, writes) * retries.get(id)!.success : availabilityOf(id, writes));
    if (lookups || retry) {
      const { scenarios, percentiles, tailScenario } = cachedLatency(u, shares, lookups ?? [], retry ? retries : new Map(), pathOf, new Set(options.percentiles ?? PERCENTILES));
      const writes = mainWrites(u, shares, (step) => access(step) === 'write');
      const availability = useCaseAvailability(u, shares, retries.size ? withRetries(writes) : (id) => availabilityOf(id, writes)) * (1 - (stranded ?? 0));
      return { id: u.id, name: u.name, rps, ...(average !== undefined ? { avgRps: rps * average } : {}), scenarios, percentiles, tailScenario, availability };
    }
    const paths = u.scenarios.map((s) => pathOf(criticalPath(u, s)));
    const scenarios: ScenarioAnalysis[] = u.scenarios.map((s, i) => ({
      id: s.id,
      name: s.name,
      share: shares[i] ?? 0,
      meanMs: pathMean(paths[i]),
      percentiles: Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], pathQuantile(paths[i], q / 100)])) as Percentiles,
    }));
    const weighted = paths.map((path, i) => ({ share: shares[i] ?? 0, path }));
    const wanted = new Set(options.percentiles ?? PERCENTILES);
    const percentiles = Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], wanted.has(q) ? mixtureQuantile(weighted, q / 100) : NaN])) as Percentiles;
    const tailScenario = Object.fromEntries(
      PERCENTILES.map((q) => {
        if (!wanted.has(q)) return [PERCENTILE_KEYS[q], 0];
        const t = percentiles[PERCENTILE_KEYS[q]];
        const above = weighted.map((s) => (s.share > 0 ? s.share * (1 - pathCdf(s.path, t * (1 - 1e-9))) : -1));
        return [PERCENTILE_KEYS[q], Math.max(0, above.indexOf(Math.max(...above)))];
      }),
    ) as UseCaseAnalysis['tailScenario'];
    if (rps > 0 && u.scenarios.length === 0) warnings.push(`"${u.name}" has traffic but no steps`);
    const writes = mainWrites(u, shares, (step) => access(step) === 'write');
    const availability = useCaseAvailability(u, shares, retries.size ? withRetries(writes) : (id) => availabilityOf(id, writes)) * (1 - (stranded ?? 0));
    return { id: u.id, name: u.name, rps, ...(average !== undefined ? { avgRps: rps * average } : {}), scenarios, percentiles, tailScenario, availability };
  });

  return {
    nodes: nodeResults,
    useCases,
    totalCostUsd: nodeResults.reduce((sum, n) => sum + n.costUsd, 0),
    totalEgressUsd: nodeResults.reduce((sum, n) => sum + n.egressUsd, 0),
    singlePointsOfFailure: singlePointsOfFailure(diagram),
    warnings,
    ...(systems ? { systems: systems.systems } : {}),
  };
}

/**
 * Latency of a use case whose scenarios read caches with a hit rate or call
 * nodes with retries: each scenario is the mixture of its hit and miss
 * variants (`cacheVariants`), each of those split by how many attempts its
 * retried hops take (`retryVariants`), and the use case the mixture of all of
 * them weighted by scenario share, exactly as an explicit `alt` per variant
 * with a `mix` would be.
 */
function cachedLatency(
  u: DiagramUseCase,
  shares: number[],
  lookups: CacheLookup[][],
  retries: ReadonlyMap<string, Retry>,
  pathOf: (hops: Hop[][]) => PathModel,
  wanted: Set<Percentile>,
): Pick<UseCaseAnalysis, 'scenarios' | 'percentiles' | 'tailScenario'> {
  const variants = u.scenarios.map((s, i) =>
    cacheVariants(criticalPath(u, s), lookups[i] ?? []).flatMap((v) =>
      retries.size ? retryVariants(v.hops, retries).map((r) => ({ share: v.share * r.share, path: pathOf(r.hops) })) : [{ share: v.share, path: pathOf(v.hops) }],
    ),
  );
  const scenarios: ScenarioAnalysis[] = u.scenarios.map((s, i) => ({
    id: s.id,
    name: s.name,
    share: shares[i] ?? 0,
    meanMs: variants[i].reduce((sum, v) => sum + v.share * pathMean(v.path), 0),
    percentiles: Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], mixtureQuantile(variants[i], q / 100)])) as Percentiles,
  }));
  const weighted = variants.flatMap((vs, i) => vs.map((v) => ({ share: (shares[i] ?? 0) * v.share, path: v.path })));
  const percentiles = Object.fromEntries(PERCENTILES.map((q) => [PERCENTILE_KEYS[q], wanted.has(q) ? mixtureQuantile(weighted, q / 100) : NaN])) as Percentiles;
  const tailScenario = Object.fromEntries(
    PERCENTILES.map((q) => {
      if (!wanted.has(q)) return [PERCENTILE_KEYS[q], 0];
      const t = percentiles[PERCENTILE_KEYS[q]];
      const above = variants.map((vs, i) => ((shares[i] ?? 0) > 0 ? vs.reduce((sum, v) => sum + (shares[i] ?? 0) * v.share * (1 - pathCdf(v.path, t * (1 - 1e-9))), 0) : -1));
      return [PERCENTILE_KEYS[q], Math.max(0, above.indexOf(Math.max(...above)))];
    }),
  ) as UseCaseAnalysis['tailScenario'];
  return { scenarios, percentiles, tailScenario };
}

/** A system's availability for a use case: the weakest entry point the use case enters (1 when it is not a simulated system). */
function systemAvailability(u: DiagramUseCase, id: string, availability: (id: string, port: string | undefined) => number | undefined): number {
  let result = 1;
  for (const s of u.scenarios) for (const step of s.steps) if (step.toServiceId === id) result = Math.min(result, availability(id, step.toPort) ?? 1);
  return result;
}

/** Nodes the main scenario writes to on its synchronous critical path (they need a single-primary store's primary). */
export function mainWrites(useCase: DiagramUseCase, shares: number[], isWrite: (step: DiagramStep) => boolean): Set<string> {
  if (useCase.scenarios.length === 0) return new Set();
  const path = criticalPath(useCase, useCase.scenarios[mainScenarioIndex(shares)]).flat();
  return new Set(path.filter((h) => !h.failed && !h.async && isWrite(h.step)).map((h) => h.target));
}

/**
 * Product of node availabilities over the synchronous path of the main
 * scenario. A node with a fallback (§7.6: a success scenario that calls it
 * with `-x` before responding and completes without it) contributes
 * `1 − (1 − A(n)) · (1 − A(fallback))`, where the fallback path is the nodes
 * that scenario adds to the main path. `availabilityOf` gives a node's
 * availability for what the main scenario does with it (a write to a
 * single-primary store needs its primary).
 */
export function useCaseAvailability(useCase: DiagramUseCase, shares: number[], availabilityOf: (id: string) => number): number {
  if (useCase.scenarios.length === 0) return 1;
  const main = pathNodes(useCase, useCase.scenarios[mainScenarioIndex(shares)]);
  const onMain = new Set(main);
  let result = 1;
  for (const id of main) {
    const a = availabilityOf(id);
    const fallback = Math.max(
      0,
      ...fallbacksFor(useCase, id).map((s) =>
        pathNodes(useCase, s)
          .filter((other) => other !== id && !onMain.has(other))
          .reduce((product, other) => product * availabilityOf(other), 1),
      ),
    );
    result *= 1 - (1 - a) * (1 - fallback);
  }
  return result;
}

/**
 * Kinds that run as instances of your own; clients, annotations, third
 * parties and DNS (off the request path, §7.5) are left out of failure analysis.
 */
export const DEPLOYED = (kind: Kind): boolean => kind !== 'client' && kind !== 'other' && kind !== 'external' && kind !== 'dns';

/** Single-replica nodes that some use case needs and has no fallback for. */
export function singlePointsOfFailure(diagram: Diagram): string[] {
  return components(diagram)
    .filter((n) => replicasOf(n) === 1 && DEPLOYED(profileOf(n).kind))
    .filter((n) => diagram.useCases.some((u) => needs(u, n.id) && fallbacksFor(u, n.id).length === 0))
    .map((n) => n.id);
}
