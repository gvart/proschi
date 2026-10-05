/**
 * The review scheduler: FSRS-5 (the Free Spaced Repetition Scheduler, as in
 * Anki 23.10+, https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
 * with its published default weights and a target retention of 0.9.
 *
 * A card's memory is two numbers: stability S, the days until the chance of
 * recalling it falls to 90%, and difficulty D, from 1 to 10, how hard it is
 * to raise S. Each review's rating updates both, and the card is due again
 * when the predicted recall falls to the target retention, which at 0.9 is S
 * days after the review.
 *
 * Pure functions with no dependency, written here rather than taken from npm
 * because the Worker bundles frontend/src (backend/src/cards.ts) and replays
 * the review log with the same code the page schedules with. Times are Unix
 * seconds, like the API's.
 */

/** 1 again (forgot), 2 hard, 3 good, 4 easy. */
export type Rating = 1 | 2 | 3 | 4;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

/** FSRS-5's default weights w0…w18 (fsrs-rs 1.x, py-fsrs 4.x, ts-fsrs 4.x). */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

/** The chance of recall a card is scheduled for. */
export const TARGET_RETENTION = 0.9;
/** The forgetting curve's shape: R(t) = (1 + FACTOR · t / S)^DECAY, so that R(S) = 0.9. */
const DECAY = -0.5;
const FACTOR = 19 / 81;

export const DAY = 86_400;
/** Intervals are whole days, at least one and at most a hundred years. */
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 36_500;
/** Stability never drops below this (days), so intervals and recall stay defined. */
const MIN_STABILITY = 0.01;

/** What the scheduler knows about one card for one learner. */
export interface CardState {
  /** The card's `version` these reviews were of; a higher card version makes the card new again. */
  version: number;
  /** When it is next due, Unix seconds. */
  due: number;
  /** Days until recall falls to 90%. */
  stability: number;
  /** 1 (easy) to 10 (hard). */
  difficulty: number;
  /** Reviews counted into this state. */
  reps: number;
  /** Times it was forgotten (rated again) after the first review. */
  lapses: number;
  /** The last review, Unix seconds. */
  lastReview: number;
}

/** One review, as the log keeps it: of which version of the card, how it went and when. */
export interface ReviewEvent {
  version: number;
  rating: Rating;
  /** Unix seconds. */
  reviewedAt: number;
}

export function isRating(value: unknown): value is Rating {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const w = DEFAULT_WEIGHTS;

/** The chance of recalling a card `days` after its last review, given its stability. */
export function forgettingCurve(days: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, days)) / stability, DECAY);
}

/** The predicted chance of recalling the card at `at` (Unix seconds); 0 for a card never reviewed. */
export function retrievability(state: CardState | undefined, at: number): number {
  if (!state) return 0;
  return forgettingCurve((at - state.lastReview) / DAY, state.stability);
}

/** Days until recall falls to `retention`, rounded to whole days within 1 and 36,500. */
export function intervalDays(stability: number, retention = TARGET_RETENTION): number {
  const days = (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(days), MIN_INTERVAL, MAX_INTERVAL);
}

/** Difficulty after the first review: 1 again is hardest. */
function initialDifficulty(rating: Rating): number {
  return w[4] - Math.exp(w[5] * (rating - 1)) + 1;
}

/** Difficulty after a later review: again and hard raise it, easy lowers it, damped near 10 and pulled back towards an easy card's start. */
function nextDifficulty(d: number, rating: Rating): number {
  const delta = -w[6] * (rating - 3);
  const damped = d + (delta * (10 - d)) / 9;
  return clamp(w[7] * initialDifficulty(4) + (1 - w[7]) * damped, 1, 10);
}

/** Stability after a successful recall (hard, good or easy) with recall chance r. */
function recallStability(d: number, s: number, r: number, rating: Rating): number {
  const hardPenalty = rating === 2 ? w[15] : 1;
  const easyBonus = rating === 4 ? w[16] : 1;
  return s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus);
}

/** Stability after forgetting: much lower, and never above what a same-day lapse would give. */
function forgetStability(d: number, s: number, r: number): number {
  const longTerm = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
  const shortTerm = s / Math.exp(w[17] * w[18]);
  return Math.min(longTerm, shortTerm);
}

/** Stability after a second review on the same day, when the forgetting curve has barely moved. */
function sameDayStability(s: number, rating: Rating): number {
  return s * Math.exp(w[17] * (rating - 3 + w[18]));
}

/**
 * The state after rating a card at `at` (Unix seconds). `version` is the
 * card's current version; when it is above the state's, the card changed its
 * answer since the last review and starts over as new. A review dated before
 * the last one counts as made at the same time.
 */
export function nextState(state: CardState | undefined, rating: Rating, at: number, version = state?.version ?? 1): CardState {
  if (!state || version > state.version) {
    const stability = w[rating - 1];
    return {
      version,
      due: at + intervalDays(stability) * DAY,
      stability,
      difficulty: clamp(initialDifficulty(rating), 1, 10),
      reps: 1,
      lapses: 0,
      lastReview: at,
    };
  }
  const when = Math.max(at, state.lastReview);
  const days = (when - state.lastReview) / DAY;
  const { stability: s, difficulty: d } = state;
  let stability: number;
  if (days < 1) stability = sameDayStability(s, rating);
  else {
    const r = forgettingCurve(days, s);
    stability = rating === 1 ? forgetStability(d, s, r) : recallStability(d, s, r, rating);
  }
  stability = Math.max(MIN_STABILITY, stability);
  return {
    version: state.version,
    due: when + intervalDays(stability) * DAY,
    stability,
    difficulty: nextDifficulty(d, rating),
    reps: state.reps + 1,
    lapses: state.lapses + (rating === 1 ? 1 : 0),
    lastReview: when,
  };
}

/** The interval in days each rating would give, for the rating buttons' hints. */
export function previewIntervals(state: CardState | undefined, at: number, version?: number): Record<Rating, number> {
  const days = (rating: Rating) => {
    const next = nextState(state, rating, at, version);
    return Math.round((next.due - next.lastReview) / DAY);
  };
  return { 1: days(1), 2: days(2), 3: days(3), 4: days(4) };
}

/**
 * A card's state from its whole review log, in time order (ties keep the
 * given order). A review of a newer version starts the card over; a review of
 * an older version than the state's, which can only arrive late from an
 * offline device, is ignored. Undefined for no reviews.
 */
export function replay(reviews: readonly ReviewEvent[]): CardState | undefined {
  const sorted = reviews.map((r, i) => ({ r, i })).sort((a, b) => a.r.reviewedAt - b.r.reviewedAt || a.i - b.i);
  let state: CardState | undefined;
  for (const { r } of sorted) {
    if (state && r.version < state.version) continue;
    state = nextState(state, r.rating, r.reviewedAt, r.version);
  }
  return state;
}
