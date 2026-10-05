import {
  challengeDay,
  challengeEndsAt,
  challengeStreak,
  isPerfect,
  MAX_SCORE,
  pickChallenge,
  readAttempt,
  scoreChallenge,
  type ChallengeAnswer,
  type ChallengeCard,
  type ChallengeStats,
  type ChallengeStreak,
} from '../../frontend/src/learn/challenge';
import { isDay } from '../../frontend/src/learn/review';
import { addDays } from '../../frontend/src/learn/streak';
import { authenticate, requireUser, type User } from './auth';
import { allCards } from './cards';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { cached } from './stats';

/**
 * The daily challenge (frontend/src/learn/challenge.ts): five auto-graded
 * cards a UTC day, the same for everyone. The server picks them with the
 * page's own code, grades and scores each attempt itself (a client never
 * claims a score), keeps a user's first attempt of a day only, and ranks the
 * day's attempts by score, then by the total time.
 */

/** An attempt at yesterday's challenge is still taken this long after 00:00 UTC, for a player who started it before midnight. */
export const GRACE_SECONDS = 15 * 60;
/** Entries of the day's leaderboard. */
export const LEADERBOARD_SIZE = 20;
/** The earliest day the leaderboard answers. */
const FIRST_DAY = '2026-01-01';

const NO_STORE = { 'Cache-Control': 'no-store' };

const picks = new Map<string, ChallengeCard[]>();

/** The day's cards, picked once per isolate and day. */
export function challengeCards(day: string): ChallengeCard[] {
  let cards = picks.get(day);
  if (!cards) {
    if (picks.size > 8) picks.clear();
    cards = pickChallenge([...allCards().values()], day);
    picks.set(day, cards);
  }
  return cards;
}

/** One card of a stored attempt. */
interface StoredResult {
  cardId: string;
  answer: ChallengeAnswer;
  ms: number;
  correct: boolean;
  points: number;
  bonus: number;
}

/** An attempt as the API answers it. */
export interface Attempt {
  day: string;
  score: number;
  maxScore: number;
  correct: number;
  perfect: boolean;
  totalMs: number;
  results: StoredResult[];
  /** 1 for the best of the day; ties share a rank. */
  rank: number;
  /** Everyone who played that day. */
  players: number;
  submittedAt: number;
}

interface AttemptRow {
  day: string;
  score: number;
  correct: number;
  perfect: number;
  total_ms: number;
  results: string;
  submitted_at: number;
  rank: number;
  players: number;
}

/** The user's attempt on `day` with its rank among the day's (those with a higher score, or the same score in less time, rank above). */
async function loadAttempt(DB: D1Database, userId: string, day: string): Promise<Attempt | null> {
  const row = await DB.prepare(
    `SELECT m.day, m.score, m.correct, m.perfect, m.total_ms, m.results, m.submitted_at,
       (SELECT COUNT(*) FROM challenge_attempts o WHERE o.day = m.day AND (o.score > m.score OR (o.score = m.score AND o.total_ms < m.total_ms))) + 1 AS rank,
       (SELECT COUNT(*) FROM challenge_attempts o WHERE o.day = m.day) AS players
     FROM challenge_attempts m WHERE m.user_id = ? AND m.day = ?`,
  )
    .bind(userId, day)
    .first<AttemptRow>();
  if (!row) return null;
  return {
    day: row.day,
    score: row.score,
    maxScore: MAX_SCORE,
    correct: row.correct,
    perfect: row.perfect === 1,
    totalMs: row.total_ms,
    results: JSON.parse(row.results) as StoredResult[],
    rank: row.rank,
    players: row.players,
    submittedAt: row.submitted_at,
  };
}

/** The user's challenge streak as of `today`. */
async function loadStreak(DB: D1Database, userId: string, today: string): Promise<ChallengeStreak> {
  const { results } = await DB.prepare('SELECT day FROM challenge_attempts WHERE user_id = ? ORDER BY day').bind(userId).all<{ day: string }>();
  return challengeStreak(
    results.map((r) => r.day),
    today,
  );
}

/** What the challenge badges look at (GET /api/me/achievements). */
export async function loadChallengeStats(DB: D1Database, userId: string, t: number): Promise<ChallengeStats> {
  const { results } = await DB.prepare('SELECT day, perfect FROM challenge_attempts WHERE user_id = ? ORDER BY day').bind(userId).all<{ day: string; perfect: number }>();
  const today = challengeDay(new Date(t * 1000));
  const streak = challengeStreak(
    results.map((r) => r.day),
    today,
  );
  return { completed: results.length, perfect: results.filter((r) => r.perfect === 1).length, longestStreak: streak.longest };
}

/**
 * GET /api/challenge/today: `{day, cardIds, endsAt, maxScore}`, the day's
 * cards in the order to show them (clients have the cards themselves) and
 * when the next challenge starts. Signed in, also `attempt` (null before
 * playing) and the challenge `streak`.
 */
