import type { Card, Deck, Topic } from './cards';
import { DAY, nextState, replay, type CardState, type Rating } from './fsrs';

/**
 * Daily review (docs/CARDS.md, "Reviewing"): which cards are due, which new
 * ones come next, a session's queue, the counts per local day, and how the
 * reviews a device made offline combine with the server's states.
 *
 * Pure TypeScript with no browser or React dependency, like cards.ts and
 * fsrs.ts: the practice page, the Worker and a future mobile app share it.
 * Times are Unix seconds; days are the learner's local dates, `YYYY-MM-DD`,
 * which the client sends since only it knows its time zone.
 */

/** Each card's scheduler state, by card id. */
export type CardStates = Record<string, CardState>;

/** One review as a client records it and POST /api/cards/reviews takes it. */
export interface CardReview {
  /** Made by the client (a UUID), so sending a review twice stores it once. */
  id: string;
  cardId: string;
  /** The card's version when it was reviewed. */
  version: number;
  rating: Rating;
  /** Unix seconds. */
  reviewedAt: number;
  /** From showing the card to answering it. */
  durationMs: number;
  /** The learner's local date of the review. */
  day: string;
}

/** New cards a day, unless the learner trains one topic. */
export const NEW_PER_DAY = 10;
/** Cards in one session. */
export const SESSION_SIZE = 20;
/** Reviews in one POST /api/cards/reviews. */
export const MAX_BATCH = 200;

