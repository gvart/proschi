import type { Problem } from '../types';
import { newsFeed } from './news-feed';
import { pastebin } from './pastebin';
import { rateLimiter } from './rate-limiter';
import { urlShortener } from './url-shortener';

/** Every problem, in the order the list shows them: by difficulty, then title. */
export const problems: Problem[] = [pastebin, rateLimiter, urlShortener, newsFeed];

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
