import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AchievementsAnswer } from '../../frontend/src/learn/achievements';
import { challengeDay, pickChallenge, type ChallengeAnswer, type ChallengeCard } from '../../frontend/src/learn/challenge';
import { addDays } from '../../frontend/src/learn/streak';
import { allCards, findCard } from '../src/cards';
import type { Attempt } from '../src/challenge';
import { call, resetDatabase, signedInUser } from './helpers';

/**
 * The daily challenge. Nothing here assumes which cards a day brings: the
 * expected set is picked with the same code from the cards the Worker ships,
 * and right and wrong answers are made from each card.
 */

const today = () => challengeDay();

interface Today {
  day: string;
  cardIds: string[];
  endsAt: number;
  maxScore: number;
  attempt?: Attempt | null;
  streak?: { current: number; longest: number; todayDone: boolean };
}

async function getToday(token?: string): Promise<Today> {
  const response = await call('/api/challenge/today', { token });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return (await response.json()) as Today;
}

const cardsOf = (ids: string[]) => ids.map((id) => findCard(id) as ChallengeCard);

/** The right answer to a card, as a client sends it. */
function right(card: ChallengeCard): ChallengeAnswer {
  if (card.type === 'choice') return card.options.findIndex((o) => o.correct);
  if (card.type === 'estimate') return card.answer;
  return card.blanks.map((b) => b[0]);
}

/** A wrong answer to a card. */
function wrong(card: ChallengeCard): ChallengeAnswer {
  if (card.type === 'choice') return card.options.findIndex((o) => !o.correct);
  if (card.type === 'estimate') return card.answer * card.tolerance * 10;
  return card.blanks.map(() => 'definitely not it');
}

const attempt = (token: string, body: unknown) => call('/api/challenge/today/attempt', { method: 'POST', token, body });

/** Answers to today's cards: `pattern[i]` says whether card i is answered right. */
async function answers(pattern: boolean[], ms = 2000) {
  const { cardIds } = await getToday();
  return cardsOf(cardIds).map((c, i) => ({ cardId: c.id, answer: pattern[i] ? right(c) : wrong(c), ms }));
}

