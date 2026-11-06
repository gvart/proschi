import { DURATIONS, type Duration } from '../../frontend/src/practice/modes/session';
import { requireUser, type User } from './auth';
import { aiEnabled, AiError, createClient, HAIKU } from './ai/client';
import { addUsage, billedTokens, emptyUsage, sessionCostUsd, WALL_CLOCK_MS } from './ai/budget';
import { problemContext } from './ai/context';
import { InterviewLimitError, start, turn, verdict, type Hint, type InterviewState, type InterviewVerdict } from './ai/interviewer';
import type { Ctx } from './context';
import { balance, refund, spend } from './credits';
import type { Env } from './env';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { recommendAfterInterview } from './roadmap';

/**
 * The AI mock interviewer's routes (docs/design/paid-plans.md P3–P10), over
 * the engine in src/ai/interviewer.ts. Signed in only, each route with its
 * own per-user rate limit; without ANTHROPIC_API_KEY every route answers 501.
 *
 *   POST /api/interviews {problem, minutes, replace?}   spends a credit, opens a session (402 no_credits, 409 active_session)
 *   POST /api/interviews/<id>/turn {message, design?, advance?}
 *                                                 the reply as Server-Sent Events: text…, then hint, grade, done
 *   POST /api/interviews/<id>/finish              the verdict (once; again answers the same one)
 *   GET  /api/interviews/<id>                     the session with its transcript, to resume
 *   GET  /api/interviews                          the user's sessions, newest first, and the credits left
 *   GET  /api/interviews/history                  verdict summaries with skill scores: every one on Pro, the latest on free (P1)
 *
 * A Pro user's verdict is followed by the AI roadmap's next steps
 * (src/roadmap.ts, P9): one Haiku call made after the verdict is answered
 * (waitUntil), whose failure never touches it. GET /api/interviews lists
 * every session, with the verdict of the latest only off Pro.
 *
 * The credit (P3) is refunded when the session fails (a model error, not a
 * limit) on its first turn or in its first 5 minutes; the session then ends.
 * The limits (60-minute wall clock, token cap, turns, message and design
 * size) are the engine's; the routes add a body cap and one session at a
 * time: with one open, a start answers 409 active_session unless `replace` ends it (its credit is not returned).
 */

export const REFUND_WINDOW_MS = 5 * 60_000;
/** Transcripts are kept this long (P8); the verdict stays. */
export const TRANSCRIPT_TTL_MS = 90 * 86_400_000;
/** A turn's body: a 64 KiB design and a 4,000-character message, with room for JSON escaping. */
const MAX_TURN_BODY = 160 * 1024;
const LIST_MAX = 50;

const NO_STORE = { 'Cache-Control': 'no-store' };

type Status = 'active' | 'finishing' | 'finished' | 'failed' | 'abandoned';

interface Row {
  id: string;
  user_id: string;
  problem_id: string;
  duration_min: number;
  status: Status;
  state: string | null;
  version: number;
  started_at: number;
  ended_at: number | null;
  tokens: number;
  cost_usd: number;
  verdict: string | null;
}

interface MessageRow {
  role: 'interviewer' | 'candidate';
  text: string;
  hint: string | null;
  design: number;
  at: number;
}

function requireAi(env: Env): void {
  if (!aiEnabled(env)) throw new HttpError(501, 'ai_disabled');
}

async function signedIn(request: Request, ctx: Ctx, limiter: RateLimit) {
  requireAi(ctx.env);
  const user = await requireUser(request, ctx);
  await rateLimit(limiter, user.id, 'Too many interview requests; wait a minute');
  return user;
}

