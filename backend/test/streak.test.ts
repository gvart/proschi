import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { challengeDay, type ChallengeAnswer, type ChallengeCard } from '../../frontend/src/learn/challenge';
import { addDays, computeStreak, goalFor } from '../../frontend/src/learn/streak';
import { Game } from '../../frontend/src/game/engine/run';
import type { Action, RunSetup } from '../../frontend/src/game/engine/types';
import { findCard } from '../src/cards';
import { gameContent } from '../src/game';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * One daily streak for any daily practice: besides card reviews and solves,
 * a completed daily challenge and a finished (submitted, replayed) Scale or
 * Fail run each meet the daily goal, in GET /api/me/activity and in the
 * streak badges, by the local day the client sent.
 */

/** The tests' "local" date: the server's UTC date. */
const today = () => new Date().toISOString().slice(0, 10);
const activity = async (token: string, day = today()) => (await (await call(`/api/me/activity?day=${day}`, { token })).json()) as Record<string, any>;

function right(card: ChallengeCard): ChallengeAnswer {
  if (card.type === 'choice') return card.options.findIndex((o) => o.correct);
  if (card.type === 'estimate') return card.answer;
  return card.blanks.map((b) => b[0]);
}

async function playChallenge(token: string, extra: Record<string, unknown> = {}) {
  const { cardIds } = (await (await call('/api/challenge/today')).json()) as { cardIds: string[] };
  const answers = cardIds.map((id) => ({ cardId: id, answer: right(findCard(id) as ChallengeCard), ms: 2000 }));
  return call('/api/challenge/today/attempt', { method: 'POST', token, body: { answers, ...extra } });
}

/** Plays a run to its end with the start board, skipping every choice. */
function play(setup: RunSetup): Action[] {
  const game = new Game(gameContent(), setup);
  const s = game.state;
  for (let guard = 0; s.phase !== 'over' && guard < 1000; guard++) {
    if (s.phase === 'plan') game.apply({ t: 'deploy', board: s.board });
    else if (s.phase === 'run') game.advance();
    else if (s.phase === 'draft') game.apply({ t: 'pick', card: null });
    else if (s.phase === 'contract') game.apply({ t: 'contract', pick: null });
    else if (s.phase === 'cleared') game.apply({ t: 'retire' });
  }
  return s.log;
}

/** Starts a run; with `finish`, plays it and submits it (with `day`, the local date). */
async function gameRun(token: string, { finish = true, day }: { finish?: boolean; day?: string } = {}) {
  const started = (await (await call('/api/game/runs', { method: 'POST', token, body: { scenario: 'shortly' } })).json()) as { runId: string; setup: RunSetup };
  if (!finish) return started.runId;
  await env.DB.prepare('UPDATE game_runs SET started_at = started_at - 3600 WHERE id = ?').bind(started.runId).run();
  const response = await call(`/api/game/runs/${started.runId}/submit`, { method: 'POST', token, body: { actions: play(started.setup), ...(day ? { day } : {}) } });
  expect(response.status).toBe(200);
  return started.runId;
}

