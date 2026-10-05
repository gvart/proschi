import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findProblem } from '../src/verify';
import { cacheKey, clearStatsCache } from '../src/stats';
import { call, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

const ID = 'url-shortener';
const problem = findProblem(ID)!;

function run(token: string, body: Record<string, unknown>, id = ID) {
  return call(`/api/problems/${id}/runs`, { method: 'POST', token, body });
}

async function stats(path: string, token?: string) {
  await clearStatsCache();
  return (await (await call(path, { token })).json()) as Record<string, any>;
}

describe('progress', () => {
  beforeEach(resetDatabase);

  it('needs a session', async () => {
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', { token: 'nope' })).status).toBe(401);
    expect((await call('/api/nothing')).status).toBe(404);
    expect((await run('nope', { source: '', solved: false })).status).toBe(401);
  });

  it('counts runs, and records a solve only when the server confirms it', async () => {
    const { token } = await signedInUser();
    expect(await (await run(token, { source: problem.starter, solved: false })).json()).toMatchObject({ progress: { status: 'attempted', runs: 1 } });

    // The page claims a solve the server does not confirm.
    const fake = await (await run(token, { source: problem.starter, solved: true })).json();
    expect(fake).toMatchObject({ progress: { status: 'attempted', runs: 2 }, verdict: { solved: false } });

    const real = (await (await run(token, { source: problem.solution, solved: true })).json()) as Record<string, any>;
    expect(real).toMatchObject({ progress: { status: 'solved', runs: 3, runsToSolve: 3 }, verdict: { solved: true } });
    expect(real.progress.bestCostUsd).toBe(real.verdict.costUsd);
    expect(real.progress.bestP99Ms).toBe(real.verdict.p99Ms);

    // Later runs keep the solve and the first runs-to-solve, and store the latest design.
    const later = await (await run(token, { source: problem.starter, solved: false })).json();
    expect(later).toMatchObject({ progress: { status: 'solved', runs: 4, runsToSolve: 3, source: problem.starter } });

    const me = (await (await call('/api/me', { token })).json()) as Record<string, any>;
    expect(me.progress[ID]).toMatchObject({ status: 'solved', runs: 4, runsToSolve: 3, source: problem.starter });
  });

  it('keeps the cheapest and the fastest solving designs', async () => {
    const { token } = await signedInUser();
    const first = (await (await run(token, { source: problem.solution, solved: true })).json()) as Record<string, any>;
    // More replicas: still solves, costs more.
    const pricier = problem.solution.replace(/x(\d+)/, (_, n) => `x${Number(n) + 5}`);
    const second = (await (await run(token, { source: pricier, solved: true })).json()) as Record<string, any>;
    expect(second.verdict.solved).toBe(true);
    expect(second.verdict.costUsd).toBeGreaterThan(first.verdict.costUsd);
    expect(second.progress.bestCostUsd).toBe(first.verdict.costUsd);
    expect(second.progress.bestP99Ms).toBe(Math.min(first.verdict.p99Ms, second.verdict.p99Ms));
  });

  it('imports browser progress without counting runs or overwriting a stored design', async () => {
    const { token } = await signedInUser();
    const imported = await (await run(token, { source: problem.solution, solved: true, imported: true })).json();
    expect(imported).toMatchObject({ progress: { status: 'solved', runs: 1 } });
    expect((imported as any).progress.runsToSolve).toBeUndefined();

    await run(token, { source: 'mine', solved: false }, 'chat');
    const again = await (await run(token, { source: 'from the browser', solved: false, imported: true }, 'chat')).json();
    expect(again).toMatchObject({ progress: { runs: 1, source: 'mine' } });
  });

  it('validates the run', async () => {
    const { token } = await signedInUser();
    expect((await run(token, { source: 'x', solved: false }, 'no-such-problem')).status).toBe(404);
    expect((await run(token, { solved: false })).status).toBe(400);
    expect((await run(token, { source: 'x' })).status).toBe(400);
    expect((await run(token, { source: 'x'.repeat(70_000), solved: false })).status).toBe(413);
    const notJson = await call(`/api/problems/${ID}/runs`, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: undefined });
    expect(notJson.status).toBe(400);
  });

  it('limits test runs per user', async () => {
    const { token } = await signedInUser();
    await withinOneWindow();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await run(token, { source: 'x', solved: false })).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    const other = await signedInUser();
    expect((await run(other.token, { source: 'x', solved: false })).status).toBe(200);
  }, WINDOW_TIMEOUT);

  it('renames, opts in to the leaderboard, and deletes the account with its progress', async () => {
    const { id, token } = await signedInUser();
    await run(token, { source: problem.solution, solved: true });
    const patched = await (await call('/api/me', { method: 'PATCH', token, body: { displayName: '  Ada  ', publicProfile: true } })).json();
    expect(patched).toEqual({ user: { id, displayName: 'Ada', publicProfile: true, dailyGoal: 10 } });
    expect((await call('/api/me', { method: 'PATCH', token, body: { displayName: ' ' } })).status).toBe(400);
    expect((await call('/api/me', { method: 'PATCH', token, body: { publicProfile: 'yes' } })).status).toBe(400);

    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect((await call('/api/me', { token })).status).toBe(401);
    for (const table of ['users', 'identities', 'sessions', 'progress']) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n, table).toBe(0);
    }
  });
});

