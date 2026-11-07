import { MAX_REVIEW_BODY, MAX_REVIEW_IMPORTS, MAX_REVIEW_SOURCE } from '../../frontend/src/review/contract';
import type { User } from './auth';
import { WALL_CLOCK_MS } from './ai/budget';
import { AiError, aiEnabled, createClient, type MessageRequest, type MessageResult } from './ai/client';
import { approxTokens, problemContext, type ProblemContext } from './ai/context';
import { checkChange, measure, type ChangeResult, type DesignSite, type Edit } from './ai/partnerChanges';
import { INTENTS, MAX_TOKENS, parsePartnerAnswer, partnerRequest, repairMessage, type HistoryTurn, type Intent, type PartnerAnswer, type TurnInput } from './ai/partnerPrompt';
import { serverReviewRequest } from './ai/reviewer';
import type { Ctx } from './context';
import type { Env } from './env';
import { can, planRequired, requireFeature, type FeatureRoute } from './features';
import { HttpError, json, rateLimit, readJson } from './http';
import { errorText, log } from './log';
import type { Usage } from './meter';
import { credits, partnerBilling } from './partnerBilling';

/**
 * Design partner's routes (docs/design/paid-plans.md P29–P31; the contract
 * is docs/impl/design-partner.md "Design partner"). Signed in (feature
 * design_partner), the credits deciding how much; without ANTHROPIC_API_KEY
 * every route answers 501.
 *
 *   POST /api/partner/sessions {context, deep?}                 a new chat: {id}
 *   GET  /api/partner/sessions/<id>                             the chat with its turns
 *   POST /api/partner/sessions/<id>/turns {intent, message, source, files?, changeId?}
 *                                                               one turn: {turn, credits: {charged, balance}}
 *   POST /api/partner/sessions/<id>/changes/<changeId> {decision}  accepted or rejected: 204, free
 *
 * A session is its owner's only: anyone else gets 404. One turn at a time
 * per session (a 90-second lease, 409 turn_in_progress), none during the
 * user's open mock interview (409 interview_active, P29). A turn holds its
 * estimated cost before the model is called (402 no_credits), then settles
 * with the real usage; a failed turn releases the hold and is not charged,
 * and neither is an answer that did not validate and was asked for again.
 *
 * The server never trusts the page's numbers (P6): it parses, simulates and
 * tests the source itself, and checks each proposed change
 * (src/ai/partnerChanges.ts). A change that does not apply gets one repair
 * call; what still fails is sent as `{ok: false, reason}`. On a practice
 * problem the partner coaches (P30): every intent but `solve` has its
 * changes dropped, and a turn with changes is `assisted`.
 */

export const TURN_LEASE_MS = 90_000;
/** Chats are kept this long after their last turn (as P8's transcripts), then deleted. */
export const PARTNER_TTL_MS = 90 * 86_400_000;
export const MAX_MESSAGE = 4_000;
const MAX_FILE_NAME = 256;
/** Turns in one chat (each turn is two: the user's and the partner's). */
export const MAX_SESSION_TURNS = 200;

const NO_STORE = { 'Cache-Control': 'no-store' };

type Context = { kind: 'editor' } | { kind: 'practice'; problemId: string };

interface SessionRow {
  id: string;
  user_id: string;
  context_kind: 'editor' | 'practice';
  problem_id: string | null;
  deep: number;
  created_at: number;
  updated_at: number;
  turning_until: number | null;
}

interface TurnRow {
  id: string;
  n: number;
  role: 'user' | 'partner';
  intent: Intent;
  message: string;
  questions: string | null;
  assisted: number;
  at: number;
}

interface ChangeRow {
  id: string;
  turn_id: string;
  position: number;
  title: string;
  why: string;
  edits: string;
  result: string;
  decision: 'accepted' | 'rejected' | null;
  fed: number;
}

interface Change {
  id: string;
  title: string;
  why: string;
  edits: Edit[];
  result: ChangeResult;
}

interface Turn {
  id: string;
  role: 'user' | 'partner';
  message: string;
  questions?: { id: string; text: string; options?: string[] }[];
  changes?: Change[];
  assisted?: boolean;
  at: number;
}

