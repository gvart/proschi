import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { challengeDay } from '../../frontend/src/learn/challenge';
import { emptyMeta, type Meta } from '../../frontend/src/game/engine/meta';
import { Game } from '../../frontend/src/game/engine/run';
import type { Action, RunSetup } from '../../frontend/src/game/engine/types';
import { ABANDONED_RUN_SECONDS, pruneAbandonedGameRuns } from '../src/cron';
import { gameContent } from '../src/game';
import worker from '../src/index';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * Scale or Fail on the server: runs are started by the server, replayed from
 * their actions, and only then scored. Runs here are played with the same
 * engine, keeping the start board and skipping every choice until the run
 * is lost.
 */

function play(setup: RunSetup, tamper?: (actions: Action[]) => Action[]): { actions: Action[]; score: number } {
  const game = new Game(gameContent(), setup);
  const s = game.state;
  for (let guard = 0; s.phase !== 'over' && guard < 1000; guard++) {
    if (s.phase === 'plan') game.apply({ t: 'deploy', board: s.board });
    else if (s.phase === 'run') game.advance();
    else if (s.phase === 'draft') game.apply({ t: 'pick', card: null });
    else if (s.phase === 'contract') game.apply({ t: 'contract', pick: null });
    else if (s.phase === 'cleared') game.apply({ t: 'retire' });
  }
  const actions = tamper ? tamper(s.log) : s.log;
  return { actions, score: s.score };
}

async function start(token: string, body: unknown) {
  const response = await call('/api/game/runs', { method: 'POST', token, body });
  return { response, body: (await response.json()) as { runId: string; setup: RunSetup; error?: string } };
}

/** Moves a run's start back, as if it had been played for that long. */
const age = (runId: string, seconds = 3600) => env.DB.prepare('UPDATE game_runs SET started_at = started_at - ? WHERE id = ?').bind(seconds, runId).run();

const submit = (token: string, runId: string, actions: Action[]) => call(`/api/game/runs/${runId}/submit`, { method: 'POST', token, body: { actions } });

const setMeta = (userId: string, meta: Partial<Meta>) =>
  env.DB.prepare('INSERT OR REPLACE INTO game_meta (user_id, meta, updated_at) VALUES (?, ?, 0)').bind(userId, JSON.stringify({ ...emptyMeta(), ...meta })).run();