describe('daily challenge', () => {
  beforeEach(resetDatabase);

  it('gives everyone the same cards today, picked from the cards the Worker ships', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const anonymous = await getToday();
    expect(anonymous.day).toBe(today());
    expect(anonymous.cardIds).toHaveLength(5);
    expect(anonymous.cardIds).toEqual(pickChallenge([...allCards().values()], today()).map((c) => c.id));
    expect(anonymous.endsAt).toBe(Date.parse(`${addDays(today(), 1)}T00:00:00Z`) / 1000);
    expect(anonymous.maxScore).toBe(600);
    expect(anonymous).not.toHaveProperty('attempt');
    for (const user of [a, b]) {
      const signedIn = await getToday(user.token);
      expect(signedIn.cardIds).toEqual(anonymous.cardIds);
      expect(signedIn.attempt).toBeNull();
      expect(signedIn.streak).toEqual({ current: 0, longest: 0, todayDone: false });
    }
    for (const card of cardsOf(anonymous.cardIds)) expect(['choice', 'estimate', 'cloze']).toContain(card.type);
  });

  it('needs a session to keep an attempt', async () => {
    expect((await attempt('nope', { answers: await answers([true, true, true, true, true]) })).status).toBe(401);
  });

  it('grades and scores the answers itself, ignoring any score the client claims', async () => {
    const { token } = await signedInUser();
    const pattern = [true, false, true, true, false];
    const body = { score: 600, correct: 5, answers: (await answers(pattern)).map((a) => ({ ...a, correct: true, points: 120 })) };
    const response = await attempt(token, body);
    expect(response.status).toBe(200);
    const { attempt: kept, streak } = (await response.json()) as { attempt: Attempt; streak: Today['streak'] };
    expect(kept.results.map((r) => r.correct)).toEqual(pattern);
    expect(kept.results.map((r) => r.points)).toEqual(pattern.map((ok) => (ok ? 120 : 0)));
    expect(kept).toMatchObject({ day: today(), score: 360, maxScore: 600, correct: 3, perfect: false, totalMs: 10_000, rank: 1, players: 1 });
    expect(streak).toEqual({ current: 1, longest: 1, todayDone: true });
    // The page sees it on its next visit.
    const again = await getToday(token);
    expect(again.attempt).toMatchObject({ score: 360, correct: 3 });
  });

  it('scores speed: the bonus fades from 10 s to 60 s', async () => {
    const { token } = await signedInUser();
    const list = (await answers([true, true, true, true, true])).map((a, i) => ({ ...a, ms: [1000, 10_000, 35_000, 60_000, 9_000_000][i] }));
    const response = await attempt(token, { answers: list });
    const { attempt: kept } = (await response.json()) as { attempt: Attempt };
    expect(kept.results.map((r) => r.bonus)).toEqual([20, 20, 10, 0, 0]);
    expect(kept).toMatchObject({ score: 550, perfect: true, totalMs: 1000 + 10_000 + 35_000 + 60_000 + 3_600_000 });
  });

  it('refuses answers that are not exactly today’s cards', async () => {
    const { token } = await signedInUser();
    const good = await answers([true, true, true, true, true]);
    const other = [...allCards().values()].find((c) => c.type === 'choice' && !c.retired && !good.some((a) => a.cardId === c.id))!;
    const cases: [unknown, RegExp][] = [
      [{}, /must be a list/],
      [{ answers: good.slice(0, 4) }, /one answer for each/],
      [{ answers: [...good.slice(0, 4), { cardId: other.id, answer: 0, ms: 1000 }] }, /not one of today's cards/],
      [{ answers: [...good.slice(0, 4), good[0]] }, /answered twice/],
      [{ answers: good.map((a, i) => (i === 0 ? { ...a, answer: { pick: 1 } } : a)) }, /not an answer/],
      [{ answers: good.map((a, i) => (i === 0 ? { ...a, ms: 1.5 } : a)) }, /ms must be/],
    ];
    for (const [body, message] of cases) {
      const response = await attempt(token, body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(message);
    }
    // A challenge that is over is refused; nothing was kept, so today's can still be played.
    const late = await attempt(token, { day: addDays(today(), -3), answers: good });
    expect(late.status).toBe(409);
    expect(((await late.json()) as { error: string }).error).toMatch(/is over/);
    expect((await attempt(token, { day: 'yesterday', answers: good })).status).toBe(400);
    expect((await attempt(token, { day: today(), answers: good })).status).toBe(200);
  });

  it('keeps only the first attempt of the day', async () => {
    const { token } = await signedInUser();
    expect((await attempt(token, { answers: await answers([false, false, false, false, false]) })).status).toBe(200);
    const second = await attempt(token, { answers: await answers([true, true, true, true, true]) });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string; attempt: Attempt };
    expect(body.error).toMatch(/already played/);
    expect(body.attempt).toMatchObject({ score: 0, correct: 0 });
    const { results } = await env.DB.prepare('SELECT score FROM challenge_attempts').all<{ score: number }>();
    expect(results).toEqual([{ score: 0 }]);
  });

  it('ranks everyone but lists only those who opted in', async () => {
    const best = await signedInUser('Hidden', false);
    const second = await signedInUser('Ada', true);
    const third = await signedInUser('Grace', true);
    await attempt(best.token, { answers: await answers([true, true, true, true, true], 1000) });
    await attempt(second.token, { answers: await answers([true, true, true, true, false], 1000) });
    await attempt(third.token, { answers: await answers([true, true, false, false, false], 1000) });

    const response = await call(`/api/challenge/leaderboard?day=${today()}`);
    expect(response.status).toBe(200);
    const board = (await response.json()) as { day: string; players: number; entries: { rank: number; id: string; displayName: string; score: number; correct: number }[] };
    expect(board).toMatchObject({ day: today(), players: 3 });
    // Each entry carries the user's public id, for their profile.
    expect(board.entries).toEqual([
      { rank: 2, id: second.id, displayName: 'Ada', score: 480, correct: 4 },
      { rank: 3, id: third.id, displayName: 'Grace', score: 240, correct: 2 },
    ]);
    expect(JSON.stringify(board)).not.toContain(best.id);
    expect((await call(`/api/users/${board.entries[0].id}/profile`)).status).toBe(200);
    expect(JSON.stringify(board)).not.toContain('Hidden');

    const mine = (await (await call('/api/challenge/leaderboard', { token: best.token })).json()) as { you: { rank: number; score: number } };
    expect(mine.you).toMatchObject({ rank: 1, score: 600, players: 3 });
    const nobody = (await (await call('/api/challenge/leaderboard', { token: (await signedInUser()).token })).json()) as { you: unknown };
    expect(nobody.you).toBeNull();

    // A tie on score is broken by the total time.
    const quick = await signedInUser('Quick', true);
    await attempt(quick.token, { answers: await answers([true, true, true, true, false], 500) });
    const quickRank = (await (await call('/api/challenge/today', { token: quick.token })).json()) as Today;
    expect(quickRank.attempt).toMatchObject({ rank: 2, players: 4 });
  });

  it('answers past days, and refuses future or malformed ones', async () => {
    expect((await call(`/api/challenge/leaderboard?day=${addDays(today(), -1)}`)).status).toBe(200);
    expect((await call(`/api/challenge/leaderboard?day=${addDays(today(), 1)}`)).status).toBe(400);
    expect((await call('/api/challenge/leaderboard?day=2026-13-01')).status).toBe(400);
  });

  it('counts the challenge streak and earns the challenge badges', async () => {
    const { id, token } = await signedInUser();
    for (const n of [2, 1]) {
      await env.DB.prepare(
        "INSERT INTO challenge_attempts (user_id, day, started_at, score, correct, perfect, total_ms, results, submitted_at) VALUES (?, ?, 0, 100, 1, 0, 1000, '[]', 0)",
      )
        .bind(id, addDays(today(), -n))
        .run();
    }
    const response = await attempt(token, { answers: await answers([true, true, true, true, true]) });
    expect(((await response.json()) as { streak: Today['streak'] }).streak).toEqual({ current: 3, longest: 3, todayDone: true });

    const achievements = (await (await call('/api/me/achievements', { token })).json()) as AchievementsAnswer;
    const badge = (badgeId: string) => achievements.achievements.find((a) => a.id === badgeId)!;
    expect(badge('challenge-first')).toMatchObject({ earned: true });
    expect(badge('challenge-perfect')).toMatchObject({ earned: true });
    expect(badge('challenge-streak-7')).toMatchObject({ earned: false, current: 3, target: 7 });
  });

  it('records the start once, from any device, and keeps it out of the counts until the attempt', async () => {
    const { token } = await signedInUser('Ada', true);
    const start = async () => {
      const response = await call('/api/challenge/today/start', { method: 'POST', token, body: {} });
      expect(response.status).toBe(200);
      return (await response.json()) as { day: string; startedAt: number; submitted: boolean };
    };
    expect((await call('/api/challenge/today/start', { method: 'POST', body: {} })).status).toBe(401);
    const first = await start();
    expect(first).toMatchObject({ day: today(), submitted: false });
    // Another device (another session of the same user) gets the same start.
    await env.DB.prepare('UPDATE challenge_attempts SET started_at = started_at - 30').run();
    expect((await start()).startedAt).toBe(first.startedAt - 30);
    const seen = await getToday(token);
    expect(seen).toMatchObject({ attempt: null, startedAt: first.startedAt - 30, streak: { current: 0, todayDone: false } });
    const board = (await (await call('/api/challenge/leaderboard')).json()) as { players: number; entries: unknown[] };
    expect(board).toMatchObject({ players: 0, entries: [] });

    // Times adding up to far more than the 30 s since the start are refused.
    const slow = await attempt(token, { answers: await answers([true, true, true, true, true], 60_000) });
    expect(slow.status).toBe(400);
    expect(((await slow.json()) as { error: string }).error).toMatch(/longer than the challenge has been open/);
    const sent = await attempt(token, { answers: await answers([true, true, true, true, true], 5000) });
    expect(sent.status).toBe(200);
    expect(((await sent.json()) as { attempt: Attempt }).attempt).toMatchObject({ score: 600, rank: 1, players: 1 });
    const row = await env.DB.prepare('SELECT started_at, submitted_at FROM challenge_attempts').first<{ started_at: number; submitted_at: number }>();
    expect(row?.started_at).toBe(first.startedAt - 30);
    expect(row?.submitted_at).toBeGreaterThanOrEqual(first.startedAt);
    expect(await start()).toMatchObject({ startedAt: first.startedAt - 30, submitted: true });
  });

  it('exports the attempts and deletes them with the account', async () => {
    const { id, token } = await signedInUser();
    await attempt(token, { answers: await answers([true, false, true, false, true]) });
    const exported = (await (await call('/api/me/export', { token })).json()) as { challengeAttempts: { day: string; score: number; results: { cardId: string }[] }[] };
    expect(exported.challengeAttempts).toHaveLength(1);
    expect(exported.challengeAttempts[0]).toMatchObject({ day: today(), correct: 3, perfect: false });
    expect(exported.challengeAttempts[0].results.map((r) => r.cardId)).toEqual((await getToday()).cardIds);
    expect(exported.challengeAttempts[0]).toMatchObject({ startedAt: expect.any(Number), submittedAt: expect.any(Number) });

    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM challenge_attempts WHERE user_id = ?').bind(id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
