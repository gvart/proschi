import { cardFromFile, type Card } from '../../frontend/src/learn/cards';
import { DAY, isRating, replay, type CardState, type Rating } from '../../frontend/src/learn/fsrs';
import { daysBetween, isDay, MAX_BATCH } from '../../frontend/src/learn/review';
import { requireUser } from './auth';
import { cardFiles } from './cards.gen';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';

/**
 * Daily review of practice cards (docs/CARDS.md): the signed-in user's
 * reviews, an append-only log, and the scheduler states derived from it by
 * replaying it with the page's own scheduler (frontend/src/learn/fsrs.ts).
 * Clients (the practice page, later a mobile app) schedule locally and send
 * their reviews in batches, so a device can review offline and send later.
 */

/** A review may be dated at most this far ahead of the server's clock (seconds), for clocks that run a little fast. */
export const MAX_CLOCK_SKEW = 300;
/** Reviews before this (2026-01-01) are refused: no client made them. */
const EARLIEST = 1_767_225_600;
/** A review's time on the card counts up to an hour. */
const MAX_DURATION_MS = 3_600_000;
const REVIEW_ID = /^[A-Za-z0-9-]{8,64}$/;

let cards: Map<string, Card> | undefined;

/** A card the site ships (with its version and topics), by id; the cards are read once per isolate. */

export function findCard(id: string): Card | undefined {
  cards ??= new Map(Object.entries(cardFiles).map(([file, text]) => [file.slice(file.indexOf('/') + 1, -3), cardFromFile(file, text)]));
  return cards.get(id);
}

interface StateRow {
  card_id: string;
  card_version: number;
  due_at: number;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_review_at: number;
}

