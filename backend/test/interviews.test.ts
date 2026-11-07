import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU } from '../src/ai/client';
import { grantSignupCredits, topupStatement } from '../src/credits';
import type { Env } from '../src/env';
import { pruneInterviewTranscripts, TRANSCRIPT_TTL_MS } from '../src/interviews';
import { balanceMc, costMc, hold, interviewTurnHoldMc, verdictHoldMc } from '../src/meter';
import { call, resetDatabase, signedInUser } from './helpers';
import { messageResponse, sseResponse, streamEvents, type Recorded } from './ai/mockClaude';

const MIN = 60_000;
const verdictJson = {
  passed: true,
  scores: { requirements: 4, estimation: 3, design: 4, tradeoffs: 3, communication: 4 },
  wentWell: [{ skill: 'requirements', text: 'Asked about the read to write ratio first.' }],
  wentWrong: [{ skill: 'estimation', text: 'Skipped the storage estimate.' }],
  nextSteps: ['Practise storage estimates'],
};

type Reply = (req: Recorded) => Response | Promise<Response>;

/** The Claude API, faked through the Worker's fetch: Sonnet streams `reply`, Haiku hints, the verdict is JSON. */
function claude(opts: { reply?: Reply; hint?: Reply; verdict?: Reply } = {}): Recorded[] {
  const calls: Recorded[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.anthropic.com/')) return real(input, init);
    const rec: Recorded = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) };
    calls.push(rec);
    if (rec.body.model === HAIKU) return (opts.hint ?? (() => messageResponse(JSON.stringify({ kind: 'focus', text: 'Ask about the peak write rate.', covered: ['q1'] }), { model: HAIKU })))(rec);
    if (rec.body.stream) return (opts.reply ?? (() => sseResponse(streamEvents('About 100M new links a month.'))))(rec);
    return (opts.verdict ?? (() => messageResponse(JSON.stringify(verdictJson))))(rec);
  });
  return calls;
}

const failing = () => Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, { status: 400 });

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

async function events(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      return { event: lines.find((l) => l.startsWith('event: '))!.slice(7), data: JSON.parse(lines.find((l) => l.startsWith('data: '))!.slice(6)) as Record<string, unknown> };
    });
}

const startOne = (token: string, body: unknown = { problem: 'url-shortener', minutes: 45 }) => call('/api/interviews', { method: 'POST', token, body });
const turnOf = (token: string, id: string, body: unknown) => call(`/api/interviews/${id}/turn`, { method: 'POST', token, body });
const credits = async (token: string) => ((await (await call('/api/interviews', { token })).json()) as { credits: { balance: number } }).credits.balance;
const e = env as Env;
/** A signed-in user with its 100 sign-up credits (and `topup` more). */
async function user(topup = 0): Promise<{ id: string; token: string }> {
  const u = await signedInUser();
  await grantSignupCredits(env, u.id, `github\n${u.id}`);
  if (topup) await topupStatement(env.DB, u.id, topup * 1000, 'credits_1000', `ord-${u.id}`).run();
  return u;
}
const charges = async (userId: string) =>
  (await env.DB.prepare('SELECT action, charged_mc FROM credit_charges WHERE user_id = ? ORDER BY created_at, rowid').bind(userId).all<{ action: string; charged_mc: number }>()).results;
const row = (id: string) => env.DB.prepare('SELECT status, state, verdict, tokens, cost_usd FROM ai_interviews WHERE id = ?').bind(id).first<{ status: string; state: string | null; verdict: string | null; tokens: number; cost_usd: number }>();

/** Moves a session's start `ms` into the past, in its row and its state. */
async function age(id: string, ms: number): Promise<void> {
  await env.DB.prepare("UPDATE ai_interviews SET started_at = started_at - ?1, state = json_set(state, '$.startedAt', json_extract(state, '$.startedAt') - ?1) WHERE id = ?2").bind(ms, id).run();
}

async function started(token: string): Promise<string> {
  const res = await startOne(token);
  expect(res.status).toBe(201);
  return ((await res.json()) as { interview: { id: string } }).interview.id;
}

