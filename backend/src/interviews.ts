import { DURATIONS, type Duration } from '../../frontend/src/practice/modes/session';
import type { User } from './auth';
import { aiEnabled, AiError, createClient, HAIKU, OPUS, SONNET, type Model } from './ai/client';
import { addUsage, billedTokens, emptyUsage, sessionCostUsd, usageSince, WALL_CLOCK_MS, type SessionUsage } from './ai/budget';
import { problemContext } from './ai/context';
import { InterviewLimitError, start, turn, verdict, type Hint, type InterviewState, type InterviewVerdict } from './ai/interviewer';
import type { Ctx } from './context';
import { creditsView } from './credits';
import type { Env } from './env';
import { can, planRequired, requireFeature, type FeatureRoute } from './features';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import { balanceMc, CALLS, hold, HOLD_TTL_MS, interviewTurnHoldMc, noCredits, release, settle, verdictHoldMc, worstMc, type Usage as MeterUsage } from './meter';
import { recommendAfterInterview } from './roadmap';

/**
 * The AI mock interviewer's routes (docs/design/paid-plans.md P3–P10), over
 * the engine in src/ai/interviewer.ts. Signed in only, each route with its
 * own per-user rate limit; without ANTHROPIC_API_KEY every route answers 501.
 *
 *   POST /api/interviews {problem, minutes, replace?, deep?}   holds the verdict's credits, opens a session (402 no_credits or plan_required, 409 active_session)
 *   POST /api/interviews/<id>/turn {message, design?, advance?}
 *                                                 the reply as Server-Sent Events: text…, then hint, grade, done
 *   POST /api/interviews/<id>/finish              the verdict (once; again answers the same one)
 *   GET  /api/interviews/<id>                     the session with its transcript, to resume
 *   GET  /api/interviews                          the user's sessions, newest first, and the credits left
 *   GET  /api/interviews/history                  verdict summaries with skill scores: every one on Pro, the latest on free (P1)
 *   GET  /api/interviews/<id>/report              a finished session's printable report (interview_report, Max; P31), without the AI key too
 *
 * Deep mode (deep_mode, Max; P31): a session started with `deep` has its
 * verdict written by Opus, held and charged at Opus's price; its turns and
 * hints stay on Sonnet and Haiku. The server checks the plan at the start
 * (402 plan_required) and again at the verdict: an account that left Max
 * meanwhile gets the ordinary verdict.
 *
 * A Pro user's verdict is followed by the AI roadmap's next steps
 * (src/roadmap.ts, P9): one Haiku call made after the verdict is answered
 * (waitUntil), whose failure never touches it. GET /api/interviews lists
 * every session, with the verdict of the latest only off Pro.
 *
 * Credits (P26–P28, src/meter.ts): starting needs enough for the verdict and
 * one turn, and holds the verdict's worst case for the whole session. Each
 * turn holds its own worst case, then is charged what its calls really cost
 * (a failed hint isn't charged); a failed turn or verdict is charged nothing.
 * When a turn can't be held (0 credits), it answers 402 no_credits with
 * `wrapUp: true` and the session moves to its wrap-up: the verdict still runs
 * from the hold it kept. Of a verdict asked for again after a malformed
 * answer, only the answer that validated is charged. Every call's tokens are
 * added to the stored total, failed ones too, and the token cap is checked
 * against it. The limits (60-minute wall clock, token cap, turns, message
 * and design size) are the engine's; the routes add a body cap, one turn at a
 * time per session (a turn meanwhile answers 409 turn_in_progress) and one
 * session at a time: with one open, a start answers 409 active_session unless `replace` ends it (its hold is let go).
 */

/** The verdict's hold lasts the wall clock and this much after, for a verdict asked for late. */
export const VERDICT_HOLD_EXTRA_MS = 30 * 60_000;
/**
 * How long a turn holds its session (P3): one turn at a time, so parallel
 * turns can't each call the model. A turn that died is let go after this.
 */
export const TURN_LEASE_MS = 90_000;
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
  turning_until: number | null;
  verdict_hold: string | null;
  deep: number;
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

