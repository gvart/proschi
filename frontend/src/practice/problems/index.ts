import type { Problem } from '../types';
import { rateLimiter } from './rate-limiter';
import { urlShortener } from './url-shortener';

/** Every problem, in the order the list shows them (easy first). */
export const problems: Problem[] = [urlShortener, rateLimiter];

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
