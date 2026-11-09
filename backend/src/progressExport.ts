import { levelOf } from '../../frontend/src/learn/level';
import { addDays, computeStreak, goalFor } from '../../frontend/src/learn/streak';
import { evaluate, utcDay } from './achievements';
import type { User } from './auth';
import { cardTopics } from './cards';
import type { Ctx } from './context';
import { now, type Env } from './env';
import { requireFeature } from './features';
import { json, rateLimit } from './http';
import { catalogSolved, findProblem, problemIds } from './verify';

/**
 * GET /api/me/export?view=progress (Pro, `data_export`;
 * docs/design/paid-plans.md P56): the account's learning data, shaped for a
 * spreadsheet rather than for the right of access. The full export
 * (`GET /api/me/export`, src/progress.ts exportMe) stays on every plan and
 * holds all of this too, raw; this view adds what the page computes (level,
 * mastery, streaks) and leaves out sessions, billing and transcripts. The
 * page turns it into CSV files in the browser (frontend/src/learn/progressExport.ts).
 *
 * Times are ISO 8601 strings in UTC.
 */

/** Unix seconds (or milliseconds, for interviews on your own) as ISO 8601; null stays null. */
const iso = (seconds: number | null | undefined): string | null => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null);

/** The level, skill map and streaks the progress page shows, from the server's own data (src/achievements.ts evaluate). */
export async function learningSummary(env: Env, user: { id: string; dailyGoal: number }) {
  const t = now();
  // A local date is at most a day ahead of the UTC one: count up to the day after, and keep the better of the two days' streaks (src/profile.ts).
  const today = addDays(utcDay(t), 1);
  const { answer, activity } = await evaluate(env.DB, user, today, t);
  const goal = goalFor(user.dailyGoal);
  const streaks = [computeStreak(activity, today, goal), computeStreak(activity, utcDay(t), goal)];
  const titles = new Map(cardTopics().map((topic) => [topic.id, topic.title]));
  const level = levelOf(answer.stats);
  return {
    level: { level: level.level, xp: level.xp },
    readiness: answer.skills.readiness,
    topics: answer.skills.topics.map((topic) => ({ topic: topic.topic, title: titles.get(topic.topic) ?? topic.topic, mastery: topic.mastery })),
    streak: {
      current: Math.max(...streaks.map((s) => s.current)),
      longest: Math.max(answer.stats.longestStreak, ...streaks.map((s) => s.longest)),
    },
    stats: answer.stats,
  };
}

type Row = Record<string, string | number | null>;

async function progressExport(_request: Request, ctx: Ctx, user: User): Promise<Response> {
  const { DB } = ctx.env;
  await rateLimit(ctx.env.PROFILE_LIMITER, user.id, 'Too many account changes; wait a minute');
  const [progress, cards, interviews, solo] = await DB.batch([
    DB.prepare('SELECT problem_id, runs, first_run_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms FROM progress WHERE user_id = ? ORDER BY problem_id').bind(user.id),
    DB.prepare('SELECT card_id, due_at, stability, difficulty, reps, lapses, last_review_at FROM card_state WHERE user_id = ? ORDER BY card_id').bind(user.id),
    DB.prepare('SELECT id, problem_id, duration_min, status, started_at, ended_at, verdict FROM ai_interviews WHERE user_id = ? ORDER BY started_at, id').bind(user.id),
    DB.prepare('SELECT problem_id, started_at, duration_min, total_ms, reached_design, drew, solved FROM solo_interviews WHERE user_id = ? ORDER BY started_at').bind(user.id),
  ]);
  const summary = await learningSummary(ctx.env, user);
  const byId = new Map((progress.results as Row[]).map((r) => [String(r.problem_id), r]));
  // Every problem of the catalog, in its order, tried or not, then progress on problems no longer in it.
  const ids = [...problemIds(), ...[...byId.keys()].filter((id) => !findProblem(id))];
  // Counted as the certificate counts them: the published catalog, and the solves still in it.
  const catalog = catalogSolved([...byId].filter(([, r]) => r.solved_at != null).map(([id]) => id));
  const body = {
    exportedAt: iso(now()),
    displayName: user.displayName,
    level: summary.level,
    readiness: summary.readiness,
    streak: summary.streak,
    problemsSolved: catalog.solved.length,
    problemsTotal: catalog.total,
    mastery: summary.topics,
    problems: ids.map((id) => {
      const problem = findProblem(id);
      const r = byId.get(id);
      return {
        problemId: id,
        title: problem?.title ?? id,
        difficulty: problem?.difficulty ?? null,
        solved: r?.solved_at != null,
        solvedAt: iso(r?.solved_at as number | null),
        runs: (r?.runs as number | undefined) ?? 0,
        firstRunAt: iso(r?.first_run_at as number | null),
        runsToSolve: (r?.runs_to_solve as number | null | undefined) ?? null,
        bestCostUsd: (r?.best_cost_usd as number | null | undefined) ?? null,
        bestP99Ms: (r?.best_p99_ms as number | null | undefined) ?? null,
      };
    }),
    // Mock interviews with the interviewer: the verdict's pass and scores only (the full export keeps the notes and transcript).
    interviews: (interviews.results as Row[]).map((r) => {
      const verdict = r.verdict ? (JSON.parse(String(r.verdict)) as { passed: boolean; scores: Record<string, number> }) : null;
      return {
        id: r.id,
        problemId: r.problem_id,
        minutes: r.duration_min,
        status: r.status,
        startedAt: iso(r.started_at as number),
        endedAt: iso(r.ended_at as number | null),
        passed: verdict ? verdict.passed : null,
        scores: verdict ? verdict.scores : null,
      };
    }),
    soloInterviews: (solo.results as Row[]).map((r) => ({
      problemId: r.problem_id,
      startedAt: iso((r.started_at as number) / 1000),
      minutes: r.duration_min,
      totalMinutes: Math.round((r.total_ms as number) / 60_000),
      reachedDesign: r.reached_design === 1,
      drew: r.drew === 1,
      solved: r.solved === 1,
    })),
    cards: (cards.results as Row[]).map((r) => ({
      cardId: r.card_id,
      reps: r.reps,
      lapses: r.lapses,
      stabilityDays: r.stability,
      difficulty: r.difficulty,
      lastReviewAt: iso(r.last_review_at as number),
      dueAt: iso(r.due_at as number),
    })),
  };
  return json(body, 200, { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="proschi-progress.json"' });
}

/** The route: 401 signed out, 402 off a plan without `data_export`. */
export const getProgressExport = requireFeature('data_export', progressExport);
