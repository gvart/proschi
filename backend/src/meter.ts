import { AiError } from './ai/client';
import { requireUser } from './auth';
import type { Ctx } from './context';
import { buckets, credits, LEDGER_TOTAL_SQL, monthlyGrantStatement, periodOf, planOf, spendable } from './credits';
import type { Env } from './env';
import { json } from './http';
import { MC } from './plans';

/**
 * Metered credits (docs/design/paid-plans.md P26, P27, P34): what a model call
 * costs the user, and the hold-then-settle that charges it.
 *
 *   hold(env, user, amountMc, ref)          before a call: keeps its worst case back, or {ok: false} when the balance can't cover it
 *   topUp(env, holdId, userId, extraMc)     before a second call on the same hold (a retry, a repair): holds its worst case too, or false
 *   settle(env, holdId, usage[], action, deep)   after it: charges the real cost (never more than the hold) and lets go of the rest
 *   release(env, holdId)                    a call that failed on our side or the infrastructure's: charges nothing
 *   settleFailed(env, holdId, error, action, deep)   a failed call: charges what the model answered (P34), else releases
 *
 * A credit is €0.01 at retail; a call costs 2x what the answering model cost
 * us (USD→EUR at CREDITS_USD_EUR, 0.95 unset), so every credit keeps a 100%
 * margin. Amounts are millicredits (mc), rounded up per settle.
 *
 * Holds count against the balance until settled, released or expired (5
 * minutes unless asked otherwise), so parallel calls can't overdraw and a
 * crashed request can't lock credits for long. A hold is one conditional
 * INSERT, and a settle one batch, which D1 runs atomically.
 */

export type Usage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** Speech-to-text (WHISPER): the audio's length, which it is priced by. */
  audio_seconds?: number;
};
export type Action = 'mock_interview' | 'design_partner' | 'verdict' | 'next_steps' | 'voice';

/** Workers AI's speech-to-text model for voice input (src/voice.ts, P39). */
export const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** What Whisper costs us, USD per audio minute (Workers AI pricing, checked 2026-11-07: $0.000513 a minute). At 2x and 0.95 EUR/USD, about 0.1 credit a minute. */
export const WHISPER_USD_PER_MINUTE = 0.000513;

/** How long a hold counts unless the caller asks otherwise. */
export const HOLD_TTL_MS = 5 * 60_000;

/** EUR per USD when CREDITS_USD_EUR is unset or not a number in (0, 10). */
export const DEFAULT_USD_EUR = 0.95;

/** What the user pays per unit of what a call cost us (P26). */
export const MARKUP = 2;

interface Price {
  input: number;
  output: number;
  /** A cache write, priced at the 1-hour rate (2x input): an upper bound of the 5-minute one (1.25x). */
  cacheWrite: number;
  cacheRead: number;
}

/**
 * USD per million tokens, first-party Claude API rates (claude-api skill's
 * model table and prompt-caching economics, cached 2026-10-06): Opus 5.5
 * $4/$20, cache reads $0.20; Sonnet 5.5 $2/$10, cache reads $0.20; Haiku 5.5
 * $0.10/$0.50, cache reads 0.1x, and $0.50/$2.50 past 100K input tokens.
 * Cache writes cost 2x input (1-hour TTL).
 */
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.2, cacheRead: 0.01 },
};
const HAIKU_LONG: Price = { input: 0.5, output: 2.5, cacheWrite: 1, cacheRead: 0.05 };
/** Haiku 5.5's prompts past this many input tokens are priced at HAIKU_LONG. */
const HAIKU_LONG_AFTER = 100_000;
/** A model not in the table (a fallback that answered instead) is priced as the dearest one, so it is never undercharged. */
const UNKNOWN = PRICES['claude-opus-5-5'];

