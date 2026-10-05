import { hashText, seededRandom } from '../../learn/grade';

/**
 * Seeded randomness: every random choice of a run comes from its own stream,
 * named for what it decides (`draft:3:0`, `events:5`), so one choice never
 * shifts another and a replay draws the same numbers.
 */
export function stream(seed: string, name: string): () => number {
  return seededRandom(hashText(`${seed}:${name}`));
}

/** An index into `weights`, chosen with probability proportional to its weight. */
export function weighted(next: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return -1;
  let r = next() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** `items` shuffled (Fisher–Yates) with `next`. */
export function shuffled<T>(next: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The daily run's seed: the same for everyone on a UTC day. */
export const dailySeed = (day: string): string => `daily:${day}`;
