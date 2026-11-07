import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU } from '../src/ai/client';
import { parsePicks, ROADMAP_PROMPT, type Candidates } from '../src/ai/roadmap';
import { grantSignupCredits } from '../src/credits';
import { REVIEW_REFRESH_MS } from '../src/roadmap';
import { call, resetDatabase, signedInUser } from './helpers';
import { messageResponse, sseResponse, streamEvents, type Recorded } from './ai/mockClaude';

const verdictJson = {
  passed: false,
  scores: { requirements: 4, estimation: 2, design: 3, tradeoffs: 3, communication: 4 },
  wentWell: [{ skill: 'requirements', text: 'Asked about the read to write ratio first.' }],
  wentWrong: [{ skill: 'estimation', text: 'Skipped the storage estimate.' }],
  nextSteps: ['Practise storage estimates'],
};

const PICKS = {
  picks: [
    { kind: 'problem', id: 'pastebin', reason: 'Your storage estimate was missing; Pastebin makes you size it.' },
    { kind: 'cards', id: 'estimation', reason: 'Estimation scored 2 of 5.' },
    { kind: 'problem', id: 'made-up-problem', reason: 'Invented.' },
    { kind: 'cards', id: 'caching', reason: 'Cache misses came up in the design.' },
  ],
};

const GOOD_REVIEW = { summary: 'A small, sound design.', strengths: ['Two API replicas.'], issues: [{ severity: 'major', title: 'One database', detail: 'No replica.', nodeId: 'db' }], suggestions: ['Add a replica.'] };

type Reply = (req: Recorded) => Response | Promise<Response>;
const isPicker = (req: Recorded) => req.body.model === HAIKU && req.body.system[0]?.text === ROADMAP_PROMPT;

/** The Claude API, faked: the roadmap's Haiku call answers `picks`; anything else answers the verdict or a review. */
function claude(opts: { picks?: Reply; other?: Reply } = {}): Recorded[] {
  const calls: Recorded[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.anthropic.com/')) return real(input, init);
    const rec: Recorded = { url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) };
    calls.push(rec);
    if (isPicker(rec)) return (opts.picks ?? (() => messageResponse(JSON.stringify(PICKS), { model: HAIKU })))(rec);
    if (rec.body.stream) return sseResponse(streamEvents('Hello.'));
    return (opts.other ?? (() => messageResponse(JSON.stringify(verdictJson))))(rec);
  });
  return calls;
}

const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();

