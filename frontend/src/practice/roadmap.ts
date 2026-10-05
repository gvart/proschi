import { statusOf, type Progress, type Status } from './progress';
import type { AccountState } from './useAccount';

/**
 * The interview prep roadmap: the practice problems as a guided path, in
 * stages, solved in a fixed order (docs/PRACTICE.md, "The roadmap"). Only the
 * roadmap view is gated; the problem list stays open.
 *
 * The order follows the usual shape of system design curricula (foundations,
 * then building blocks, then patterns, then whole systems): replicas and
 * caching before partitioning, queues before the fan-out and streaming
 * patterns built on them, and contention, geo and hot spots last, where a
 * design needs everything before it.
 */

export interface RoadmapStage {
  /** Lowercase words joined by `-`, unique. */
  id: string;
  title: string;
  /** One or two sentences: what the stage teaches and why it comes now. */
  why: string;
  /** Problem ids (folder names), in the order they are solved. */
  problems: string[];
}

export const ROADMAP: RoadmapStage[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    why: 'Redundancy, durability and a clean read path: two of everything, data that survives a node, and IDs without a single coordinator. Every later design assumes these.',
    problems: ['url-shortener', 'pastebin', 'shopping-cart', 'snowflake-ids'],
  },
  {
    id: 'caching',
    title: 'Caching and the edge',
    why: 'Most systems are read-heavy, and the cheapest request is the one answered before it reaches the database. Learn where a cache or CDN goes and what happens on a miss.',
    problems: ['rate-limiter', 'search-autocomplete', 'cdn-tiered-cache'],
  },
  {
    id: 'partitioning',
    title: 'Partitioning and replication',
    why: 'Once one database cannot hold the data or the writes, split it into shards and keep replicas in step. Comes after caching, which is cheaper and usually tried first.',
    problems: ['notion-sharding', 'github-repo-replication', 'social-graph-cache'],
  },
  {
    id: 'async',
    title: 'Queues and async work',
    why: 'Answer the user first and do slow or failure-prone work later: queues, workers and retries. The fan-out and streaming patterns that follow are built on them.',
    problems: ['job-queue', 'file-storage', 'notification-fanout'],
  },
  {
    id: 'fan-out',
    title: 'Fan-out and real-time delivery',
    why: 'Deliver one write to many readers: precomputed feeds, chat over websockets and server push. Combines caching, queues and partitioning from the stages before.',
    problems: ['news-feed', 'chat', 'push-gateway'],
  },
  {
    id: 'streams',
    title: 'Streams and aggregation',
    why: 'Count and rank events at a rate no database takes row by row: batch, pre-aggregate and accept approximate answers where they are good enough.',
    problems: ['view-counting', 'trending-topics', 'metrics-ingest'],
  },
  {
    id: 'consistency',
    title: 'Consistency and contention',
    why: 'Money and inventory must be right exactly once, under retries and under a crowd. Idempotency, locks and admission control, the questions senior interviews dwell on.',
    problems: ['payments', 'ticket-booking', 'flash-sale'],
  },
  {
    id: 'scale',
    title: 'Geo, media and hot spots at scale',
    why: 'Large systems modelled on real companies, where location, bandwidth and hot partitions decide the design. Each needs most of what came before.',
    problems: ['ride-matching', 'video-streaming', 'discord-messages'],
  },
];

/** The practice URL of a problem opened from the roadmap: the problem page then shows where it is on the roadmap. */
export const roadmapHref = (id: string) => `#/roadmap/${id}`;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What is wrong with a roadmap's shape: bad or repeated ids, empty stages, a problem listed twice. Empty when it is fine. */
export function validateRoadmap(stages: RoadmapStage[]): string[] {
  const errors: string[] = [];
  const stageIds = new Set<string>();
  const seen = new Map<string, string>();
  if (stages.length === 0) errors.push('The roadmap has no stages');
  for (const stage of stages) {
    const where = `Stage "${stage.id}"`;
    if (!ID.test(stage.id)) errors.push(`${where}: the id must be lowercase words joined by "-"`);
    if (stageIds.has(stage.id)) errors.push(`${where} appears twice`);
    stageIds.add(stage.id);
    if (!stage.title.trim()) errors.push(`${where} has no title`);
    if (!stage.why.trim()) errors.push(`${where} does not say what it teaches`);
    if (stage.problems.length === 0) errors.push(`${where} has no problems`);
    for (const id of stage.problems) {
      if (!ID.test(id)) errors.push(`${where}: "${id}" is not a problem id`);
      const first = seen.get(id);
      if (first !== undefined) errors.push(`${where}: "${id}" is already in stage "${first}"`);
      else seen.set(id, stage.id);
    }
  }
  return errors;
}

/** The roadmap with only the problems that exist; stages left empty are dropped. */
export function roadmapFor(stages: RoadmapStage[], problemIds: Iterable<string>): RoadmapStage[] {
  const known = new Set(problemIds);
  return stages.map((s) => ({ ...s, problems: s.problems.filter((id) => known.has(id)) })).filter((s) => s.problems.length > 0);
}

export interface RoadmapStep {
  id: string;
  /** Index into the stages. */
  stage: number;
  status: Status;
  /** Not solved, and an earlier problem is not solved either. */
  locked: boolean;
}

export interface RoadmapState {
  steps: RoadmapStep[];
  solved: number;
  /** The first problem not solved yet; undefined once every one is. */
  next?: RoadmapStep;
  /** The stage of `next`, or the last stage when the roadmap is done. */
  currentStage: number;
}

/**
 * Where a learner is on the roadmap. A problem is unlocked when every problem
 * before it is solved; a solved problem stays open (it may have been solved
 * from the open list, out of order).
 */
export function roadmapState(stages: RoadmapStage[], progress: Progress): RoadmapState {
  const steps: RoadmapStep[] = [];
  let blocked = false;
  stages.forEach((stage, i) => {
    for (const id of stage.problems) {
      const status = statusOf(progress, id);
      steps.push({ id, stage: i, status, locked: blocked && status !== 'solved' });
      if (status !== 'solved') blocked = true;
    }
  });
  const next = steps.find((s) => s.status !== 'solved');
  return {
    steps,
    solved: steps.filter((s) => s.status === 'solved').length,
    next,
    currentStage: next?.stage ?? Math.max(0, stages.length - 1),
  };
}

/**
 * Whether the viewer may start the roadmap: `open`, `checking` while the
 * account loads, or `sign-in`. Anyone can see the stages; working through them
 * takes an account. This is the one place to put a paid plan later (an
 * `upgrade` answer for an account without one).
 *
 * A build without accounts (`VITE_ACCOUNTS` unset: local development, the e2e
 * build, forks) has nothing to sign in to, so the roadmap is open there.
 */
export type RoadmapAccess = 'open' | 'checking' | 'sign-in';

export function roadmapAccess(account: AccountState): RoadmapAccess {
  switch (account.status) {
    case 'off':
    case 'signed-in':
      return 'open';
    case 'loading':
      return 'checking';
    case 'signed-out':
      return 'sign-in';
  }
}