describe('AI interviews', () => {
  beforeEach(async () => {
    await resetDatabase();
    env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('answers 501 without the API key, and 401 signed out', async () => {
    delete env.ANTHROPIC_API_KEY;
    const { token } = await user();
    expect((await startOne(token)).status).toBe(501);
    expect((await call('/api/interviews', { token })).status).toBe(501);
    expect((await turnOf(token, 'x', { message: 'hi' })).status).toBe(501);
    env.ANTHROPIC_API_KEY = 'sk-test';
    expect((await call('/api/interviews', { method: 'POST', body: { problem: 'url-shortener', minutes: 45 } })).status).toBe(401);
  });

  it('holds the verdict’s credits to start, and answers 402 no_credits {needed, balance} without enough', async () => {
    const poor = await signedInUser();
    const refused = await startOne(poor.token);
    expect(refused.status).toBe(402);
    const needed = (verdictHoldMc(e) + interviewTurnHoldMc(e)) / 1000;
    expect(await refused.json()).toEqual({ error: 'no_credits', needed, balance: 0 });

    const { token } = await user();
    expect(await credits(token)).toBe(100);
    expect((await startOne(token, { problem: 'nope', minutes: 45 })).status).toBe(400);
    expect((await startOne(token, { problem: 'url-shortener', minutes: 50 })).status).toBe(400);
    const res = await startOne(token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { interview: { status: string; phase: string; messages: { role: string; text: string }[] }; credits: { balance: number } };
    expect(body.interview).toMatchObject({ status: 'active', phase: 'clarify', problem: 'url-shortener', minutes: 45 });
    expect(body.interview.messages).toEqual([expect.objectContaining({ role: 'interviewer', text: expect.stringContaining('URL Shortener') })]);
    // Nothing is charged to start: the verdict's worst case is only held.
    expect(body.credits.balance).toBe((100_000 - verdictHoldMc(e)) / 1000);
    // Ending the open one lets go of its hold, so a new one can start on the same credits.
    const replaced = await startOne(token, { problem: 'url-shortener', minutes: 45, replace: true });
    expect(replaced.status).toBe(201);
    expect(await credits(token)).toBe((100_000 - verdictHoldMc(e)) / 1000);
  });

  it('streams a turn as text events, then the hint, the grade and done, and keeps the transcript', async () => {
    const calls = claude();
    const { id: userId, token } = await user();
    const id = await started(token);
    const res = await turnOf(token, id, { message: 'How many new links a month?', design: 'not a design' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const list = await events(res);
    const kinds = list.map((e) => e.event);
    const firstOther = kinds.findIndex((k) => k !== 'text');
    expect(firstOther).toBeGreaterThan(0);
    expect(kinds.slice(firstOther)).toEqual(['hint', 'grade', 'done']);
    expect(list.filter((e) => e.event === 'text').map((e) => e.data.text).join('')).toBe('About 100M new links a month.');
    expect(list.find((e) => e.event === 'hint')!.data).toEqual({ kind: 'focus', text: 'Ask about the peak write rate.' });
    expect(list.find((e) => e.event === 'grade')!.data).toMatchObject({ blocked: 'errors' });
    expect(list.at(-1)!.data).toMatchObject({ reply: 'About 100M new links a month.', phase: 'clarify', turns: 1 });
    // The server graded the design itself and gave the model its results (P6).
    expect(JSON.stringify(calls[0].body.messages)).toContain('test_results');

    const got = (await (await call(`/api/interviews/${id}`, { token })).json()) as { interview: { messages: { role: string; text: string; hint?: unknown; design?: boolean }[]; turns: number } };
    expect(got.interview.turns).toBe(1);
    expect(got.interview.messages.map((m) => m.role)).toEqual(['interviewer', 'candidate', 'interviewer']);
    expect(got.interview.messages[1]).toMatchObject({ text: 'How many new links a month?', design: true });
    expect(got.interview.messages[2]).toMatchObject({ text: 'About 100M new links a month.', hint: { kind: 'focus' } });
    const saved = await row(id);
    expect(saved!.tokens).toBeGreaterThan(0);
    expect(saved!.cost_usd).toBeGreaterThan(0);
    // The turn is charged its real cost (the reply and the hint), far below its hold.
    const real = costMc({ model: 'claude-sonnet-5-5', input_tokens: 100, output_tokens: 50 }, e) + costMc({ model: HAIKU, input_tokens: 100, output_tokens: 50 }, e);
    const [charge] = await charges(userId);
    expect(charge.action).toBe('mock_interview');
    expect(Math.abs(charge.charged_mc - real)).toBeLessThanOrEqual(1);
    expect(await balanceMc(e, userId)).toBe(100_000 - verdictHoldMc(e) - charge.charged_mc);
  });

  it('answers 404 for another user’s session', async () => {
    claude();
    const owner = await user();
    const other = await user();
    const id = await started(owner.token);
    expect((await call(`/api/interviews/${id}`, { token: other.token })).status).toBe(404);
    expect((await turnOf(other.token, id, { message: 'hi' })).status).toBe(404);
    expect((await call(`/api/interviews/${id}/finish`, { method: 'POST', token: other.token })).status).toBe(404);
    expect(((await (await call('/api/interviews', { token: other.token })).json()) as { interviews: unknown[] }).interviews).toEqual([]);
  });

  it('charges a failed turn nothing, and keeps the session open to try again', async () => {
    let fail = true;
    claude({ reply: () => (fail ? failing() : sseResponse(streamEvents('Sure.'))) });
    const { id: userId, token } = await user();
    const id = await started(token);
    const before = await credits(token);
    const res = await turnOf(token, id, { message: 'Hello' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_failed', retryable: false });
    expect((await row(id))!.status).toBe('active');
    expect(await credits(token)).toBe(before);
    expect(await charges(userId)).toEqual([]);
    fail = false;
    expect((await events(await turnOf(token, id, { message: 'Hello again' }))).at(-1)!.event).toBe('done');
    expect(await charges(userId)).toHaveLength(1);
  });

  it('at 0 credits moves the session to its wrap-up, and the verdict still runs from its hold', async () => {
    const calls = claude();
    const { id: userId, token } = await user();
    const id = await started(token);
    // Everything left is taken by something else (another tab's call, say).
    const drained = await hold(e, userId, await balanceMc(e, userId), 'elsewhere');
    expect(drained.ok).toBe(true);
    const res = await turnOf(token, id, { message: 'Next?' });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'no_credits', needed: interviewTurnHoldMc(e) / 1000, balance: 0, wrapUp: true });
    expect(calls).toHaveLength(0);
    const got = (await (await call(`/api/interviews/${id}`, { token })).json()) as { interview: { phase: string } };
    expect(got.interview.phase).toBe('wrapup');
    // The lease was let go.
    expect((await env.DB.prepare('SELECT turning_until FROM ai_interviews WHERE id = ?').bind(id).first<{ turning_until: number | null }>())!.turning_until).toBeNull();
    const finished = await call(`/api/interviews/${id}/finish`, { method: 'POST', token });
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({ interview: { status: 'finished', verdict: verdictJson } });
    expect((await charges(userId)).map((c) => c.action)).toEqual(['verdict']);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM credit_holds WHERE ref = ?').bind(id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('charges only the verdict that validated, not the malformed one asked for again', async () => {
    let n = 0;
    claude({
      verdict: () =>
        ++n === 1
          ? messageResponse('not json', { usage: { input_tokens: 20_000, output_tokens: 8_000 } })
          : messageResponse(JSON.stringify(verdictJson), { usage: { input_tokens: 1_000, output_tokens: 500 } }),
    });
    const { id: userId, token } = await user();
    const id = await started(token);
    expect((await call(`/api/interviews/${id}/finish`, { method: 'POST', token })).status).toBe(200);
    expect(n).toBe(2);
    const [charge] = await charges(userId);
    expect(charge).toEqual({ action: 'verdict', charged_mc: costMc({ model: 'claude-sonnet-5-5', input_tokens: 1_000, output_tokens: 500 }, e) });
    expect(await balanceMc(e, userId)).toBe(100_000 - charge.charged_mc);
  });

  it('takes one turn at a time: parallel turns call the model once and the others answer 409 turn_in_progress', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const calls = claude({ reply: async () => (await gate, sseResponse(streamEvents('Sure.'))) });
    const { token } = await user();
    const id = await started(token);
    const N = 4;
    const pending = Array.from({ length: N }, (_, i) => turnOf(token, id, { message: `Turn ${i}` }));
    // The losers answer while the winner's model call is still held.
    const settled = pending.map((p) => p.then((res) => res));
    await new Promise((resolve) => setTimeout(resolve, 200));
    open();
    const responses = await Promise.all(settled);
    const refused = responses.filter((r) => r.status === 409);
    expect(refused).toHaveLength(N - 1);
    for (const r of refused) expect(await r.json()).toEqual({ error: 'turn_in_progress', message: 'Still answering your last message' });
    const ok = responses.find((r) => r.status === 200)!;
    expect((await events(ok)).at(-1)!.event).toBe('done');
    expect(calls.filter((c) => c.body.model !== HAIKU)).toHaveLength(1);
    // The lease is let go: the next turn goes through.
    expect((await turnOf(token, id, { message: 'Next' })).status).toBe(200);
  });

  it('lets a turn go once its lease is past, and refuses a finish while a turn holds the session', async () => {
    claude();
    const { token } = await user();
    const id = await started(token);
    await env.DB.prepare('UPDATE ai_interviews SET turning_until = ? WHERE id = ?').bind(Date.now() + 60_000, id).run();
    expect(await (await turnOf(token, id, { message: 'hi' })).json()).toMatchObject({ error: 'turn_in_progress' });
    expect((await call(`/api/interviews/${id}/finish`, { method: 'POST', token })).status).toBe(409);
    await env.DB.prepare('UPDATE ai_interviews SET turning_until = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    const res = await turnOf(token, id, { message: 'hi' });
    expect(res.status).toBe(200);
    await events(res);
    expect((await env.DB.prepare('SELECT turning_until FROM ai_interviews WHERE id = ?').bind(id).first<{ turning_until: number | null }>())!.turning_until).toBeNull();
  });

  it('counts a failed call’s tokens against the cap, but charges the user nothing for it', async () => {
    // The stream fails after the model billed the input: it counts toward the token cap, not the credits.
    const broken = () => sseResponse([{ type: 'message_start', message: { id: 'm', model: 'claude-sonnet-5-5', usage: { input_tokens: 3000, output_tokens: 1 } } }, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }]);
    claude({ reply: broken });
    const { id: userId, token } = await user();
    const id = await started(token);
    const res = await turnOf(token, id, { message: 'Hello' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_failed', retryable: true });
    expect(await row(id)).toMatchObject({ status: 'active', tokens: 3001 });
    expect(await charges(userId)).toEqual([]);
    // Failed calls add up against the cap too.
    const again = await turnOf(token, id, { message: 'Hello' });
    expect(again.status).toBe(502);
    expect((await row(id))!.tokens).toBe(6002);
  });

  it('checks the token cap against the stored total, failed calls included', async () => {
    const calls = claude();
    const { token } = await user();
    const id = await started(token);
    await env.DB.prepare('UPDATE ai_interviews SET tokens = 590000 WHERE id = ?').bind(id).run();
    const budget = await turnOf(token, id, { message: 'hi' });
    expect(budget.status).toBe(409);
    expect(await budget.json()).toMatchObject({ error: 'budget' });
    expect(calls).toHaveLength(0);
  });

  it('counts a failed verdict’s tokens, charges nothing and keeps the session open with its hold', async () => {
    claude({ verdict: () => messageResponse('', { stop: 'refusal', usage: { input_tokens: 5000 } }) });
    const { id: userId, token } = await user();
    const id = await started(token);
    const res = await call(`/api/interviews/${id}/finish`, { method: 'POST', token });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'ai_failed', retryable: false });
    expect(await row(id)).toMatchObject({ status: 'active', tokens: 5050 });
    expect(await charges(userId)).toEqual([]);
    // The verdict's hold stays for the next try.
    expect(await credits(token)).toBe((100_000 - verdictHoldMc(e)) / 1000);
  });

  it('never flips a finished session to failed from a stale failing turn', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    claude({ reply: async () => (await gate, failing()) });
    const { token } = await user();
    const id = await started(token);
    const pending = turnOf(token, id, { message: 'Hello' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Meanwhile the session ended (as after a lease ran out and a verdict was written).
    await env.DB.prepare("UPDATE ai_interviews SET status = 'finished', verdict = ? WHERE id = ?").bind(JSON.stringify(verdictJson), id).run();
    open();
    const res = await pending;
    expect(res.status).toBe(502);
    expect((await row(id))!.status).toBe('finished');
  });

  it('refuses turns past the 60-minute wall clock or the token budget, and oversized input', async () => {
    const calls = claude();
    const { token } = await user();
    const id = await started(token);
    expect((await turnOf(token, id, { message: 'x'.repeat(4001) })).status).toBe(400);
    expect((await turnOf(token, id, { message: 'hi', design: 'x'.repeat(64 * 1024 + 1) })).status).toBe(400);
    expect((await turnOf(token, id, { message: 42 })).status).toBe(400);
    await env.DB.prepare("UPDATE ai_interviews SET state = json_set(state, '$.usage.\"claude-sonnet-5-5\".input_tokens', 590000) WHERE id = ?").bind(id).run();
    const budget = await turnOf(token, id, { message: 'hi' });
    expect(budget.status).toBe(409);
    expect(await budget.json()).toMatchObject({ error: 'budget' });
    await env.DB.prepare("UPDATE ai_interviews SET state = json_set(state, '$.usage.\"claude-sonnet-5-5\".input_tokens', 0) WHERE id = ?").bind(id).run();
    await age(id, 61 * MIN);
    const time = await turnOf(token, id, { message: 'hi' });
    expect(time.status).toBe(409);
    expect(await time.json()).toMatchObject({ error: 'time' });
    expect(calls).toHaveLength(0);
    // Nothing failed: the session stays open for its verdict.
    expect((await row(id))!.status).toBe('active');
  });

  it('finishes with the verdict once, and takes no turns after', async () => {
    const calls = claude();
    const { token } = await user();
    const id = await started(token);
    await events(await turnOf(token, id, { message: 'Hello' }));
    const res = await call(`/api/interviews/${id}/finish`, { method: 'POST', token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ interview: { status: 'finished', verdict: verdictJson } });
    const n = calls.length;
    const again = await call(`/api/interviews/${id}/finish`, { method: 'POST', token });
    expect(await again.json()).toMatchObject({ interview: { verdict: verdictJson } });
    expect(calls).toHaveLength(n);
    expect((await turnOf(token, id, { message: 'more' })).status).toBe(409);
    const list = (await (await call('/api/interviews', { token })).json()) as { interviews: { id: string; verdict?: { passed: boolean } }[] };
    expect(list.interviews).toMatchObject([{ id, status: 'finished', verdict: { passed: true } }]);
  });

  it('answers 409 active_session while one is open, and ends it only when asked, letting go of its hold', async () => {
    claude();
    const { token } = await user(1000);
    const first = await started(token);
    const left = (1_100_000 - verdictHoldMc(e)) / 1000;
    expect(await credits(token)).toBe(left);
    const refused = await startOne(token, { problem: 'url-shortener', minutes: 30 });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'active_session', id: first, problem: 'url-shortener' });
    expect(await credits(token)).toBe(left);
    expect((await row(first))!.status).toBe('active');
    expect((await startOne(token, { problem: 'url-shortener', minutes: 45, replace: 'yes' })).status).toBe(400);

    const replaced = await startOne(token, { problem: 'url-shortener', minutes: 45, replace: true });
    expect(replaced.status).toBe(201);
    const second = ((await replaced.json()) as { interview: { id: string } }).interview.id;
    expect((await row(first))!.status).toBe('abandoned');
    expect((await row(second))!.status).toBe('active');
    expect(await credits(token)).toBe(left);
    // A finished one doesn't block a new start.
    await call(`/api/interviews/${second}/finish`, { method: 'POST', token });
    expect((await startOne(token)).status).toBe(201);
  });

  it('exports the sessions with their transcripts, and deletes them with the account', async () => {
    claude();
    const { id: userId, token } = await user();
    const id = await started(token);
    await events(await turnOf(token, id, { message: 'Hello' }));
    await call(`/api/interviews/${id}/finish`, { method: 'POST', token });
    const data = (await (await call('/api/me/export', { token })).json()) as { aiInterviews: { id: string; verdict: unknown; messages: { role: string }[] }[] };
    expect(data.aiInterviews).toMatchObject([{ id, problem: 'url-shortener', status: 'finished', verdict: verdictJson }]);
    expect(data.aiInterviews[0].messages.map((m) => m.role)).toEqual(['interviewer', 'candidate', 'interviewer']);

    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_interviews WHERE user_id = ?').bind(userId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_interview_messages WHERE interview_id = ?').bind(id).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('clears transcripts older than 90 days and keeps the verdicts', async () => {
    claude();
    const { token } = await user();
    const old = await started(token);
    await events(await turnOf(token, old, { message: 'Hello' }));
    await call(`/api/interviews/${old}/finish`, { method: 'POST', token });
    await age(old, TRANSCRIPT_TTL_MS + MIN);
    await env.DB.prepare('UPDATE ai_interview_messages SET at = at - ? WHERE interview_id = ?').bind(TRANSCRIPT_TTL_MS + MIN, old).run();
    const { token: token2 } = await user();

    const recent = await started(token2);

    expect(await pruneInterviewTranscripts(env)).toBe(1);
    expect(await row(old)).toMatchObject({ status: 'finished', state: null, verdict: JSON.stringify(verdictJson) });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_interview_messages WHERE interview_id = ?').bind(old).first<{ n: number }>()).toEqual({ n: 0 });
    expect((await row(recent))!.state).not.toBeNull();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_interview_messages WHERE interview_id = ?').bind(recent).first<{ n: number }>()).toEqual({ n: 1 });
    expect((await call(`/api/interviews/${old}`, { token })).status).toBe(200);
    expect((await turnOf(token, old, { message: 'x' })).status).toBe(409);
  });
});