async function load(ctx: Ctx, userId: string, id: string): Promise<Row> {
  const row = await ctx.env.DB.prepare('SELECT * FROM ai_interviews WHERE id = ? AND user_id = ?').bind(id, userId).first<Row>();
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

function stateOf(row: Row): InterviewState {
  if (!row.state) throw new HttpError(410, 'This interview is past its 90 days; only the verdict is kept');
  return JSON.parse(row.state) as InterviewState;
}

/** A session as the page sees it: never the model's view of the turns (src/ai/interviewer.ts Entry.text). */
async function view(ctx: Ctx, row: Row) {
  const { results } = await ctx.env.DB.prepare('SELECT role, text, hint, design, at FROM ai_interview_messages WHERE interview_id = ? ORDER BY id').bind(row.id).all<MessageRow>();
  const state = row.state ? (JSON.parse(row.state) as InterviewState) : undefined;
  return {
    ...summary(row),
    phase: state?.phase,
    phaseStarts: state?.phaseStarts,
    turns: state?.turns ?? 0,
    covered: state?.covered.length ?? 0,
    // The wall clock (P3): no turn after this, whatever the chosen length.
    deadline: row.started_at + WALL_CLOCK_MS,
    messages: results.map((m) => ({ role: m.role, text: m.text, at: m.at, ...(m.hint ? { hint: JSON.parse(m.hint) as Hint } : {}), ...(m.design ? { design: true } : {}) })),
  };
}

function summary(row: Row) {
  return {
    id: row.id,
    problem: row.problem_id,
    minutes: row.duration_min,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    ...(row.verdict ? { verdict: JSON.parse(row.verdict) as InterviewVerdict } : {}),
  };
}

/** POST /api/interviews {problem, minutes, replace?}. */
export async function startInterview(request: Request, ctx: Ctx): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_START_LIMITER);
  const body = await readJson(request);
  const context = typeof body.problem === 'string' ? problemContext(body.problem) : undefined;
  if (!context) throw new HttpError(400, 'Unknown problem');
  const minutes = body.minutes ?? 45;
  if (!DURATIONS.includes(minutes as Duration)) throw new HttpError(400, `minutes must be one of ${DURATIONS.join(', ')}`);

  if (body.replace !== undefined && typeof body.replace !== 'boolean') throw new HttpError(400, 'replace must be a boolean');
  // One session at a time: an open one is resumed, or ended on purpose (its credit is not returned).
  const open = await ctx.env.DB.prepare("SELECT id, problem_id FROM ai_interviews WHERE user_id = ? AND status IN ('active', 'finishing') ORDER BY started_at DESC LIMIT 1")
    .bind(user.id)
    .first<{ id: string; problem_id: string }>();
  if (open && body.replace !== true) return json({ error: 'active_session', id: open.id, problem: open.problem_id }, 409, NO_STORE);

  const id = crypto.randomUUID();
  const now = Date.now();
  const spent = await spend(ctx.env, user.id, 'interview', id, now);
  if (!spent.ok) return json({ error: 'no_credits', credits: await balance(ctx.env, user.id, now) }, 402, NO_STORE);

  const { state, opening } = start(context, minutes as Duration, now);
  const { DB } = ctx.env;
  await DB.batch([
    DB.prepare("UPDATE ai_interviews SET status = 'abandoned', ended_at = ?2 WHERE user_id = ?1 AND status IN ('active', 'finishing')").bind(user.id, now),
    DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, state, started_at) VALUES (?, ?, ?, ?, 'active', ?, ?)").bind(id, user.id, context.problem.id, minutes, JSON.stringify(state), now),
    DB.prepare("INSERT INTO ai_interview_messages (interview_id, role, text, at) VALUES (?, 'interviewer', ?, ?)").bind(id, opening, now),
  ]);
  const row = await load(ctx, user.id, id);
  return json({ interview: await view(ctx, row), credits: await balance(ctx.env, user.id, now) }, 201, NO_STORE);
}

/** P3: a session that fails on its first turn or in its first 5 minutes gives its credit back and ends. */
async function failEarly(env: Env, row: Row, state: InterviewState, now: number): Promise<boolean> {
  if (state.turns > 0 && now - row.started_at >= REFUND_WINDOW_MS) return false;
  await env.DB.prepare("UPDATE ai_interviews SET status = 'failed', ended_at = ? WHERE id = ?").bind(now, row.id).run();
  await refund(env, row.id, now);
  return true;
}

