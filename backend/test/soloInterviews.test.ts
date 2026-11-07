import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AchievementsAnswer } from '../../frontend/src/learn/achievements';
import { call, resetDatabase, signedInUser } from './helpers';

const send = (token: string | undefined, body: unknown) => call('/api/me/interviews/solo', { method: 'POST', token, body });
const START = Date.UTC(2026, 10, 1);
const session = (over: Record<string, unknown> = {}) => ({ problem: 'url-shortener', startedAt: START, durationMin: 45, onTime: false, ...over });
const achievements = async (token: string) => (await (await call('/api/me/achievements', { token })).json()) as AchievementsAnswer;

describe('mock interviews in progress', () => {
  beforeEach(resetDatabase);

  it('needs a sign-in and well-formed sessions', async () => {
    expect((await send(undefined, { sessions: [session()] })).status).toBe(401);
    const { token } = await signedInUser();
    for (const body of [
      {},
      { sessions: [] },
      { sessions: [session({ durationMin: 20 })] },
      { sessions: [session({ startedAt: 1.5 })] },
      { sessions: [session({ startedAt: Date.UTC(2020, 0, 1) })] },
      { sessions: [session({ onTime: 'yes' })] },
      { sessions: Array.from({ length: 51 }, (_, i) => session({ startedAt: START + i })) },
    ]) {
      expect((await send(token, body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });

  it('keeps each session once, skips unknown problems, and counts them in the level, badges and skill map', async () => {
    const { id, token } = await signedInUser();
    const before = await achievements(token);
    expect(before.stats).toMatchObject({ interviews: 0, soloInterviews: 0 });

    const first = await send(token, { sessions: [session(), session({ problem: 'no-such-problem' })] });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ added: 1 });
    // Sent again (a reload, another sign-in): nothing new.
    expect(await (await send(token, { sessions: [session(), session({ startedAt: START + 1, onTime: true })] })).json()).toEqual({ added: 1 });

    const after = await achievements(token);
    // Two sessions of one problem: it counts once.
    expect(after.stats).toMatchObject({ interviews: 0, soloInterviews: 1 });
    const badge = (a: AchievementsAnswer, badgeId: string) => a.achievements.find((b) => b.id === badgeId)!;
    expect(badge(after, 'interview-first').earned).toBe(true);
    expect(badge(after, 'interview-on-time').earned).toBe(true);
    expect(badge(after, 'interview-passed').earned).toBe(false);
    expect(badge(after, 'interviews-5')).toMatchObject({ current: 1, target: 5 });

    const exported = (await (await call('/api/me/export', { token })).json()) as { soloInterviews: { problem: string }[] };
    expect(exported.soloInterviews.map((s) => s.problem)).toEqual(['url-shortener', 'url-shortener']);
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM solo_interviews WHERE user_id = ?').bind(id).first<{ n: number }>())!.n).toBe(0);
  });

  it('counts an AI interview’s verdict: a pass, on time, and its scores in the skill map', async () => {
    const { id, token } = await signedInUser();
    const before = await achievements(token);
    const verdict = { passed: true, scores: { requirements: 5, estimation: 5, design: 5, tradeoffs: 5, communication: 5 }, wentWell: [], wentWrong: [], nextSteps: [] };
    await env.DB.prepare(
      "INSERT INTO ai_interviews (id, user_id, problem_id, duration_min, status, started_at, ended_at, verdict) VALUES ('i1', ?, 'url-shortener', 45, 'finished', ?, ?, ?)",
    )
      .bind(id, START, START + 40 * 60_000, JSON.stringify(verdict))
      .run();
    const after = await achievements(token);
    expect(after.stats).toMatchObject({ interviews: 1, soloInterviews: 0 });
    for (const badgeId of ['interview-first', 'interview-passed', 'interview-on-time']) expect(after.achievements.find((b) => b.id === badgeId)!.earned, badgeId).toBe(true);
    const estimation = (a: AchievementsAnswer) => a.skills.topics.find((t) => t.topic === 'estimation')!.mastery;
    expect(estimation(after)).toBeGreaterThan(estimation(before));
  });
});
