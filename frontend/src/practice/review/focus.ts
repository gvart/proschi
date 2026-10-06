import { withFocus, type FocusQueue } from '../../learn/review';
import { loadJson, saveJson } from '../../services/storage';

/**
 * The focus queue (src/learn/review.ts, FocusQueue) in this browser: the
 * cards a learner added from a mistake on a problem page, due now in the
 * daily review. Their reviews are stored like any other: in this browser
 * without accounts, on the server signed in (POST /api/cards/reviews).
 */
export const CARDS_FOCUS_KEY = 'proschi.cards.focus';

/** The queue read back from storage: anything malformed is dropped. */
export function loadFocus(): FocusQueue {
  const raw = loadJson<unknown>(CARDS_FOCUS_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => Number.isInteger(e[1])));
}

/** Adds cards to the queue, asked for now; answers the queue. */
export function addToFocus(ids: readonly string[], now = Math.floor(Date.now() / 1000)): FocusQueue {
  const queue = withFocus(loadFocus(), ids, now);
  saveJson(CARDS_FOCUS_KEY, queue);
  return queue;
}

/** Replaces the stored queue, e.g. once its reviewed cards are pruned. */
export function saveFocus(queue: FocusQueue): void {
  saveJson(CARDS_FOCUS_KEY, queue);
}