function priceOf(model: string, inputTokens: number): Price {
  if (model === 'claude-haiku-5-5' && inputTokens > HAIKU_LONG_AFTER) return HAIKU_LONG;
  return Object.prototype.hasOwnProperty.call(PRICES, model) ? PRICES[model] : UNKNOWN;
}

/** The configured EUR per USD. */
export function usdToEur(env: Pick<Env, 'CREDITS_USD_EUR'>): number {
  const rate = Number(env.CREDITS_USD_EUR);
  return Number.isFinite(rate) && rate > 0 && rate < 10 ? rate : DEFAULT_USD_EUR;
}

/** What one call cost us, in USD. */
export function costUsd(u: Usage): number {
  if (u.model === WHISPER) return ((u.audio_seconds ?? 0) / 60) * WHISPER_USD_PER_MINUTE;
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const p = priceOf(u.model, u.input_tokens + read + write);
  return (u.input_tokens * p.input + u.output_tokens * p.output + write * p.cacheWrite + read * p.cacheRead) / 1e6;
}

/** USD at our cost → millicredits the user pays: 2x, in EUR, 1 credit = €0.01, rounded up. */
function usdToMc(usd: number, env: Pick<Env, 'CREDITS_USD_EUR'>): number {
  const mc = usd * MARKUP * usdToEur(env) * 100 * MC;
  // Rounded up, but not past a float's noise (3.0000000001 is 3).
  return Math.max(0, Math.ceil(mc - 1e-6));
}

/** What a call costs the user, in millicredits (P26). */
export function costMc(usage: Usage, env: Pick<Env, 'CREDITS_USD_EUR'>): number {
  return usdToMc(costUsd(usage), env);
}

/**
 * The worst case of one call, for its hold: every input token a cache write
 * (the dearest input), and the whole `maxOutputTokens`.
 */
export function estimateMc(model: string, maxOutputTokens: number, approxInputTokens: number, env: Pick<Env, 'CREDITS_USD_EUR'>): number {
  return costMc({ model, input_tokens: 0, cache_creation_input_tokens: Math.max(0, approxInputTokens), output_tokens: Math.max(0, maxOutputTokens) }, env);
}

/**
 * Holds `amountMc` for `ref` (what it pays for: a session's id) when the
 * balance less every unexpired hold covers it; else `{ok: false}` with what
 * was needed and what there is. `ttlMs` is how long it counts (5 minutes; a
 * mock interview's verdict holds for the session).
 */
export async function hold(
  env: Env,
  userId: string,
  amountMc: number,
  ref: string,
  ttlMs = HOLD_TTL_MS,
): Promise<{ ok: true; holdId: string } | { ok: false; neededMc: number; balanceMc: number }> {
  const { DB } = env;
  const amount = Math.max(0, Math.ceil(amountMc));
  const at = Date.now();
  const id = crypto.randomUUID();
  const plan = (await planOf(DB, userId)) ?? 'free';
  const [, held] = await DB.batch([
    monthlyGrantStatement(DB, userId, plan, at),
    // One statement: two holds at once can't both pass the check.
    DB.prepare(
      `INSERT INTO credit_holds (id, user_id, amount_mc, ref, expires_at, created_at)
       SELECT ?3, ?1, ?4, ?5, ?6, ?7
       WHERE ${LEDGER_TOTAL_SQL} - (SELECT COALESCE(SUM(amount_mc), 0) FROM credit_holds WHERE user_id = ?1 AND expires_at > ?7) >= ?4`,
    ).bind(userId, periodOf(at), id, amount, ref, at + ttlMs, at),
  ]);
  if (held.meta.changes > 0) return { ok: true, holdId: id };
  return { ok: false, neededMc: amount, balanceMc: await balanceMc(env, userId) };
}

/**
 * Charges the real cost of `usage` (every call the hold paid for, summed)
 * against the hold, at most the hold's amount, and lets go of the hold. The
 * charge is taken from the monthly allowance, then the sign-up credits, then
 * the top-up. Once per hold: settling it again, or after a release, charges
 * nothing. Pass every call the model answered, a malformed, refused or
 * truncated one included (P34); not one that failed before an answer.
 */
