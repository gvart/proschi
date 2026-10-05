import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DAY } from '../../frontend/src/learn/fsrs';
import { addDays } from '../../frontend/src/learn/streak';
import type { PublicProfile } from '../src/profile';
import { clearStatsCache } from '../src/stats';
import { call, resetDatabase, signedInUser, WINDOW_TIMEOUT, withinOneWindow } from './helpers';

/**
 * Public profiles (GET /api/users/<id>/profile): only for users who opted
 * in, the same 404 for private and missing users, and only the fields
 * docs/PRIVACY.md lists.
 */

const nowSeconds = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
const SOURCE = 'service SecretDesign { replicas: 3 }';

const profile = (id: string, headers?: HeadersInit) => call(`/api/users/${id}/profile`, { headers });

/** A solve, a review a day for three days at a goal of 5 cards, and a badge stored as earned. */
async function activeUser(publicProfile: boolean) {
  const user = await signedInUser('Ada', publicProfile);
  const t = nowSeconds();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET daily_goal = 5, created_at = ? WHERE id = ?').bind(t - 40 * DAY + 1234, user.id),
    env.DB.prepare(
      `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at, solved_day, runs_to_solve, best_cost_usd, best_p99_ms)
       VALUES (?, 'url-shortener', 2, ?, ?, ?, ?, ?, 2, 12.5, 80)`,
    ).bind(user.id, SOURCE, t, t, t, today()),
    env.DB.prepare(
      `INSERT INTO progress (user_id, problem_id, runs, source, first_run_at, updated_at, solved_at) VALUES (?, 'pastebin', 1, ?, ?, ?, NULL)`,
    ).bind(user.id, SOURCE, t, t),
    env.DB.prepare('INSERT INTO achievements (user_id, achievement_id, earned_at, seen_at) VALUES (?, ?, ?, ?)').bind(user.id, 'first-solve', t - 100, t - 50),
    // A badge that no longer exists stays out.
    env.DB.prepare('INSERT INTO achievements (user_id, achievement_id, earned_at) VALUES (?, ?, ?)').bind(user.id, 'retired-badge', t),
    ...[-2, -1].flatMap((n) =>
      Array.from({ length: 5 }, (_, i) =>
        env.DB.prepare('INSERT INTO card_reviews (id, user_id, card_id, card_version, rating, reviewed_at, duration_ms, day) VALUES (?, ?, ?, 1, 3, ?, 1000, ?)').bind(
          crypto.randomUUID(),
          user.id,
          'cache-aside',
          t + n * DAY + i,
          addDays(today(), n),
        ),
      ),
    ),
  ]);
  return user;
}