/**
 * An interview route (the ai_interview feature, src/features.ts): 501
 * without the AI key, 401 signed out, 402 off a plan without it, then the
 * route's own per-user rate limit.
 */
function interviewRoute<A extends unknown[]>(limiter: (env: Env) => RateLimit, handler: (request: Request, ctx: Ctx, user: User, ...args: A) => Promise<Response>): FeatureRoute<A> {
  return requireFeature(
    'ai_interview',
    async (request: Request, ctx: Ctx, user: User, _pre: undefined, ...args: A) => {
      await rateLimit(limiter(ctx.env), user.id, 'Too many interview requests; wait a minute');
      return handler(request, ctx, user, ...args);
    },
    (_request: Request, ctx: Ctx, ..._args: A) => {
      requireAi(ctx.env);
      return undefined;
    },
  );
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
    deep: row.deep === 1,
    ...(row.verdict ? { verdict: JSON.parse(row.verdict) as InterviewVerdict } : {}),
  };
}

/** POST /api/interviews {problem, minutes, replace?, deep?}. */
export const startInterview = interviewRoute((env) => env.INTERVIEW_START_LIMITER, async (request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const body = await readJson(request);
  const context = typeof body.problem === 'string' ? problemContext(body.problem) : undefined;
  if (!context) throw new HttpError(400, 'Unknown problem');
  const minutes = body.minutes ?? 45;
  if (!DURATIONS.includes(minutes as Duration)) throw new HttpError(400, `minutes must be one of ${DURATIONS.join(', ')}`);

  if (body.replace !== undefined && typeof body.replace !== 'boolean') throw new HttpError(400, 'replace must be a boolean');
  if (body.deep !== undefined && typeof body.deep !== 'boolean') throw new HttpError(400, 'deep must be a boolean');
  const deep = body.deep === true;
  if (deep && !can(user, 'deep_mode', ctx.env).ok) return planRequired('deep_mode');
  // One session at a time: an open one is resumed, or ended on purpose (its credit is not returned).
  const open = await ctx.env.DB.prepare("SELECT id, problem_id FROM ai_interviews WHERE user_id = ? AND status IN ('active', 'finishing') ORDER BY started_at DESC LIMIT 1")
    .bind(user.id)
    .first<{ id: string; problem_id: string }>();
  if (open && body.replace !== true) return json({ error: 'active_session', id: open.id, problem: open.problem_id }, 409, NO_STORE);

  const id = crypto.randomUUID();
  const now = Date.now();
  const { DB } = ctx.env;
  // The session being replaced lets go of its verdict's hold first, so the new one can use those credits.
  const replaced = await DB.prepare("SELECT verdict_hold FROM ai_interviews WHERE user_id = ? AND status IN ('active', 'finishing') AND verdict_hold IS NOT NULL").bind(user.id).all<{ verdict_hold: string }>();
  for (const r of replaced.results) await release(ctx.env, r.verdict_hold);
  // Enough for the verdict and one turn (P28); only the verdict is held, for the whole session.
  const needed = verdictHoldMc(ctx.env, deep) + interviewTurnHoldMc(ctx.env);
  const balance = await balanceMc(ctx.env, user.id);
  if (balance < needed) return noCredits(needed, balance);
  const held = await hold(ctx.env, user.id, verdictHoldMc(ctx.env, deep), id, WALL_CLOCK_MS + VERDICT_HOLD_EXTRA_MS);
  if (!held.ok) return noCredits(needed, held.balanceMc);

  const { state, opening } = start(context, minutes as Duration, now);
  await DB.batch([
    DB.prepare("UPDATE ai_interviews SET status = 'abandoned', ended_at = ?2, verdict_hold = NULL WHERE user_id = ?1 AND status IN ('active', 'finishing')").bind(user.id, now),
    DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, state, started_at, verdict_hold, deep) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)").bind(
      id,
      user.id,
      context.problem.id,
      minutes,
      JSON.stringify(state),
      now,
      held.holdId,
      deep ? 1 : 0,
    ),
    DB.prepare("INSERT INTO ai_interview_messages (interview_id, role, text, at) VALUES (?, 'interviewer', ?, ?)").bind(id, opening, now),
  ]);
  const row = await load(ctx, user.id, id);
  return json({ interview: await view(ctx, row), credits: await creditsView(ctx.env, user.id) }, 201, NO_STORE);
});