const DAY_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written `YYYY-MM-DD`. */
export function isDay(value: unknown): value is string {
  const m = typeof value === 'string' ? DAY_FORMAT.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** `date`'s calendar date in the runtime's time zone, `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days from `a` to `b`, both `YYYY-MM-DD`. */
export function daysBetween(a: string, b: string): number {
  const ms = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / (DAY * 1000));
}

/** Never reviewed, or reviewed before its answer changed (a higher `version`). */
export function isNew(card: Pick<Card, 'version'>, state: CardState | undefined): boolean {
  return !state || state.version < card.version;
}

export function isDue(card: Pick<Card, 'version'>, state: CardState | undefined, now: number): boolean {
  return !!state && !isNew(card, state) && state.due <= now;
}

export interface CardFilter {
  /** Only cards that train this topic (their folder or `tags`). */
  topic?: string;
  /** Only cards on this deck, e.g. the free `sample` deck. */
  deck?: Deck;
}

/** The cards a learner can review: not retired, within the filter. */
export function reviewable(cards: readonly Card[], { topic, deck }: CardFilter = {}): Card[] {
  return cards.filter((c) => !c.retired && (!topic || c.tags.includes(topic)) && (!deck || c.decks.includes(deck)));
}

const DIFFICULTY_RANK: Record<Card['difficulty'], number> = { easy: 0, medium: 1, hard: 2 };

/**
 * The order new cards are introduced in: the sample deck first (the
 * hand-picked introduction to every topic), then the rest; within each, one
 * from each topic in turn, in tags.json's order, and within a topic easy
 * before hard (then by id), so the first days touch every topic at its
 * gentlest card. Stable for a given set of cards, and adding cards outside
 * the sample deck never changes where the sample cards come.
 */
export function newCardOrder(cards: readonly Card[], topics: readonly Topic[]): Card[] {
  const sample = cards.filter((c) => c.decks.includes('sample'));
  const rest = cards.filter((c) => !c.decks.includes('sample'));
  return [...interleave(sample, topics), ...interleave(rest, topics)];
}

/** One card from each topic in turn, in tags.json's order; easy before hard within a topic. */
function interleave(cards: readonly Card[], topics: readonly Topic[]): Card[] {
  const rank = new Map(topics.map((t, i) => [t.id, i]));
  const byTopic = new Map<string, Card[]>();
  for (const card of cards) byTopic.set(card.topic, [...(byTopic.get(card.topic) ?? []), card]);
  const queues = [...byTopic.entries()]
    .sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    .map(([, list]) => list.sort((a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || a.id.localeCompare(b.id)));
  const out: Card[] = [];
  for (let i = 0; out.length < cards.length; i++) for (const q of queues) if (i < q.length) out.push(q[i]);
  return out;
}

export interface SessionOptions extends CardFilter {
  now: number;
  /** New cards to add at most: what is left of the day's allowance. */
  newLimit?: number;
  /** Cards in the session at most. */
  max?: number;
}

export interface SessionItem {
  card: Card;
  isNew: boolean;
}

/**
 * A session's queue: the due cards first, the most overdue (earliest due)
 * first, then new cards in newCardOrder, up to `newLimit` of them and `max`
 * in all.
 */
export function buildSession(cards: readonly Card[], states: CardStates, topics: readonly Topic[], options: SessionOptions): SessionItem[] {
  const { now, newLimit = NEW_PER_DAY, max = SESSION_SIZE } = options;
  const pool = reviewable(cards, options);
  const due = pool
    .filter((c) => isDue(c, states[c.id], now))
    .sort((a, b) => states[a.id].due - states[b.id].due || a.id.localeCompare(b.id))
    .map((card) => ({ card, isNew: false }));
  const fresh = newCardOrder(
    pool.filter((c) => isNew(c, states[c.id])),
    topics,
  )
    .slice(0, Math.max(0, newLimit))
    .map((card) => ({ card, isNew: true }));
  return [...due, ...fresh].slice(0, Math.max(0, max));
}

export interface Counts {
  due: number;
  /** Never reviewed (or changed since). */
  new: number;
  total: number;
}

export interface Overview extends Counts {
  /** Every topic of tags.json that has cards, in its order. */
  topics: (Counts & { topic: Topic })[];
  /** The earliest time a reviewed card is due, if any is. */
  nextDue?: number;
}

/** Due, new and total cards, overall and per topic (a card counts for every topic it trains). */
export function overview(cards: readonly Card[], states: CardStates, topics: readonly Topic[], { now, deck }: { now: number; deck?: Deck }): Overview {
  const pool = reviewable(cards, { deck });
  const count = (list: Card[]): Counts => ({
    due: list.filter((c) => isDue(c, states[c.id], now)).length,
    new: list.filter((c) => isNew(c, states[c.id])).length,
    total: list.length,
  });
  const dues = pool.filter((c) => !isNew(c, states[c.id])).map((c) => states[c.id].due);
  return {
    ...count(pool),
    topics: topics.map((topic) => ({ topic, ...count(pool.filter((c) => c.tags.includes(topic.id))) })).filter((t) => t.total > 0),
    ...(dues.length ? { nextDue: Math.min(...dues) } : {}),
  };
}

/** Reviews made on one day, and how many of them introduced a new card. */
export interface DayCounts {
  reviews: number;
  new: number;
}

/**
 * The counts of `day` from a whole review log: a review is new when it is
 * the first of its card at its version (or a higher one) in the log.
 */
export function dayCounts(log: readonly CardReview[], day: string): DayCounts {
  const seen = new Map<string, number>();
  const counts: DayCounts = { reviews: 0, new: 0 };
  for (const r of [...log].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    const isFirst = (seen.get(r.cardId) ?? 0) < r.version;
    if (isFirst) seen.set(r.cardId, r.version);
    if (r.day !== day) continue;
    counts.reviews++;
    if (isFirst) counts.new++;
  }
  return counts;
}

/** The states with `reviews` applied on top, in time order. */
export function applyReviews(states: CardStates, reviews: readonly CardReview[]): CardStates {
  const out: CardStates = { ...states };
  for (const r of [...reviews].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    const current = out[r.cardId];
    if (current && r.version < current.version) continue;
    out[r.cardId] = nextState(current, r.rating, r.reviewedAt, r.version);
  }
  return out;
}

/** Every card's state from a whole review log (what the server does with its log). */
export function statesFromLog(log: readonly CardReview[]): CardStates {
  const byCard = new Map<string, CardReview[]>();
  for (const r of log) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);
  const out: CardStates = {};
  for (const [id, reviews] of byCard) {
    const state = replay(reviews);
    if (state) out[id] = state;
  }
  return out;
}

/**
 * The server's states and `day`'s counts with the reviews it does not have
 * yet (a device's outbox) applied on top: those after the server's last
 * review of their card, a review of `day` counting as new when its card was
 * new before it.
 */
export function withPending(states: CardStates, counts: DayCounts, pending: readonly CardReview[], day: string): { states: CardStates; today: DayCounts } {
  let out = states;
  const today = { ...counts };
  for (const r of [...pending].sort((a, b) => a.reviewedAt - b.reviewedAt)) {
    const before = out[r.cardId];
    if (before && r.reviewedAt <= before.lastReview) continue;
    if (r.day === day) {
      today.reviews++;
      if (isNew(r, before)) today.new++;
    }
    out = applyReviews(out, [r]);
  }
  return { states: out, today };
}

/** A rating from an automatically graded answer: wrong is again, right is good, or easy when the learner says so. */
export function autoRating(correct: boolean, easy = false): Rating {
  return correct ? (easy ? 4 : 3) : 1;
}

/** An interval for a rating button: "1d", "12d", "3w", "4mo", "1.5y". */
export function formatInterval(days: number): string {
  if (days < 1) return '<1d';
  if (days < 14) return `${Math.round(days)}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years}y`;
}
