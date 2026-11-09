import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogSolved, problemIds } from '../src/verify';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * T6+T7 (docs/design/paid-plans.md P56): the progress export (Pro), the
 * mastery certificate (Max, src/certificates.ts) and embeds without
 * Proschi's branding (Pro).
 */

const SOURCE = 'service SecretDesign { replicas: 3 }';
const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();

async function solver(name = 'Ada <Lovelace>') {
  const user = await signedInUser(name);
  const t = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms)
       VALUES (?, 'url-shortener', 2, ?, ?, ?, ?, 2, 12.5, 80)`,
    ).bind(user.id, SOURCE, t, t, t),
    env.DB.prepare(
      `INSERT INTO card_state (user_id, card_id, card_version, due_at, stability, difficulty, reps, lapses, last_review_at) VALUES (?, 'cache-aside', 1, ?, 30, 5, 3, 0, ?)`,
    ).bind(user.id, t + 86_400, t),
  ]);
  return user;
}

const meta = (html: string, attr: string, name: string) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1];

describe('progress export', () => {
  beforeEach(resetDatabase);

  it('is Pro: 401 signed out, 402 on Free, and the full export stays open to every plan', async () => {
    expect((await call('/api/me/export?view=progress')).status).toBe(401);
    const { token } = await solver();
    const refused = await call('/api/me/export?view=progress', { token });
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: 'plan_required', feature: 'data_export' });
    expect((await call('/api/me/export', { token })).status).toBe(200);
  });

  it('answers the learning data on Pro: level, mastery, streaks, problems, interviews and cards, nothing private', async () => {
    const { id, token } = await solver();
    await setPlan(id, 'pro');
    await env.DB.prepare(
      `INSERT INTO solo_interviews (user_id, problem_id, started_at, duration_min, total_ms, reached_design, drew, solved, received_at) VALUES (?, 'url-shortener', ?, 45, 1800000, 1, 1, 1, 1)`,
    )
      .bind(id, Date.parse('2026-10-01T10:00:00Z'))
      .run();
    const response = await call('/api/me/export?view=progress', { token });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('proschi-progress.json');
    const text = await response.text();
    expect(text).not.toContain('SecretDesign');
    const body = JSON.parse(text) as Record<string, any>;
    expect(body.level.level).toBeGreaterThanOrEqual(2);
    expect(body.mastery.length).toBeGreaterThan(0);
    expect(body.mastery[0]).toEqual({ topic: expect.any(String), title: expect.any(String), mastery: expect.any(Number) });
    const solved = body.problems.find((p: { problemId: string }) => p.problemId === 'url-shortener');
    expect(solved).toMatchObject({ title: 'URL Shortener', solved: true, runs: 2, runsToSolve: 2, bestCostUsd: 12.5, bestP99Ms: 80 });
    expect(solved.solvedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(body.problems.find((p: { solved: boolean }) => !p.solved)).toMatchObject({ runs: 0, solvedAt: null });
    expect(body.soloInterviews).toEqual([
      { problemId: 'url-shortener', startedAt: '2026-10-01T10:00:00.000Z', minutes: 45, totalMinutes: 30, reachedDesign: true, drew: true, solved: true },
    ]);
    expect(body.cards).toEqual([expect.objectContaining({ cardId: 'cache-aside', reps: 3, stabilityDays: 30 })]);
    expect(body.interviews).toEqual([]);
    expect(body.streak).toEqual({ current: expect.any(Number), longest: expect.any(Number) });
  });
});

describe('mastery certificate', () => {
  beforeEach(resetDatabase);

  const turn = (token: string, on: boolean) => call('/api/me/certificate', { method: 'PUT', token, body: { public: on } });

  it('is Max to turn on; off is open to every plan', async () => {
    const { id, token } = await solver();
    expect((await call('/api/me/certificate', { token })).status).toBe(200);
    expect(await (await call('/api/me/certificate', { token })).json()).toEqual({ certificate: null });
    await setPlan(id, 'pro');
    const refused = await turn(token, true);
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ feature: 'certificate' });
    expect((await turn(token, false)).status).toBe(200);
    expect((await call('/api/me/certificate', { method: 'PUT', token, body: { public: 'yes' } })).status).toBe(400);
  });

  it('keeps one id across off and on, and is public only while on and on Max', async () => {
    const { id, token } = await solver();
    await setPlan(id, 'max');
    const on = (await (await turn(token, true)).json()) as { certificate: { id: string; public: boolean; issuedAt: number } };
    expect(on.certificate).toEqual({ id: expect.stringMatching(/^[\w-]{12}$/), public: true, issuedAt: expect.any(Number) });
    const certId = on.certificate.id;

    const read = await call(`/api/certificates/${certId}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('Cache-Control')).toBe('no-store');
    const cert = (await read.json()) as Record<string, any>;
    expect(cert).toMatchObject({ id: certId, displayName: 'Ada <Lovelace>', issuedAt: on.certificate.issuedAt, solved: [{ id: 'url-shortener', title: 'URL Shortener' }] });
    expect(cert.level).toBeGreaterThanOrEqual(2);
    expect(cert.skills.length).toBeGreaterThan(0);
    // Strongest first.
    expect(cert.skills.map((s: { mastery: number }) => s.mastery)).toEqual([...cert.skills.map((s: { mastery: number }) => s.mastery)].sort((a, b) => b - a));
    expect(JSON.stringify(cert)).not.toContain(id);

    await turn(token, false);
    expect((await call(`/api/certificates/${certId}`)).status).toBe(404);
    expect((await call(`/c/${certId}`)).status).toBe(404);
    const again = (await (await turn(token, true)).json()) as { certificate: { id: string; issuedAt: number } };
    expect(again.certificate).toMatchObject({ id: certId, issuedAt: on.certificate.issuedAt });

    // A plan without it hides it, and Max again shows the same address.
    await setPlan(id, 'pro');
    expect((await call(`/api/certificates/${certId}`)).status).toBe(404);
    await setPlan(id, 'max');
    expect((await call(`/api/certificates/${certId}`)).status).toBe(200);
    expect((await call('/api/certificates/not-an-id')).status).toBe(404);
    expect((await call('/api/certificates/AAAAAAAAAAAA')).status).toBe(404);
  });

  it('serves its page with meta tags and its Open Graph card', async () => {
    const { id, token } = await solver();
    await setPlan(id, 'max');
    const certId = ((await (await turn(token, true)).json()) as { certificate: { id: string } }).certificate.id;
    const page = await call(`/c/${certId}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    const html = await page.text();
    expect(html).toContain('<title>Ada &lt;Lovelace&gt;: Proschi mastery certificate</title>');
    expect(meta(html, 'property', 'og:description')).toMatch(/^Level \d+ · 1 of \d+ system design problems solved/);
    expect(meta(html, 'property', 'og:image')).toMatch(new RegExp(`^https://proschi.test/c/${certId}\\.png\\?v=[\\w-]{16}$`));
    expect(html).toContain(`href="/practice/#/c/${certId}"`);
    expect(html).not.toContain('SecretDesign');

    const image = await call(`/c/${certId}.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('Content-Type')).toBe('image/png');
    const bytes = new Uint8Array(await image.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect((await call(`/c/${certId}`, { method: 'POST' })).status).toBe(404);
  }, 30_000);

  it('is in the full export', async () => {
    const { id, token } = await solver();
    await setPlan(id, 'max');
    await turn(token, true);
    const data = (await (await call('/api/me/export', { token })).json()) as Record<string, any>;
    expect(data.certificate).toMatchObject({ public: true });
    expect(data.embedBranding).toBe(true);
  });
});

describe('problems solved, counted one way', () => {
  beforeEach(resetDatabase);

  it('catalogSolved: the published catalog in its order, without problems no longer in it', () => {
    const [first, second] = problemIds();
    expect(catalogSolved([second, 'retired-problem', first])).toEqual({
      total: problemIds().length,
      solved: [expect.objectContaining({ id: first }), expect.objectContaining({ id: second })],
    });
    expect(catalogSolved([]).solved).toEqual([]);
  });

  it('the certificate, its card and the progress export agree on N of M', async () => {
    const { id, token } = await solver();
    const t = Math.floor(Date.now() / 1000);
    // A solve on a problem since removed from the catalog counts nowhere.
    await env.DB.prepare(`INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at) VALUES (?, 'retired-problem', 1, ?, ?, ?, ?)`)
      .bind(id, SOURCE, t, t, t)
      .run();
    await setPlan(id, 'max');
    const certId = ((await (await call('/api/me/certificate', { method: 'PUT', token, body: { public: true } })).json()) as { certificate: { id: string } }).certificate.id;
    const cert = (await (await call(`/api/certificates/${certId}`)).json()) as { problems: number; solved: unknown[] };
    const data = (await (await call('/api/me/export?view=progress', { token })).json()) as { problemsSolved: number; problemsTotal: number };
    const total = problemIds().length;
    expect([cert.solved.length, cert.problems]).toEqual([1, total]);
    expect([data.problemsSolved, data.problemsTotal]).toEqual([1, total]);
    const html = await (await call(`/c/${certId}`)).text();
    expect(meta(html, 'property', 'og:description')).toMatch(new RegExp(`^Level \\d+ · 1 of ${total} system design problems solved`));
  });
});

describe('embeds without branding', () => {
  beforeEach(resetDatabase);

  it('is Pro to hide, and the short link says so only while the plan has it', async () => {
    const { id, token } = await signedInUser();
    const created = (await (await call('/api/shares', { method: 'POST', token, body: { source: 'diagram "Shop"\nservice API' } })).json()) as { id: string };
    const share = async () => (await (await call(`/api/shares/${created.id}`)).json()) as Record<string, unknown>;
    expect(await (await call('/api/me/embeds', { token })).json()).toEqual({ branding: true });
    const refused = await call('/api/me/embeds', { method: 'PUT', token, body: { branding: false } });
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ feature: 'pro_exports' });
    expect('branding' in (await share())).toBe(false);

    await setPlan(id, 'pro');
    expect((await call('/api/me/embeds', { method: 'PUT', token, body: { branding: false } })).status).toBe(200);
    expect(await (await call('/api/me/embeds', { token })).json()).toEqual({ branding: false });
    expect((await share()).branding).toBe(false);

    // Back on Free, the embed shows the branding again; showing it is open to every plan.
    await setPlan(id, 'free');
    expect('branding' in (await share())).toBe(false);
    expect((await call('/api/me/embeds', { method: 'PUT', token, body: { branding: true } })).status).toBe(200);
  });
});
