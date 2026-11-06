import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { balance, grantStatement, periodOf, refund, spend } from '../src/credits';
import { resetDatabase, signedInUser } from './helpers';

/** The AI interview credit ledger (src/credits.ts). */

const NOV = Date.parse('2026-11-10T12:00:00Z');
const DEC = Date.parse('2026-12-01T00:00:00Z');

const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();
const grant = (id: string, n: number, order: string) => grantStatement(env.DB, id, n, 'pack_5', order).run();

describe('credits', () => {
  beforeEach(resetDatabase);

  it('give a free account one interview for life', async () => {
    const { id } = await signedInUser();
    expect(await balance(env, id, NOV)).toEqual({ total: 1, monthly: 0, trial: 1, pack: 0, period: '2026-11' });
    expect(await spend(env, id, 'interview', 's1', NOV)).toEqual({ ok: true, bucket: 'trial' });
    expect(await spend(env, id, 'interview', 's2', NOV)).toEqual({ ok: false, reason: 'no_credits' });
    // A new month gives a free account nothing new.
    expect((await balance(env, id, DEC)).total).toBe(0);
  });

  it('give Pro 4 a month, reset each month, before the trial and packs', async () => {
    const { id } = await signedInUser();
    await setPlan(id, 'pro');
    await grant(id, 5, 'order-1');
    expect(await balance(env, id, NOV)).toMatchObject({ total: 10, monthly: 4, trial: 1, pack: 5 });
    const buckets = [];
    for (let i = 0; i < 6; i++) buckets.push(((await spend(env, id, 'interview', `n${i}`, NOV)) as { bucket: string }).bucket);
    expect(buckets).toEqual(['monthly', 'monthly', 'monthly', 'monthly', 'trial', 'pack']);
    expect(await balance(env, id, NOV)).toMatchObject({ total: 4, monthly: 0, trial: 0, pack: 4 });
    // December: a fresh allowance; November's unused credits would not have rolled over.
    expect(await balance(env, id, DEC)).toMatchObject({ total: 8, monthly: 4, pack: 4, period: '2026-12' });
    expect(await spend(env, id, 'interview', 'd1', DEC)).toEqual({ ok: true, bucket: 'monthly' });
    expect(periodOf(DEC)).toBe('2026-12');
  });

  it('spend once per refId, and refund once to the same bucket', async () => {
    const { id } = await signedInUser();
    expect(await spend(env, id, 'interview', 'same', NOV)).toEqual({ ok: true, bucket: 'trial' });
    expect(await spend(env, id, 'interview', 'same', NOV)).toEqual({ ok: true, bucket: 'trial' });
    expect((await balance(env, id, NOV)).total).toBe(0);
    expect(await refund(env, 'same')).toEqual({ refunded: true });
    expect(await refund(env, 'same')).toEqual({ refunded: false });
    expect(await refund(env, 'never-spent')).toEqual({ refunded: false });
    expect(await balance(env, id, NOV)).toMatchObject({ total: 1, trial: 1 });
  });

  it('never let racing spends take more than there is', async () => {
    const { id } = await signedInUser();
    await setPlan(id, 'pro');
    await grant(id, 2, 'order-race');
    // 4 monthly + 1 trial + 2 pack = 7 credits, 20 interviews started at once.
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => spend(env, id, 'interview', `race-${i}`, NOV)));
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect(await balance(env, id, NOV)).toMatchObject({ total: 0, monthly: 0, trial: 0, pack: 0 });
    const sum = await env.DB.prepare("SELECT SUM(delta) AS s FROM credits WHERE user_id = ? AND bucket = 'pack'").bind(id).first<{ s: number }>();
    expect(sum?.s).toBe(0);
  });

  it('never refund twice when refunds race', async () => {
    const { id } = await signedInUser();
    await spend(env, id, 'interview', 'r1', NOV);
    const results = await Promise.all(Array.from({ length: 10 }, () => refund(env, 'r1')));
    expect(results.filter((r) => r.refunded)).toHaveLength(1);
    expect((await balance(env, id, NOV)).total).toBe(1);
  });

  it('give a pack once per order, and keep pack credits after a downgrade', async () => {
    const { id } = await signedInUser();
    await setPlan(id, 'pro');
    await grant(id, 5, 'order-x');
    await grant(id, 5, 'order-x');
    await setPlan(id, 'free');
    expect(await balance(env, id, NOV)).toMatchObject({ total: 6, monthly: 0, trial: 1, pack: 5 });
  });
});