describe('public profiles', () => {
  beforeEach(resetDatabase);

  it('answers an opted-in user’s public profile, and nothing private', async () => {
    const user = await activeUser(true);
    const response = await profile(user.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as PublicProfile;
    expect(Object.keys(body).sort()).toEqual(['badges', 'challenge', 'displayName', 'id', 'memberSince', 'readiness', 'solved', 'streak', 'topics']);
    expect(body.id).toBe(user.id);
    expect(body.displayName).toBe('Ada');
    // Rounded to the day.
    expect(body.memberSince % DAY).toBe(0);
    expect(body.solved).toEqual([{ id: 'url-shortener', difficulty: 'easy' }]);
    // Two days of reviews and today's solve, at the user's goal of 5 cards.
    expect(body.streak).toEqual({ current: 3, longest: 3 });
    // No daily challenge played yet.
    expect(body.challenge).toBeNull();
    expect(body.badges).toEqual([{ id: 'first-solve', earnedAt: expect.any(Number) }]);
    expect(body.badges[0].earnedAt % DAY).toBe(0);
    expect(body.topics.length).toBeGreaterThan(5);
    for (const t of body.topics) expect(Math.round(t.mastery * 100)).toBeCloseTo(t.mastery * 100, 6);
    expect(body.readiness).toBeGreaterThanOrEqual(0);

    // No design, goal, review counts, sign-ins or sessions.
    const text = JSON.stringify(body);
    for (const secret of [SOURCE, 'SecretDesign', 'github', 'token', 'dailyGoal', 'reviews', 'source', 'session', 'providers', 'cost', 'p99', 'seen', 'pastebin']) {
      expect(text, secret).not.toContain(secret);
    }
    // Reading someone's profile stores no badge for them.
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ?').bind(user.id).first('n')).toBe(2);
  });

  it('shows the daily challenge streak and best score, never the answers', async () => {
    const user = await activeUser(true);
    const t = nowSeconds();
    const attempt = (day: string, score: number) =>
      env.DB.prepare(
        `INSERT INTO challenge_attempts (user_id, day, started_at, score, correct, perfect, total_ms, results, submitted_at)
         VALUES (?, ?, ?, ?, 0, 0, 5000, '[{"cardId":"secret-card","answer":3}]', ?)`,
      ).bind(user.id, day, t, score, t);
    await env.DB.batch([
      attempt(addDays(today(), -5), 590),
      attempt(addDays(today(), -4), 120),
      attempt(addDays(today(), -3), 240),
      attempt(addDays(today(), -1), 360),
      attempt(today(), 480),
      // Started, not sent: counts nowhere.
      env.DB.prepare('INSERT INTO challenge_attempts (user_id, day, started_at) VALUES (?, ?, ?)').bind(user.id, addDays(today(), -2), t),
    ]);
    const body = (await (await profile(user.id)).json()) as PublicProfile;
    expect(body.challenge).toEqual({ current: 2, longest: 3, best: 590 });
    expect(JSON.stringify(body)).not.toContain('secret-card');
    // The player's own GET /api/challenge/today has the best score too.
    const own = (await (await call('/api/challenge/today', { token: user.token })).json()) as { best: number; streak: { current: number; longest: number } };
    expect(own).toMatchObject({ best: 590, streak: { current: 2, longest: 3 } });
  });

  it('answers 404 for a private user, the same as for one that does not exist', async () => {
    const hidden = await activeUser(false);
    const privateAnswer = await profile(hidden.id);
    const missing = await profile(crypto.randomUUID());
    expect(privateAnswer.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await privateAnswer.json()).toEqual(await missing.json());
    expect((await profile('not%20an%20id')).status).toBe(404);
    expect((await profile('x'.repeat(65))).status).toBe(404);
  });

  it('follows the opt-in: turning it off hides the profile at once', async () => {
    const user = await activeUser(true);
    expect((await profile(user.id)).status).toBe(200);
    expect((await call('/api/me', { method: 'PATCH', token: user.token, body: { publicProfile: false } })).status).toBe(200);
    expect((await profile(user.id)).status).toBe(404);
  });

  it('links from the leaderboard: entries carry the public id', async () => {
    const shown = await activeUser(true);
    await activeUser(false);
    await clearStatsCache();
    const board = (await (await call('/api/leaderboard')).json()) as { entries: { id: string; displayName: string }[] };
    expect(board.entries.map((e) => e.id)).toEqual([shown.id]);
    expect((await profile(board.entries[0].id)).status).toBe(200);
  });

  it(
    'is rate limited per IP',
    async () => {
      const user = await activeUser(true);
      await withinOneWindow(15_000);
      // STATS_LIMITER (wrangler.jsonc) allows 120 a minute; unknown ids count too, and are cheap.
      const headers = { 'CF-Connecting-IP': `test-${crypto.randomUUID()}` };
      const statuses: number[] = [];
      for (let i = 0; i < 120; i++) statuses.push((await profile('nobody', headers)).status);
      expect(statuses.every((s) => s === 404)).toBe(true);
      expect((await profile(user.id, headers)).status).toBe(429);
      // Another reader is not held back.
      expect((await profile(user.id)).status).toBe(200);
    },
    WINDOW_TIMEOUT,
  );
});