export async function getChallengeToday(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const user = await authenticate(request, ctx);
  const day = challengeDay(new Date(now() * 1000));
  const base = { day, cardIds: challengeCards(day).map((c) => c.id), endsAt: challengeEndsAt(day), maxScore: MAX_SCORE };
  if (!user) return json(base, 200, NO_STORE);
  const [attempt, streak] = await Promise.all([loadAttempt(DB, user.id, day), loadStreak(DB, user.id, day)]);
  return json({ ...base, attempt, streak }, 200, NO_STORE);
}

/** The day an attempt is for: today, or yesterday within GRACE_SECONDS of midnight. */
function attemptDay(raw: unknown, t: number): string {
  const today = challengeDay(new Date(t * 1000));
  if (raw === undefined || raw === today) return today;
  if (!isDay(raw)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
  if (raw === addDays(today, -1) && t - Date.parse(`${today}T00:00:00Z`) / 1000 < GRACE_SECONDS) return raw;
  throw new HttpError(409, `That challenge is over; today's (${today}) started at 00:00 UTC`);
}

/**
 * POST /api/challenge/today/attempt {answers: [{cardId, answer, ms}], day?}:
 * grades the answers to the day's cards (one each), scores them, keeps the
 * attempt and answers it with its rank and the challenge streak. 409 when the
 * user played that day already (with `attempt`, the one kept). `day`, the
 * challenge the client showed, may be yesterday's for GRACE_SECONDS after
 * midnight.
 */
export async function postChallengeAttempt(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  const body = await readJson(request, 16 * 1024);
  await rateLimit(ctx.env.CHALLENGE_LIMITER, user.id, 'Too many challenge attempts; wait a minute');
  const t = now();
  const day = attemptDay(body.day, t);
  const cards = challengeCards(day);
  if (cards.length === 0) throw new HttpError(503, 'No cards for a challenge');
  const read = readAttempt(cards, body.answers);
  if ('error' in read) throw new HttpError(400, read.error);
  const score = scoreChallenge(cards, read.answers);
  const results: StoredResult[] = read.answers.map((a, i) => ({ ...a, correct: score.results[i].correct, points: score.results[i].points, bonus: score.results[i].bonus }));

  const inserted = await DB.prepare(
    `INSERT OR IGNORE INTO challenge_attempts (user_id, day, score, correct, perfect, total_ms, results, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(user.id, day, score.score, score.correct, isPerfect(score) ? 1 : 0, score.totalMs, JSON.stringify(results), t)
    .run();
  const [attempt, streak] = await Promise.all([loadAttempt(DB, user.id, day), loadStreak(DB, user.id, challengeDay(new Date(t * 1000)))]);
  if (!inserted.meta.changes) return json({ error: 'You already played this challenge; only the first attempt counts', attempt, streak }, 409, NO_STORE);
  return json({ attempt, streak }, 200, NO_STORE);
}

interface BoardRow {
  name: string;
  score: number;
  correct: number;
  rank: number;
}

/**
 * GET /api/challenge/leaderboard?day=YYYY-MM-DD (default today, UTC):
 * `{day, players, maxScore, entries: [{rank, displayName, score, correct}]}`,
 * the day's best LEADERBOARD_SIZE among users who chose to appear on the
 * leaderboard, ranked among everyone who played (so ranks can skip the
 * others). Signed in, also `you`: the user's own rank, or null.
 */
export async function getChallengeLeaderboard(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  await rateLimit(ctx.env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  const today = challengeDay(new Date(now() * 1000));
  const day = new URL(request.url).searchParams.get('day') ?? today;
  if (!isDay(day)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
  if (day > today || day < FIRST_DAY) throw new HttpError(400, `day must be from ${FIRST_DAY} to today (${today}, UTC)`);
  const user: User | undefined = await authenticate(request, ctx);
  const board = await cached(ctx, `challenge/${day}`, async () => {
    const [entries, players] = await DB.batch([
      DB.prepare(
        `SELECT name, score, correct, rank FROM (
           SELECT u.display_name AS name, u.public_profile AS public, a.score, a.correct,
             RANK() OVER (ORDER BY a.score DESC, a.total_ms ASC) AS rank, a.submitted_at
           FROM challenge_attempts a JOIN users u ON u.id = a.user_id WHERE a.day = ?
         ) WHERE public = 1 ORDER BY rank, submitted_at LIMIT ?`,
      ).bind(day, LEADERBOARD_SIZE),
      DB.prepare('SELECT COUNT(*) AS n FROM challenge_attempts WHERE day = ?').bind(day),
    ]);
    return {
      day,
      players: (players.results[0] as { n: number }).n,
      maxScore: MAX_SCORE,
      entries: (entries.results as unknown as BoardRow[]).map((r) => ({ rank: r.rank, displayName: r.name, score: r.score, correct: r.correct })),
    };
  });
  if (!user) return json(board, 200, NO_STORE);
  const mine = await loadAttempt(DB, user.id, day);
  return json({ ...board, you: mine && { rank: mine.rank, score: mine.score, correct: mine.correct, players: mine.players } }, 200, NO_STORE);
}