describe('game runs', () => {
  beforeEach(resetDatabase);

  it('needs a session', async () => {
    expect((await call('/api/game/runs', { method: 'POST', body: { scenario: 'shortly' } })).status).toBe(401);
    expect((await call('/api/game/me')).status).toBe(401);
  });

  it('starts a run with a seed and loadout the server picks', async () => {
    const user = await signedInUser();
    await setMeta(user.id, { unlocked: ['cache'], perks: { 'seed-round': 1 }, equipped: ['seed-round'] });
    const { response, body } = await start(user.token, { scenario: 'shortly' });
    expect(response.status).toBe(200);
    expect(body.setup).toMatchObject({ scenario: 'shortly', ascension: 0, mode: 'normal', loadout: { unlocked: ['cache'], perks: { 'seed-round': 1 } } });
    expect(body.setup.seed).toMatch(/^[0-9a-f]{16}$/);
    const again = await start(user.token, { scenario: 'shortly' });
    expect(again.body.setup.seed).not.toBe(body.setup.seed);
  });

  it('keeps locked scenarios and ascensions closed', async () => {
    const user = await signedInUser();
    expect((await start(user.token, { scenario: 'snapshots' })).response.status).toBe(403);
    expect((await start(user.token, { scenario: 'shortly', ascension: 1 })).response.status).toBe(403);
    expect((await start(user.token, { scenario: 'nope' })).response.status).toBe(400);
    await setMeta(user.id, { scenarios: { shortly: { reached: 12, cleared: 0 } } });
    expect((await start(user.token, { scenario: 'snapshots' })).response.status).toBe(200);
    expect((await start(user.token, { scenario: 'shortly', ascension: 1 })).response.status).toBe(200);
    expect((await start(user.token, { scenario: 'shortly', ascension: 2 })).response.status).toBe(403);
  });

  it('replays a submitted run, keeps its score once and banks the Blueprints', async () => {
    const user = await signedInUser();
    const { body } = await start(user.token, { scenario: 'shortly' });
    const { actions, score } = play(body.setup);
    expect((await submit(user.token, body.runId, actions)).status).toBe(400); // too fast
    await age(body.runId);
    const response = await submit(user.token, body.runId, actions);
    expect(response.status).toBe(200);
    const result = (await response.json()) as { score: number; outcome: string; blueprints: number; meta: Meta; rank: number; players: number };
    expect(result.score).toBe(score);
    expect(result.outcome).toBe('churned');
    expect(result.blueprints).toBeGreaterThan(0);
    expect(result.meta.blueprints).toBe(result.blueprints);
    expect(result.meta.scenarios.shortly.reached).toBeGreaterThan(0);
    expect(result).toMatchObject({ rank: 1, players: 1 });
    expect((await submit(user.token, body.runId, actions)).status).toBe(409);
    const me = (await (await call('/api/game/me', { token: user.token })).json()) as { meta: Meta; best: Record<string, number> };
    expect(me.meta.blueprints).toBe(result.blueprints);
    expect(Object.values(me.best)).toEqual([score]);
  });

  it('refuses actions that do not replay, and runs that are not over', async () => {
    const user = await signedInUser();
    const { body } = await start(user.token, { scenario: 'shortly' });
    await age(body.runId);
    const { actions } = play(body.setup);
    const cheat = actions.map((a) => (a.t === 'deploy' ? { ...a, board: { ...a.board, nodes: [...a.board.nodes, { id: 'cdn', component: 'cdn', replicas: 9 }] } } : a));
    const refused = await submit(user.token, body.runId, cheat);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(/does not replay: CDN is not unlocked/);
    expect((await submit(user.token, body.runId, actions.slice(0, 3))).status).toBe(400);
    expect((await submit(user.token, body.runId, [])).status).toBe(400);
    const other = await signedInUser();
    expect((await submit(other.token, body.runId, actions)).status).toBe(404);
  });
});

describe('the daily run', () => {
  beforeEach(resetDatabase);

  it('is the same scenario and seed for everyone, once a day', async () => {
    const a = await signedInUser('alice', true);
    const b = await signedInUser('bob');
    const first = await start(a.token, { mode: 'daily' });
    expect(first.response.status).toBe(200);
    expect(first.body.setup.seed).toBe(`daily:${challengeDay()}`);
    expect((await start(a.token, { mode: 'daily' })).body.runId).toBe(first.body.runId);
    const theirs = await start(b.token, { mode: 'daily' });
    expect(theirs.body.setup.seed).toBe(first.body.setup.seed);
    expect(theirs.body.setup.scenario).toBe(first.body.setup.scenario);

    await age(first.body.runId);
    await age(theirs.body.runId);
    const mine = play(first.body.setup);
    expect((await submit(a.token, first.body.runId, mine.actions)).status).toBe(200);
    expect((await submit(b.token, theirs.body.runId, play(theirs.body.setup).actions)).status).toBe(200);
    expect((await start(a.token, { mode: 'daily' })).response.status).toBe(409);

    const board = (await (await call(`/api/game/leaderboard?day=${challengeDay()}`, { token: b.token })).json()) as {
      players: number;
      entries: { displayName: string; score: number }[];
      you: { rank: number } | null;
    };
    expect(board.players).toBe(2);
    expect(board.entries).toEqual([expect.objectContaining({ displayName: 'alice', score: mine.score })]);
    expect(board.you?.rank).toBe(1);
  });
});