export async function settle(env: Env, holdId: string, usage: Usage[], action: Action, deep: boolean): Promise<{ chargedMc: number; balanceMc: number }> {
  const { DB } = env;
  const at = Date.now();
  const cost = usage.reduce((sum, u) => sum + costUsd(u), 0);
  const charge = usdToMc(cost, env);
  const period = periodOf(at);
  const live = 'EXISTS (SELECT 1 FROM credit_holds WHERE id = ?1)';
  const charged = 'SELECT charged_mc FROM credit_charges WHERE hold_id = ?1';
  const taken = (refs: string[]) => `(SELECT COALESCE(-SUM(delta_mc), 0) FROM credits WHERE kind = 'settle' AND ref_id IN (${refs.map((b) => `?1 || ':${b}'`).join(', ')}))`;
  const bucketAvail = (bucket: string) =>
    `(SELECT MAX(0, COALESCE(SUM(delta_mc), 0)) FROM credits WHERE user_id = (SELECT user_id FROM credit_holds WHERE id = ?1) AND bucket = '${bucket}'${bucket === 'monthly' ? ' AND period = ?3' : ''})`;
  const insert = (bucket: string, amount: string) =>
    DB.prepare(
      `INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at)
       SELECT user_id, 'settle', '${bucket}', ${bucket === 'monthly' ? '?3' : "''"}, -(${amount}), ?2, ?1 || ':${bucket}', ?4 FROM credit_holds
       WHERE id = ?1 AND (${amount}) > 0
       ON CONFLICT (kind, ref_id) DO NOTHING`,
    ).bind(holdId, action, period, at);
  const [first] = await DB.batch([
    DB.prepare(
      `INSERT INTO credit_charges (hold_id, user_id, action, ref, deep, charged_mc, cost_usd, created_at)
       SELECT id, user_id, ?2, ref, ?3, MIN(?4, amount_mc), ?5, ?6 FROM credit_holds WHERE id = ?1
       ON CONFLICT (hold_id) DO NOTHING`,
    ).bind(holdId, action, deep ? 1 : 0, charge, cost, at),
    // Monthly, then sign-up, then top-up; each only while the hold is still there, so a second settle adds nothing.
    insert('monthly', `CASE WHEN ${live} THEN MIN((${charged}), ${bucketAvail('monthly')}) ELSE 0 END`),
    insert('signup', `CASE WHEN ${live} THEN MIN((${charged}) - ${taken(['monthly'])}, ${bucketAvail('signup')}) ELSE 0 END`),
    // The rest from the top-up, even past 0 when a refund took it back since the hold (the hold had covered it).
    insert('topup', `CASE WHEN ${live} THEN (${charged}) - ${taken(['monthly', 'signup'])} ELSE 0 END`),
    DB.prepare('DELETE FROM credit_holds WHERE id = ?').bind(holdId),
  ]);
  const row = await DB.prepare('SELECT user_id, charged_mc FROM credit_charges WHERE hold_id = ?').bind(holdId).first<{ user_id: string; charged_mc: number }>();
  // Charged by this call, or 0 when the hold was settled or released before.
  const chargedMc = first.meta.changes > 0 && row ? row.charged_mc : 0;
  return { chargedMc, balanceMc: row ? await balanceMc(env, row.user_id) : 0 };
}

/** Lets go of a hold and charges nothing: the call failed on our side or the infrastructure's (P34). Releasing it again, or after a settle, changes nothing. */
export async function release(env: Env, holdId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM credit_holds WHERE id = ?').bind(holdId).run();
}

/**
 * Adds `extraMc` to a live hold of `userId` when the balance less every
 * unexpired hold covers it, and keeps it at least HOLD_TTL_MS more: a second
 * call on the same hold (a retry of a malformed answer, a repair) is held
 * before it runs, so it can't run unheld. False when it can't be covered, or
 * the hold is gone; the hold is then unchanged.
 */
