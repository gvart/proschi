import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../frontend/src/learn/interviewPlan';
import { call, resetDatabase, signedInUser } from './helpers';

/** The interview-date plan's route (src/interviewPlan.ts, P55): Max only, validated, exported and deleted. */

const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();
const today = () => new Date().toISOString().slice(0, 10);
const put = (token: string | undefined, body: unknown) => call('/api/me/interview-plan', { method: 'PUT', token, body });
const get = (token: string | undefined) => call('/api/me/interview-plan', { token });

describe('the interview-date plan', () => {
  beforeEach(resetDatabase);

  it('is for Max: 401 signed out, 402 plan_required on Free and Pro', async () => {
    const body = { date: addDays(today(), 10), minutes: 45, start: today() };
    expect((await get(undefined)).status).toBe(401);
    const { id, token } = await signedInUser();
    for (const plan of ['free', 'pro']) {
      await setPlan(id, plan);
      for (const res of [await get(token), await put(token, body)]) {
        expect(res.status).toBe(402);
        expect(await res.json()).toMatchObject({ error: 'plan_required', feature: 'interview_plan' });
      }
    }
  });

  it('keeps the date, minutes and start, and today’s list for the reminder', async () => {
    const { id, token } = await signedInUser();
    await setPlan(id, 'max');
    expect(await (await get(token)).json()).toEqual({ plan: null });
    const plan = { date: addDays(today(), 10), minutes: 60, start: today() };
    const res = await put(token, { ...plan, today: { day: today(), items: [{ title: 'Try Chat', done: false }] } });
    expect(res.status).toBe(200);
    expect(await (await get(token)).json()).toEqual({ plan });
    // Without today, the kept list stays.
    expect((await put(token, { ...plan, minutes: 30 })).status).toBe(200);
    const row = await env.DB.prepare('SELECT minutes, today_day, today_items FROM interview_plans WHERE user_id = ?').bind(id).first();
    expect(row).toEqual({ minutes: 30, today_day: today(), today_items: JSON.stringify([{ title: 'Try Chat', done: false }]) });
    const exported = (await (await call('/api/me/export', { token })).json()) as { interviewPlan: unknown };
    expect(exported.interviewPlan).toEqual({ date: plan.date, minutes: 30, start: plan.start, todayDay: today(), today: [{ title: 'Try Chat', done: false }] });
  });

  it('refuses a bad date, minutes or list', async () => {
    const { id, token } = await signedInUser();
    await setPlan(id, 'max');
    const ok = { date: addDays(today(), 10), minutes: 45, start: today() };
    for (const body of [
      {},
      { ...ok, date: '2026-02-30' },
      { ...ok, date: addDays(today(), -5), start: addDays(today(), -9) },
      { ...ok, date: addDays(today(), 200) },
      { ...ok, minutes: 5 },
      { ...ok, minutes: 45.5 },
      { ...ok, start: addDays(today(), 11) },
      { ...ok, today: { day: today(), items: Array.from({ length: 9 }, () => ({ title: 'x', done: false })) } },
      { ...ok, today: { day: today(), items: [{ title: 'x'.repeat(121), done: false }] } },
      { ...ok, today: { day: 'today', items: [] } },
    ]) {
      expect((await put(token, body)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it('can be removed on any plan, and goes with the account', async () => {
    const { id, token } = await signedInUser();
    await setPlan(id, 'max');
    await put(token, { date: addDays(today(), 10), minutes: 45, start: today() });
    await setPlan(id, 'free');
    expect((await call('/api/me/interview-plan', { method: 'DELETE', token })).status).toBe(204);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM interview_plans').first('n')).toBe(0);
    await setPlan(id, 'max');
    await put(token, { date: addDays(today(), 10), minutes: 45, start: today() });
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBeLessThan(300);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM interview_plans').first('n')).toBe(0);
  });
});
