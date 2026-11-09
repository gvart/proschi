import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAIKU } from '../src/ai/client';
import { grantSignupCredits } from '../src/credits';
import { sha256 } from '../src/crypto';
import { FEATURES } from '../src/features';
import { isPaidPath, PAID_ROUTES } from '../src/index';
import { TOKEN_SCOPES } from '../src/scopes';
import { call, resetDatabase, signedInUser } from './helpers';
import { messageResponse, sseResponse, streamEvents } from './ai/mockClaude';

/**
 * The paid routes (src/index.ts PAID_ROUTES): every one declares its feature
 * or why it is open, and each is run with a free and a Pro account on the
 * session cookie. An app's or the CLI's bearer access token (an `app_access`
 * session, src/apptokens.ts) reaches none of them, whatever its scopes
 * (src/scopes.ts, test/scopes.test.ts). The plan is read from D1 on every request (src/auth.ts authenticate), so a
 * downgrade counts from the next request.
 */

type AiEnv = { ANTHROPIC_API_KEY?: string };
const aiEnv = env as unknown as AiEnv;

const VERDICT = {
  passed: true,
  scores: { requirements: 4, estimation: 3, design: 4, tradeoffs: 3, communication: 4 },
  wentWell: [{ skill: 'requirements', text: 'Asked about the read to write ratio first.' }],
  wentWrong: [{ skill: 'estimation', text: 'Skipped the storage estimate.' }],
  nextSteps: ['Practise storage estimates'],
};
const SOURCE = 'title "Checkout"\n\napi "API" [Go]\ndb "Orders" [Postgres]\napi -> db\n';

/** The Claude API: streamed replies, hints and picks from Haiku, the verdict as JSON. */
function claude(): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.anthropic.com/')) return real(input, init);
    const text = String(init?.body);
    const body = JSON.parse(text) as { model: string; stream?: boolean };
    if (text.includes('You are the Design partner')) return messageResponse(JSON.stringify({ message: 'Looks sound.', questions: [], changes: [] }));
    if (body.model === HAIKU) return messageResponse(text.includes('"picks"') ? JSON.stringify({ picks: [] }) : JSON.stringify({ kind: 'focus', text: 'Ask about writes.', covered: [] }), { model: HAIKU });
    if (body.stream) return sseResponse(streamEvents('About 100M new links a month.'));
    return messageResponse(JSON.stringify(VERDICT));
  });
}

type Credential = 'cookie' | 'bearer';
interface Who {
  id: string;
  /** Call options for this account under the credential. */
  as: { token?: string; bearer?: string };
}

let bearers = 0;
/**
 * An account on `plan`: 'comp' is on free with Pro given by the admin until
 * tomorrow (users.comp_until, src/plans.ts effectivePlan), 'expired' on free
 * with a comp that ended an hour ago. Free accounts have their 100 sign-up
 * credits (src/credits.ts grantSignupCredits).
 */
async function account(plan: 'free' | 'pro' | 'comp' | 'expired', credential: Credential): Promise<Who> {
  const { id, token } = await signedInUser();
  if (plan === 'free' || plan === 'expired') await grantSignupCredits(env, id, `test\n${id}`);
  if (plan === 'pro') await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(id).run();
  const nowS = Math.floor(Date.now() / 1000);
  if (plan === 'comp') await env.DB.prepare('UPDATE users SET comp_until = ? WHERE id = ?').bind(nowS + 86_400, id).run();
  if (plan === 'expired') await env.DB.prepare('UPDATE users SET comp_until = ? WHERE id = ?').bind(nowS - 3600, id).run();
  if (credential === 'cookie') return { id, as: { token } };
  const bearer = `bearer-${++bearers}-${id}`;
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id, scopes) VALUES (?, ?, 4000000000, 0, 'app_access', ?, ?)")
    .bind(await sha256(bearer), id, `f-${id}`, TOKEN_SCOPES.join(' '))
    .run();
  return { id, as: { bearer } };
}

