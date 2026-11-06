import { ROADMAP } from '../../frontend/src/practice/roadmapStages';
import { evaluate } from './achievements';
import { aiEnabled, AiError, createClient, type Usage } from './ai/client';
import { pickNext, type Candidates, type Pick } from './ai/roadmap';
import type { InterviewVerdict } from './ai/interviewer';
import type { User } from './auth';
import { cardTopics } from './cards';
import type { Ctx } from './context';
import { now, type Env } from './env';
import { can, requireFeature } from './features';
import { json, rateLimit } from './http';
import { errorText, log } from './log';
import { findProblem } from './verify';

/**
 * The AI roadmap (docs/design/paid-plans.md P1, P9; migration 0021): Pro
 * only. After a Pro user's AI interview verdict (src/interviews.ts), and at
 * most once a day after an AI design review (src/review.ts), Haiku picks the
 * next 3 steps from the roadmap's problems and the card topics
 * (src/ai/roadmap.ts). A failed pick never fails what prompted it.
 *
 *   GET /api/roadmap/next[?interview=<id>]   the newest picks (or the picks made after that interview): {next: {…} | null}
 *                                            without `interview`, also `pending: <id>` while a verdict's picks are being made
 *
 * 401 signed out, 402 plan_required off Pro, 501 without ANTHROPIC_API_KEY
 * (the page then keeps the roadmap's own order, P10).
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
/** The picks a review refreshes are at least this old. */
export const REVIEW_REFRESH_MS = 86_400_000;
/** How long after a verdict its picks count as still coming (the call's timeout twice, and room). */
export const PENDING_MS = 60_000;
/** A pick is a nicety: it gets less time than the verdict, and one retry. */
const PICK_TIMEOUT_MS = 20_000;

export type RecSource = 'interview' | 'review';

export interface RoadmapNext {
  createdAt: number;
  source: RecSource;
  /** The interview's id, or the reviewed problem's; absent for a review of an editor diagram. */
  sourceId?: string;
  picks: Pick[];
}

interface RecRow {
  created_at: number;
  source: RecSource;
  source_id: string | null;
  recs: string;
}

/** The candidates for this user: every roadmap problem (solved or not) and every card topic with its mastery; the weakest topics. */
async function candidatesFor(env: Env, user: User): Promise<{ candidates: Candidates; weakest: string[] }> {
  const t = now();
  const [{ answer }, solvedRows] = await Promise.all([
    evaluate(env.DB, user, new Date(t * 1000).toISOString().slice(0, 10), t),
    env.DB.prepare('SELECT problem_id FROM progress WHERE user_id = ? AND solved_at IS NOT NULL').bind(user.id).all<{ problem_id: string }>(),
  ]);
  const solved = new Set(solvedRows.results.map((r) => r.problem_id));
  const mastery = new Map(answer.skills.topics.map((t) => [t.topic, t.mastery]));
  const problems = ROADMAP.flatMap((stage) =>
    stage.problems.flatMap((id) => {
      const p = findProblem(id);
      return p ? [{ id, title: p.title, difficulty: p.difficulty, stage: stage.title, solved: solved.has(id) }] : [];
    }),
  );
  const topics = cardTopics()
    .filter((t) => mastery.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, mastery: mastery.get(t.id) ?? 0 }));
  return { candidates: { problems, topics }, weakest: answer.skills.weakest };
}

/**
 * Picks and stores the next steps; returns the tokens spent (to count with
 * the session), or undefined when nothing was called. Never throws: a
 * failure is logged and the caller carries on.
 */