describe('the daily streak counts any daily practice', () => {
  beforeEach(resetDatabase);

  it('a completed daily challenge meets the goal, on the local day sent', async () => {
    const { token } = await signedInUser();
    const t = today();
    expect((await activity(token)).streak).toMatchObject({ current: 0, todayDone: false });
    const response = await playChallenge(token, { localDay: t });
    expect(response.status).toBe(200);
    const body = await activity(token);
    // The challenge's five answers are reviews too, but only through POST /api/cards/reviews: here only the challenge counts.
    expect(body.days).toEqual([{ day: t, reviews: 0, newCards: 0, solves: 0, challenges: 1 }]);
    expect(body.streak).toMatchObject({ current: 1, todayDone: true, todayProgress: 1 });
    expect(body.streak).toEqual(computeStreak(body.days, t, goalFor(10)));
    // Stored with the attempt, and in the export.
    const exported = (await (await call('/api/me/export', { token })).json()) as Record<string, any>;
    expect(exported.challengeAttempts[0]).toMatchObject({ day: challengeDay(), localDay: t });
  });

  it('takes a local day within a day of UTC, the UTC date otherwise, and refuses one that is not a date', async () => {
    const a = await signedInUser();
    const tomorrow = addDays(today(), 1);
    expect((await playChallenge(a.token, { localDay: tomorrow })).status).toBe(200);
    expect((await activity(a.token, tomorrow)).days.map((d: { day: string }) => d.day)).toEqual([tomorrow]);
    const b = await signedInUser();
    expect((await playChallenge(b.token, { localDay: '2020-01-01' })).status).toBe(200);
    expect((await activity(b.token)).days.map((d: { day: string }) => d.day)).toEqual([today()]);
    const c = await signedInUser();
    expect((await playChallenge(c.token, { localDay: 'today' })).status).toBe(400);
  });

  it('a challenge only started does not count', async () => {
    const { token } = await signedInUser();
    expect((await call('/api/challenge/today/start', { method: 'POST', token, body: {} })).status).toBe(200);
    expect((await activity(token)).days).toEqual([]);
  });

  it('counts challenges from before the local day was kept on their (UTC) day', async () => {
    const { id, token } = await signedInUser();
    const t = today();
    await env.DB.batch(
      [1, 2, 3].map((n) =>
        env.DB.prepare('INSERT INTO challenge_attempts (user_id, day, started_at, score, correct, perfect, total_ms, results, submitted_at) VALUES (?, ?, 0, 500, 5, 1, 1000, ?, 1)').bind(
          id,
          addDays(t, -n),
          '[]',
        ),
      ),
    );
    const body = await activity(token);
    expect(body.days.map((d: { day: string; challenges: number }) => [d.day, d.challenges])).toEqual([3, 2, 1].map((n) => [addDays(t, -n), 1]));
    // Yesterday counted, today is still open: the streak is alive.
    expect(body.streak).toMatchObject({ current: 3, longest: 3, todayDone: false });
  });

  it('a finished game run meets the goal; a run only started, or imported at sign-in, does not', async () => {
    const { id, token } = await signedInUser();
    const t = today();
    await gameRun(token, { finish: false });
    expect((await activity(token)).days).toEqual([]);
    await gameRun(token, { day: t });
    await gameRun(token, { day: t });
    const body = await activity(token);
    expect(body.days).toEqual([{ day: t, reviews: 0, newCards: 0, solves: 0, runs: 2 }]);
    expect(body.streak).toMatchObject({ current: 1, todayDone: true });
    // An imported run (played signed out) has no day the server saw.
    await env.DB.prepare(
      `INSERT INTO game_runs (id, user_id, mode, scenario, ascension, setup, versions, started_at, submitted_at, score, waves, outcome, cleared, blueprints, actions)
       VALUES (?, ?, 'import', 'shortly', 0, '{}', 'x', ?, ?, 1, 1, 'over', 0, 0, '[]')`,
    )
      .bind(crypto.randomUUID(), id, Date.parse(`${addDays(t, -1)}T12:00:00Z`) / 1000, Date.parse(`${addDays(t, -1)}T12:00:00Z`) / 1000)
      .run();
    expect((await activity(token)).days.map((d: { day: string }) => d.day)).toEqual([t]);
  });

  it('counts game runs from before the local day was kept on the UTC date of their submission', async () => {
    const { id, token } = await signedInUser();
    const t = today();
    const runId = await gameRun(token);
    const yesterday = Date.parse(`${addDays(t, -1)}T23:00:00Z`) / 1000;
    await env.DB.prepare('UPDATE game_runs SET local_day = NULL, submitted_at = ? WHERE id = ? AND user_id = ?').bind(yesterday, runId, id).run();
    expect((await activity(token)).days).toEqual([{ day: addDays(t, -1), reviews: 0, newCards: 0, solves: 0, runs: 1 }]);
  });

  it('mixes them into one streak, with freezes, and the streak badges count it too', async () => {
    const { id, token } = await signedInUser();
    const t = today();
    // Seven days in a row, each met by something different, a missed day (a freeze covers it), then today's challenge.
    const at = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;
    for (let n = 9; n >= 3; n--) {
      const d = addDays(t, -n);
      if (n % 3 === 0) {
        await env.DB.prepare('INSERT INTO challenge_attempts (user_id, day, started_at, score, correct, perfect, total_ms, results, submitted_at, local_day) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?)')
          .bind(id, d, at(d), '[]', at(d), d)
          .run();
      } else if (n % 3 === 1) {
        await env.DB.prepare(
          `INSERT INTO game_runs (id, user_id, mode, scenario, ascension, setup, versions, started_at, submitted_at, score, waves, outcome, cleared, blueprints, actions, local_day)
           VALUES (?, ?, 'normal', 'shortly', 0, '{}', 'x', ?, ?, 1, 1, 'over', 0, 0, '[]', ?)`,
        )
          .bind(crypto.randomUUID(), id, at(d), at(d), d)
          .run();
      } else {
        await env.DB.batch(
          Array.from({ length: 10 }, (_, i) =>
            env.DB.prepare('INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day) VALUES (?, ?, ?, 1, 3, ?, 1000, ?)').bind(
              crypto.randomUUID(),
              id,
              `card-${n}-${i}`,
              at(d) + i,
              d,
            ),
          ),
        );
      }
    }
    // Two days ago missed, then yesterday a run.
    await gameRun(token, { day: addDays(t, -1) });
    const body = await activity(token);
    expect(body.streak).toMatchObject({ current: 8, longest: 8, frozen: [addDays(t, -2)], todayDone: false });
    expect(body.recap.challenges + body.recap.runs).toBeGreaterThan(0);
    const achievements = (await (await call(`/api/me/achievements?day=${t}`, { token })).json()) as { stats: { longestStreak: number } };
    expect(achievements.stats.longestStreak).toBe(8);
  });
});