const send = (who: Who, method: string, path: string, body?: unknown) => call(path, { method, body, ...who.as });

/** A finished interview of `who`'s, with its verdict, `ago` ms in the past; its id. */
async function finishedInterview(who: Who, ago = 0): Promise<string> {
  const id = crypto.randomUUID();
  const t = Date.now() - ago;
  await env.DB.prepare(
    "INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, state, version, started_at, ended_at, tokens, cost_usd, verdict) VALUES (?, ?, 'url-shortener', 45, 'finished', NULL, 1, ?, ?, 0, 0, ?)",
  )
    .bind(id, who.id, t, t + 1000, JSON.stringify(VERDICT))
    .run();
  return id;
}

async function startedInterview(who: Who): Promise<string> {
  const res = await send(who, 'POST', '/api/interviews', { problem: 'url-shortener', minutes: 45 });
  expect(res.status).toBe(201);
  return ((await res.json()) as { interview: { id: string } }).interview.id;
}

/**
 * One interview turn, its stream read to the end: the Worker writes the reply while it is read
 * (src/interviews.ts, in waitUntil), so a body left unread would never finish and workerd would
 * cancel it as hung.
 */
async function turn(who: Who): Promise<void> {
  const res = await send(who, 'POST', `/api/interviews/${await startedInterview(who)}/turn`, { message: 'How many links?' });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('event: done');
}