/** A Design partner route: 501 without the AI key, 401 signed out, then the per-user rate limit. */
function partnerRoute<A extends unknown[]>(handler: (request: Request, ctx: Ctx, user: User, ...args: A) => Promise<Response>): FeatureRoute<A> {
  return requireFeature(
    'design_partner',
    async (request: Request, ctx: Ctx, user: User, _pre: undefined, ...args: A) => {
      await rateLimit(ctx.env.PARTNER_LIMITER, user.id, 'Too many Design partner requests; wait a minute');
      return handler(request, ctx, user, ...args);
    },
    (_request: Request, ctx: Ctx, ..._args: A) => (aiEnabled(ctx.env) ? undefined : json({ error: 'not_implemented' }, 501, NO_STORE)),
  );
}

async function load(env: Env, userId: string, id: string): Promise<SessionRow> {
  const row = await env.DB.prepare('SELECT * FROM partner_sessions WHERE id = ? AND user_id = ?').bind(id, userId).first<SessionRow>();
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

/** The user's mock interview that is still open (P29: Design partner is off during one). */
async function interviewActive(env: Env, userId: string, now: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS open FROM ai_interviews WHERE user_id = ? AND status IN ('active', 'finishing') AND started_at > ? LIMIT 1")
    .bind(userId, now - WALL_CLOCK_MS)
    .first<{ open: number }>();
  return !!row;
}

const interviewRefused = () => json({ error: 'interview_active', message: 'Design partner is off during a mock interview' }, 409, NO_STORE);

const contextOf = (row: SessionRow): Context => (row.context_kind === 'practice' ? { kind: 'practice', problemId: row.problem_id ?? '' } : { kind: 'editor' });

function changeOf(c: ChangeRow): Change {
  return { id: c.id, title: c.title, why: c.why, edits: JSON.parse(c.edits) as Edit[], result: JSON.parse(c.result) as ChangeResult };
}

function turnOf(t: TurnRow, changes: Change[]): Turn {
  return {
    id: t.id,
    role: t.role,
    message: t.message,
    ...(t.questions ? { questions: JSON.parse(t.questions) as Turn['questions'] } : {}),
    ...(changes.length ? { changes } : {}),
    ...(t.assisted ? { assisted: true } : {}),
    at: t.at,
  };
}

async function turnsOf(env: Env, sessionId: string): Promise<{ turns: TurnRow[]; changes: ChangeRow[] }> {
  const [turns, changes] = await env.DB.batch([
    env.DB.prepare('SELECT id, n, role, intent, message, questions, assisted, at FROM partner_turns WHERE session_id = ? ORDER BY n').bind(sessionId),
    env.DB.prepare('SELECT * FROM partner_changes WHERE session_id = ? ORDER BY turn_id, position').bind(sessionId),
  ]);
  return { turns: turns.results as TurnRow[], changes: changes.results as ChangeRow[] };
}

function viewTurns(turns: TurnRow[], changes: ChangeRow[]): Turn[] {
  const byTurn = new Map<string, Change[]>();
  for (const c of changes) byTurn.set(c.turn_id, [...(byTurn.get(c.turn_id) ?? []), changeOf(c)]);
  return turns.map((t) => turnOf(t, byTurn.get(t.id) ?? []));
}

/** POST /api/partner/sessions {context, deep?}: 201 {id}. */
export const createPartnerSession = partnerRoute(async (request: Request, ctx: Ctx, user: User): Promise<Response> => {
  const body = await readJson(request);
  const context = body.context as Record<string, unknown> | undefined;
  if (typeof context !== 'object' || context === null) throw new HttpError(400, 'context must be {kind: "editor"} or {kind: "practice", problemId}');
  let problemId: string | null = null;
  if (context.kind === 'practice') {
    if (typeof context.problemId !== 'string' || !problemContext(context.problemId)) throw new HttpError(400, 'Unknown problem');
    problemId = context.problemId;
  } else if (context.kind !== 'editor') throw new HttpError(400, 'context.kind must be "editor" or "practice"');
  if (body.deep !== undefined && typeof body.deep !== 'boolean') throw new HttpError(400, 'deep must be a boolean');
  const deep = body.deep === true;
  if (deep && !can(user, 'deep_mode', ctx.env).ok) return planRequired('deep_mode');
  const now = Date.now();
  if (await interviewActive(ctx.env, user.id, now)) return interviewRefused();

  const id = crypto.randomUUID();
  await ctx.env.DB.prepare('INSERT INTO partner_sessions (id, user_id, context_kind, problem_id, deep, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, context.kind, problemId, deep ? 1 : 0, now, now)
    .run();
  return json({ id }, 201, NO_STORE);
});

/** GET /api/partner/sessions/<id>: {id, context, deep, turns}. */
export const getPartnerSession = partnerRoute(async (_request: Request, ctx: Ctx, user: User, id: string): Promise<Response> => {
  const row = await load(ctx.env, user.id, id);
  const { turns, changes } = await turnsOf(ctx.env, id);
  return json({ id: row.id, context: contextOf(row), deep: row.deep === 1, turns: viewTurns(turns, changes) }, 200, NO_STORE);
});

/** POST /api/partner/sessions/<id>/changes/<changeId> {decision}: 204; told to the model on the next turn. */
export const decidePartnerChange = partnerRoute(async (request: Request, ctx: Ctx, user: User, id: string, changeId: string): Promise<Response> => {
  await load(ctx.env, user.id, id);
  const body = await readJson(request);
  if (body.decision !== 'accepted' && body.decision !== 'rejected') throw new HttpError(400, 'decision must be "accepted" or "rejected"');
  const { meta } = await ctx.env.DB.prepare('UPDATE partner_changes SET decision = ?, fed = 0 WHERE id = ? AND session_id = ?').bind(body.decision, changeId, id).run();
  if (meta.changes === 0) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 204, headers: NO_STORE });
});

