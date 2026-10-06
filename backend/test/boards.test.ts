import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { findProblem, verify } from '../src/verify';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * Per-problem leaderboards (GET /api/problems/<id>/leaderboard): the
 * cheapest and the fastest passing designs, from the server's own run of the
 * tests, of the users who opted in.
 */

const ID = 'url-shortener';
const problem = findProblem(ID)!;
/** A passing design dearer than the reference: more app servers. */
const dearer = problem.solution.replace('x12', 'x16');

interface Board {
  problem: string;
  metric: 'cost' | 'p99';
  players: number;
  entries: { rank: number; id: string; displayName: string; value: number; at: number }[];
  you?: { rank: number; value: number; players: number } | null;
}

const run = (token: string, source: string, solved = true) => call(`/api/problems/${ID}/runs`, { method: 'POST', token, body: { source, solved } });
async function board(metric?: string, token?: string, id = ID): Promise<Board> {
  const response = await call(`/api/problems/${id}/leaderboard${metric ? `?metric=${metric}` : ''}`, { token });
  expect(response.status).toBe(200);
  return (await response.json()) as Board;
}

describe('per-problem leaderboards', () => {
  beforeEach(resetDatabase);

  it('checks the problem and the metric', async () => {
    expect((await call('/api/problems/nope/leaderboard?metric=cost')).status).toBe(404);
    expect((await call(`/api/problems/${ID}/leaderboard?metric=fun`)).status).toBe(400);
    expect(await board()).toEqual({ problem: ID, metric: 'cost', players: 0, entries: [] });
  });

  it('ranks the cheapest passing designs of users who opted in, and counts everyone', async () => {
    const cheap = verify(problem, problem.solution);
    const dear = verify(problem, dearer);
    expect(cheap.solved && dear.solved).toBe(true);
    expect(dear.costUsd!).toBeGreaterThan(cheap.costUsd!);

    const alice = await signedInUser('alice', true);
    const bob = await signedInUser('bob', true);
    const hidden = await signedInUser('hidden', false);
    await run(alice.token, dearer);
    await run(bob.token, problem.solution);
    await run(hidden.token, problem.solution);
    // Reached a second apart, whatever the clock did between the requests.
    await env.DB.prepare('UPDATE progress SET best_cost_at = best_cost_at + 10 WHERE user_id = ?').bind(hidden.id).run();

    const cost = await board('cost', alice.token);
    expect(cost.players).toBe(3);
    // Bob and the hidden user tie on cost: Bob reached it first. The hidden user is ranked but not listed.
    expect(cost.entries.map((e) => [e.displayName, e.rank, e.value])).toEqual([
      ['bob', 1, cheap.costUsd],
      ['alice', 3, dear.costUsd],
    ]);
    expect(cost.entries[0].id).toBe(bob.id);
    expect(cost.you).toEqual({ rank: 3, value: dear.costUsd, players: 3 });
    expect((await board('cost', hidden.token)).you).toMatchObject({ rank: 2 });
    // Signed out: no `you`.
    expect(await board('cost')).not.toHaveProperty('you');

    const p99 = await board('p99');
    expect(p99.metric).toBe('p99');
    expect(p99.players).toBe(3);
    expect(p99.entries.every((e) => typeof e.value === 'number')).toBe(true);
  });

  it('only counts designs the server verified, never a claimed solve', async () => {
    const mallory = await signedInUser('mallory', true);
    // The page claims a solve of the starter; the server's run of the tests disagrees.
    await run(mallory.token, problem.starter, true);
    await call(`/api/problems/${ID}/runs`, { method: 'POST', token: mallory.token, body: { source: problem.starter, solved: true, costUsd: 0.01, p99Ms: 1 } });
    expect((await board('cost', mallory.token)).players).toBe(0);
    expect((await board('cost', mallory.token)).you).toBeNull();
  });

  it('keeps each user’s best: a cheaper design later replaces it, a dearer one does not', async () => {
    const carol = await signedInUser('carol', true);
    const dave = await signedInUser('dave', true);
    await run(carol.token, dearer);
    await run(dave.token, problem.solution);
    await env.DB.prepare('UPDATE progress SET best_cost_at = best_cost_at - 10 WHERE user_id = ?').bind(dave.id).run();
    expect((await board('cost', carol.token)).you).toMatchObject({ rank: 2 });

    // Carol improves on hers after solving: she ties Dave's cost, and Dave got there first.
    await run(carol.token, problem.solution);
    const after = await board('cost', carol.token);
    expect(after.you).toEqual({ rank: 2, value: verify(problem, problem.solution).costUsd, players: 2 });
    // A dearer design afterwards keeps her best, and when she reached it.
    const before = (await env.DB.prepare('SELECT best_cost_usd, best_cost_at FROM progress WHERE user_id = ?').bind(carol.id).first()) as Record<string, number>;
    await run(carol.token, dearer);
    const kept = (await env.DB.prepare('SELECT best_cost_usd, best_cost_at FROM progress WHERE user_id = ?').bind(carol.id).first()) as Record<string, number>;
    expect(kept).toEqual(before);
  });

  it('breaks ties by who reached the value first, and falls back to the first solve for older rows', async () => {
    const erin = await signedInUser('erin', true);
    const frank = await signedInUser('frank', true);
    await run(erin.token, problem.solution);
    await run(frank.token, problem.solution);
    // Frank's best predates the column (NULL): his first solve, earlier than Erin's, decides.
    await env.DB.prepare('UPDATE progress SET best_cost_at = NULL, solved_at = 100 WHERE user_id = ?').bind(frank.id).run();
    const cost = await board('cost', erin.token);
    expect(cost.entries.map((e) => e.displayName)).toEqual(['frank', 'erin']);
    expect(cost.you).toMatchObject({ rank: 2 });
  });

  it('leaves out progress on an older problem or simulation version', async () => {
    const gina = await signedInUser('gina', true);
    await run(gina.token, problem.solution);
    await env.DB.prepare('UPDATE progress SET sim_version = sim_version - 1 WHERE user_id = ?').bind(gina.id).run();
    expect(await board('cost', gina.token)).toMatchObject({ players: 0, entries: [], you: null });
  });
});
