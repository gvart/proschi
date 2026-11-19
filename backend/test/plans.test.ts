import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectivePlan, effectivePlanSql, FREE_LIMITS, limitsFor, PLANS } from '../src/plans';
import { call, resetDatabase, signedInUser } from './helpers';

/** Plans and their limits: src/plans.ts and GET /api/me/limits. */

describe('plans', () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    delete PLANS.team;
  });

  it('give an unknown plan the free limits', () => {
    expect(FREE_LIMITS).toEqual({ documents: 5, versionsPerDocument: 20, documentBytes: 64 * 1024, monthlyCredits: 0 });
    expect(limitsFor('pro')).toMatchObject({ documents: 1000, monthlyCredits: 800 });
    expect(limitsFor('max')).toMatchObject({ documents: 1000, monthlyCredits: 2200 });
    expect(limitsFor('free')).toBe(FREE_LIMITS);
    expect(limitsFor('gold')).toBe(FREE_LIMITS);
    expect(limitsFor('toString')).toBe(FREE_LIMITS);
    expect(limitsFor(null)).toBe(FREE_LIMITS);
  });

  it('are reported with what the account uses', async () => {
    expect((await call('/api/me/limits')).status).toBe(401);
    const { id, token } = await signedInUser();
    expect((await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(id).first<{ plan: string }>())?.plan).toBe('free');
    await call('/api/me/documents/d1', { method: 'PUT', token, body: { name: 'a.proschi', source: '', baseVersion: 0 } });
    const response = await call('/api/me/limits', { token });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ plan: 'free', limits: FREE_LIMITS, usage: { documents: 1 } });

    await env.DB.prepare("UPDATE users SET plan = 'gold' WHERE id = ?").bind(id).run();
    expect(await (await call('/api/me/limits', { token })).json()).toMatchObject({ plan: 'free', limits: FREE_LIMITS });
  });

  it("apply the account's plan to synced diagrams", async () => {
    PLANS.team = { ...FREE_LIMITS, documents: 1, versionsPerDocument: 2, documentBytes: 10 };
    const { id, token } = await signedInUser();
    await env.DB.prepare("UPDATE users SET plan = 'team' WHERE id = ?").bind(id).run();
    expect(await (await call('/api/me/limits', { token })).json()).toMatchObject({ plan: 'team', limits: PLANS.team });
    const put = (docId: string, source: string) => call(`/api/me/documents/${docId}`, { method: 'PUT', token, body: { name: 'a.proschi', source, baseVersion: 0 } });
    expect((await put('big', 'x'.repeat(11))).status).toBe(413);
    expect((await put('d1', 'x'.repeat(10))).status).toBe(200);
    const full = await put('d2', '');
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: 'document_limit', limit: 1, used: 1 });
    expect(await (await call('/api/me/documents', { token })).json()).toMatchObject({ limit: 1, used: 1 });
  });

  it('resolve a comp the same way in TypeScript and in SQL: the higher of the stored plan and the running comp', async () => {
    const { id } = await signedInUser();
    const at = 1_000;
    const rows: [string, number | null, string | null, string][] = [
      ['free', null, null, 'free'],
      ['free', at + 1, null, 'pro'],
      ['free', at + 1, 'pro', 'pro'],
      ['free', at + 1, 'max', 'max'],
      ['free', at, 'max', 'free'],
      ['pro', at + 1, 'max', 'max'],
      ['pro', at - 1, 'max', 'pro'],
      ['pro', null, 'max', 'pro'],
      ['max', at + 1, 'pro', 'max'],
      ['max', at + 1, null, 'max'],
      ['gold', at + 1, null, 'pro'],
      ['gold', at - 1, 'max', 'gold'],
    ];
    for (const [plan, compUntil, compPlan, expected] of rows) {
      await env.DB.prepare('UPDATE users SET plan = ?, comp_until = ?, comp_plan = ? WHERE id = ?').bind(plan, compUntil, compPlan, id).run();
      const sql = await env.DB.prepare(`SELECT ${effectivePlanSql('u', '?')} AS p FROM users u WHERE u.id = ?`).bind(at, id).first<{ p: string }>();
      expect([plan, compUntil, compPlan, effectivePlan(plan, compUntil, compPlan, at)]).toEqual([plan, compUntil, compPlan, expected]);
      expect([plan, compUntil, compPlan, sql?.p]).toEqual([plan, compUntil, compPlan, expected]);
    }
  });
});