export async function topUp(env: Env, holdId: string, userId: string, extraMc: number): Promise<boolean> {
  const extra = Math.max(0, Math.ceil(extraMc));
  const at = Date.now();
  // One statement, as hold(): two top-ups at once can't both pass the check.
  const { meta } = await env.DB.prepare(
    `UPDATE credit_holds SET amount_mc = amount_mc + ?3, expires_at = MAX(expires_at, ?5)
     WHERE id = ?4 AND user_id = ?1 AND expires_at > ?6
       AND ${LEDGER_TOTAL_SQL} - (SELECT COALESCE(SUM(amount_mc), 0) FROM credit_holds WHERE user_id = ?1 AND expires_at > ?6) >= ?3`,
  )
    .bind(userId, periodOf(at), extra, holdId, at + HOLD_TTL_MS, at)
    .run();
  return meta.changes > 0;
}

/**
 * After a failed call (P34): charges what the model answered (the error's
 * `charge`: a refusal, a cut-off or malformed answer, an earlier attempt),
 * or releases the hold when nothing reached the model. Returns what was
 * charged, in millicredits.
 */
export async function settleFailed(env: Env, holdId: string, error: unknown, action: Action, deep: boolean): Promise<number> {
  const charge = error instanceof AiError ? error.charge : [];
  if (!charge.length) {
    await release(env, holdId);
    return 0;
  }
  return (await settle(env, holdId, charge, action, deep)).chargedMc;
}

/** What can be held now, in millicredits: every bucket that counts less the unexpired holds, never below 0. */
export async function balanceMc(env: Env, userId: string): Promise<number> {
  return spendable(await buckets(env, userId));
}

/** The 402 for too few credits: `{error: 'no_credits', needed, balance}` in credits, and `extra` (say, wrapUp). */
export function noCredits(neededMc: number, balanceMc: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: 'no_credits', needed: credits(neededMc), balance: credits(balanceMc), ...extra }, 402, { 'Cache-Control': 'no-store' });
}

/** Holds expired this long ago are deleted (the daily cron); a late settle of one still finds it until then. */
export const HOLD_KEEP_MS = 86_400_000;

/** Deletes holds that expired over a day ago (the daily cron); returns how many. */
export async function pruneHolds(env: Pick<Env, 'DB'>, at = Date.now()): Promise<number> {
  const { meta } = await env.DB.prepare('DELETE FROM credit_holds WHERE expires_at < ?').bind(at - HOLD_KEEP_MS).run();
  return meta.changes;
}

// --- Estimates (GET /api/credits/estimates) --------------------------------

/** One call's shape: the model, its max_tokens, and the input it usually has. */
interface CallShape {
  model: string;
  maxOutput: number;
  input: number;
  /** Output it usually writes, low and high: the typical estimate's ends. */
  typicalOutput: readonly [number, number];
}

const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';
const OPUS = 'claude-opus-5-5';

/**
 * The calls the paid features make (src/ai/interviewer.ts, the design
 * partner): a mock interview turn is a Sonnet reply and a Haiku hint, the
 * verdict one Sonnet call that thinks.
 */
export const CALLS = {
  interviewReply: { model: SONNET, maxOutput: 1_024, input: 20_000, typicalOutput: [300, 500] },
  interviewHint: { model: HAIKU, maxOutput: 400, input: 4_000, typicalOutput: [100, 200] },
  verdict: { model: SONNET, maxOutput: 16_000, input: 30_000, typicalOutput: [5_000, 7_000] },
  nextSteps: { model: HAIKU, maxOutput: 1_024, input: 6_000, typicalOutput: [300, 500] },
  partnerReview: { model: SONNET, maxOutput: 16_000, input: 25_000, typicalOutput: [3_000, 5_000] },
  partnerBuild: { model: SONNET, maxOutput: 32_000, input: 15_000, typicalOutput: [6_000, 10_000] },
  partnerTurn: { model: SONNET, maxOutput: 8_000, input: 20_000, typicalOutput: [1_000, 2_000] },
} satisfies Record<string, CallShape>;