interface TurnBody {
  intent: Intent;
  message: string;
  source: string;
  files: Record<string, string>;
  changeId?: string;
}

function turnBody(body: Record<string, unknown>): TurnBody {
  if (!INTENTS.includes(body.intent as Intent)) throw new HttpError(400, `intent must be one of ${INTENTS.join(', ')}`);
  const intent = body.intent as Intent;
  const message = body.message ?? '';
  if (typeof message !== 'string') throw new HttpError(400, 'message must be a string');
  if (message.length > MAX_MESSAGE) throw new HttpError(400, `message is over ${MAX_MESSAGE} characters`);
  if ((intent === 'build' || intent === 'chat') && !message.trim()) throw new HttpError(400, 'message is required');
  if (typeof body.source !== 'string') throw new HttpError(400, 'source must be a string');
  if (body.source.length > MAX_REVIEW_SOURCE) throw new HttpError(413, 'source is too long');
  const files: Record<string, string> = {};
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || body.files.length > MAX_REVIEW_IMPORTS) throw new HttpError(400, `files must be an array of at most ${MAX_REVIEW_IMPORTS}`);
    for (const f of body.files as unknown[]) {
      const file = f as Record<string, unknown> | null;
      if (typeof file !== 'object' || file === null || typeof file.name !== 'string' || typeof file.source !== 'string' || !file.name || file.name.length > MAX_FILE_NAME) throw new HttpError(400, 'each file must be {name, source}');
      if (file.source.length > MAX_REVIEW_SOURCE) throw new HttpError(413, 'a file is too long');
      files[file.name] = file.source;
    }
  }
  if (intent === 'improve' && typeof body.changeId !== 'string') throw new HttpError(400, 'changeId is required to improve a change');
  return { intent, message, source: body.source, files, ...(intent === 'improve' ? { changeId: body.changeId as string } : {}) };
}

const meterUsage = (r: MessageResult): Usage => ({ model: r.model, ...r.usage });

interface Answered {
  answer: PartnerAnswer;
  changes: { title: string; why: string; edits: Edit[]; result: ChangeResult }[];
  /** The calls to charge: the answer that was kept, and a repair. Not an answer that did not validate. */
  billed: Usage[];
}

/**
 * Asks the model for the turn, and checks its answer: one more call when it
 * does not validate, and one repair call when a change does not apply. Each
 * change is checked against `source` (measured as `before`).
 */
async function answer(
  env: Env,
  request: MessageRequest,
  check: (edits: Edit[]) => ChangeResult,
  coach: boolean,
  extend: () => Promise<void>,
): Promise<Answered> {
  const client = createClient(env);
  const billed: Usage[] = [];
  let first: { result: MessageResult; answer: PartnerAnswer } | undefined;
  for (let attempt = 0; !first; attempt++) {
    const result = await client.create(request);
    const parsed = parsePartnerAnswer(result.text);
    if (parsed) {
      billed.push(meterUsage(result));
      first = { result, answer: parsed };
    } else if (attempt >= 1) throw new AiError('malformed', 'The answer did not validate twice', { usage: result.usage });
  }
  const checked = (a: PartnerAnswer) => (coach ? [] : a.changes).map((c) => ({ ...c, result: check(c.edits) }));
  let kept = first.answer;
  let changes = checked(kept);
  const failed = changes.flatMap((c) => (c.result.ok ? [] : [{ title: c.title, reason: c.result.reason }]));
  if (failed.length) {
    await extend();
    try {
      const repair = await client.create({
        ...request,
        messages: [...request.messages, { role: 'assistant', content: first.result.text }, { role: 'user', content: repairMessage(failed) }],
      });
      billed.push(meterUsage(repair));
      const repaired = parsePartnerAnswer(repair.text);
      if (repaired) {
        kept = repaired;
        changes = checked(repaired);
      }
    } catch (e) {
      // A failed repair is not charged; the first answer stands, its failed changes as they are.
      if (!(e instanceof AiError)) throw e;
    }
  }
  return { answer: coach ? { ...kept, changes: [] } : kept, changes, billed };
}

