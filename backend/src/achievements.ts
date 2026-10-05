import {
  achievementsAnswer,
  achievementStatuses,
  buildSnapshot,
  liveAchievements,
  longestStreak,
  type Achievement,
  type AchievementContext,
  type AchievementStatus,
  type AchievementsAnswer,
  type EarnedRecord,
  type SolvedProblem,
} from '../../frontend/src/learn/achievements';
import type { CardState, Rating } from '../../frontend/src/learn/fsrs';
import type { ProblemInfo } from '../../frontend/src/learn/mastery';
import { daysBetween, isDay } from '../../frontend/src/learn/review';
import { addDays, goalFor, type DayActivity } from '../../frontend/src/learn/streak';
import { ROADMAP } from '../../frontend/src/practice/roadmapStages';
import raw from '../../frontend/src/practice/achievements.json';
import { loadActivity } from './activity';
import { requireUser } from './auth';
import { allCards, cardTopics } from './cards';
import { loadChallengeStats } from './challenge';
import { loadGameStats } from './game';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { findProblem, problemIds, referenceCost } from './verify';

/**
 * Achievements and the skill map (frontend/src/learn/achievements.ts and
 * mastery.ts), decided here so the web page and a future app agree.
 * Evaluated on read: GET /api/me/achievements builds the user's stats
 * snapshot from the database, stores the badges it earns for the first time
 * and answers every badge with its progress; POST
 * /api/me/achievements/seen records that a client celebrated them.
 */

/**
 * Checked in CI (`proschi achievements check`, the frontend tests); read as it
 * is. Retired badges are left out; their rows in the achievements table stay.
 */
const ACHIEVEMENTS = liveAchievements(raw as unknown as Achievement[]);

let context: AchievementContext | undefined;

