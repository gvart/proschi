import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DAY } from '../../frontend/src/learn/fsrs';
import { addDays, computeStreak, goalFor, weeklyRecap, weekStart } from '../../frontend/src/learn/streak';
import { findProblem } from '../src/verify';
import { call, resetDatabase, signedInUser } from './helpers';

const ID = 'url-shortener';
const problem = findProblem(ID)!;
const nowSeconds = () => Math.floor(Date.now() / 1000);
/** The tests' "local" date: the server's UTC date. */
const today = () => new Date().toISOString().slice(0, 10);

const activity = async (token: string, day = today()) => (await (await call(`/api/me/activity?day=${day}`, { token })).json()) as Record<string, any>;
const run = (token: string, body: Record<string, unknown>, id = ID) => call(`/api/problems/${id}/runs`, { method: 'POST', token, body });
const patch = (token: string, body: unknown) => call('/api/me', { method: 'PATCH', token, body });

/** `n` reviews of distinct cards on `day`, written straight to the log (as if sent then); `card` names them apart. */
async function reviewsOn(userId: string, day: string, n: number, card = 'card') {
  const at = Date.parse(`${day}T12:00:00Z`) / 1000;
  await env.DB.batch(
    Array.from({ length: n }, (_, i) =>
      env.DB.prepare('INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day) VALUES (?, ?, ?, 1, 3, ?, 1000, ?)').bind(
        crypto.randomUUID(),
        userId,
        `${card}-${i}`,
        at + i,
        day,
      ),
    ),
  );
}

describe('daily goal', () => {
  beforeEach(resetDatabase);

  it('is 10 cards by default, and PATCH /api/me changes it to one of the choices', async () => {
    const { id, token } = await signedInUser();
    expect(((await (await call('/api/me', { token })).json()) as Record<string, any>).user.dailyGoal).toBe(10);
    expect(await (await patch(token, { dailyGoal: 20 })).json()).toEqual({ user: { id, displayName: expect.any(String), publicProfile: false, dailyGoal: 20 } });
    expect(((await (await call('/api/me', { token })).json()) as Record<string, any>).user.dailyGoal).toBe(20);
    for (const bad of [7, '10', 0, null, 10.5]) {
      const response = await patch(token, { dailyGoal: bad });
      expect(response.status, String(bad)).toBe(400);
      expect(await response.json()).toEqual({ error: 'dailyGoal must be one of 5, 10, 20, 30' });
    }
    // Other fields keep the goal.
    await patch(token, { publicProfile: true });
    expect((await activity(token)).goal).toEqual({ reviews: 20, solves: 1 });
  });
});

describe('the day of a solve', () => {
  beforeEach(resetDatabase);

  it('keeps the client’s local date of the first verified solve', async () => {
    const { token } = await signedInUser();
    const tomorrow = addDays(today(), 1);
    const unsolved = (await (await run(token, { source: problem.starter, solved: false, day: tomorrow })).json()) as Record<string, any>;
    expect(unsolved.progress.solvedDay).toBeUndefined();
    // A claimed solve the server does not confirm has no day either.
    expect(((await (await run(token, { source: problem.starter, solved: true, day: tomorrow })).json()) as Record<string, any>).progress.solvedDay).toBeUndefined();

    const solved = (await (await run(token, { source: problem.solution, solved: true, day: tomorrow })).json()) as Record<string, any>;
    expect(solved.progress).toMatchObject({ status: 'solved', solvedDay: tomorrow });
    // Later solves keep the first day.
    const again = (await (await run(token, { source: problem.solution, solved: true, day: today() })).json()) as Record<string, any>;
    expect(again.progress.solvedDay).toBe(tomorrow);
    expect(((await (await call('/api/me', { token })).json()) as Record<string, any>).progress[ID].solvedDay).toBe(tomorrow);
  });

  it('uses the server’s date without a day or with one far off, and refuses one that is not a date', async () => {
    const { token } = await signedInUser();
    const chat = findProblem('chat')!;
    expect(((await (await run(token, { source: problem.solution, solved: true })).json()) as Record<string, any>).progress.solvedDay).toBe(today());
    expect(((await (await run(token, { source: chat.solution, solved: true, day: '2020-01-01' }, 'chat')).json()) as Record<string, any>).progress.solvedDay).toBe(
      today(),
    );
    for (const day of ['05/10/2026', '2026-02-30', 20261005]) expect((await run(token, { source: 'x', solved: false, day })).status, String(day)).toBe(400);
  });

  it('leaves imported solves out of the streak', async () => {
    const { token } = await signedInUser();
    const imported = (await (await run(token, { source: problem.solution, solved: true, imported: true, day: today() })).json()) as Record<string, any>;
    expect(imported.progress).toMatchObject({ status: 'solved' });
    expect(imported.progress.solvedDay).toBeUndefined();
    expect((await activity(token)).days).toEqual([]);
  });
});

