import { format } from '../dsl/format';
import { isDataStore, kindOf } from '../dsl/kinds';
import type { Diagram, Kind } from '../dsl/types';

/**
 * The editor's "Start from…" gallery: bundled examples, and the reference
 * solutions of the practice problems this browser has solved. Pattern tags
 * come from the designs themselves (node kinds, replicas, shards, fan-out),
 * so a new example or problem needs no tagging. Pure.
 */

const KIND_TAGS: Partial<Record<Kind, string>> = {
  cache: 'cache',
  queue: 'queue',
  cdn: 'CDN',
  loadbalancer: 'load balancing',
  gateway: 'API gateway',
  search: 'search',
  analytics: 'analytics',
  storage: 'object storage',
  function: 'serverless',
  external: 'external API',
};

/** The order tags are listed in: architecture patterns first, then flow traits. */
export const TAG_ORDER = [
  'cache', 'CDN', 'queue', 'fan-out', 'sharding', 'replication', 'rate limiting', 'load balancing', 'API gateway',
  'search', 'analytics', 'object storage', 'serverless', 'external API', 'async', 'error paths', 'HLD',
];

/** Pattern tags of a design, in TAG_ORDER. */
export function patternTags(diagram: Diagram): string[] {
  const tags = new Set<string>();
  const kinds = new Map(diagram.nodes.map((n) => [n.id, kindOf(n)]));
  for (const kind of kinds.values()) {
    const tag = KIND_TAGS[kind];
    if (tag) tags.add(tag);
  }
  const text = [...diagram.nodes.flatMap((n) => [n.id, n.name, n.description ?? '']), ...diagram.edges.map((e) => e.label ?? '')].join(' ');
  const steps = diagram.useCases.flatMap((u) => u.scenarios.flatMap((s) => s.steps));

  if (diagram.capacity?.some((c) => (c.shards ?? 1) > 1) || /shard|partition/i.test(text)) tags.add('sharding');
  if (diagram.nodes.some((n) => (n.replicas ?? 1) > 1 && isDataStore(kinds.get(n.id) ?? 'other')) || /replica|follower|standby/i.test(text)) tags.add('replication');
  if (/rate.?limit|throttl|token.?bucket/i.test(text) || steps.some((s) => s.statusCode === 429)) tags.add('rate limiting');
  const fanOutQueue = diagram.nodes.some((n) => kinds.get(n.id) === 'queue' && diagram.edges.filter((e) => e.source === n.id).length > 1);
  if (fanOutQueue || steps.some((s) => (s.multiplier ?? 1) > 1) || /fan.?out/i.test(text)) tags.add('fan-out');
  if (steps.some((s) => s.executionType !== 'SYNC_REQUEST_RESPONSE')) tags.add('async');
  if (diagram.useCases.some((u) => u.scenarios.some((s) => s.outcome === 'error'))) tags.add('error paths');
  if (diagram.traffic?.length || diagram.requirements?.length) tags.add('HLD');
  return TAG_ORDER.filter((t) => tags.has(t));
}

/**
 * A reference solution as one document: the problem's given design with the
 * solution's own lines in place of its `import "problem.proschi"`, titled
 * after the problem, so it opens and simulates on its own in the editor.
 */
export function solutionSource(given: string, solution: string, title: string): string {
  const body = solution.replace(/^\s*import\s+"problem\.proschi"\s*$/m, '').trim();
  const withoutTitle = given.replace(/^title\s+"(?:[^"\\]|\\.)*"(\s+"(?:[^"\\]|\\.)*")?\s*$/m, '').trim();
  const summary = /^title\s+"(?:[^"\\]|\\.)*"\s+("(?:[^"\\]|\\.)*")\s*$/m.exec(given)?.[1];
  const head = `title ${JSON.stringify(`${title}: reference solution`)}${summary ? ` ${summary}` : ''}`;
  return format(`${head}\n\n# The problem as given\n${withoutTitle}\n\n# The reference solution\n${body}\n`);
}

export interface GalleryItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  /** Searchable text beyond title, description and tags (tech names). */
  keywords?: string;
}

/** Whether an item matches every word of the query (title, description, tags, keywords) and the selected tag. */
export function matchesGallery(item: GalleryItem, query: string, tag?: string): boolean {
  if (tag && !item.tags.includes(tag)) return false;
  const haystack = [item.title, item.description, ...item.tags, item.keywords ?? ''].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