async function partnerSession(who: Who): Promise<string> {
  const res = await send(who, 'POST', '/api/partner/sessions', { context: { kind: 'editor' } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function syncedDocument(who: Who, id = 'doc1'): Promise<void> {
  expect((await send(who, 'PUT', `/api/me/documents/${id}`, { name: 'checkout.proschi', source: SOURCE, imports: null, baseVersion: 0 })).status).toBe(200);
}

interface Case {
  /** Free: what the route answers an account on the free plan. */
  free: (who: Who) => Promise<void>;
  /** Pro: it works. */
  pro: (who: Who) => Promise<void>;
}

const planRequired = async (res: Response, feature: string) => {
  expect(res.status).toBe(402);
  expect(await res.json()).toMatchObject({ error: 'plan_required', feature });
};

/** Every entry of PAID_ROUTES, by `${method} ${path}`. A route without a case here fails the first test. */
const CASES: Record<string, Case> = {
  // ai_interview is on every plan; the credits decide how many (402 no_credits).
  'POST api/interviews': {
    free: async (who) => {
      await startedInterview(who);
      // The sign-up credits spent: ending the open one with `replace`, or any other field, starts no other.
      await env.DB.prepare("INSERT INTO credits (user_id, kind, bucket, period, delta_mc, item, ref_id, created_at) VALUES (?, 'settle', 'signup', '', -100000, 'mock_interview', 'spent', 0)").bind(who.id).run();
      const again = await send(who, 'POST', '/api/interviews', { problem: 'url-shortener', minutes: 45, replace: true, credits: 99, bucket: 'topup', refId: 'x', plan: 'pro' });
      expect(again.status).toBe(402);
      expect(await again.json()).toMatchObject({ error: 'no_credits', balance: 0 });
      expect((await env.DB.prepare('SELECT SUM(delta_mc) AS n FROM credits WHERE user_id = ?').bind(who.id).first<{ n: number }>())!.n).toBe(0);
    },
    pro: async (who) => void (await startedInterview(who)),
  },
  'GET api/interviews': {
    free: async (who) => {
      await finishedInterview(who, 2000);
      const latest = await finishedInterview(who, 1000);
      const { interviews } = (await (await send(who, 'GET', '/api/interviews')).json()) as { interviews: { id: string; verdict?: unknown }[] };
      expect(interviews.filter((i) => i.verdict).map((i) => i.id)).toEqual([latest]);
    },
    pro: async (who) => {
      await finishedInterview(who, 2000);
      await finishedInterview(who, 1000);
      const { interviews } = (await (await send(who, 'GET', '/api/interviews')).json()) as { interviews: { verdict?: unknown }[] };
      expect(interviews.filter((i) => i.verdict)).toHaveLength(2);
    },
  },
  'GET api/interviews/history': {
    free: async (who) => {
      await finishedInterview(who, 2000);
      await finishedInterview(who, 1000);
      expect(await (await send(who, 'GET', '/api/interviews/history')).json()).toMatchObject({ full: false, total: 2, sessions: [expect.anything()] });
    },
    pro: async (who) => {
      await finishedInterview(who, 2000);
      await finishedInterview(who, 1000);
      const body = (await (await send(who, 'GET', '/api/interviews/history')).json()) as { full: boolean; sessions: unknown[] };
      expect(body.full).toBe(true);
      expect(body.sessions).toHaveLength(2);
    },
  },
  // An older verdict can't be read by its id off Pro (it is kept, as the history says).
  'GET api/interviews/*': {
    free: async (who) => {
      const older = await finishedInterview(who, 2000);
      const latest = await finishedInterview(who, 1000);
      const get = async (id: string) => ((await (await send(who, 'GET', `/api/interviews/${id}`)).json()) as { interview: { verdict?: unknown } }).interview.verdict;
      expect(await get(older)).toBeUndefined();
      expect(await get(latest)).toEqual(VERDICT);
    },
    pro: async (who) => {
      const older = await finishedInterview(who, 2000);
      await finishedInterview(who, 1000);
      expect(((await (await send(who, 'GET', `/api/interviews/${older}`)).json()) as { interview: { verdict?: unknown } }).interview.verdict).toEqual(VERDICT);
    },
  },
  'POST api/interviews/*/turn': {
    free: async (who) => turn(who),
    pro: async (who) => turn(who),
  },
  'POST api/interviews/*/finish': {
    free: async (who) => {
      // Its own verdict, the latest; asked again for an older one, none.
      const older = await finishedInterview(who, 60_000);
      const id = await startedInterview(who);
      const res = await send(who, 'POST', `/api/interviews/${id}/finish`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { interview: { verdict?: unknown } }).interview.verdict).toEqual(VERDICT);
      expect(((await (await send(who, 'POST', `/api/interviews/${older}/finish`)).json()) as { interview: { verdict?: unknown } }).interview.verdict).toBeUndefined();
    },
    pro: async (who) => {
      const older = await finishedInterview(who, 60_000);
      const id = await startedInterview(who);
      expect((await send(who, 'POST', `/api/interviews/${id}/finish`)).status).toBe(200);
      expect(((await (await send(who, 'POST', `/api/interviews/${older}/finish`)).json()) as { interview: { verdict?: unknown } }).interview.verdict).toEqual(VERDICT);
    },
  },
  // interview_report is Max's (P31): Pro is refused too; test/interviews.test.ts runs it on Max.
  'GET api/interviews/*/report': {
    free: async (who) => planRequired(await send(who, 'GET', `/api/interviews/${await finishedInterview(who)}/report`), 'interview_report'),
    pro: async (who) => planRequired(await send(who, 'GET', `/api/interviews/${await finishedInterview(who)}/report`), 'interview_report'),
  },
  // design_partner is for anyone signed in; the credits decide how much.
  'POST api/partner/sessions': {
    free: async (who) => expect((await send(who, 'POST', '/api/partner/sessions', { context: { kind: 'editor' } })).status).toBe(201),
    pro: async (who) => expect((await send(who, 'POST', '/api/partner/sessions', { context: { kind: 'editor' } })).status).toBe(201),
  },
  'GET api/partner/sessions/*': {
    free: async (who) => expect((await send(who, 'GET', `/api/partner/sessions/${await partnerSession(who)}`)).status).toBe(200),
    pro: async (who) => expect((await send(who, 'GET', `/api/partner/sessions/${await partnerSession(who)}`)).status).toBe(200),
  },
  'POST api/partner/sessions/*/turns': {
    free: async (who) => expect((await send(who, 'POST', `/api/partner/sessions/${await partnerSession(who)}/turns`, { intent: 'review', message: '', source: SOURCE })).status).toBe(200),
    pro: async (who) => expect((await send(who, 'POST', `/api/partner/sessions/${await partnerSession(who)}/turns`, { intent: 'review', message: '', source: SOURCE })).status).toBe(200),
  },
  'POST api/partner/sessions/*/changes/*': {
    // An unknown change of the user's own chat: past the feature check, 404.
    free: async (who) => expect((await send(who, 'POST', `/api/partner/sessions/${await partnerSession(who)}/changes/nope`, { decision: 'accepted' })).status).toBe(404),
    pro: async (who) => expect((await send(who, 'POST', `/api/partner/sessions/${await partnerSession(who)}/changes/nope`, { decision: 'accepted' })).status).toBe(404),
  },
  'GET api/roadmap/next': {
    free: async (who) => planRequired(await send(who, 'GET', '/api/roadmap/next'), 'ai_roadmap'),
    pro: async (who) => expect((await send(who, 'GET', '/api/roadmap/next')).status).toBe(200),
  },
  'POST api/me/documents/*/share': {
    free: async (who) => {
      await syncedDocument(who);
      await planRequired(await send(who, 'POST', '/api/me/documents/doc1/share'), 'share_links');
    },
    pro: async (who) => {
      await syncedDocument(who);
      expect((await send(who, 'POST', '/api/me/documents/doc1/share')).status).toBe(201);
    },
  },
  // Open on purpose: an account that left Pro still sees and revokes its links; the links themselves stop answering.
  'GET api/me/documents/*/share': {
    free: async (who) => expect(await (await send(who, 'GET', '/api/me/documents/doc1/share')).json()).toEqual({ share: null }),
    pro: async (who) => expect((await send(who, 'GET', '/api/me/documents/doc1/share')).status).toBe(200),
  },
  'DELETE api/me/documents/*/share': {
    free: async (who) => expect((await send(who, 'DELETE', '/api/me/documents/doc1/share')).status).toBe(404),
    pro: async (who) => {
      await syncedDocument(who);
      expect((await send(who, 'POST', '/api/me/documents/doc1/share')).status).toBe(201);
      expect((await send(who, 'DELETE', '/api/me/documents/doc1/share')).status).toBe(204);
    },
  },
};

const key = ([method, path]: readonly [string, string, unknown]) => `${method} ${path}`;

describe('paid routes', () => {
  beforeEach(async () => {
    await resetDatabase();
    aiEnv.ANTHROPIC_API_KEY = 'sk-test';
    claude();
  });
  afterEach(() => {
    delete aiEnv.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('every route under a paid path names its feature, or why it is open, and has a case here', () => {
    for (const entry of PAID_ROUTES) {
      const [, path, route] = entry;
      expect(isPaidPath(path.split('/')), path).toBe(true);
      const feature = 'feature' in route ? route.feature : undefined;
      const open = 'open' in route ? route.open : undefined;
      expect(feature !== undefined ? feature in FEATURES : typeof open === 'string' && open.length > 0, `${key(entry)} is neither requireFeature nor openRoute`).toBe(true);
      expect(CASES[key(entry)], `${key(entry)} has no case in this test`).toBeDefined();
    }
    expect(Object.keys(CASES).sort()).toEqual(PAID_ROUTES.map(key).sort());
  });

  it('a paid path not in the table answers 404, whatever the credential', async () => {
    const who = await account('pro', 'cookie');
    for (const [method, path] of [
      // The retired in-depth review (P29: Design partner replaces it).
      ['POST', '/api/review'],
      ['GET', '/api/review/usage'],
      ['GET', '/api/roadmap'],
      ['POST', '/api/roadmap/next'],
      ['PUT', '/api/me/documents/doc1/share'],
      ['DELETE', '/api/interviews/x'],
    ]) {
      expect((await send(who, method, path)).status, `${method} ${path}`).toBe(404);
    }
  });

  it('signed out, every route answers 401', async () => {
    for (const [method, path] of PAID_ROUTES) {
      const url = `/${path.replace(/\*/g, 'doc1')}`;
      const res = await call(url, { method, body: method === 'POST' ? { problem: 'url-shortener', minutes: 45, message: 'hi' } : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  for (const [method, path] of PAID_ROUTES) {
    it(`${method} ${path}: free, then Pro`, async () => {
      await CASES[`${method} ${path}`].free(await account('free', 'cookie'));
      await CASES[`${method} ${path}`].pro(await account('pro', 'cookie'));
    });
  }

  it('an app or CLI token, with every scope, gets 403 insufficient_scope on every route, on any plan', async () => {
    for (const plan of ['free', 'pro'] as const) {
      const who = await account(plan, 'bearer');
      for (const [method, path] of PAID_ROUTES) {
        const res = await send(who, method, `/${path.replace(/\*/g, 'doc1')}`, method === 'POST' ? { problem: 'url-shortener', minutes: 45, message: 'hi', context: { kind: 'editor' } } : undefined);
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.headers.get('WWW-Authenticate'), `${method} ${path}`).toContain('insufficient_scope');
      }
    }
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_interviews').first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM partner_sessions').first<{ n: number }>())!.n).toBe(0);
  }, 30_000);

  // A comp (Pro given by the admin) is Pro on every route; one that has ended is free again.
  for (const [method, path] of PAID_ROUTES) {
    it(`${method} ${path}: an expired comp is free, a running comp is Pro`, async () => {
      await CASES[`${method} ${path}`].free(await account('expired', 'cookie'));
      await CASES[`${method} ${path}`].pro(await account('comp', 'cookie'));
    });
  }

  it('the public link answers while its owner is comped, and stops when the comp ends', async () => {
    const owner = await account('comp', 'cookie');
    await syncedDocument(owner);
    const { share } = (await (await send(owner, 'POST', '/api/me/documents/doc1/share')).json()) as { share: { token: string } };
    expect((await call(`/api/share/${share.token}`)).status).toBe(200);
    await env.DB.prepare('UPDATE users SET comp_until = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000) - 1, owner.id).run();
    expect((await call(`/api/share/${share.token}`)).status).toBe(404);
  });

  it('a comped account gets Pro’s limits and monthly credits, and /api/me/plan says pro', async () => {
    const who = await account('comp', 'cookie');
    const plan = (await (await send(who, 'GET', '/api/me/plan')).json()) as { plan: string; limits: { documents: number | null }; credits: { monthly: { allowance: number } }; features: Record<string, { ok: boolean }> };
    expect(plan.plan).toBe('pro');
    expect(plan.limits.documents).toBeNull();
    expect(plan.credits.monthly.allowance).toBe(800);
    expect(Object.entries(plan.features).filter(([, f]) => !f.ok).map(([id]) => id)).toEqual(['deep_mode', 'interview_report', 'interview_plan']);
    const expired = await account('expired', 'cookie');
    expect(((await (await send(expired, 'GET', '/api/me/plan')).json()) as { plan: string }).plan).toBe('free');
  });

  it('a refresh token, an expired access token or an admin session is no credential for them', async () => {
    const { id } = await account('pro', 'cookie');
    const refresh = 'refresh-token';
    const expired = 'expired-access-token';
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id) VALUES (?, ?, 4000000000, 0, 'app_refresh', 'f1')").bind(await sha256(refresh), id),
      env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at, kind, family_id) VALUES (?, ?, 1, 0, 'app_access', 'f2')").bind(await sha256(expired), id),
    ]);
    // Refused before the token is even read: no bearer token reaches a paid route.
    for (const bearer of [refresh, expired]) expect((await call('/api/roadmap/next', { bearer })).status).toBe(403);
    expect((await call('/api/roadmap/next', { headers: { Cookie: '__Host-proschi_admin=anything' } })).status).toBe(401);
  });

  it('the public link stops answering while its owner is not on Pro', async () => {
    const owner = await account('pro', 'cookie');
    await syncedDocument(owner);
    const { share } = (await (await send(owner, 'POST', '/api/me/documents/doc1/share')).json()) as { share: { token: string } };
    expect((await call(`/api/share/${share.token}`)).status).toBe(200);
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = ?").bind(owner.id).run();
    expect((await call(`/api/share/${share.token}`)).status).toBe(404);
  });
});

// --- A downgrade through Polar, between two requests --------------------------

const SECRET = 'polar_whs_test-secret';
let events = 0;

async function deliver(event: unknown): Promise<Response> {
  const id = `evt-paid-${++events}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify(event);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return call('/api/billing/webhook', { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${btoa(String.fromCharCode(...mac))}` }, body: event });
}