function limitStatus(e: InterviewLimitError): number {
  return e.reason === 'message' || e.reason === 'design' ? 400 : 409;
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * POST /api/interviews/<id>/turn. Anything refused before the model starts
 * answering is plain JSON (400 for the input, 409 for a limit, 502 for a
 * model failure); after that the answer is `text/event-stream`:
 *
 *   event: text   {text}                 the reply, piece by piece
 *   event: hint   {kind, text}           the coaching card (absent when it failed)
 *   event: grade  {passed, total, …}     the server's run of the design sent (only with one)
 *   event: done   {reply, phase, elapsedMs, turns}
 *   event: error  {error, refunded?}     instead of done, when the turn failed midway
 */
export async function interviewTurn(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_TURN_LIMITER);
  const row = await load(ctx, user.id, id);
  const body = await readJson(request, MAX_TURN_BODY);
  if (row.status !== 'active') throw new HttpError(409, 'finished');
  const message = body.message ?? '';
  if (typeof message !== 'string') throw new HttpError(400, 'message must be a string');
  if (body.design !== undefined && typeof body.design !== 'string') throw new HttpError(400, 'design must be a string');
  if (body.advance !== undefined && typeof body.advance !== 'boolean') throw new HttpError(400, 'advance must be a boolean');
  const state = stateOf(row);
  const context = problemContext(row.problem_id);
  if (!context) throw new HttpError(409, 'The problem is no longer available');
  const now = Date.now();

  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();
  let streaming = false;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const run = turn({ client: createClient(ctx.env), context, now }, state, {
    message,
    ...(body.design !== undefined ? { design: body.design as string } : {}),
    ...(body.advance ? { advance: true } : {}),
    onText: (text) => {
      if (!streaming) {
        streaming = true;
        markStarted();
      }
      void writer.write(sse('text', { text }));
    },
  });

  // Until the first piece of the reply, a refusal or a failure is an ordinary JSON answer.
  const early = await Promise.race([started.then(() => undefined), run.then(() => undefined, (e: unknown) => e)]);
  if (early !== undefined && !streaming) {
    void writer.abort();
    if (early instanceof InterviewLimitError) return json({ error: early.reason, message: early.message }, limitStatus(early), NO_STORE);
    if (early instanceof AiError) {
      log('warn', 'AI interview turn failed', { requestId: ctx.requestId, kind: early.kind, status: early.status });
      const refunded = await failEarly(ctx.env, row, state, Date.now());
      return json({ error: 'ai_failed', retryable: early.retryable && !refunded, refunded }, 502, NO_STORE);
    }
    throw early;
  }

  const finish = (async () => {
    try {
      const result = await run;
      const s = result.state;
      const { DB } = ctx.env;
      const [saved] = await DB.batch([
        DB.prepare('UPDATE ai_interviews SET state = ?1, version = version + 1, tokens = ?2, cost_usd = ?3 WHERE id = ?4 AND version = ?5 AND status = ?6').bind(
          JSON.stringify(s),
          billedTokens(s.usage),
          sessionCostUsd(s.usage),
          row.id,
          row.version,
          'active',
        ),
        // Only kept when the state above was (changes() counts the statement before): a concurrent turn that saved first wins.
        DB.prepare("INSERT INTO ai_interview_messages (interview_id, role, text, design, at) SELECT ?, 'candidate', ?, ?, ? WHERE changes() > 0").bind(row.id, message, body.design !== undefined ? 1 : 0, now),
        DB.prepare("INSERT INTO ai_interview_messages (interview_id, role, text, hint, at) SELECT ?, 'interviewer', ?, ?, ? WHERE changes() > 0").bind(
          row.id,
          result.reply,
          result.hint ? JSON.stringify(result.hint) : null,
          Date.now(),
        ),
      ]);
      if (saved.meta.changes === 0) {
        await writer.write(sse('error', { error: 'conflict' }));
        return;
      }
      if (result.hint) await writer.write(sse('hint', result.hint));
      if (result.grade) await writer.write(sse('grade', result.grade));
      await writer.write(sse('done', { reply: result.reply, phase: s.phase, elapsedMs: result.elapsedMs, turns: s.turns }));
    } catch (e) {
      log('warn', 'AI interview turn failed midway', { requestId: ctx.requestId, error: errorText(e).split('\n')[0] });
      const refunded = e instanceof AiError ? await failEarly(ctx.env, row, state, Date.now()) : false;
      await writer.write(sse('error', { error: e instanceof AiError ? 'ai_failed' : 'internal', refunded })).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  ctx.exec.waitUntil(finish);
  return new Response(readable.pipeThrough(new TextEncoderStream()), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}

/** POST /api/interviews/<id>/finish: the verdict, once; asked again, the same one. */
export async function finishInterview(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_FINISH_LIMITER);
  const row = await load(ctx, user.id, id);
  if (row.status === 'finished') return json({ interview: summary(row) }, 200, NO_STORE);
  if (row.status !== 'active') throw new HttpError(409, row.status);
  const state = stateOf(row);
  const context = problemContext(row.problem_id);
  if (!context) throw new HttpError(409, 'The problem is no longer available');
  const { DB } = ctx.env;
  // Claims the session, so two finishes at once don't both pay for a verdict.
  const claimed = await DB.prepare("UPDATE ai_interviews SET status = 'finishing' WHERE id = ? AND status = 'active' AND version = ?").bind(id, row.version).run();
  if (claimed.meta.changes === 0) throw new HttpError(409, 'busy');
  const now = Date.now();
  try {
    const result = await verdict({ client: createClient(ctx.env), context, now }, state);
    const s = result.state;
    await DB.prepare("UPDATE ai_interviews SET status = 'finished', state = ?, version = version + 1, ended_at = ?, tokens = ?, cost_usd = ?, verdict = ? WHERE id = ?")
      .bind(JSON.stringify(s), Date.now(), billedTokens(s.usage), sessionCostUsd(s.usage), JSON.stringify(result.verdict), id)
      .run();
    // The next steps (Pro), after the verdict is answered: the page asks for them again until they land.
    ctx.exec.waitUntil(pickAfterVerdict(ctx, user, id, row.problem_id, result.verdict));
  } catch (e) {
    await DB.prepare("UPDATE ai_interviews SET status = 'active' WHERE id = ? AND status = 'finishing'").bind(id).run();
    if (e instanceof InterviewLimitError) return json({ error: e.reason, message: e.message }, limitStatus(e), NO_STORE);
    if (!(e instanceof AiError)) throw e;
    log('warn', 'AI interview verdict failed', { requestId: ctx.requestId, kind: e.kind, status: e.status });
    const refunded = await failEarly(ctx.env, row, state, Date.now());
    return json({ error: 'ai_failed', retryable: e.retryable && !refunded, refunded }, 502, NO_STORE);
  }
  return json({ interview: summary(await load(ctx, user.id, id)) }, 200, NO_STORE);
}

/** The AI roadmap's picks after a verdict; their tokens are added to the session's. Never throws. */
async function pickAfterVerdict(ctx: Ctx, user: User, id: string, problemId: string, v: InterviewVerdict): Promise<void> {
  const used = await recommendAfterInterview(ctx.env, user, id, problemId, v, ctx.requestId);
  if (!used) return;
  const extra = addUsage(emptyUsage(), HAIKU, used);
  await ctx.env.DB.prepare('UPDATE ai_interviews SET tokens = tokens + ?, cost_usd = cost_usd + ? WHERE id = ?')
    .bind(billedTokens(extra), sessionCostUsd(extra), id)
    .run()
    .catch((e: unknown) => log('warn', 'roadmap.tokens_failed', { requestId: ctx.requestId, error: errorText(e) }));
}

/** GET /api/interviews/<id>: the session and its transcript, to resume after a reload. */
export async function getInterview(request: Request, ctx: Ctx, id: string): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_READ_LIMITER);
  return json({ interview: await view(ctx, await load(ctx, user.id, id)) }, 200, NO_STORE);
}

/**
 * GET /api/interviews: the newest sessions (no transcripts) and the credits
 * left. Off Pro only the latest verdict comes with them (P1, as the history):
 * the others are listed without it.
 */
export async function listInterviews(request: Request, ctx: Ctx): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_READ_LIMITER);
  const { results } = await ctx.env.DB.prepare('SELECT * FROM ai_interviews WHERE user_id = ? ORDER BY started_at DESC, id LIMIT ?').bind(user.id, LIST_MAX).all<Row>();
  const latest = results.find((r) => r.verdict)?.id;
  const rows = user.plan === 'pro' ? results : results.map((r) => (r.id === latest ? r : { ...r, verdict: null }));
  return json({ interviews: rows.map(summary), credits: await balance(ctx.env, user.id) }, 200, NO_STORE);
}