const stateOf = (row: StateRow): CardState => ({
  version: row.card_version,
  due: row.due_at,
  stability: row.stability,
  difficulty: row.difficulty,
  reps: row.reps,
  lapses: row.lapses,
  lastReview: row.last_review_at,
});

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/cards/state?day=YYYY-MM-DD: every card state of the user, and
 * with `day` (the client's local date) that day's counts: reviews, and new
 * cards (the first review of a card, or of its new version).
 */
export async function getCardState(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.CARD_LIMITER, user.id, 'Too many review requests; wait a minute');
  const day = new URL(request.url).searchParams.get('day');
  if (day !== null && !isDay(day)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');

  const statements = [
    DB.prepare(
      'SELECT card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at FROM card_state WHERE user_id = ? ORDER BY card_id',
    ).bind(user.id),
  ];
  if (day !== null) {
    // A local date spans at most two days of UTC either side of now.
    statements.push(
      DB.prepare(
        `SELECT COUNT(*) AS reviews, COALESCE(SUM(NOT EXISTS (
           SELECT 1 FROM card_reviews p WHERE p.user_id = r.user_id AND p.card_id = r.card_id AND p.card_version >= r.card_version
             AND (p.reviewed_at < r.reviewed_at OR (p.reviewed_at = r.reviewed_at AND p.id < r.id))
         )), 0) AS new
         FROM card_reviews r WHERE r.user_id = ? AND r.reviewed_at >= ? AND r.day = ?`,
      ).bind(user.id, now() - 2 * DAY, day),
    );
  }
  const [rows, counts] = await DB.batch(statements);
  const states: Record<string, CardState> = {};
  for (const row of rows.results as unknown as StateRow[]) states[row.card_id] = stateOf(row);
  const today = counts ? (counts.results[0] as { reviews: number; new: number }) : undefined;
  return json({ states, ...(today ? { today: { reviews: today.reviews, new: today.new } } : {}) }, 200, NO_STORE);
}

interface IncomingReview {
  id: string;
  cardId: string;
  version: number;
  rating: Rating;
  reviewedAt: number;
  durationMs: number | null;
  day: string;
}

const isWhole = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Each review's shape; 400 naming the first one that is malformed. */
function readReviews(body: Record<string, unknown>): IncomingReview[] {
  const list = body.reviews;
  if (!Array.isArray(list)) throw new HttpError(400, 'reviews must be a list');
  if (list.length > MAX_BATCH) throw new HttpError(413, `At most ${MAX_BATCH} reviews per request`);
  return list.map((raw: unknown, i) => {
    const r = raw as Record<string, unknown> | null;
    const bad = (what: string) => new HttpError(400, `Review ${i + 1}: ${what}`);
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw bad('must be {id, cardId, version, rating, reviewedAt, durationMs, day}');
    if (typeof r.id !== 'string' || !REVIEW_ID.test(r.id)) throw bad('id must be a UUID');
    if (typeof r.cardId !== 'string' || r.cardId.length > 100) throw bad('cardId must be a card id');
    if (!isWhole(r.version, 1)) throw bad('version must be a whole number from 1');
    if (!isRating(r.rating)) throw bad('rating must be 1 (again), 2 (hard), 3 (good) or 4 (easy)');
    if (!isWhole(r.reviewedAt, 0)) throw bad('reviewedAt must be Unix seconds');
    if (r.durationMs !== undefined && r.durationMs !== null && !isWhole(r.durationMs, 0)) throw bad('durationMs must be a whole number of milliseconds');
    if (!isDay(r.day)) throw bad('day must be a date written YYYY-MM-DD');
    const durationMs = typeof r.durationMs === 'number' ? Math.min(r.durationMs, MAX_DURATION_MS) : null;
    return { id: r.id, cardId: r.cardId, version: r.version, rating: r.rating, reviewedAt: r.reviewedAt, durationMs, day: r.day };
  });
}

/** The UTC date of a Unix time, YYYY-MM-DD. */
const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Why a well-formed review is not stored, or undefined to store it. */
function reject(r: IncomingReview, t: number): string | undefined {
  const card = findCard(r.cardId);
  if (!card) return 'unknown card';
  if (r.version > card.version) return 'unknown version';
  if (r.reviewedAt > t + MAX_CLOCK_SKEW) return 'reviewedAt is in the future';
  if (r.reviewedAt < EARLIEST) return 'reviewedAt is too old';
  // Local dates are within a day of the UTC date (time zones run from UTC−12 to UTC+14).
  if (Math.abs(daysBetween(utcDay(r.reviewedAt), r.day)) > 1) return 'day does not match reviewedAt';
  return undefined;
}

/**
 * POST /api/cards/reviews {reviews: [{id, cardId, version, rating,
 * reviewedAt, durationMs, day}]}: stores up to 200 reviews and answers with
 * the new states of their cards, recomputed by replaying each card's whole
 * log. Idempotent: a review whose id is stored already is ignored, so a client
 * resends a batch until it gets an answer. Reviews of unknown cards or
 * versions, or dated in the future, are skipped and listed in `skipped`;
 * the client drops them too.
 */
export async function postCardReviews(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const incoming = readReviews(await readJson(request));
  await rateLimit(ctx.env.CARD_LIMITER, user.id, 'Too many review requests; wait a minute');

  const t = now();
  const valid: IncomingReview[] = [];
  const skipped: { id: string; cardId: string; reason: string }[] = [];
  for (const r of incoming) {
    const reason = reject(r, t);
    if (reason) skipped.push({ id: r.id, cardId: r.cardId, reason });
    else valid.push(r);
  }
  const cardIds = [...new Set(valid.map((r) => r.cardId))];
  if (valid.length === 0) return json({ accepted: 0, skipped, states: {} }, 200, NO_STORE);

  // One statement each, whatever the batch size: json_each turns the JSON list into rows.
  const [inserted, log] = await DB.batch([
    DB.prepare(
      `INSERT OR IGNORE INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.cardId'), json_extract(value, '$.version'), json_extract(value, '$.rating'),
              json_extract(value, '$.reviewedAt'), json_extract(value, '$.durationMs'), json_extract(value, '$.day')
       FROM json_each(?2)`,
    ).bind(user.id, JSON.stringify(valid)),
    DB.prepare(
      `SELECT card_id, card_version, rating, reviewed_at FROM card_reviews
       WHERE user_id = ?1 AND card_id IN (SELECT value FROM json_each(?2)) ORDER BY reviewed_at, id`,
    ).bind(user.id, JSON.stringify(cardIds)),
  ]);

  const byCard = new Map<string, { version: number; rating: Rating; reviewedAt: number }[]>();
  for (const row of log.results as { card_id: string; card_version: number; rating: Rating; reviewed_at: number }[]) {
    byCard.set(row.card_id, [...(byCard.get(row.card_id) ?? []), { version: row.card_version, rating: row.rating, reviewedAt: row.reviewed_at }]);
  }
  const states: Record<string, CardState> = {};
  for (const [id, reviews] of byCard) {
    const state = replay(reviews);
    if (state) states[id] = state;
  }
  // Two requests replaying the same card at once can finish in either order;
  // the state stays one replay of the log, and the card's next review replays it again.
  await DB.prepare(
    `INSERT INTO card_state (user_id, card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at)
     SELECT ?1, json_extract(value, '$.cardId'), json_extract(value, '$.version'), json_extract(value, '$.due'), json_extract(value, '$.stability'),
            json_extract(value, '$.difficulty'), json_extract(value, '$.reps'), json_extract(value, '$.lapses'), json_extract(value, '$.lastReview')
     FROM json_each(?2) WHERE true
     ON CONFLICT (user_id, card_id) DO UPDATE SET
       card_version = excluded.card_version, due_at = excluded.due_at, stability = excluded.stability, difficulty = excluded.difficulty,
       reps = excluded.reps, lapses = excluded.lapses, last_review_at = excluded.last_review_at`,
  )
    .bind(user.id, JSON.stringify(Object.entries(states).map(([cardId, s]) => ({ cardId, ...s }))))
    .run();

  return json({ accepted: inserted.meta.changes ?? 0, skipped, states }, 200, NO_STORE);
}