/** Moves the account to `plan` (free: with its sign-up credits) and starts an interview; returns the session id. */
async function interview(token: string, userId: string, plan = 'pro'): Promise<string> {
  if (plan === 'free') await grantSignupCredits(env, userId, `test\n${userId}`);
  else await setPlan(userId, plan);
  const res = await call('/api/interviews', { method: 'POST', token, body: { problem: 'url-shortener', minutes: 45 } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { interview: { id: string } }).interview.id;
}

const finish = (token: string, id: string) => call(`/api/interviews/${id}/finish`, { method: 'POST', token });
const next = (token?: string, query = '') => call(`/api/roadmap/next${query}`, { token });
const recCount = async (userId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM roadmap_recs WHERE user_id = ?').bind(userId).first<{ n: number }>())!.n;

/** A finished session written straight to D1, `daysAgo` days back. */
async function finished(userId: string, daysAgo: number, scores: Record<string, number>, passed = true): Promise<string> {
  const id = crypto.randomUUID();
  const at = Date.now() - daysAgo * 86_400_000;
  await env.DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, state, started_at, ended_at, verdict) VALUES (?, ?, 'url-shortener', 45, 'finished', NULL, ?, ?, ?)")
    .bind(id, userId, at, at + 45 * 60_000, JSON.stringify({ ...verdictJson, passed, scores }))
    .run();
  return id;
}

describe('the AI roadmap: picking', () => {
  const candidates: Candidates = {
    problems: [
      { id: 'url-shortener', title: 'URL Shortener', difficulty: 'easy', stage: 'Foundations', solved: true },
      { id: 'pastebin', title: 'Pastebin', difficulty: 'easy', stage: 'Foundations', solved: false },
    ],
    topics: [
      { id: 'estimation', title: 'Estimation', mastery: 0.1 },
      { id: 'caching', title: 'Caching', mastery: 0.5 },
    ],
  };

  it('keeps only picks that name a real problem or card topic, with the right kind, once each, at most 3', () => {
    const text = JSON.stringify({
      picks: [
        { kind: 'problem', id: 'nope', reason: 'Unknown problem.' },
        { kind: 'cards', id: 'pastebin', reason: 'A problem id as a topic.' },
        { kind: 'lesson', id: 'caching', reason: 'Not a kind.' },
        { kind: 'problem', id: 'pastebin', reason: '  Size the storage.  ' },
        { kind: 'problem', id: 'pastebin', reason: 'Again.' },
        { kind: 'cards', id: 'estimation', reason: '' },
        { kind: 'cards', id: 'estimation', reason: 'Weak.' },
        { kind: 'cards', id: 'caching', reason: 'Relevant.' },
        { kind: 'problem', id: 'url-shortener', reason: 'A fourth valid one is cut.' },
      ],
    });
    expect(parsePicks(text, candidates)).toEqual([
      { kind: 'problem', id: 'pastebin', reason: 'Size the storage.' },
      { kind: 'cards', id: 'estimation', reason: 'Weak.' },
      { kind: 'cards', id: 'caching', reason: 'Relevant.' },
    ]);
    expect(parsePicks('not json', candidates)).toEqual([]);
    expect(parsePicks('{"picks": 3}', candidates)).toEqual([]);
  });
});

describe('the AI roadmap: routes', () => {
  beforeEach(async () => {
    await resetDatabase();
    env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('answers the verdict at once, then picks the next steps from real ids only, and answers them on GET /api/roadmap/next', async () => {
    // The pick waits until the test lets it go: the verdict must not.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = claude({ picks: async () => (await gate, messageResponse(JSON.stringify(PICKS), { model: HAIKU })) });
    const { id: userId, token } = await signedInUser();
    const id = await interview(token, userId);
    const res = await finish(token, id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ interview: { status: 'finished', verdict: verdictJson } });
    await vi.waitFor(() => expect(calls.filter(isPicker)).toHaveLength(1));
    expect(await recCount(userId)).toBe(0);
    expect(((await (await next(token, `?interview=${id}`)).json()) as { next: unknown }).next).toBeNull();
    // Meanwhile the newest picks name the verdict whose picks are coming.
    expect(await (await next(token)).json()).toEqual({ next: null, pending: id });
    release();
    await vi.waitFor(async () => expect(await recCount(userId)).toBe(1));
    expect(await (await next(token)).json()).not.toHaveProperty('pending');

    // The input names the verdict, the weak topics and the candidates by id; the verdict is fenced as data.
    const prompt = calls.filter(isPicker)[0].body.messages[0].content as string;
    expect(prompt).toContain('<report>');
    expect(prompt).toContain('Skipped the storage estimate.');
    expect(prompt).toContain('- pastebin | Pastebin |');
    expect(prompt).toContain('- estimation | Estimation |');
    expect(prompt).toMatch(/Weakest card topics: \S+/);

    const body = (await (await next(token)).json()) as { next: { source: string; sourceId: string; picks: { kind: string; id: string }[] } };
    expect(body.next).toMatchObject({ source: 'interview', sourceId: id });
    expect(body.next.picks.map((p) => `${p.kind}:${p.id}`)).toEqual(['problem:pastebin', 'cards:estimation', 'cards:caching']);
    // By the interview that prompted them; another id has none.
    expect(((await (await next(token, `?interview=${id}`)).json()) as { next: unknown }).next).toMatchObject({ sourceId: id });
    expect(((await (await next(token, '?interview=other')).json()) as { next: unknown }).next).toBeNull();
    // Haiku's tokens count with the session: 150 for the verdict, 150 for the picks (mockClaude usage()).
    await vi.waitFor(async () => expect((await env.DB.prepare('SELECT tokens FROM ai_interviews WHERE id = ?').bind(id).first<{ tokens: number }>())!.tokens).toBe(300));
    // The picks are paid in credits, after the verdict.
    await vi.waitFor(async () => expect((await env.DB.prepare('SELECT action FROM credit_charges WHERE user_id = ? ORDER BY created_at, rowid').bind(userId).all()).results).toEqual([{ action: 'verdict' }, { action: 'next_steps' }]));
  });

  it('keeps the verdict when the pick fails: an API error, or no known id', async () => {
    const cases = [
      { picks: () => Response.json({ type: 'error', error: { type: 'api_error', message: 'down' } }, { status: 500 }), charged: 0 },
      { picks: () => messageResponse(JSON.stringify({ picks: [{ kind: 'problem', id: 'nope', reason: 'x' }] }), { model: HAIKU }), charged: 1 },
    ];
    for (const { picks, charged } of cases) {
      await resetDatabase();
      vi.restoreAllMocks();
      const calls = claude({ picks });
      const { id: userId, token } = await signedInUser();
      const id = await interview(token, userId);
      const res = await finish(token, id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ interview: { status: 'finished', verdict: verdictJson } });
      // The 500 is retried once; give the background pick time to give up.
      await vi.waitFor(() => expect(calls.filter(isPicker).length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 1500));
      expect(await recCount(userId)).toBe(0);
      expect(((await (await next(token)).json()) as { next: unknown }).next).toBeNull();
      expect(await env.DB.prepare('SELECT status FROM ai_interviews WHERE id = ?').bind(id).first()).toEqual({ status: 'finished' });
      // A pick that failed on the API's side is charged nothing; one the model answered uselessly is charged (P34). Neither holds anything.
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_charges WHERE action = 'next_steps'").first()).toEqual({ n: charged });
      expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM credit_holds').first()).toEqual({ n: 0 });
    }
  });

  it('is Pro only: no pick after a free verdict, 402 off Pro, 401 signed out, 501 without the key', async () => {
    const calls = claude();
    const { id: userId, token } = await signedInUser();
    const id = await interview(token, userId, 'free');
    expect((await finish(token, id)).status).toBe(200);
    expect(calls.filter(isPicker)).toHaveLength(0);
    expect(await recCount(userId)).toBe(0);
    const refused = await next(token);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'plan_required', feature: 'ai_roadmap' });
    expect((await next()).status).toBe(401);
    delete env.ANTHROPIC_API_KEY;
    expect((await next(token)).status).toBe(501);
  });

  it('refreshes after an AI review at most once a day', async () => {
    const calls = claude({ other: () => messageResponse(JSON.stringify(GOOD_REVIEW)) });
    const { id: userId, token } = await signedInUser();
    await setPlan(userId, 'pro');
    const body = { source: 'title "x"\n', model: { nodes: [], edges: [], useCases: [], decisions: [], diagnostics: [] } };
    expect((await call('/api/review', { method: 'POST', token, body })).status).toBe(200);
    await vi.waitFor(async () => expect(await recCount(userId)).toBe(1));
    expect((await call('/api/review', { method: 'POST', token, body })).status).toBe(200);
    // Give a second refresh time to happen, were it to.
    await new Promise((r) => setTimeout(r, 50));
    expect(await recCount(userId)).toBe(1);
    expect(calls.filter(isPicker)).toHaveLength(1);
    // A day later, a review refreshes them again.
    await env.DB.prepare('UPDATE roadmap_recs SET created_at = created_at - ?').bind(REVIEW_REFRESH_MS + 1).run();
    expect((await call('/api/review', { method: 'POST', token, body })).status).toBe(200);
    await vi.waitFor(async () => expect(await recCount(userId)).toBe(2));
    expect(((await (await next(token)).json()) as { next: { source: string } }).next.source).toBe('review');
  });

  it('is in Download my data, and deleted with the account', async () => {
    claude();
    const { id: userId, token } = await signedInUser();
    const id = await interview(token, userId);
    await finish(token, id);
    const data = (await (await call('/api/me/export', { token })).json()) as { roadmapRecs: { source: string; sourceId: string; picks: unknown[] }[] };
    expect(data.roadmapRecs).toMatchObject([{ source: 'interview', sourceId: id, picks: [{ kind: 'problem', id: 'pastebin' }, {}, {}] }]);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await recCount(userId)).toBe(0);
  });
});