const HISTORY_MAX = 200;

/**
 * GET /api/interviews/history: the finished sessions' verdict summaries
 * (pass or fail and the score per skill, no notes), newest first, for the
 * history list and the trend per skill. Pro gets every one (up to 200);
 * any other plan gets the latest only (P1), with `total` saying how many
 * there are and `full: false`.
 */
export async function interviewHistory(request: Request, ctx: Ctx): Promise<Response> {
  const user = await signedIn(request, ctx, ctx.env.INTERVIEW_READ_LIMITER);
  const full = user.plan === 'pro';
  const { DB } = ctx.env;
  const [rows, count] = await DB.batch([
    DB.prepare("SELECT id, problem_id, duration_min, started_at, ended_at, verdict FROM ai_interviews WHERE user_id = ? AND status = 'finished' AND verdict IS NOT NULL ORDER BY started_at DESC, id LIMIT ?").bind(
      user.id,
      full ? HISTORY_MAX : 1,
    ),
    DB.prepare("SELECT COUNT(*) AS n FROM ai_interviews WHERE user_id = ? AND status = 'finished' AND verdict IS NOT NULL").bind(user.id),
  ]);
  const sessions = (rows.results as Pick<Row, 'id' | 'problem_id' | 'duration_min' | 'started_at' | 'ended_at' | 'verdict'>[]).map((r) => {
    const v = JSON.parse(r.verdict!) as InterviewVerdict;
    return { id: r.id, problem: r.problem_id, minutes: r.duration_min, startedAt: r.started_at, endedAt: r.ended_at ?? undefined, passed: v.passed, scores: v.scores };
  });
  return json({ full, total: (count.results[0] as { n: number }).n, sessions }, 200, NO_STORE);
}