/** POST /api/partner/sessions/<id>/turns: {turn, credits: {charged, balance}}. */
export const postPartnerTurn = partnerRoute(async (request: Request, ctx: Ctx, user: User, id: string): Promise<Response> => {
  const { env } = ctx;
  const session = await load(env, user.id, id);
  const body = turnBody(await readJson(request, MAX_REVIEW_BODY));
  const now = Date.now();
  if (await interviewActive(env, user.id, now)) return interviewRefused();
  const deep = session.deep === 1;
  if (deep && !can(user, 'deep_mode', env).ok) return planRequired('deep_mode');
  let context: ProblemContext | undefined;
  if (session.context_kind === 'practice') {
    context = problemContext(session.problem_id ?? '');
    if (!context) throw new HttpError(409, 'The problem is no longer available');
  }

  const { turns, changes: stored } = await turnsOf(env, id);
  if (turns.length >= MAX_SESSION_TURNS) return json({ error: 'session_full', message: 'This chat is full; start a new one' }, 409, NO_STORE);
  const improving = body.changeId !== undefined ? stored.find((c) => c.id === body.changeId) : undefined;
  if (body.changeId !== undefined && !improving) throw new HttpError(404, 'Unknown change');

  // One turn at a time: the session is claimed before any model call, so parallel turns can't each pay for one.
  const lease = now + TURN_LEASE_MS;
  const claimed = await env.DB.prepare('UPDATE partner_sessions SET turning_until = ?1 WHERE id = ?2 AND user_id = ?3 AND (turning_until IS NULL OR turning_until < ?4) RETURNING id')
    .bind(lease, id, user.id, now)
    .first<{ id: string }>();
  if (!claimed) return json({ error: 'turn_in_progress', message: 'Still answering your last message' }, 409, NO_STORE);
  let held = lease;
  const letGo = () => env.DB.prepare('UPDATE partner_sessions SET turning_until = NULL WHERE id = ? AND turning_until = ?').bind(id, held).run();
  /** Keeps the lease for a second call (a repair). */
  const extend = async () => {
    const next = Date.now() + TURN_LEASE_MS;
    await env.DB.prepare('UPDATE partner_sessions SET turning_until = ? WHERE id = ? AND turning_until = ?').bind(next, id, held).run();
    held = next;
  };

  let holdId: string | undefined;
  try {
    const site: DesignSite = context ? { problem: context.problem } : { files: body.files };
    const before = measure(body.source, site);
    const practice = !!context;
    const input: TurnInput = {
      intent: body.intent,
      message: body.message,
      source: body.source,
      ...(practice ? {} : { files: body.files }),
      review: serverReviewRequest(body.source, context?.problem, practice ? {} : { imports: body.files }),
      ...(improving ? { improve: changeOf(improving) } : {}),
      feedback: stored.filter((c) => c.decision && !c.fed).map((c) => ({ title: c.title, decision: c.decision as 'accepted' | 'rejected' })),
      ...(context ? { notAsked: context.topics.filter((t) => t.kind === 'clarify').map((t) => t.label) } : {}),
    };
    const byTurn = new Map<string, { title: string; ok: boolean }[]>();
    for (const c of stored) byTurn.set(c.turn_id, [...(byTurn.get(c.turn_id) ?? []), { title: c.title, ok: (JSON.parse(c.result) as ChangeResult).ok }]);
    const history: HistoryTurn[] = turns.map((t) => ({ role: t.role, intent: t.intent, message: t.message, changes: byTurn.get(t.id) }));
    const req = partnerRequest(input, history, { deep, context });

    const approxInput = approxTokens(JSON.stringify(req.system) + JSON.stringify(req.messages));
    const estimate = partnerBilling.estimateMc(req.model, MAX_TOKENS, approxInput, env);
    const hold = await partnerBilling.hold(env, user.id, estimate, `partner:${id}:${turns.length + 1}`);
    if (!hold.ok) {
      await letGo();
      return json({ error: 'no_credits', needed: credits(hold.neededMc), balance: credits(hold.balanceMc) }, 402, NO_STORE);
    }
    holdId = hold.holdId;

    // Coach first on a practice problem (P30): only `solve` gets changes.
    const coach = practice && body.intent !== 'solve';
    const result = await answer(env, req, (edits) => checkChange(body.source, before, edits, site, body.intent === 'build'), coach, extend);
    const charged = await partnerBilling.settle(env, holdId, result.billed, deep);
    holdId = undefined;

    const at = Date.now();
    const userTurn = { id: crypto.randomUUID(), n: turns.length + 1 };
    const partnerTurn = { id: crypto.randomUUID(), n: turns.length + 2 };
    const questions = result.answer.questions.map((q, i) => ({ id: `q${i + 1}`, text: q.text, ...(q.options.length ? { options: q.options } : {}) }));
    const changes: Change[] = result.changes.map((c) => ({ id: crypto.randomUUID(), title: c.title, why: c.why, edits: c.edits, result: c.result }));
    const assisted = practice && changes.length > 0;
    const { DB } = env;
    await DB.batch([
      DB.prepare('INSERT INTO partner_turns (id, session_id, n, role, intent, message, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(userTurn.id, id, userTurn.n, 'user', body.intent, body.message, now),
      DB.prepare('INSERT INTO partner_turns (id, session_id, n, role, intent, message, questions, assisted, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        partnerTurn.id,
        id,
        partnerTurn.n,
        'partner',
        body.intent,
        result.answer.message,
        questions.length ? JSON.stringify(questions) : null,
        assisted ? 1 : 0,
        at,
      ),
      ...changes.map((c, i) =>
        DB.prepare('INSERT INTO partner_changes (id, session_id, turn_id, position, title, why, edits, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(c.id, id, partnerTurn.id, i, c.title, c.why, JSON.stringify(c.edits), JSON.stringify(c.result)),
      ),
      // The decisions told to the model this turn are not told again.
      ...(input.feedback.length ? [DB.prepare('UPDATE partner_changes SET fed = 1 WHERE session_id = ? AND decision IS NOT NULL').bind(id)] : []),
      DB.prepare('UPDATE partner_sessions SET updated_at = ?, turning_until = NULL WHERE id = ?').bind(at, id),
    ]);
    log('info', 'partner.turn', { requestId: ctx.requestId, userId: user.id, intent: body.intent, deep, changes: changes.length, failed: changes.filter((c) => !c.result.ok).length, chargedMc: charged.chargedMc, usage: result.billed });
    const turn: Turn = {
      id: partnerTurn.id,
      role: 'partner',
      message: result.answer.message,
      ...(questions.length ? { questions } : {}),
      ...(changes.length ? { changes } : {}),
      ...(assisted ? { assisted: true } : {}),
      at,
    };
    return json({ turn, credits: { charged: credits(charged.chargedMc), balance: credits(charged.balanceMc) } }, 200, NO_STORE);
  } catch (e) {
    if (holdId) await partnerBilling.release(env, holdId).catch((err: unknown) => log('error', 'partner.release_failed', { requestId: ctx.requestId, error: errorText(err) }));
    await letGo();
    if (!(e instanceof AiError)) throw e;
    log('error', 'partner.failed', { requestId: ctx.requestId, userId: user.id, kind: e.kind, error: errorText(e) });
    return e.retryable
      ? json({ error: 'ai_unavailable', message: 'Design partner is busy; try again in a minute' }, 503, NO_STORE)
      : json({ error: 'partner_failed', message: 'Design partner could not answer; try again' }, 502, NO_STORE);
  }
});

/** Deletes chats whose last turn is more than PARTNER_TTL_MS ago, with their turns and changes; returns how many. For the daily cron. */
export async function prunePartnerSessions(env: Pick<Env, 'DB'>, at = Date.now()): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM partner_sessions WHERE updated_at <= ?').bind(at - PARTNER_TTL_MS).run();
  return meta.changes;
}

/** Download my data: every Design partner chat, with its turns. */
export async function exportPartnerSessions(env: Env, userId: string): Promise<unknown[]> {
  const { results } = await env.DB.prepare('SELECT * FROM partner_sessions WHERE user_id = ? ORDER BY created_at').bind(userId).all<SessionRow>();
  const out: unknown[] = [];
  for (const row of results) {
    const { turns, changes } = await turnsOf(env, row.id);
    out.push({ id: row.id, context: contextOf(row), deep: row.deep === 1, createdAt: row.created_at, turns: viewTurns(turns, changes) });
  }
  return out;
}