describe('GET /api/me/activity', () => {
  beforeEach(resetDatabase);

  it('needs a session and a day', async () => {
    expect((await call(`/api/me/activity?day=${today()}`)).status).toBe(401);
    const { token } = await signedInUser();
    expect((await call('/api/me/activity', { token })).status).toBe(400);
    expect((await call('/api/me/activity?day=2026-13-01', { token })).status).toBe(400);
  });

  it('is empty for a new user', async () => {
    const { token } = await signedInUser();
    const t = today();
    expect(await activity(token, t)).toEqual({
      day: t,
      goal: { reviews: 10, solves: 1 },
      days: [],
      streak: { current: 0, longest: 0, freezes: 0, frozen: [], todayDone: false, today: { day: t, reviews: 0, solves: 0, newCards: 0 }, todayProgress: 0 },
      recap: { start: addDays(weekStart(t), -7), end: addDays(weekStart(t), -1), reviews: 0, newCards: 0, solves: 0, challenges: 0, runs: 0, goalDays: 0, streak: 0 },
    });
  });

  it('counts each day’s reviews, new cards and solves, and the streak and recap from them', async () => {
    const { id, token } = await signedInUser();
    const t = today();
    // Ten days of 10 reviews ending yesterday, a missed day before them, and 3 reviews and a solve today.
    for (let d = 1; d <= 10; d++) await reviewsOn(id, addDays(t, -d), 10, d % 2 ? 'odd' : 'even');
    await reviewsOn(id, addDays(t, -12), 4, 'old');
    // Sent like the page does: with the local day.
    const at = nowSeconds();
    const sent = await call('/api/cards/reviews', {
      method: 'POST',
      token,
      body: { reviews: ['cache-aside', 'seconds-in-a-day', 'cache-aside'].map((cardId, i) => ({ id: crypto.randomUUID(), cardId, version: 1, rating: 3, reviewedAt: at - 10 + i, durationMs: 1000, day: t })) },
    });
    expect(((await sent.json()) as Record<string, any>).accepted).toBe(3);
    await run(token, { source: problem.solution, solved: true, day: t });

    const body = await activity(token, t);
    expect(body.days).toHaveLength(12);
    expect(body.days[0]).toEqual({ day: addDays(t, -12), reviews: 4, newCards: 4, solves: 0 });
    // Odd days review the same ten cards, and so do even days: only the first of each are new.
    expect(body.days.find((d: { day: string }) => d.day === addDays(t, -8))).toEqual({ day: addDays(t, -8), reviews: 10, newCards: 0, solves: 0 });
    expect(body.days.find((d: { day: string }) => d.day === addDays(t, -9))).toEqual({ day: addDays(t, -9), reviews: 10, newCards: 10, solves: 0 });
    expect(body.days.at(-1)).toEqual({ day: t, reviews: 3, newCards: 2, solves: 1 });
    expect(body.streak).toMatchObject({ current: 11, longest: 11, freezes: 1, todayDone: true, todayProgress: 1 });
    // The page and the server compute them with the same code.
    expect(body.streak).toEqual(computeStreak(body.days, t, goalFor(10)));
    expect(body.recap).toEqual(weeklyRecap(body.days, t, goalFor(10)));
    expect(body.recap.reviews).toBeGreaterThan(0);

    // A higher goal: today's 3 cards miss it, but the solve meets it.
    await patch(token, { dailyGoal: 30 });
    expect((await activity(token, t)).streak).toMatchObject({ current: 1, todayDone: true });
  });

  it('answers only the user’s own activity, up to the day asked for', async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const t = today();
    await reviewsOn(a.id, addDays(t, -1), 10);
    await reviewsOn(a.id, t, 10);
    expect((await activity(b.token)).days).toEqual([]);
    expect((await activity(a.token, addDays(t, -1))).days).toEqual([{ day: addDays(t, -1), reviews: 10, newCards: 10, solves: 0 }]);
    // Activity older than the window is left out.
    await env.DB.prepare('UPDATE card_reviews SET reviewed_at = reviewed_at - ? , day = ? WHERE user_id = ? AND day = ?')
      .bind(500 * DAY, addDays(t, -501), a.id, addDays(t, -1))
      .run();
    expect((await activity(a.token)).days.map((d: { day: string }) => d.day)).toEqual([t]);
  });
});