/**
 * The daily retention job (src/cron.ts, P8): transcripts older than 90 days
 * go (the messages, and the state, which holds the transcript and the last
 * design); the session row and its verdict stay for history. Returns how
 * many sessions were cleared.
 */
export async function pruneInterviewTranscripts(env: Pick<Env, 'DB'>, at = Date.now()): Promise<number> {
  const cutoff = at - TRANSCRIPT_TTL_MS;
  const [, cleared] = await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_interview_messages WHERE interview_id IN (SELECT id FROM ai_interviews WHERE started_at <= ?)').bind(cutoff),
    // A session left active past its wall clock is over too.
    env.DB.prepare("UPDATE ai_interviews SET state = NULL, status = CASE WHEN status IN ('active', 'finishing') THEN 'abandoned' ELSE status END, ended_at = COALESCE(ended_at, started_at + ?2) WHERE started_at <= ?1 AND state IS NOT NULL").bind(
      cutoff,
      WALL_CLOCK_MS,
    ),
  ]);
  return cleared.meta.changes;
}

/** The sessions in "Download my data": each with its transcript while kept, and its verdict. */
export async function exportInterviews(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const [sessions, messages] = await DB.batch([
    DB.prepare('SELECT id, problem_id, duration_min, status, started_at, ended_at, tokens, cost_usd, verdict FROM ai_interviews WHERE user_id = ? ORDER BY started_at, id').bind(userId),
    DB.prepare('SELECT m.interview_id, m.role, m.text, m.hint, m.design, m.at FROM ai_interview_messages m JOIN ai_interviews i ON i.id = m.interview_id WHERE i.user_id = ? ORDER BY m.id').bind(userId),
  ]);
  const byInterview = new Map<string, Record<string, unknown>[]>();
  for (const m of messages.results as (MessageRow & { interview_id: string })[]) {
    const list = byInterview.get(m.interview_id) ?? [];
    list.push({ role: m.role, text: m.text, at: m.at, ...(m.hint ? { hint: JSON.parse(m.hint) as Hint } : {}), ...(m.design ? { design: true } : {}) });
    byInterview.set(m.interview_id, list);
  }
  return (sessions.results as Omit<Row, 'user_id' | 'state' | 'version'>[]).map((r) => ({
    id: r.id,
    problem: r.problem_id,
    minutes: r.duration_min,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    tokens: r.tokens,
    costUsd: r.cost_usd,
    verdict: r.verdict ? (JSON.parse(r.verdict) as InterviewVerdict) : null,
    messages: byInterview.get(r.id) ?? [],
  }));
}