describe('progress', () => {
  beforeEach(resetDatabase);

  it('buys unlocks and equips perks with Blueprints the server counted', async () => {
    const user = await signedInUser();
    const buy = (id: string) => call('/api/game/buy', { method: 'POST', token: user.token, body: { id } });
    expect((await buy('cache')).status).toBe(400);
    await setMeta(user.id, { blueprints: 20 });
    const bought = await buy('cache');
    expect(bought.status).toBe(200);
    expect(((await bought.json()) as { meta: Meta }).meta).toMatchObject({ blueprints: 15, unlocked: ['cache'] });
    expect((await buy('seed-round')).status).toBe(200);
    const equip = await call('/api/game/equip', { method: 'POST', token: user.token, body: { perks: ['seed-round'] } });
    expect(((await equip.json()) as { meta: Meta }).meta.equipped).toEqual(['seed-round']);
    expect((await call('/api/game/equip', { method: 'POST', token: user.token, body: { perks: ['free-reroll'] } })).status).toBe(400);
  });

  it('imports runs played signed out once each, and only what progress allowed', async () => {
    const user = await signedInUser();
    const setup: RunSetup = { scenario: 'shortly', seed: 'guest-1', ascension: 0, mode: 'normal', loadout: { unlocked: [], perks: {} } };
    const run = { t: 'run', setup, actions: play(setup).actions };
    const sync = (events: unknown[]) => call('/api/game/sync', { method: 'POST', token: user.token, body: { events } });
    const first = (await (await sync([run])).json()) as { meta: Meta; applied: number };
    expect(first.applied).toBe(1);
    expect(first.meta.blueprints).toBeGreaterThan(0);
    const again = (await (await sync([run])).json()) as { meta: Meta; applied: number };
    expect(again.meta.blueprints).toBe(first.meta.blueprints);

    const cheat = { t: 'run', setup: { ...setup, seed: 'guest-2', loadout: { unlocked: ['autoscaler'], perks: {} } }, actions: [] };
    const refused = (await (await sync([cheat])).json()) as { applied: number; error: string };
    expect(refused).toMatchObject({ applied: 0, error: "'autoscaler' is not unlocked" });

    const board = (await (await call('/api/game/leaderboard?scenario=shortly&ascension=0')).json()) as { players: number };
    expect(board.players).toBe(0);
  });

  it('is in the export', async () => {
    const user = await signedInUser();
    await setMeta(user.id, { blueprints: 7 });
    const data = (await (await call('/api/me/export', { token: user.token })).json()) as { game: { meta: Meta } };
    expect(data.game.meta.blueprints).toBe(7);
  });
});

describe('the daily cron', () => {
  beforeEach(resetDatabase);

  const runIds = async (userId: string) =>
    (await env.DB.prepare('SELECT id FROM game_runs WHERE user_id = ?').bind(userId).all<{ id: string }>()).results.map((r) => r.id).sort();

  it('prunes runs started over a week ago and never submitted', async () => {
    const user = await signedInUser();
    const fresh = (await start(user.token, { scenario: 'shortly' })).body.runId;
    const recent = (await start(user.token, { scenario: 'shortly' })).body.runId;
    const abandoned = (await start(user.token, { scenario: 'shortly' })).body.runId;
    const daily = (await start(user.token, { mode: 'daily' })).body.runId;
    const played = (await start(user.token, { scenario: 'shortly' })).body;
    await age(played.runId);
    expect((await submit(user.token, played.runId, play(played.setup).actions)).status).toBe(200);
    await age(recent, 6 * 86_400);
    await age(abandoned, ABANDONED_RUN_SECONDS + 60);
    await age(daily, ABANDONED_RUN_SECONDS + 60);
    await age(played.runId, 30 * 86_400);
    expect((await runIds(user.id)).length).toBe(5);

    await worker.scheduled(createScheduledController({ cron: '17 3 * * *' }), env);
    expect(await runIds(user.id)).toEqual([fresh, recent, played.runId].sort());
    expect(await pruneAbandonedGameRuns(env)).toBe(0);
  });
});