/** A turn's usage as the meter charges it: each model's, the models with none left out. */
function meterUsage(used: SessionUsage, models: readonly Model[] = [SONNET, HAIKU]): MeterUsage[] {
  return models.filter((m) => used[m].input_tokens + used[m].output_tokens + used[m].cache_creation_input_tokens + used[m].cache_read_input_tokens > 0).map((m) => ({ model: m, ...used[m] }));
}

/**
 * At 0 credits (P28): the session moves to its wrap-up, so the candidate
 * asks for the verdict, which runs from the hold the session kept. The state
 * is saved only when no turn changed it meanwhile.
 */
async function moveToWrapUp(DB: D1Database, row: Row, state: InterviewState, now: number): Promise<void> {
  if (state.phase === 'wrapup') return;
  const elapsed = now - state.startedAt;
  const next: InterviewState = { ...state, phase: 'wrapup', phaseStarts: { ...state.phaseStarts, wrapup: state.phaseStarts.wrapup ?? elapsed } };
  await DB.prepare("UPDATE ai_interviews SET state = ?1, version = version + 1 WHERE id = ?2 AND version = ?3 AND status = 'active'").bind(JSON.stringify(next), row.id, row.version).run();
}

/**
 * Adds a call's usage to the session's stored total (also of a failed call,
 * or of a turn whose state was not kept) and, with `lease`, lets go of the
 * turn that held it. The stored total is what the cap checks.
 */
function addTokens(DB: D1Database, id: string, used: SessionUsage, lease?: number): D1PreparedStatement {
  return DB.prepare('UPDATE ai_interviews SET tokens = tokens + ?1, cost_usd = cost_usd + ?2, turning_until = CASE WHEN turning_until = ?3 THEN NULL ELSE turning_until END WHERE id = ?4').bind(
    billedTokens(used),
    sessionCostUsd(used),
    lease ?? null,
    id,
  );
}

/** A failed call's tokens, as a session's usage (a turn's is Sonnet's, a failed hint part of it; a Deep verdict's is Opus's). */
const failedUsage = (e: AiError, model: Model = SONNET): SessionUsage => addUsage(emptyUsage(), model, e.usage);


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
 *   event: error  {error}                instead of done, when the turn failed midway (it is charged nothing)
 *
 * 402 no_credits {needed, balance, wrapUp: true} when the turn can't be held:
 * the session is in its wrap-up then, and the verdict runs from its own hold.
 */
