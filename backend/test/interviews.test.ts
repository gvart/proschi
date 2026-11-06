import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU } from '../src/ai/client';
import { pruneInterviewTranscripts, TRANSCRIPT_TTL_MS } from '../src/interviews';
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
const credits = async (token: string) => ((await (await call('/api/interviews', { token })).json()) as { credits: { total: number } }).credits.total;
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
    const { token } = await signedInUser();
    expect((await startOne(token)).status).toBe(501);
    expect((await call('/api/interviews', { token })).status).toBe(501);
    expect((await turnOf(token, 'x', { message: 'hi' })).status).toBe(501);
    env.ANTHROPIC_API_KEY = 'sk-test';
    expect((await call('/api/interviews', { method: 'POST', body: { problem: 'url-shortener', minutes: 45 } })).status).toBe(401);
  });

  it('spends a credit to start, and answers 402 no_credits with the balance once none is left', async () => {
    const { token } = await signedInUser();
    expect(await credits(token)).toBe(1);
    expect((await startOne(token, { problem: 'nope', minutes: 45 })).status).toBe(400);
    expect((await startOne(token, { problem: 'url-shortener', minutes: 50 })).status).toBe(400);
    const res = await startOne(token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { interview: { status: string; phase: string; messages: { role: string; text: string }[] }; credits: { total: number } };
    expect(body.interview).toMatchObject({ status: 'active', phase: 'clarify', problem: 'url-shortener', minutes: 45 });
    expect(body.interview.messages).toEqual([expect.objectContaining({ role: 'interviewer', text: expect.stringContaining('URL Shortener') })]);
    expect(body.credits.total).toBe(0);
    const refused = await startOne(token);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'no_credits', credits: { total: 0, trial: 0, monthly: 0, pack: 0 } });
  });

  it('streams a turn as text events, then the hint, the grade and done, and keeps the transcript', async () => {
    const calls = claude();
    const { token } = await signedInUser();
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
  });

  it('answers 404 for another user’s session', async () => {
    claude();
    const owner = await signedInUser();
    const other = await signedInUser();
    const id = await started(owner.token);
    expect((await call(`/api/interviews/${id}`, { token: other.token })).status).toBe(404);
    expect((await turnOf(other.token, id, { message: 'hi' })).status).toBe(404);
    expect((await call(`/api/interviews/${id}/finish`, { method: 'POST', token: other.token })).status).toBe(404);
    expect(((await (await call('/api/interviews', { token: other.token })).json()) as { interviews: unknown[] }).interviews).toEqual([]);
  });

  it('refunds the credit when the first turn fails, and ends the session', async () => {
    claude({ reply: failing });
    const { token } = await signedInUser();
    const id = await started(token);
    await age(id, 20 * MIN);
    const res = await turnOf(token, id, { message: 'Hello' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'ai_failed', refunded: true });
    expect((await row(id))!.status).toBe('failed');
    expect(await credits(token)).toBe(1);
    expect((await turnOf(token, id, { message: 'Hello again' })).status).toBe(409);
  });

  it('refunds a failure in the first 5 minutes, but not a later one after the first turn', async () => {
    let fail = false;
    claude({ reply: () => (fail ? failing() : sseResponse(streamEvents('Sure.'))) });
    const { token } = await signedInUser();
    const early = await started(token);
    await events(await turnOf(token, early, { message: 'One' }));
    fail = true;
    const res = await turnOf(token, early, { message: 'Two' });
    expect(await res.json()).toMatchObject({ refunded: true });
    expect(await credits(token)).toBe(1);

    fail = false;
    const late = await started(token);
    await events(await turnOf(token, late, { message: 'One' }));
    await age(late, 6 * MIN);
    fail = true;
    const kept = await turnOf(token, late, { message: 'Two' });
    expect(kept.status).toBe(502);
    expect(await kept.json()).toMatchObject({ error: 'ai_failed', refunded: false });
    expect((await row(late))!.status).toBe('active');
    expect(await credits(token)).toBe(0);
  });

  it('refuses turns past the 60-minute wall clock or the token budget, and oversized input', async () => {
    const calls = claude();
    const { token } = await signedInUser();
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
    // Nothing failed: the credit stays spent and the session open for its verdict.
    expect((await row(id))!.status).toBe('active');
  });

  it('finishes with the verdict once, and takes no turns after', async () => {
    const calls = claude();
    const { token } = await signedInUser();
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

  it('abandons the session before when a new one starts', async () => {
    claude();
    const { id: userId, token } = await signedInUser();
    await env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, delta, item, ref_id, created_at) VALUES (?, 'grant', 'pack', 5, 'pack_5', 'ord', 0)").bind(userId).run();
    const first = await started(token);
    const second = await started(token);
    expect((await row(first))!.status).toBe('abandoned');
    expect((await row(second))!.status).toBe('active');
  });

  it('exports the sessions with their transcripts, and deletes them with the account', async () => {
    claude();
    const { id: userId, token } = await signedInUser();
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
    const { token } = await signedInUser();
    const old = await started(token);
    await events(await turnOf(token, old, { message: 'Hello' }));
    await call(`/api/interviews/${old}/finish`, { method: 'POST', token });
    await age(old, TRANSCRIPT_TTL_MS + MIN);
    await env.DB.prepare('UPDATE ai_interview_messages SET at = at - ? WHERE interview_id = ?').bind(TRANSCRIPT_TTL_MS + MIN, old).run();
    const { token: token2 } = await signedInUser();
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