async function recommend(env: Env, user: User, source: RecSource, sourceId: string | undefined, report: string, requestId?: string): Promise<Usage | undefined> {
  try {
    const { candidates, weakest } = await candidatesFor(env, user);
    const { picks, usage } = await pickNext(createClient(env, { timeoutMs: PICK_TIMEOUT_MS, maxRetries: 1 }), { report, weakest, candidates });
    await env.DB.prepare('INSERT INTO roadmap_recs (user_id, created_at, source, source_id, recs) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, Date.now(), source, sourceId ?? null, JSON.stringify(picks))
      .run();
    log('info', 'roadmap.picked', { requestId, userId: user.id, source, picks: picks.length });
    return usage;
  } catch (e) {
    log('warn', 'roadmap.failed', { requestId, userId: user.id, source, ...(e instanceof AiError ? { kind: e.kind } : {}), error: errorText(e).split('\n')[0] });
    return e instanceof AiError ? e.usage : undefined;
  }
}

/** The verdict as the picker reads it. */
export function verdictReport(problemId: string, v: InterviewVerdict): string {
  const title = findProblem(problemId)?.title ?? problemId;
  return [
    `AI mock interview on "${title}" (${problemId}): ${v.passed ? 'passed' : 'not passed'}.`,
    `Scores out of 5: ${Object.entries(v.scores).map(([s, n]) => `${s} ${n}`).join(', ')}.`,
    `What went wrong:\n${v.wentWrong.map((n) => `- (${n.skill}) ${n.text}`).join('\n') || '- nothing noted'}`,
    `What went well:\n${v.wentWell.map((n) => `- (${n.skill}) ${n.text}`).join('\n') || '- nothing noted'}`,
    `The interviewer's next steps:\n${v.nextSteps.map((s) => `- ${s}`).join('\n') || '- none'}`,
  ].join('\n');
}

/** After an AI interview's verdict (src/interviews.ts finishInterview): Pro only. Returns Haiku's tokens, or undefined. */
export async function recommendAfterInterview(env: Env, user: User, interviewId: string, problemId: string, verdict: InterviewVerdict, requestId?: string): Promise<Usage | undefined> {
  if (!can(user, 'ai_roadmap', env).ok || !aiEnabled(env)) return undefined;
  return recommend(env, user, 'interview', interviewId, verdictReport(problemId, verdict), requestId);
}

/** After an AI design review (src/review.ts): Pro only, and only when the newest picks are a day old or there are none. */
export async function refreshAfterReview(env: Env, user: User, problemId: string | undefined, review: { summary: string; issues: { title: string; detail: string }[] }, requestId?: string): Promise<void> {
  if (!can(user, 'ai_roadmap', env).ok || !aiEnabled(env)) return;
  const last = await env.DB.prepare('SELECT MAX(created_at) AS at FROM roadmap_recs WHERE user_id = ?').bind(user.id).first<{ at: number | null }>();
  if (last?.at && Date.now() - last.at < REVIEW_REFRESH_MS) return;
  const title = problemId ? (findProblem(problemId)?.title ?? problemId) : undefined;
  const report = [
    `AI design review of ${title ? `a solution to "${title}" (${problemId})` : 'a diagram in the editor'}.`,
    `Summary: ${review.summary}`,
    `Issues:\n${review.issues.map((i) => `- ${i.title}: ${i.detail}`).join('\n') || '- none'}`,
  ].join('\n');
  await recommend(env, user, 'review', problemId, report, requestId);
}

/** A stored row as the API answers it; picks whose problem or topic is gone are left out. */
function nextOf(row: RecRow): RoadmapNext | null {
  const topics = new Set(cardTopics().map((t) => t.id));
  const picks = (JSON.parse(row.recs) as Pick[]).filter((p) => (p.kind === 'problem' ? findProblem(p.id) !== undefined : topics.has(p.id)));
  if (!picks.length) return null;
  return { createdAt: row.created_at, source: row.source, ...(row.source_id ? { sourceId: row.source_id } : {}), picks };
}

/** GET /api/roadmap/next[?interview=<id>]. */
export async function getRoadmapNext(request: Request, ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  if (!aiEnabled(env)) return json({ error: 'not_implemented' }, 501, NO_STORE);
  return nextFor(request, ctx);
}

const nextFor = requireFeature('ai_roadmap', async (request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const { env } = ctx;
  await rateLimit(env.INTERVIEW_READ_LIMITER, user.id, 'Too many requests; wait a minute');
  const interview = new URL(request.url).searchParams.get('interview');
  if (!interview) {
    // A verdict whose picks are still being made (in the background, src/interviews.ts): the page asks for them by its id.
    const [latest, pending] = await env.DB.batch([
      env.DB.prepare('SELECT created_at, source, source_id, recs FROM roadmap_recs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(user.id),
      env.DB.prepare(
        "SELECT id FROM ai_interviews i WHERE user_id = ?1 AND status = 'finished' AND ended_at > ?2 AND NOT EXISTS (SELECT 1 FROM roadmap_recs r WHERE r.user_id = ?1 AND r.source = 'interview' AND r.source_id = i.id) ORDER BY ended_at DESC LIMIT 1",
      ).bind(user.id, Date.now() - PENDING_MS),
    ]);
    const row = latest.results[0] as RecRow | undefined;
    const waiting = (pending.results[0] as { id: string } | undefined)?.id;
    return json({ next: row ? nextOf(row) : null, ...(waiting ? { pending: waiting } : {}) }, 200, NO_STORE);
  }
  const row = interview
    ? await env.DB.prepare("SELECT created_at, source, source_id, recs FROM roadmap_recs WHERE user_id = ? AND source = 'interview' AND source_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
        .bind(user.id, interview)
        .first<RecRow>()
    : await env.DB.prepare('SELECT created_at, source, source_id, recs FROM roadmap_recs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').bind(user.id).first<RecRow>();
  return json({ next: row ? nextOf(row) : null }, 200, NO_STORE);
});

/** Download my data: every set of picks, oldest first. */
export async function exportRoadmapRecs(DB: D1Database, userId: string): Promise<{ createdAt: number; source: RecSource; sourceId: string | null; picks: Pick[] }[]> {
  const { results } = await DB.prepare('SELECT created_at, source, source_id, recs FROM roadmap_recs WHERE user_id = ? ORDER BY created_at, id').bind(userId).all<RecRow>();
  return results.map((r) => ({ createdAt: r.created_at, source: r.source, sourceId: r.source_id, picks: JSON.parse(r.recs) as Pick[] }));
}
