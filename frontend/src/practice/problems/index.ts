import type { Problem } from '../types';
import { chat } from './chat';
import { fileStorage } from './file-storage';
import { newsFeed } from './news-feed';
import { notificationFanout } from './notification-fanout';
import { pastebin } from './pastebin';
import { payments } from './payments';
import { rateLimiter } from './rate-limiter';
import { rideMatching } from './ride-matching';
import { searchAutocomplete } from './search-autocomplete';
import { ticketBooking } from './ticket-booking';
import { urlShortener } from './url-shortener';
import { videoStreaming } from './video-streaming';

/** Every problem, in the order the list shows them: by difficulty (easy first), then by title. */
export const problems: Problem[] = [
  // easy
  pastebin,
  rateLimiter,
  urlShortener,
  // medium
  chat,
  fileStorage,
  newsFeed,
  notificationFanout,
  rideMatching,
  searchAutocomplete,
  // hard
  payments,
  ticketBooking,
  videoStreaming,
];

export function findProblem(id: string): Problem | undefined {
  return problems.find((p) => p.id === id);
}
