import type { Problem } from '../types';
import { fileStorage } from './file-storage';
import { rateLimiter } from './rate-limiter';
import { rideMatching } from './ride-matching';
import { searchAutocomplete } from './search-autocomplete';
import { urlShortener } from './url-shortener';

/** Every problem, in the order the list shows them: by difficulty (easy first), then by title. */
export const problems: Problem[] = [rateLimiter, urlShortener, fileStorage, rideMatching, searchAutocomplete];

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