describe('stats', () => {
  beforeEach(resetDatabase);

  it('summarises every problem: attempted, solved, median runs to solve', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const c = await signedInUser();
    await run(a.token, { source: problem.solution, solved: true }); // 1 run
    for (let i = 0; i < 3; i++) await run(b.token, { source: problem.starter, solved: false });
    await run(b.token, { source: problem.solution, solved: true }); // 4 runs
    await run(c.token, { source: problem.starter, solved: false });

    const body = await stats('/api/stats');
    expect(body.solvers).toBe(2);
    expect(body.problems[ID]).toEqual({ attempted: 3, solved: 2, medianRunsToSolve: 2.5 });
    expect(body.problems.chat).toEqual({ attempted: 0, solved: 0, medianRunsToSolve: null });
  });

  it('gives a problem’s cost and p99 spread, and where your design falls in it', async () => {
    const cheap = await signedInUser();
    const pricey = await signedInUser();
    await run(cheap.token, { source: problem.solution, solved: true });
    await run(pricey.token, { source: problem.solution.replace(/x(\d+)/, (_, n) => `x${Number(n) + 5}`), solved: true });

    const anonymous = await stats(`/api/stats/${ID}`);
    expect(anonymous).toMatchObject({ attempted: 2, solved: 2, medianRunsToSolve: 1 });
    expect(anonymous.costUsd.count).toBe(2);
    expect(anonymous.costUsd.min).toBeLessThan(anonymous.costUsd.max);
    expect(anonymous.you).toBeUndefined();

    expect((await stats(`/api/stats/${ID}`, cheap.token)).you).toMatchObject({ cheaperThan: 1, runsToSolve: 1 });
    expect((await stats(`/api/stats/${ID}`, pricey.token)).you).toMatchObject({ cheaperThan: 0 });
    const nobody = await signedInUser();
    expect((await stats(`/api/stats/${ID}`, nobody.token)).you).toBeNull();
    expect((await call('/api/stats/no-such-problem')).status).toBe(404);
  });

  it('answers signed-in users from the shared cache, with where their latest design falls in it', async () => {
    const other = await signedInUser();
    await run(other.token, { source: problem.solution, solved: true });
    const me = await signedInUser();
    expect(await stats(`/api/stats/${ID}`)).toMatchObject({ solved: 1 });
    await vi.waitFor(async () => expect(await caches.default.match(cacheKey(`problem/${ID}`))).toBeDefined());
    await run(me.token, { source: problem.solution, solved: true });
    // No clearStatsCache: both answers come from the cached distribution, which predates my solve.
    const anonymous = (await (await call(`/api/stats/${ID}`)).json()) as Record<string, any>;
    const signedIn = (await (await call(`/api/stats/${ID}`, { token: me.token })).json()) as Record<string, any>;
    expect(anonymous.solved).toBe(1);
    expect(signedIn).toMatchObject({ solved: 1, costUsd: { count: 1 }, you: { cheaperThan: 0, runsToSolve: 1 } });
  });

  it('ranks only users who opted in, by problems solved, then who got there first', async () => {
    const first = await signedInUser('First', true);
    const second = await signedInUser('Second', true);
    const hidden = await signedInUser('Hidden', false);
    const chat = findProblem('chat')!;
    for (const u of [first, second, hidden]) await run(u.token, { source: problem.solution, solved: true });
    await run(hidden.token, { source: chat.solution, solved: true }, 'chat');
    await env.DB.prepare('UPDATE progress SET solved_at = solved_at + 10 WHERE user_id = ?').bind(second.id).run();

    const board = await stats('/api/leaderboard');
    expect(board.entries).toEqual([
      { rank: 1, id: first.id, displayName: 'First', solved: 1, lastSolvedAt: expect.any(Number) },
      { rank: 1, id: second.id, displayName: 'Second', solved: 1, lastSolvedAt: expect.any(Number) },
    ]);
    expect(board.problems).toBeGreaterThan(5);
  });
});
