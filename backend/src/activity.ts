import { DAY } from '../../frontend/src/learn/fsrs';
import { isDay } from '../../frontend/src/learn/review';
import { ACTIVITY_DAYS, addDays, computeStreak, goalFor, weeklyRecap, type Day, type DayActivity } from '../../frontend/src/learn/streak';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit } from './http';

/**
 * The daily goal and streak (frontend/src/learn/streak.ts), computed from
 * what the server already keeps: card reviews by their local `day`, and each
 * problem's first verified solve by its `solved_day`. The page and a mobile
 * app read the same answer, so they show the same streak.
 */

/**
 * Each day's `{day, reviews, newCards, solves}` of a user over the
 * ACTIVITY_DAYS days up to `day` (days without activity left out), oldest
 * first: what computeStreak and weeklyRecap take. GET /api/me/achievements
 * reads it too, for the longest streak.
 */
export async function loadActivity(DB: D1Database, userId: string, day: Day): Promise<DayActivity[]> {
  const from = addDays(day, -ACTIVITY_DAYS);
  const [reviews, solves] = await DB.batch([
    // A review is new when no earlier one of its card has its version or a higher one (as GET /api/cards/state counts).
    // The time bound keeps the scan on the index; a local date is within a day or two of the UTC one.
    DB.prepare(
      `SELECT r.day AS day, COUNT(*) AS reviews, COALESCE(SUM(NOT EXISTS (
         SELECT 1 FROM card_reviews p WHERE p.user_id = r.user_id AND p.card_id = r.card_id AND p.card_version >= r.card_version
           AND (p.reviewed_at < r.reviewed_at OR (p.reviewed_at = r.reviewed_at AND p.id < r.id))
       )), 0) AS new_cards
       FROM card_reviews r WHERE r.user_id = ? AND r.reviewed_at >= ? AND r.day >= ? AND r.day <= ?
       GROUP BY r.day`,
    ).bind(userId, now() - (ACTIVITY_DAYS + 2) * DAY, from, day),
    DB.prepare('SELECT solved_day AS day, COUNT(*) AS solves FROM progress WHERE user_id = ? AND solved_day >= ? AND solved_day <= ? GROUP BY solved_day').bind(
      userId,
      from,
      day,
    ),
  ]);

  const days = new Map<string, DayActivity>();
  const at = (d: string) => days.get(d) ?? days.set(d, { day: d, reviews: 0, newCards: 0, solves: 0 }).get(d)!;
  for (const row of reviews.results as { day: string; reviews: number; new_cards: number }[]) Object.assign(at(row.day), { reviews: row.reviews, newCards: row.new_cards });
  for (const row of solves.results as { day: string; solves: number }[]) at(row.day).solves = row.solves;
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * GET /api/me/activity?day=YYYY-MM-DD: with `day` the client's local date,
 * each day's `{day, reviews, newCards, solves}` over the last ACTIVITY_DAYS
 * days (days without activity left out), the daily `goal`, the `streak` as
 * of `day`, and the `recap` of the Monday–Sunday week before `day`'s.
 */
export async function getActivity(request: Request, ctx: Ctx): Promise<Response> {
  const { DB } = ctx.env;
  const user = await requireUser(request, ctx);
  await rateLimit(ctx.env.CARD_LIMITER, user.id, 'Too many review requests; wait a minute');
  const day = new URL(request.url).searchParams.get('day');
  if (!isDay(day)) throw new HttpError(400, 'day must be a date written YYYY-MM-DD');
  const activity = await loadActivity(DB, user.id, day);
  const goal = goalFor(user.dailyGoal);
  return json(
    { day, goal, days: activity, streak: computeStreak(activity, day, goal), recap: weeklyRecap(activity, day, goal) },
    200,
    { 'Cache-Control': 'no-store' },
  );
}
