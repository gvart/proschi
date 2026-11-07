import type { ProblemListing } from '../listing';
import type { Problem } from '../types';

/**
 * Which problem a mock interview is on (docs/design/paid-plans.md P45). By
 * default the set-up screen's "Surprise me" draws one at random from the
 * pool, preferring those not yet done in an interview here or on the
 * account; the filters narrow the pool. Pure: the caller passes the random
 * source, so the tests pick deterministically.
 */

/** Problems that are not interview questions: the language tutorial. They can still be chosen by name. */
export const NOT_IN_POOL: readonly string[] = ['hello-proschi'];

export interface PoolFilters {
  difficulty?: Problem['difficulty'];
  topic?: string;
}

/** The problems "Surprise me" draws from, with the filters applied. */
export function interviewPool(problems: readonly ProblemListing[], filters: PoolFilters = {}): ProblemListing[] {
  return problems.filter((p) => !NOT_IN_POOL.includes(p.id) && (!filters.difficulty || p.difficulty === filters.difficulty) && (!filters.topic || p.tags.includes(filters.topic)));
}

/** The topics (tags) of the pool, most common first, then by name. */
export function poolTopics(problems: readonly ProblemListing[]): string[] {
  const count = new Map<string, number>();
  for (const p of interviewPool(problems)) for (const t of p.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b));
}

/**
 * A problem id from `pool`: one not in `done` when there is any, else one of
 * all but `avoid` (the last one, so two in a row differ while the pool has
 * two). Undefined for an empty pool.
 */
export function pickProblem(pool: readonly ProblemListing[], done: readonly string[], random: () => number, avoid?: string): string | undefined {
  const fresh = pool.filter((p) => !done.includes(p.id));
  const others = pool.filter((p) => p.id !== avoid);
  const from = fresh.length ? fresh : others.length ? others : pool;
  if (!from.length) return undefined;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))].id;
}
