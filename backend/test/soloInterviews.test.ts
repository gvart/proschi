import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AchievementsAnswer } from '../../frontend/src/learn/achievements';
import { call, resetDatabase, signedInUser } from './helpers';

const send = (token: string | undefined, body: unknown) => call('/api/me/interviews/solo', { method: 'POST', token, body });
const START = Date.UTC(2026, 10, 1);
const MIN = 60_000;
/** Twelve minutes, Design not reached: it counts by time. */
const session = (over: Record<string, unknown> = {}) => ({ problem: 'url-shortener', startedAt: START, durationMin: 45, totalMs: 12 * MIN, reachedDesign: false, drew: false, solved: false, ...over });
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
      { sessions: [session({ solved: 'yes' })] },
      { sessions: [session({ totalMs: -1 })] },
      { sessions: [session({ drew: undefined })] },
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
    expect(await (await send(token, { sessions: [session(), session({ startedAt: START + 1, totalMs: 40 * MIN, solved: true })] })).json()).toEqual({ added: 1 });

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

  it('keeps a short session as it was but counts it only with 10 minutes, or Design reached with a drawing', async () => {
    const { token } = await signedInUser();
    const short = [
      session({ totalMs: 60_000 }),
      // Design reached, nothing drawn; drawn, Design not reached.
      session({ startedAt: START + 1, totalMs: 60_000, reachedDesign: true }),
      session({ startedAt: START + 2, totalMs: 60_000, drew: true, solved: true }),
    ];
    expect(await (await send(token, { sessions: short })).json()).toEqual({ added: 3 });
    let answer = await achievements(token);
    expect(answer.stats.soloInterviews).toBe(0);
    expect(answer.achievements.find((b) => b.id === 'interview-first')!.earned).toBe(false);
    const exported = (await (await call('/api/me/export', { token })).json()) as { soloInterviews: { totalMs: number }[] };
    expect(exported.soloInterviews.map((s) => s.totalMs)).toEqual([60_000, 60_000, 60_000]);

    // Two minutes, but Design reached with a drawing: it counts, and solved within its time.
    await send(token, { sessions: [session({ problem: 'pastebin', totalMs: 2 * MIN, reachedDesign: true, drew: true, solved: true })] });
    answer = await achievements(token);
    expect(answer.stats.soloInterviews).toBe(1);
    expect(answer.achievements.find((b) => b.id === 'interview-on-time')!.earned).toBe(true);
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

  it('keeps what each did and answers it to Pro only, newest first, filling in a session kept without it', async () => {
    const { id, token } = await signedInUser();
    const results = {
      phases: { clarify: 4 * MIN, estimate: 3 * MIN, design: 20 * MIN, wrapup: 2 * MIN },
      questions: { asked: 5, good: 3, weak: 2, goodTotal: 4 },
      estimates: { answered: 2, correct: 1, total: 2 },
      tests: { passed: 5, total: 6 },
      checklist: { checked: 4, total: 4 },
    };
    for (const bad of [{ ...results, phases: { clarify: 1 } }, { ...results, questions: { asked: -1, good: 0, weak: 0, goodTotal: 3 } }, { ...results, tests: { passed: 'all' } }, 'yes']) {
      expect((await send(token, { sessions: [session({ results: bad })] })).status).toBe(400);
    }
    // Kept first without results (sent before they were), then filled in; a later send changes nothing.
    expect(await (await send(token, { sessions: [session()] })).json()).toEqual({ added: 1 });
    expect(await (await send(token, { sessions: [session({ results }), session({ startedAt: START + MIN, results: { ...results, tests: undefined } })] })).json()).toEqual({ added: 2 });
    expect(await (await send(token, { sessions: [session({ results: { ...results, checklist: { checked: 0, total: 4 } } })] })).json()).toEqual({ added: 0 });

    const history = () => call('/api/me/interviews/solo', { token });
    expect((await call('/api/me/interviews/solo', {})).status).toBe(401);
    const free = await history();
    expect(free.status).toBe(402);
    expect(await free.json()).toMatchObject({ error: 'plan_required', feature: 'interview_history' });

    await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(id).run();
    const pro = await history();
    expect(pro.status).toBe(200);
    const { sessions } = (await pro.json()) as { sessions: { startedAt: number; results?: typeof results }[] };
    expect(sessions.map((s) => s.startedAt)).toEqual([START + MIN, START]);
    expect(sessions[1]).toEqual({ problem: 'url-shortener', startedAt: START, durationMin: 45, totalMs: 12 * MIN, reachedDesign: false, drew: false, solved: false, results });
    expect(sessions[0].results).not.toHaveProperty('tests');
    const exported = (await (await call('/api/me/export', { token })).json()) as { soloInterviews: { results?: unknown }[] };
    expect(exported.soloInterviews[0].results).toEqual(results);
  });
});