/** The problems this Worker ships and the roadmap's stages with them; built once per isolate. */
function catalog(): AchievementContext {
  if (!context) {
    const problems: ProblemInfo[] = problemIds().flatMap((id) => {
      const p = findProblem(id);
      return p ? [{ id, difficulty: p.difficulty, tags: p.tags }] : [];
    });
    // A stage counts only the problems this Worker has (ruleProgress drops the others).
    context = { problems, stages: ROADMAP };
  }
  return context;
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

interface SolveRow {
  problem_id: string;
  runs_to_solve: number | null;
  best_cost_usd: number | null;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export const utcDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/**
 * The day the streak is counted up to: the client's local date when it sends
 * one within a day of the server's UTC date, else the day after the UTC date
 * (a local date is at most a day ahead of it), so no review is left out.
 */
function streakDay(day: string | null, t: number): string {
  if (day === null) return addDays(utcDay(t), 1);
  if (!isDay(day)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
  return Math.abs(daysBetween(utcDay(t), day)) <= 1 ? day : addDays(utcDay(t), 1);
}

/** A user's badges and skill map, as evaluated now (evaluate). */
export interface Evaluation {
  statuses: AchievementStatus[];
  /** Badges met for the first time: not stored yet. */
  newly: string[];
  /** The badges stored as earned, by id. */
  earned: Record<string, EarnedRecord>;
  answer: AchievementsAnswer;
  /** The daily activity the longest streak was counted from (loadActivity up to `today`). */
  activity: DayActivity[];
}

/**
 * Builds a user's stats snapshot from the database and evaluates every badge
 * on it, with the streak counted up to `today`. Stores nothing: the caller
 * decides whether badges met for the first time (`newly`) are kept (GET
 * /api/me/achievements) or not (a public profile, read by someone else).
 */
export async function evaluate(DB: D1Database, user: { id: string; dailyGoal: number }, today: string, t: number): Promise<Evaluation> {
  const cards = allCards();
  const estimates = [...cards.values()].filter((c) => c.type === 'estimate').map((c) => c.id);

  const [activity, challenges, game, [states, total, estimateRows, solves, earnedRows]] = await Promise.all([
    // The daily streak as GET /api/me/activity counts it (streak.ts): the user's goal, solves and freezes included.
    loadActivity(DB, user.id, today),
    // The daily challenge's badges: attempts are kept by UTC day.
    loadChallengeStats(DB, user.id, t),
    // Scale or Fail's badges and its bonus to the skill map.
    loadGameStats(DB, user.id),
    DB.batch([
      DB.prepare('SELECT card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at FROM card_state WHERE user_id = ?').bind(user.id),
      DB.prepare('SELECT COUNT(*) AS n FROM card_reviews WHERE user_id = ?').bind(user.id),
      DB.prepare('SELECT rating FROM card_reviews WHERE user_id = ?1 AND card_id IN (SELECT value FROM json_each(?2)) ORDER BY reviewed_at, id').bind(
        user.id,
        JSON.stringify(estimates),
      ),
      DB.prepare('SELECT problem_id, runs_to_solve, best_cost_usd FROM progress WHERE user_id = ? AND solved_at IS NOT NULL').bind(user.id),
      DB.prepare('SELECT achievement_id, earned_at, seen_at FROM achievements WHERE user_id = ?').bind(user.id),
    ]),
  ]);

  const cardStates: Record<string, CardState> = {};
  for (const r of states.results as unknown as StateRow[]) {
    cardStates[r.card_id] = {
      version: r.card_version,
      due: r.due_at,
      stability: r.stability,
      difficulty: r.difficulty,
      reps: r.reps,
      lapses: r.lapses,
      lastReview: r.last_review_at,
    };
  }
  const solvedProblems: SolvedProblem[] = (solves.results as unknown as SolveRow[]).flatMap((r) => {
    const problem = findProblem(r.problem_id);
    if (!problem) return [];
    const reference = r.best_cost_usd !== null ? referenceCost(problem) : undefined;
    return [{ id: r.problem_id, firstRun: r.runs_to_solve === 1, underReference: r.best_cost_usd !== null && reference !== undefined && r.best_cost_usd < reference }];
  });
  const earned: Record<string, EarnedRecord> = {};
  for (const r of earnedRows.results as { achievement_id: string; earned_at: number; seen_at: number | null }[]) {
    earned[r.achievement_id] = { earnedAt: r.earned_at, ...(r.seen_at !== null ? { seenAt: r.seen_at } : {}) };
  }

  const { snapshot, skills } = buildSnapshot({
    cards: [...cards.values()],
    topics: cardTopics(),
    states: cardStates,
    now: t,
    problems: catalog().problems,
    estimateRatings: (estimateRows.results as { rating: Rating }[]).map((r) => r.rating),
    reviews: (total.results[0] as { n: number }).n,
    longestStreak: longestStreak(activity, today, goalFor(user.dailyGoal)),
    solvedProblems,
    challenges,
    game,
  });
  const { statuses, newly } = achievementStatuses(ACHIEVEMENTS, snapshot, catalog(), earned, t);
  return { statuses, newly, earned, answer: achievementsAnswer(statuses, skills, snapshot), activity };
}

/**
 * GET /api/me/achievements?day=YYYY-MM-DD: every badge with its progress (`current` of
 * `target`), whether it is earned (and when) and whether a client has shown
 * it yet (`unseen`); the skill map (each topic's mastery, the readiness score
 * and the three weakest topics); and the counts behind them. Badges met for
 * the first time are stored now.
 */
export async function getAchievements(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.STATS_LIMITER, `achievements:${user.id}`, 'Too many requests; wait a minute');
  const t = now();
  const today = streakDay(new URL(request.url).searchParams.get('day'), t);
  const { newly, answer } = await evaluate(DB, user, today, t);
  if (newly.length) {
    // Two requests at once both insert; the first row (and its time) stays.
    await DB.prepare(
      'INSERT OR IGNORE INTO achievements (user_id, achievement_id, earned_at) SELECT ?1, value, ?2 FROM json_each(?3)',
    )
      .bind(user.id, t, JSON.stringify(newly))
      .run();
  }
  return json(answer, 200, NO_STORE);
}

/**
 * POST /api/me/achievements/seen {ids?}: marks earned badges as seen, those
 * listed or, without `ids`, all of them, so a client celebrates each once.
 * Answers `{seen}`, how many were marked.
 */
export async function markAchievementsSeen(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const body = await readJson(request);
  const ids = body.ids;
  if (ids !== undefined && !(Array.isArray(ids) && ids.length <= ACHIEVEMENTS.length * 2 && ids.every((id) => typeof id === 'string' && id.length <= 100))) {
    throw new HttpError(400, 'ids must be a list of achievement ids');
  }
  await rateLimit(ctx.env.STATS_LIMITER, `achievements:${user.id}`, 'Too many requests; wait a minute');
  const result = await ctx.env.DB.prepare(
    `UPDATE achievements SET seen_at = ?2 WHERE user_id = ?1 AND seen_at IS NULL
       AND (?3 IS NULL OR achievement_id IN (SELECT value FROM json_each(?3)))`,
  )
    .bind(user.id, now(), ids === undefined ? null : JSON.stringify(ids))
    .run();
  return json({ seen: result.meta.changes ?? 0 }, 200, NO_STORE);
}