const subscription = (userId: string, status: string, modified: string) => ({
  type: `subscription.${status === 'canceled' ? 'canceled' : 'updated'}`,
  data: { id: 'sub-1', status, product_id: 'prod-pro-monthly', customer_id: `cus-${userId}`, customer: { id: `cus-${userId}`, external_id: userId }, current_period_end: '2026-12-06T00:00:00Z', cancel_at_period_end: false, modified_at: modified },
});

describe('a downgrade', () => {
  beforeEach(async () => {
    await resetDatabase();
    aiEnv.ANTHROPIC_API_KEY = 'sk-test';
    claude();
  });
  afterEach(() => {
    delete aiEnv.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('counts from the next request', async () => {
    const who = await account('free', 'cookie');
    expect((await deliver(subscription(who.id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    expect((await send(who, 'GET', '/api/roadmap/next')).status).toBe(200);
    expect((await deliver(subscription(who.id, 'canceled', '2026-11-06T11:00:00Z'))).status).toBe(200);
    await planRequired(await send(who, 'GET', '/api/roadmap/next'), 'ai_roadmap');
    // Design partner is on every plan: what is left of the credits decides.
    expect((await send(who, 'POST', '/api/partner/sessions', { context: { kind: 'editor' } })).status).toBe(201);
  });

  it('a Polar cancel does not end a comp, and the comp keeps Pro after it', async () => {
    const who = await account('comp', 'cookie');
    expect((await deliver(subscription(who.id, 'active', '2026-11-06T10:00:00Z'))).status).toBe(200);
    expect((await deliver(subscription(who.id, 'canceled', '2026-11-06T11:00:00Z'))).status).toBe(200);
    const row = await env.DB.prepare('SELECT plan, comp_until FROM users WHERE id = ?').bind(who.id).first<{ plan: string; comp_until: number }>();
    expect(row!.plan).toBe('free');
    expect(row!.comp_until).toBeGreaterThan(Date.now() / 1000);
    expect((await send(who, 'GET', '/api/roadmap/next')).status).toBe(200);
  });

  it('nothing a client sends sets the plan: only the signed webhook does', async () => {
    const who = await account('free', 'cookie');
    expect((await send(who, 'PATCH', '/api/me', { plan: 'pro', compUntil: 4_000_000_000, comp_until: 4_000_000_000, displayName: 'Ada' })).status).toBe(200);
    expect((await call('/api/billing/webhook', { method: 'POST', body: subscription(who.id, 'active', '2026-11-06T10:00:00Z') })).status).toBe(403);
    expect(await env.DB.prepare('SELECT plan, comp_until FROM users WHERE id = ?').bind(who.id).first()).toEqual({ plan: 'free', comp_until: null });
    await planRequired(await send(who, 'GET', '/api/roadmap/next'), 'ai_roadmap');
  });
});
