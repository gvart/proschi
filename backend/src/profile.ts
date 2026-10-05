import { DAY } from '../../frontend/src/learn/fsrs';
import { addDays, computeStreak, goalFor } from '../../frontend/src/learn/streak';
import { evaluate, utcDay } from './achievements';
import { loadChallengeSummary } from './challenge';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit } from './http';
import { findProblem, problemIds } from './verify';

/**
 * Public profiles: GET /api/users/<id>/profile, what a user who opted in
 * (`users.public_profile`, "Show me on the leaderboard") shows anyone who
 * follows their name from the leaderboard. Everything else stays private:
 * designs, sessions, sign-ins, the daily goal, review counts and logs, and
 * the daily challenge's answers.
 * docs/PRIVACY.md lists the same fields.
 */

/** GET /api/users/<id>/profile's answer: every field a public profile has, and nothing more. */
export interface PublicProfile {
  id: string;
  displayName: string;
  /** Unix seconds: the start of the UTC day the account was made. */
  memberSince: number;
  /** The problems solved, in the catalog's order: ids and difficulty only. */
  solved: { id: string; difficulty: string }[];
  /** Days: the current and the longest daily streak. */
  streak: { current: number; longest: number };
  /** The daily challenge: the current and longest challenge streak (days) and the best score; null before a first challenge. */
  challenge: { current: number; longest: number; best: number } | null;
  /** 0 to 1, rounded to whole percent. */
  readiness: number;
  /** Each topic's mastery, 0 to 1, rounded to whole percent. */
  topics: { topic: string; mastery: number }[];
  /** The badges earned, with the start of the UTC day each was earned. */
  badges: { id: string; earnedAt: number }[];
}

/** User ids are UUIDs; anything else cannot be one. */
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** A share rounded to whole percent, so the profile shows no more than the page does. */
const share = (n: number) => Math.round(n * 100) / 100;
/** The start of the UTC day of `t`. */
const dayStart = (t: number) => Math.floor(t / DAY) * DAY;

const notFound = () => new HttpError(404, 'No such profile');

/**
 * GET /api/users/<id>/profile: the user's public profile when they opted in;
 * 404 otherwise, the same as for an id nobody has, so it does not tell
 * whether a private user exists. Read only: badges met for the first time are
 * stored when the user opens their own page, not here.
 */
export async function getPublicProfile(ctx: Ctx, id: string): Promise<Response> {
  const { env } = ctx;
  await rateLimit(env.STATS_LIMITER, ctx.ip, 'Too many requests; wait a minute');
  if (!ID.test(id)) throw notFound();
  const user = await env.DB.prepare('SELECT id, display_name, created_at, daily_goal FROM users WHERE id = ? AND public_profile = 1')
    .bind(id)
    .first<{ id: string; display_name: string; created_at: number; daily_goal: number }>();
  if (!user) throw notFound();

  const t = now();
  // A local date is at most a day ahead of the UTC one: count up to the day after, and keep the better of the two days' streaks.
  const today = addDays(utcDay(t), 1);
  const { earned, answer, activity } = await evaluate(env.DB, { id: user.id, dailyGoal: user.daily_goal }, today, t);
  const goal = goalFor(user.daily_goal);
  const streaks = [computeStreak(activity, today, goal), computeStreak(activity, utcDay(t), goal)];

  const challenge = await loadChallengeSummary(env.DB, user.id, t);
  const solved = new Set(
    (
      await env.DB.prepare('SELECT problem_id FROM progress WHERE user_id = ? AND solved_at IS NOT NULL').bind(user.id).all<{ problem_id: string }>()
    ).results.map((r) => r.problem_id),
  );
  const body: PublicProfile = {
    id: user.id,
    displayName: user.display_name,
    memberSince: dayStart(user.created_at),
    solved: problemIds().flatMap((pid) => {
      const problem = solved.has(pid) ? findProblem(pid) : undefined;
      return problem ? [{ id: pid, difficulty: problem.difficulty }] : [];
    }),
    streak: {
      current: Math.max(...streaks.map((s) => s.current)),
      longest: Math.max(answer.stats.longestStreak, ...streaks.map((s) => s.longest)),
    },
    challenge,
    readiness: share(answer.skills.readiness),
    topics: answer.skills.topics.map((topic) => ({ topic: topic.topic, mastery: share(topic.mastery) })),
    // Only badges the user has been awarded (stored), of those that still exist.
    badges: answer.achievements.filter((a) => earned[a.id]).map((a) => ({ id: a.id, earnedAt: dayStart(earned[a.id].earnedAt) })),
  };
  // Not cached: turning the profile off must take effect at once.
  return json(body, 200, { 'Cache-Control': 'no-store' });
}
