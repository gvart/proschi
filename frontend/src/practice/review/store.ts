import { isRating } from '../../learn/fsrs';
import { dayCounts, isDay, MAX_BATCH, statesFromLog, withPending, type CardReview, type CardStates, type DayCounts } from '../../learn/review';
import { api, ApiError, type CardReviewsAnswer, type CardStatesAnswer } from '../../services/api';
import { loadJson, saveJson } from '../../services/storage';

/**
 * Where the review page keeps reviews, by account state (roadmapAccess's
 * cases): the browser's storage in a build without accounts, the server
 * signed in (with an outbox in the browser for reviews not sent yet), and
 * memory only signed out. The scheduling itself is src/learn, shared with the
 * Worker; this is the browser's glue.
 */

/** A build without accounts: every review, kept in this browser. */
export const CARDS_LOG_KEY = 'proschi.cards';
/** Signed in: the reviews not yet sent to the server, by user id, so none is lost offline. */
export const CARDS_OUTBOX_KEY = 'proschi.cards.outbox';

export interface Loaded {
  states: CardStates;
  /** Today's counts, with reviews not sent yet. */
  today: DayCounts;
}

export interface CardStore {
  /** `local`: this browser; `account`: the server; `memory`: until the page closes. */
  kind: 'local' | 'account' | 'memory';
  /** The states and `day`'s counts. Account: sends the outbox first, and rejects when the server cannot be reached. */
  load(day: string): Promise<Loaded>;
  /** Keeps a review. Account: in the outbox until flush() sends it. */
  add(review: CardReview): void;
  /** Account: sends the outbox in batches and answers the server's states of the cards sent; the others keep nothing to send. */
  flush(): Promise<CardStates>;
}

/** Reviews read back from storage: anything malformed is dropped. */
export function readReviews(raw: unknown): CardReview[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is CardReview =>
      !!r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.cardId === 'string' &&
      Number.isInteger(r.version) &&
      isRating(r.rating) &&
      Number.isInteger(r.reviewedAt) &&
      Number.isInteger(r.durationMs) &&
      isDay(r.day),
  );
}

/** A review log in memory, or in storage under `key`. */
function logStore(kind: 'local' | 'memory', key?: string): CardStore {
  let memory: CardReview[] = [];
  const read = () => (key ? readReviews(loadJson<unknown>(key, [])) : memory);
  return {
    kind,
    load: async (day) => {
      const log = read();
      return { states: statesFromLog(log), today: dayCounts(log, day) };
    },
    add: (review) => {
      const log = [...read(), review];
      if (key) saveJson(key, log);
      else memory = log;
    },
    flush: async () => ({}),
  };
}

export const localStore = (): CardStore => logStore('local', CARDS_LOG_KEY);
export const memoryStore = (): CardStore => logStore('memory');

function readOutbox(): Record<string, CardReview[]> {
  const raw = loadJson<unknown>(CARDS_OUTBOX_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([user, list]) => [user, readReviews(list)]));
}

/** The user's reviews waiting to be sent. */
export function pendingReviews(userId: string): CardReview[] {
  const all = readOutbox();
  return Object.prototype.hasOwnProperty.call(all, userId) ? all[userId] : [];
}

function updateOutbox(userId: string, update: (pending: CardReview[]) => CardReview[]): void {
  const all = readOutbox();
  const next = update(Object.prototype.hasOwnProperty.call(all, userId) ? all[userId] : []);
  if (next.length) all[userId] = next;
  else delete all[userId];
  saveJson(CARDS_OUTBOX_KEY, all);
}

/**
 * Signed in: the server keeps the reviews; the outbox holds those not sent
 * yet. A copy stays in memory too, so reviews still go out when storage is
 * blocked, and reviews another tab left in the outbox go out as well.
 */
export function accountStore(userId: string): CardStore {
  let memory: CardReview[] = [];
  /** Answered by the server in this page's life: never sent again, even when storage could not drop them. */
  const sent = new Set<string>();
  const pending = () => {
    const stored = pendingReviews(userId);
    const ids = new Set(stored.map((r) => r.id));
    return [...stored, ...memory.filter((r) => !ids.has(r.id))].filter((r) => !sent.has(r.id));
  };
  let sending: Promise<CardStates> | undefined;
  const flush = (): Promise<CardStates> => {
    // One send at a time; a flush during one waits for it.
    sending ??= (async () => {
      const states: CardStates = {};
      try {
        for (let batch = pending().slice(0, MAX_BATCH); batch.length; batch = pending().slice(0, MAX_BATCH)) {
          const answer = await api<CardReviewsAnswer>('/api/cards/reviews', { method: 'POST', body: { reviews: batch } });
          // Stored or skipped (an unknown card, a bad time): either way the server has answered for it.
          for (const r of batch) sent.add(r.id);
          memory = memory.filter((r) => !sent.has(r.id));
          updateOutbox(userId, (list) => list.filter((r) => !sent.has(r.id)));
          Object.assign(states, answer.states);
        }
      } finally {
        sending = undefined;
      }
      return states;
    })();
    return sending;
  };
  return {
    kind: 'account',
    async load(day) {
      // Unsent reviews from a previous visit go first; if they cannot, they stay in the outbox and count locally.
      await flush().catch(() => undefined);
      const answer = await api<CardStatesAnswer>(`/api/cards/state?day=${encodeURIComponent(day)}`);
      return withPending(answer.states, answer.today ?? { reviews: 0, new: 0 }, pending(), day);
    },
    add: (review) => {
      memory = [...memory, review];
      updateOutbox(userId, (list) => [...list, review]);
    },
    flush,
  };
}

/** Whether an error means the session is gone (sign in again) rather than the network. */
export const signedOutError = (e: unknown) => e instanceof ApiError && e.status === 401;