/** A call's worst case, for its hold. */
export const worstMc = (c: CallShape, env: Pick<Env, 'CREDITS_USD_EUR'>): number => estimateMc(c.model, c.maxOutput, c.input, env);

/** A call's usual cost: its input mostly read from the cache, its usual output at the low (0) or high (1) end. */
export function typicalMc(c: CallShape, env: Pick<Env, 'CREDITS_USD_EUR'>, end: 0 | 1 = 0): number {
  return costMc({ model: c.model, input_tokens: Math.round(c.input * 0.2), cache_read_input_tokens: Math.round(c.input * 0.8), output_tokens: c.typicalOutput[end] }, env);
}

/** What one mock interview turn holds: the reply (twice: the calculator's follow-up, P38) and the hint at their worst. */
export const interviewTurnHoldMc = (env: Pick<Env, 'CREDITS_USD_EUR'>): number => 2 * worstMc(CALLS.interviewReply, env) + worstMc(CALLS.interviewHint, env);

/** The most a 45-minute mock interview is ever charged, in credits (P40); other lengths in proportion. */
export const INTERVIEW_CAP_CREDITS = 150;
const CAP_MINUTES = 45;

/** A mock interview's cap in millicredits: 100 credits for 30 minutes, 150 for 45, 200 for 60 (P40). */
export const interviewCapMc = (minutes: number): number => Math.round((INTERVIEW_CAP_CREDITS * minutes) / CAP_MINUTES) * MC;

/**
 * What the next turn of a session may hold (P40): its usual hold, or less
 * when the session is near its cap. Its turns are charged at most the cap
 * less the (ordinary) verdict's hold, so the verdict always fits under it.
 * Undefined when what is left is less than a turn usually costs: the session
 * has used its budget and goes to the verdict.
 */
export function interviewTurnRoomMc(env: Pick<Env, 'CREDITS_USD_EUR'>, minutes: number, chargedMc: number): number | undefined {
  const room = interviewCapMc(minutes) - verdictHoldMc(env) - chargedMc;
  const usual = 2 * (typicalMc(CALLS.interviewReply, env, 1) + typicalMc(CALLS.interviewHint, env, 1));
  return room < usual ? undefined : Math.min(room, interviewTurnHoldMc(env));
}

/** A Deep verdict (Max, P31): the same call on Opus. */
const DEEP_VERDICT: CallShape = { ...CALLS.verdict, model: OPUS };

/** What a mock interview's verdict holds from its start (P28); a Deep one holds Opus's worst case. */
export const verdictHoldMc = (env: Pick<Env, 'CREDITS_USD_EUR'>, deep = false): number => worstMc(deep ? DEEP_VERDICT : CALLS.verdict, env);

/**
 * Candidate turns in a typical 45-minute mock interview, low and high. With
 * the calls' typical outputs above this gives about 37–57 credits, which is
 * what 45-minute interviews cost on the real API ($0.20–0.30 at 2x and
 * 0.95 EUR/USD); keep the two in step when either changes.
 */
const TYPICAL_TURNS = [9, 13] as const;

/**
 * The most a mock interview of `minutes` can be charged, whatever happens
 * (P40): each turn holds at most what is left of the cap less the verdict's
 * hold (interviewTurnRoomMc) and a settle never charges more than its hold,
 * so the turns together stay under it, and the verdict is charged at most
 * its own hold. That is the cap; a Deep verdict (P31) adds what its hold is
 * beyond the ordinary one.
 */
export function interviewWorstMc(env: Pick<Env, 'CREDITS_USD_EUR'>, deep: boolean, minutes = CAP_MINUTES): number {
  return interviewCapMc(minutes) - verdictHoldMc(env) + verdictHoldMc(env, deep);
}

