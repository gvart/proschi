import { soloCounts, type InterviewDone } from '../../frontend/src/learn/mastery';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { now } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { findProblem } from './verify';

/**
 * Mock interviews and the progress they make (docs/design/paid-plans.md P48).
 * Interviews on your own run in the browser; POST /api/me/interviews/solo
 * keeps each finished one (migrations/0032_solo_interviews.sql), once. The
 * AI interviews are in ai_interviews already. loadInterviewsDone reads both
 * for the badges, the level and the skill map (src/achievements.ts).
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
/** At most this many sessions in one request: the browser keeps its newest 50. */
export const MAX_SOLO_SESSIONS = 50;
const DURATIONS = [30, 45, 60];
/** Sessions from before the interview room existed are not real. */
const EARLIEST_MS = Date.UTC(2026, 0, 1);

interface SoloSession {
  problem: string;
  startedAt: number;
  durationMin: number;
  totalMs: number;
  reachedDesign: boolean;
  drew: boolean;
  solved: boolean;
}

/** At most a whole day on the clock (a paused interview resumed much later is still one). */
const MAX_TOTAL_MS = 86_400_000;

function readSession(raw: unknown, latest: number): SoloSession | undefined {
  const s = raw as Partial<SoloSession> | null;
  if (!s || typeof s !== 'object' || typeof s.problem !== 'string' || s.problem.length > 100) return undefined;
  if (!Number.isInteger(s.startedAt) || (s.startedAt as number) < EARLIEST_MS || (s.startedAt as number) > latest) return undefined;
  if (!DURATIONS.includes(s.durationMin as number)) return undefined;
  if (!Number.isInteger(s.totalMs) || (s.totalMs as number) < 0 || (s.totalMs as number) > MAX_TOTAL_MS) return undefined;
  if (typeof s.reachedDesign !== 'boolean' || typeof s.drew !== 'boolean' || typeof s.solved !== 'boolean') return undefined;
  return { problem: s.problem, startedAt: s.startedAt as number, durationMin: s.durationMin as number, totalMs: s.totalMs as number, reachedDesign: s.reachedDesign, drew: s.drew, solved: s.solved };
}

/**
 * POST /api/me/interviews/solo {sessions: [{problem, startedAt, durationMin,
 * totalMs, reachedDesign, drew, solved}]}: keeps finished interviews on your
 * own as they were done; one already kept is left as it is, and one of a
 * problem this Worker does not have is skipped. Whether one counts is
 * decided when the progress is read (loadInterviewsDone), so a short one is
 * kept but earns nothing. Answers `{added}`.
 */
export async function postSoloInterviews(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const body = await readJson(request);
  const raw = body.sessions;
  // A start up to a day ahead of the server's clock: the browser's clock may run fast.
  const latest = Date.now() + 86_400_000;
  const sessions = Array.isArray(raw) && raw.length > 0 && raw.length <= MAX_SOLO_SESSIONS ? raw.map((s) => readSession(s, latest)) : [];
  if (sessions.length === 0 || sessions.some((s) => s === undefined)) {
    throw new HttpError(400, `sessions must be a list of 1 to ${MAX_SOLO_SESSIONS} {problem, startedAt, durationMin, totalMs, reachedDesign, drew, solved}`);
  }
  await rateLimit(ctx.env.STATS_LIMITER, `solo-interviews:${user.id}`, 'Too many requests; wait a minute');
  const known = (sessions as SoloSession[]).filter((s) => findProblem(s.problem) !== undefined);
  let added = 0;
  if (known.length) {
    const result = await ctx.env.DB.prepare(
      `INSERT OR IGNORE INTO solo_interviews (user_id, problem_id, started_at, duration_min, total_ms, reached_design, drew, solved, received_at)
       SELECT ?1, json_extract(value, '$.problem'), json_extract(value, '$.startedAt'), json_extract(value, '$.durationMin'), json_extract(value, '$.totalMs'),
              json_extract(value, '$.reachedDesign'), json_extract(value, '$.drew'), json_extract(value, '$.solved'), ?2
       FROM json_each(?3)`,
    )
      .bind(user.id, now(), JSON.stringify(known.map((s) => ({ ...s, reachedDesign: s.reachedDesign ? 1 : 0, drew: s.drew ? 1 : 0, solved: s.solved ? 1 : 0 }))))
      .run();
    added = result.meta.changes ?? 0;
  }
  return json({ added }, 200, NO_STORE);
}

interface MockRow {
  problem_id: string;
  duration_min: number;
  started_at: number;
  ended_at: number | null;
  verdict: string;
}

interface SoloRow {
  problem_id: string;
  duration_min: number;
  total_ms: number;
  reached_design: number;
  drew: number;
  solved: number;
}

/**
 * Every mock interview the user finished that counts: those with the
 * interviewer with a verdict (credits were spent on each), and those on your
 * own that did enough (soloCounts), on time when solved within their minutes.
 */
export async function loadInterviewsDone(DB: D1Database, userId: string): Promise<InterviewDone[]> {
  const [mock, solo] = await DB.batch([
    DB.prepare("SELECT problem_id, duration_min, started_at, ended_at, verdict FROM ai_interviews WHERE user_id = ? AND status = 'finished' AND verdict IS NOT NULL").bind(userId),
    DB.prepare('SELECT problem_id, duration_min, total_ms, reached_design, drew, solved FROM solo_interviews WHERE user_id = ?').bind(userId),
  ]);
  const done: InterviewDone[] = [];
  for (const r of mock.results as unknown as MockRow[]) {
    const v = JSON.parse(r.verdict) as { passed?: unknown; scores?: Record<string, number> };
    const passed = v.passed === true;
    const inTime = r.ended_at !== null && r.ended_at - r.started_at <= r.duration_min * 60_000;
    done.push({ problem: r.problem_id, mode: 'mock', passed, onTime: passed && inTime, scores: v.scores ?? {} });
  }
  for (const r of solo.results as unknown as SoloRow[]) {
    if (!soloCounts({ totalMs: r.total_ms, reachedDesign: r.reached_design === 1, drew: r.drew === 1 })) continue;
    done.push({ problem: r.problem_id, mode: 'solo', passed: false, onTime: r.solved === 1 && r.total_ms <= r.duration_min * 60_000 });
  }
  return done;
}

/** The interviews on your own in "Download my data". */
export async function exportSoloInterviews(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const rows = await DB.prepare('SELECT problem_id, started_at, duration_min, total_ms, reached_design, drew, solved, received_at FROM solo_interviews WHERE user_id = ? ORDER BY started_at')
    .bind(userId)
    .all<SoloRow & { started_at: number; received_at: number }>();
  return rows.results.map((r) => ({
    problem: r.problem_id,
    startedAt: r.started_at,
    minutes: r.duration_min,
    totalMs: r.total_ms,
    reachedDesign: r.reached_design === 1,
    drew: r.drew === 1,
    solved: r.solved === 1,
    receivedAt: r.received_at,
  }));
}
