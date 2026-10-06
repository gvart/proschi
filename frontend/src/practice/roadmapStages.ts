/**
 * The interview prep roadmap's stages, as data. Apart from roadmap.ts (where
 * the order is explained) so that code without a browser, such as the
 * Worker's achievements and the `proschi` CLI, reads them without the
 * progress and account modules.
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

/**
 * Optional roadmap steps: the tutorial that teaches the language. It is shown
 * first and recommended to a learner who has solved nothing yet, and it opens
 * signed out, but unsolved it locks no later step, keeps no stage from
 * counting as complete and is not part of any badge's target.
 */
export const OPTIONAL_STEPS: readonly string[] = ['hello-proschi'];

/** The stages without the OPTIONAL_STEPS: what stage completion and badges count. */
export function requiredStages<S extends { problems: string[] }>(stages: readonly S[]): S[] {
  return stages.map((s) => ({ ...s, problems: s.problems.filter((id) => !OPTIONAL_STEPS.includes(id)) }));
}

export const ROADMAP: RoadmapStage[] = [
  {
    id: 'foundations',
    title: 'Foundations',
    why: 'The language first, then redundancy, durability and a clean read path: two of everything, data that survives a node, and IDs without a single coordinator. Every later design assumes these.',
    problems: ['hello-proschi', 'url-shortener', 'pastebin', 'shopping-cart', 'snowflake-ids'],
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