/** What `seconds` of audio cost the user to transcribe, in millicredits (P39). */
export const voiceMc = (seconds: number, env: Pick<Env, 'CREDITS_USD_EUR'>): number => costMc({ model: WHISPER, input_tokens: 0, output_tokens: 0, audio_seconds: seconds }, env);

/** Opus's price over Sonnet's: what Deep mode multiplies a call by (P31). */
export const DEEP_MULTIPLIER = PRICES[OPUS].output / PRICES[SONNET].output;

/**
 * GET /api/credits/estimates: what each action usually costs, in credits, low
 * to high (`min`, `max`: the typical range the page shows), and `worst`, what
 * it can never cost more than (the hold of one call; for a mock interview,
 * interviewWorstMc). Holds keep using the worst case.
 */
export function estimates(env: Pick<Env, 'CREDITS_USD_EUR'>) {
  const turn = (end: 0 | 1) => typicalMc(CALLS.interviewReply, env, end) + typicalMc(CALLS.interviewHint, env, end);
  const range = (min: number, max: number, worst: number) => ({ min: credits(min), max: credits(max), worst: credits(worst) });
  const one = (c: CallShape) => range(typicalMc(c, env, 0), typicalMc(c, env, 1), worstMc(c, env));
  return {
    mock_interview: range(
      TYPICAL_TURNS[0] * turn(0) + typicalMc(CALLS.verdict, env, 0),
      TYPICAL_TURNS[1] * turn(1) + typicalMc(CALLS.verdict, env, 1),
      interviewWorstMc(env, false),
    ),
    partner_review: one(CALLS.partnerReview),
    partner_build: one(CALLS.partnerBuild),
    partner_turn: one(CALLS.partnerTurn),
    /** Voice input's server speech-to-text, per minute of audio (P39): the same at its worst. */
    voice_minute: range(voiceMc(60, env), voiceMc(60, env), voiceMc(60, env)),
    /** The verdict alone, in the mock interview's estimate: what Deep mode multiplies there (P31). */
    verdict: one(CALLS.verdict),
    deepMultiplier: DEEP_MULTIPLIER,
  };
}

// --- Routes ------------------------------------------------------------------

/** GET /api/credits/estimates: what each action usually costs, in credits (no sign-in: the pricing page can show them too). */
export async function getEstimates(_request: Request, ctx: Ctx): Promise<Response> {
  return json(estimates(ctx.env), 200, { 'Cache-Control': 'public, max-age=300' });
}

const USAGE_MAX = 200;

/** GET /api/credits/usage?limit=50: the signed-in account's charges, newest first (`credits` is what each cost it). */
export async function getUsage(request: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(request, ctx);
  const asked = Number(new URL(request.url).searchParams.get('limit') ?? 50);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, USAGE_MAX) : 50;
  const { results } = await ctx.env.DB.prepare('SELECT action, ref, deep, charged_mc, created_at FROM credit_charges WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(user.id, limit)
    .all<{ action: Action; ref: string; deep: number; charged_mc: number; created_at: number }>();
  return json({ items: results.map((r) => ({ at: r.created_at, action: r.action, ref: r.ref, credits: credits(r.charged_mc), deep: r.deep === 1 })) }, 200, { 'Cache-Control': 'no-store' });
}

/** The charges in "Download my data". */
export async function exportCharges(DB: D1Database, userId: string): Promise<Record<string, unknown>[]> {
  const { results } = await DB.prepare('SELECT action, ref, deep, charged_mc, created_at FROM credit_charges WHERE user_id = ? ORDER BY created_at, rowid').bind(userId).all<Record<string, string | number>>();
  return results.map((r) => ({ at: r.created_at, action: r.action, ref: r.ref, credits: credits(r.charged_mc as number), deep: r.deep === 1 }));
}