describe('GET /api/interviews/history', () => {
  beforeEach(async () => {
    await resetDatabase();
    env.ANTHROPIC_API_KEY = 'sk-test';
  });
  afterEach(() => {
    delete env.ANTHROPIC_API_KEY;
  });

  const history = (token?: string) => call('/api/interviews/history', { token });
  type History = { full: boolean; total: number; sessions: { id: string; passed: boolean; scores: Record<string, number> }[] };

  it('gives Pro every verdict summary, newest first, and other plans the latest only', async () => {
    const { id: userId, token } = await signedInUser();
    const ids = [];
    for (let d = 5; d >= 1; d--) ids.push(await finished(userId, d, { requirements: 6 - d, estimation: 2, design: 3, tradeoffs: 3, communication: 4 }, d < 3));
    // Not finished, or without a verdict: never in the history.
    await env.DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, started_at) VALUES ('open', ?, 'url-shortener', 45, 'active', ?)").bind(userId, Date.now()).run();

    const free = (await (await history(token)).json()) as History;
    expect(free).toMatchObject({ full: false, total: 5 });
    expect(free.sessions.map((s) => s.id)).toEqual([ids[4]]);

    await setPlan(userId, 'pro');
    const pro = (await (await history(token)).json()) as History;
    expect(pro).toMatchObject({ full: true, total: 5 });
    expect(pro.sessions.map((s) => s.id)).toEqual([...ids].reverse());
    expect(pro.sessions[0]).toMatchObject({ passed: true, scores: { requirements: 5 } });
    // Summaries only: no notes.
    expect(pro.sessions[0]).not.toHaveProperty('wentWrong');
  });

  it('GET /api/interviews lists every session, with the latest verdict only off Pro', async () => {
    const { id: userId, token } = await signedInUser();
    const ids = [];
    for (let d = 3; d >= 1; d--) ids.push(await finished(userId, d, verdictJson.scores));
    await env.DB.prepare("INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, state, started_at) VALUES ('open', ?, 'url-shortener', 45, 'active', '{}', ?)").bind(userId, Date.now()).run();
    type List = { interviews: { id: string; status: string; verdict?: unknown }[]; credits: { total: number } };
    const free = (await (await call('/api/interviews', { token })).json()) as List;
    // The open session and every id stay, for the start screen; only the newest finished one has its verdict.
    expect(free.interviews.map((i) => i.id)).toEqual(['open', ids[2], ids[1], ids[0]]);
    expect(free.interviews.filter((i) => i.verdict).map((i) => i.id)).toEqual([ids[2]]);
    expect(free.interviews[0]).toMatchObject({ status: 'active' });
    expect(free.credits).toBeDefined();
    await setPlan(userId, 'pro');
    const pro = (await (await call('/api/interviews', { token })).json()) as List;
    expect(pro.interviews.filter((i) => i.verdict).map((i) => i.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('answers 401 signed out and 501 without the key', async () => {
    expect((await history()).status).toBe(401);
    delete env.ANTHROPIC_API_KEY;
    const { token } = await signedInUser();
    expect((await history(token)).status).toBe(501);
  });
});
