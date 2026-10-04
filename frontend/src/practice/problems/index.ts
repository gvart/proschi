import type { Problem } from '../types';
import { payments } from './payments';
import { rateLimiter } from './rate-limiter';
import { ticketBooking } from './ticket-booking';
import { urlShortener } from './url-shortener';
import { videoStreaming } from './video-streaming';

/** Every problem, in the order the list shows them (easy first). */
export const problems: Problem[] = [urlShortener, rateLimiter, payments, ticketBooking, videoStreaming];

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