export const interviewTurn = interviewRoute((env) => env.INTERVIEW_TURN_LIMITER, async (request: Request, ctx: Ctx, user: User, id: string): Promise<Response> => {
  const loaded = await load(ctx, user.id, id);
  const body = await readJson(request, MAX_TURN_BODY);
  if (loaded.status !== 'active') throw new HttpError(409, 'finished');
  const message = body.message ?? '';
  if (typeof message !== 'string') throw new HttpError(400, 'message must be a string');
  if (body.design !== undefined && typeof body.design !== 'string') throw new HttpError(400, 'design must be a string');
  if (body.advance !== undefined && typeof body.advance !== 'boolean') throw new HttpError(400, 'advance must be a boolean');
  stateOf(loaded);
  const context = problemContext(loaded.problem_id);
  if (!context) throw new HttpError(409, 'The problem is no longer available');
  const now = Date.now();

  // One turn at a time (P3): the session is claimed before any model call, so parallel turns can't each pay for one.
  const { DB } = ctx.env;
  const lease = now + TURN_LEASE_MS;
  const row = await DB.prepare("UPDATE ai_interviews SET turning_until = ?1 WHERE id = ?2 AND user_id = ?3 AND status = 'active' AND (turning_until IS NULL OR turning_until < ?4) RETURNING *")
    .bind(lease, id, user.id, now)
    .first<Row>();
  if (!row) {
    if ((await load(ctx, user.id, id)).status !== 'active') throw new HttpError(409, 'finished');
    return json({ error: 'turn_in_progress', message: 'Still answering your last message' }, 409, NO_STORE);
  }
  const state = stateOf(row);

  // The turn's worst case, held before any call; at 0 credits the session goes to its wrap-up (P28).
  const held = await hold(ctx.env, user.id, interviewTurnHoldMc(ctx.env), id);
  if (!held.ok) {
    await DB.batch([DB.prepare('UPDATE ai_interviews SET turning_until = NULL WHERE id = ? AND turning_until = ?').bind(id, lease)]);
    await moveToWrapUp(DB, row, state, now);
    return noCredits(held.neededMc, held.balanceMc, { wrapUp: true });
  }

  const { readable, writable } = new TransformStream<string, string>();
  const writer = writable.getWriter();
  let streaming = false;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const run = turn({ client: createClient(ctx.env), context, now, tokens: row.tokens }, state, {
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
    const used = early instanceof AiError ? failedUsage(early) : emptyUsage();
    await addTokens(DB, id, used, lease).run();
    // Refused or failed before the reply: charged nothing (P27).
    await release(ctx.env, held.holdId);
    if (early instanceof InterviewLimitError) return json({ error: early.reason, message: early.message }, limitStatus(early), NO_STORE);
    if (early instanceof AiError) {
      log('warn', 'AI interview turn failed', { requestId: ctx.requestId, kind: early.kind, status: early.status });
      return json({ error: 'ai_failed', retryable: early.retryable }, 502, NO_STORE);
    }
    throw early;
  }

  const finish = (async () => {
    // What this turn billed, added to the stored total whether or not its state is kept.
    let used = emptyUsage();
    let charged = false;
    try {
      const result = await run;
      const s = result.state;
      used = usageSince(s.usage, state.usage);
      // The reply, and the hint when it came (a failed hint isn't charged).
      await settle(ctx.env, held.holdId, meterUsage(used, result.hint ? [SONNET, HAIKU] : [SONNET]), 'mock_interview', false);
      charged = true;
      const [, saved] = await DB.batch([
        addTokens(DB, id, used, lease),
        DB.prepare('UPDATE ai_interviews SET state = ?1, version = version + 1 WHERE id = ?2 AND version = ?3 AND status = ?4').bind(JSON.stringify(s), row.id, row.version, 'active'),
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
      if (e instanceof AiError) used = failedUsage(e);
      // A turn that failed is charged nothing (P27); one whose state lost to another was charged for its calls.
      if (!charged) await release(ctx.env, held.holdId).catch((err: unknown) => log('error', 'AI interview hold not released', { requestId: ctx.requestId, error: errorText(err) }));
      await addTokens(DB, id, used, lease)
        .run()
        .catch((err: unknown) => log('error', 'AI interview usage not saved', { requestId: ctx.requestId, error: errorText(err) }));
      await writer.write(sse('error', { error: e instanceof AiError ? 'ai_failed' : 'internal' })).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  ctx.exec.waitUntil(finish);
  return new Response(readable.pipeThrough(new TextEncoderStream()), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
});

/**
 * The session as this account may see it: off the interview_history feature
 * (src/features.ts) only the latest verdict is kept with its session, as in
 * the list and the history (P1, P21), so an older one can't be read by its id.
 */
async function visible(ctx: Ctx, user: User, row: Row): Promise<Row> {
  if (!row.verdict || can(user, 'interview_history', ctx.env).ok) return row;
  const latest = await ctx.env.DB.prepare('SELECT id FROM ai_interviews WHERE user_id = ? AND verdict IS NOT NULL ORDER BY started_at DESC, id LIMIT 1').bind(user.id).first<{ id: string }>();
  return latest?.id === row.id ? row : { ...row, verdict: null };
}

/** POST /api/interviews/<id>/finish: the verdict, once; asked again, the same one (off interview_history, only while it is the latest). */
export const finishInterview = interviewRoute((env) => env.INTERVIEW_FINISH_LIMITER, async (_request: Request, ctx: Ctx, user: User, id: string): Promise<Response> => {
  const row = await load(ctx, user.id, id);
  if (row.status === 'finished') return json({ interview: summary(await visible(ctx, user, row)) }, 200, NO_STORE);
  if (row.status !== 'active') throw new HttpError(409, row.status);
  const state = stateOf(row);
  const context = problemContext(row.problem_id);
  if (!context) throw new HttpError(409, 'The problem is no longer available');
  const { DB } = ctx.env;
  const now = Date.now();
  // Deep only while the account still has it (P31); else the ordinary verdict, within the Deep hold.
  const deep = row.deep === 1 && can(user, 'deep_mode', ctx.env).ok;
  // Claims the session, so two finishes at once (or a finish during a turn) don't both pay for the model.
  const claimed = await DB.prepare("UPDATE ai_interviews SET status = 'finishing' WHERE id = ? AND status = 'active' AND version = ? AND (turning_until IS NULL OR turning_until < ?) RETURNING tokens")
    .bind(id, row.version, now)
    .first<{ tokens: number }>();
  if (!claimed) throw new HttpError(409, 'busy');
  // The hold kept since the start (P28); a session past it (a verdict asked for long after) holds again, and is refused without credits.
  const kept = row.verdict_hold
    ? await DB.prepare('SELECT id FROM credit_holds WHERE id = ? AND expires_at > ?').bind(row.verdict_hold, now).first<{ id: string }>()
    : null;
  const held = kept ? ({ ok: true, holdId: kept.id } as const) : await hold(ctx.env, user.id, verdictHoldMc(ctx.env, deep), id, HOLD_TTL_MS);
  if (!held.ok) {
    await DB.prepare("UPDATE ai_interviews SET status = 'active' WHERE id = ? AND status = 'finishing'").bind(id).run();
    return noCredits(held.neededMc, held.balanceMc);
  }
  try {
    const result = await verdict({ client: createClient(ctx.env), context, now, tokens: claimed.tokens }, state, { deep });
    const s = result.state;
    const used = usageSince(s.usage, state.usage);
    // Only the answer that validated is charged (P27), at the price of the model asked for.
    await settle(ctx.env, held.holdId, [{ model: result.model, ...result.billable }], 'verdict', deep);
    await DB.prepare("UPDATE ai_interviews SET status = 'finished', state = ?, version = version + 1, ended_at = ?, tokens = tokens + ?, cost_usd = cost_usd + ?, verdict = ?, verdict_hold = NULL, deep = ? WHERE id = ?")
      .bind(JSON.stringify(s), Date.now(), billedTokens(used), sessionCostUsd(used), JSON.stringify(result.verdict), deep ? 1 : 0, id)
      .run();
    // The next steps (Pro), after the verdict is answered: the page asks for them again until they land.
    ctx.exec.waitUntil(pickAfterVerdict(ctx, user, id, row.problem_id, result.verdict));
  } catch (e) {
    const used = e instanceof AiError ? failedUsage(e, deep ? OPUS : SONNET) : emptyUsage();
    await DB.prepare("UPDATE ai_interviews SET tokens = tokens + ?, cost_usd = cost_usd + ?, status = CASE WHEN status = 'finishing' THEN 'active' ELSE status END WHERE id = ?")
      .bind(billedTokens(used), sessionCostUsd(used), id)
      .run();
    // A failed verdict is charged nothing (P27); the session's own hold stays for the next try, a fresh one is let go.
    if (!kept) await release(ctx.env, held.holdId);
    if (e instanceof InterviewLimitError) return json({ error: e.reason, message: e.message }, limitStatus(e), NO_STORE);
    if (!(e instanceof AiError)) throw e;
    log('warn', 'AI interview verdict failed', { requestId: ctx.requestId, kind: e.kind, status: e.status });
    return json({ error: 'ai_failed', retryable: e.retryable }, 502, NO_STORE);
  }
  return json({ interview: summary(await load(ctx, user.id, id)) }, 200, NO_STORE);
});

/**
 * The AI roadmap's picks after a verdict (Pro): held and charged as
 * `next_steps` (none without the credits for them), charged only when they
 * were stored; their tokens are added to the session's. Never throws.
 */
async function pickAfterVerdict(ctx: Ctx, user: User, id: string, problemId: string, v: InterviewVerdict): Promise<void> {
  if (!can(user, 'ai_roadmap', ctx.env).ok) return;
  const held = await hold(ctx.env, user.id, worstMc(CALLS.nextSteps, ctx.env), id).catch(() => undefined);
  if (!held?.ok) return;
  const used = await recommendAfterInterview(ctx.env, user, id, problemId, v, ctx.requestId);
  const picked = used && (await ctx.env.DB.prepare('SELECT 1 FROM roadmap_recs WHERE user_id = ? AND source_id = ?').bind(user.id, id).first());
  await (picked ? settle(ctx.env, held.holdId, [{ model: HAIKU, ...used }], 'next_steps', false) : release(ctx.env, held.holdId)).catch((e: unknown) =>
    log('warn', 'roadmap.charge_failed', { requestId: ctx.requestId, error: errorText(e) }),
  );
  if (!used) return;
  const extra = addUsage(emptyUsage(), HAIKU, used);
  await ctx.env.DB.prepare('UPDATE ai_interviews SET tokens = tokens + ?, cost_usd = cost_usd + ? WHERE id = ?')
    .bind(billedTokens(extra), sessionCostUsd(extra), id)
    .run()
    .catch((e: unknown) => log('warn', 'roadmap.tokens_failed', { requestId: ctx.requestId, error: errorText(e) }));
}

/** GET /api/interviews/<id>: the session and its transcript, to resume after a reload; off interview_history an older session's verdict is left out. */
export const getInterview = interviewRoute((env) => env.INTERVIEW_READ_LIMITER, async (_request: Request, ctx: Ctx, user: User, id: string): Promise<Response> => {
  return json({ interview: await view(ctx, await visible(ctx, user, await load(ctx, user.id, id))) }, 200, NO_STORE);
});

/**
 * GET /api/interviews: the newest sessions (no transcripts) and the credits
 * left. Off Pro only the latest verdict comes with them (P1, as the history):
 * the others are listed without it.
 */
export const listInterviews = interviewRoute((env) => env.INTERVIEW_READ_LIMITER, async (_request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const { results } = await ctx.env.DB.prepare('SELECT * FROM ai_interviews WHERE user_id = ? ORDER BY started_at DESC, id LIMIT ?').bind(user.id, LIST_MAX).all<Row>();
  const latest = results.find((r) => r.verdict)?.id;
  const rows = can(user, 'interview_history', ctx.env).ok ? results : results.map((r) => (r.id === latest ? r : { ...r, verdict: null }));
  return json({ interviews: rows.map(summary), credits: await creditsView(ctx.env, user.id) }, 200, NO_STORE);

});

/**
 * GET /api/interviews/<id>/report: a finished session's printable report
 * (interview_report, Max; P31): the verdict, the length and dates, whether it
 * was Deep, and the last design sent with the server's run of its tests,
 * while the transcript is kept (90 days, P8). 404 for a session without a
 * verdict. No model call, so it answers without the AI key too.
 */
export const interviewReport = requireFeature('interview_report', async (_request: Request, ctx: Ctx, user: User, _pre: undefined, id: string): Promise<Response> => {
  await rateLimit(ctx.env.INTERVIEW_READ_LIMITER, user.id, 'Too many interview requests; wait a minute');
  const row = await load(ctx, user.id, id);
  if (row.status !== 'finished' || !row.verdict) throw new HttpError(404, 'This interview has no verdict yet');
  const design = row.state ? (JSON.parse(row.state) as InterviewState).design : undefined;
  return json({ report: { ...summary(row), ...(design ? { design } : {}) } }, 200, NO_STORE);
});

const HISTORY_MAX = 200;

/**
 * GET /api/interviews/history: the finished sessions' verdict summaries
 * (pass or fail and the score per skill, no notes), newest first, for the
 * history list and the trend per skill. Pro gets every one (up to 200);
 * any other plan gets the latest only (P1), with `total` saying how many
 * there are and `full: false`.
 */
export const interviewHistory = interviewRoute((env) => env.INTERVIEW_READ_LIMITER, async (_request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const full = can(user, 'interview_history', ctx.env).ok;
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
});

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
