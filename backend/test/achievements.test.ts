import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AchievementsAnswer } from '../../frontend/src/learn/achievements';
import { DAY } from '../../frontend/src/learn/fsrs';
import { addDays, type Streak } from '../../frontend/src/learn/streak';
import raw from '../../frontend/src/practice/achievements.json';
import { findProblem, referenceCost } from '../src/verify';
import { call, resetDatabase, signedInUser } from './helpers';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function review(cardId: string, rating: number, reviewedAt: number) {
  return { id: crypto.randomUUID(), cardId, version: 1, rating, reviewedAt, durationMs: 3000, day: dayOf(reviewedAt) };
}

const get = async (token: string, day?: string) => {
  const response = await call(`/api/me/achievements${day ? `?day=${day}` : ''}`, { token });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return (await response.json()) as AchievementsAnswer;
};
const badge = (answer: AchievementsAnswer, id: string) => answer.achievements.find((a) => a.id === id)!;
const seen = (token: string, body: unknown) => call('/api/me/achievements/seen', { method: 'POST', token, body });

/** A solve straight in the database, as recordRun stores it. */
async function solve(userId: string, problemId: string, runsToSolve: number | null, bestCostUsd: number | null) {
  const t = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, runs_to_solve, best_cost_usd, best_p99_ms)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, NULL)`,
  )
    .bind(userId, problemId, runsToSolve ?? 1, t, t, t, runsToSolve, bestCostUsd)
    .run();
}

/** `n` reviews of distinct cards on `day`, written straight to the log (as if sent then). */
async function reviewsOn(userId: string, day: string, n: number) {
  const at = Date.parse(`${day}T12:00:00Z`) / 1000;
  await env.DB.batch(
    Array.from({ length: n }, (_, i) =>
      env.DB.prepare('INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day) VALUES (?, ?, ?, 1, 3, ?, 1000, ?)').bind(
        crypto.randomUUID(),
        userId,
        `${day}-${i}`,
        at + i,
        day,
      ),
    ),
  );
}

/** A first solve on the local `day`, as recordRun keeps it. */
async function solveOn(userId: string, problemId: string, day: string) {
  const t = nowSeconds();
  await env.DB.prepare(
    `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, solved_day, runs_to_solve, best_cost_usd, best_p99_ms)
     VALUES (?, ?, 2, '', ?, ?, ?, ?, 2, NULL, NULL)`,
  )
    .bind(userId, problemId, t, t, t, day)
    .run();
}

describe('achievements', () => {
  beforeEach(resetDatabase);

  it('needs a session', async () => {
    expect((await call('/api/me/achievements')).status).toBe(401);
    expect((await seen('nope', {})).status).toBe(401);
  });

  it('answers every badge with its progress and an empty skill map for a new account', async () => {
    const { token } = await signedInUser();
    const answer = await get(token);
    expect(answer.achievements.map((a) => a.id)).toEqual((raw as { id: string; retired?: boolean }[]).filter((a) => !a.retired).map((a) => a.id));
    expect(answer.achievements.every((a) => !a.earned && !a.unseen && a.current === 0)).toBe(true);
    expect(badge(answer, 'reviews-100')).toMatchObject({ title: 'Hundred club', icon: 'layers', tier: 'bronze', current: 0, target: 100 });
    expect(answer.skills.readiness).toBe(0);
    expect(answer.skills.topics.length).toBe(15);
    expect(answer.skills.weakest).toHaveLength(3);
    expect(answer.stats).toEqual({ reviews: 0, mastered: 0, longestStreak: 0, estimateStreak: 0, solved: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM achievements').first('n')).toBe(0);
  });

  it('earns badges from reviews and solves, stores them once, and counts toward the rest', async () => {
    const { id, token } = await signedInUser();
    const t = nowSeconds();
    // Three estimate cards right in a row, and a streak of two days with ten reviews each.
    const reviews = [
      review('qps-from-daily-users', 3, t - 2 * DAY),
      review('hour-of-video', 4, t - 2 * DAY + 10),
      review('storage-for-five-years-of-posts', 3, t - 2 * DAY + 20),
      ...Array.from({ length: 7 }, (_, i) => review('cache-aside', 3, t - 2 * DAY + 30 + i)),
      ...Array.from({ length: 10 }, (_, i) => review('cache-aside', 3, t - DAY + i)),
    ];
    expect((await call('/api/cards/reviews', { method: 'POST', token, body: { reviews } })).status).toBe(200);
    const url = findProblem('url-shortener')!;
    await solve(id, 'url-shortener', 1, referenceCost(url)! / 2);
    await solve(id, 'pastebin', 3, null);

    const answer = await get(token);
    // cache-aside, reviewed again and again over two days, is mastered.
    expect(answer.stats).toEqual({ reviews: 20, mastered: 1, longestStreak: 2, estimateStreak: 3, solved: 2 });
    for (const earned of ['first-card', 'first-solve', 'first-run-1', 'under-reference-1', 'estimate-streak-3']) {
      expect(badge(answer, earned)).toMatchObject({ earned: true, unseen: true, current: badge(answer, earned).target });
    }
    expect(badge(answer, 'reviews-100')).toMatchObject({ earned: false, current: 20, target: 100 });
    expect(badge(answer, 'streak-3')).toMatchObject({ earned: false, current: 2, target: 3 });
    expect(badge(answer, 'stage-foundations')).toMatchObject({ earned: false, current: 2, target: 4 });
    expect(badge(answer, 'first-run-5')).toMatchObject({ current: 1, target: 5 });
    expect(answer.skills.readiness).toBeGreaterThan(0);
    const earnedAt = badge(answer, 'first-card').earnedAt;
    expect(earnedAt).toBeGreaterThanOrEqual(t);

    // Stored once; reading again keeps the time.
    const rows = await env.DB.prepare('SELECT achievement_id FROM achievements WHERE user_id = ? ORDER BY achievement_id').bind(id).all();
    expect(rows.results.map((r) => r.achievement_id)).toEqual(['estimate-streak-3', 'first-card', 'first-run-1', 'first-solve', 'under-reference-1']);
    expect(badge(await get(token), 'first-card')).toMatchObject({ earned: true, earnedAt });
  });

  it('counts the daily streak as GET /api/me/activity does: the user’s goal, solves and freezes', async () => {
    const { id, token } = await signedInUser();
    const today = dayOf(nowSeconds());
    const streak = async () => ((await (await call(`/api/me/activity?day=${today}`, { token })).json()) as { streak: Streak }).streak;
    // 7 days of 5 cards, a missed day a freeze covers, then a solve: 8 days at the goal of 5 cards.
    for (let i = 10; i >= 4; i--) await reviewsOn(id, addDays(today, -i), 5);
    await solveOn(id, 'url-shortener', addDays(today, -2));
    expect((await get(token, today)).stats.longestStreak).toBe(1);
    expect((await streak()).longest).toBe(1);

    expect((await call('/api/me', { method: 'PATCH', token, body: { dailyGoal: 5 } })).status).toBe(200);
    const answer = await get(token, today);
    expect(answer.stats.longestStreak).toBe(8);
    expect((await streak()).longest).toBe(8);
    expect(badge(answer, 'streak-7')).toMatchObject({ earned: true, unseen: true });
    expect(badge(answer, 'streak-30')).toMatchObject({ earned: false, current: 8, target: 30 });
    // Without a day, or with one far from the server's date, the server counts up to tomorrow's UTC date.
    expect((await get(token)).stats.longestStreak).toBe(8);
    expect((await get(token, addDays(today, -30))).stats.longestStreak).toBe(8);
    expect((await call('/api/me/achievements?day=yesterday', { token })).status).toBe(400);
  });

  it('marks badges seen, the listed ones or all, so they are celebrated once', async () => {
    const { id, token } = await signedInUser();
    await solve(id, 'url-shortener', 2, null);
    await solve(id, 'pastebin', 2, null);
    await call('/api/cards/reviews', { method: 'POST', token, body: { reviews: [review('cache-aside', 3, nowSeconds() - 60)] } });
    const before = await get(token);
    expect(before.achievements.filter((a) => a.unseen).map((a) => a.id)).toEqual(['first-card', 'first-solve']);

    const one = await seen(token, { ids: ['first-solve', 'not-a-badge'] });
    expect(await one.json()).toEqual({ seen: 1 });
    expect((await get(token)).achievements.filter((a) => a.unseen).map((a) => a.id)).toEqual(['first-card']);
    expect(await (await seen(token, {})).json()).toEqual({ seen: 1 });
    expect((await get(token)).achievements.filter((a) => a.unseen)).toEqual([]);
    expect(await (await seen(token, {})).json()).toEqual({ seen: 0 });
  });

  it('refuses a malformed seen request and other sites', async () => {
    const { token } = await signedInUser();
    expect((await seen(token, { ids: 'all' })).status).toBe(400);
    expect((await seen(token, { ids: [1, 2] })).status).toBe(400);
    expect((await call('/api/me/achievements/seen', { method: 'POST', token, body: {}, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('keeps one user’s badges from another', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    await solve(a.id, 'url-shortener', 1, null);
    expect(badge(await get(a.token), 'first-solve').earned).toBe(true);
    expect(badge(await get(b.token), 'first-solve').earned).toBe(false);
    await seen(b.token, {});
    expect(badge(await get(a.token), 'first-solve').unseen).toBe(true);
  });

  it('exports the badges and deletes them with the account', async () => {
    const { id, token } = await signedInUser();
    await solve(id, 'url-shortener', 1, null);
    await get(token);
    await seen(token, { ids: ['first-solve'] });
    const exported = (await (await call('/api/me/export', { token })).json()) as { achievements: { achievementId: string; earnedAt: number; seenAt: number | null }[] };
    expect(exported.achievements.map((a) => [a.achievementId, typeof a.earnedAt, a.seenAt === null])).toEqual([
      ['first-run-1', 'number', true],
      ['first-solve', 'number', false],
    ]);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?').bind(id).first('n')).toBe(0);
  });
});
