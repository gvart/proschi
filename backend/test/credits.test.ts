import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { buckets, creditsView, grantSignupCredits, identityHash, revokeStatement, tombstoneStatements, topupStatement } from '../src/credits';
import type { Env } from '../src/env';
import { balanceMc, costMc, estimateMc, estimates, hold, HOLD_TTL_MS, pruneHolds, release, settle, settleFailed, topUp, type Usage } from '../src/meter';
import { AiError } from '../src/ai/client';
import { TYPICAL_COSTS } from '../../frontend/src/services/estimates';
import { call, resetDatabase, signedInUser } from './helpers';

/** The credit ledger (src/credits.ts) and the meter (src/meter.ts): millicredits, holds, settles, plans. */

const NOV = Date.parse('2026-11-10T12:00:00Z');
const DEC = Date.parse('2026-12-01T00:00:00Z');
const e = env as Env;

const setPlan = (id: string, plan: string) => env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, id).run();
const topup = (id: string, credits: number, order: string) => topupStatement(env.DB, id, credits * 1000, 'credits_1000', order).run();
const sonnet = (input: number, output: number, extra: Partial<Usage> = {}): Usage => ({ model: 'claude-sonnet-5-5', input_tokens: input, output_tokens: output, ...extra });
const charges = async (id: string) =>
  (await env.DB.prepare('SELECT action, charged_mc, deep FROM credit_charges WHERE user_id = ? ORDER BY created_at').bind(id).all<{ action: string; charged_mc: number; deep: number }>()).results;

describe('cost', () => {
  it('is 2x the model cost in EUR at 1 credit = €0.01, rounded up to a millicredit', () => {
    // Sonnet 5.5: $2 in, $10 out per million. 1M in + 100k out = $3 → €2.85 → 285 credits → ×2 = 570 credits.
    expect(costMc(sonnet(1_000_000, 100_000), e)).toBe(570_000);
    // Opus 5.5: $4/$20, twice Sonnet.
    expect(costMc({ model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 100_000 }, e)).toBe(1_140_000);
    // Haiku 5.5: $0.10/$0.50, and $0.50/$2.50 past 100K input tokens.
    expect(costMc({ model: 'claude-haiku-5-5', input_tokens: 100_000, output_tokens: 10_000 }, e)).toBe(2_850);
    expect(costMc({ model: 'claude-haiku-5-5', input_tokens: 200_000, output_tokens: 10_000 }, e)).toBe(23_750);
    // Cache reads at $0.20 (Sonnet and Opus), cache writes at 2x input.
    expect(costMc(sonnet(0, 0, { cache_read_input_tokens: 1_000_000 }), e)).toBe(38_000);
    expect(costMc(sonnet(0, 0, { cache_creation_input_tokens: 1_000_000 }), e)).toBe(760_000);
    expect(costMc({ model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }, e)).toBe(38_000);
    expect(costMc({ model: 'claude-haiku-5-5', input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 }, e)).toBe(9_500);
    // One output token: $0.00001 → 0.0019 credits → 1.9 mc, rounded up.
    expect(costMc(sonnet(0, 1), e)).toBe(2);
    expect(costMc(sonnet(0, 0), e)).toBe(0);
    // A model not in the table is priced as the dearest.
    expect(costMc({ model: 'claude-mystery', input_tokens: 1_000_000, output_tokens: 100_000 }, e)).toBe(1_140_000);
    // The rate comes from config.
    expect(costMc(sonnet(1_000_000, 100_000), { ...e, CREDITS_USD_EUR: '1' })).toBe(600_000);
    expect(costMc(sonnet(1_000_000, 100_000), { ...e, CREDITS_USD_EUR: 'nope' })).toBe(570_000);
  });

  it('estimates the worst case: every input token a cache write, the whole max_tokens', () => {
    expect(estimateMc('claude-sonnet-5-5', 100_000, 1_000_000, e)).toBe(760_000 + 190_000);
    expect(estimateMc('claude-sonnet-5-5', 1_000, 10_000, e)).toBeGreaterThan(costMc(sonnet(10_000, 1_000), e));
    const est = estimates(e);
    expect(est.deepMultiplier).toBe(2);
    for (const k of ['mock_interview', 'partner_review', 'partner_build', 'partner_turn'] as const) expect(est[k].min).toBeLessThan(est[k].max);
  });

  it('are what the page shows before it has asked (frontend TYPICAL_COSTS), at the default rate', () => {
    expect(estimates({})).toEqual(TYPICAL_COSTS);
  });
});

describe('plans and buckets', () => {
  beforeEach(resetDatabase);

  it('give Pro 800 and Max 2,200 a UTC month, reset each month, and free none', async () => {
    const { id } = await signedInUser();
    expect(await buckets(env, id, NOV)).toEqual({ monthly: 0, signup: 0, topup: 0, held: 0 });
    await setPlan(id, 'pro');
    expect((await buckets(env, id, NOV)).monthly).toBe(800_000);
    expect(await creditsView(env, id, NOV)).toEqual({ balance: 800, monthly: { allowance: 800, left: 800, resetsAt: DEC }, signup: 0, topup: 0 });
    // A plan change mid-month adds nothing by itself: an upgrade's difference comes with its paid order (P35, src/billing.ts).
    await setPlan(id, 'max');
    expect((await buckets(env, id, NOV)).monthly).toBe(800_000);
    // December is the new plan's allowance, November's doesn't roll over.
    expect((await buckets(env, id, DEC)).monthly).toBe(2_200_000);
    await setPlan(id, 'pro');
    expect((await buckets(env, id, DEC)).monthly).toBe(2_200_000);
    await setPlan(id, 'free');
    expect(await creditsView(env, id, Date.parse('2027-01-02T00:00:00Z'))).toMatchObject({ balance: 0, monthly: null });
  });

  it('give sign-up credits once per account and once per identity, also after the account is deleted', async () => {
    const { id } = await signedInUser();
    expect(await grantSignupCredits(env, id, 'github\n42')).toBe('granted');
    expect(await grantSignupCredits(env, id, 'github\n42')).toBe('already');
    expect(await grantSignupCredits(env, id, 'email:a@example.com')).toBe('already');
    expect((await creditsView(env, id)).signup).toBe(100);
    // The same identity on a second account: nothing.
    const other = await signedInUser();
    expect(await grantSignupCredits(env, other.id, 'github\n42')).toBe('already');
    expect((await creditsView(env, other.id)).balance).toBe(0);
    // Deleted and made again: nothing either.
    const fresh = await signedInUser();
    const token = fresh.token;
    expect(await grantSignupCredits(env, fresh.id, 'github\nfresh')).toBe('granted');
    expect((await call('/api/me', { method: 'DELETE', token })).status).toBe(204);
    const again = await signedInUser();
    expect(await grantSignupCredits(env, again.id, 'github\nfresh')).toBe('already');
    // An account made before 0024 whose deleted account had the trial: its tombstone counts.
    const legacy = await signedInUser();
    await env.DB.prepare('INSERT INTO account_tombstones (identity_hash, trial_used) VALUES (?, 1)').bind(await identityHash(env.SESSION_SECRET as string, 'google', 'old')).run();
    expect(await grantSignupCredits(env, legacy.id, 'google\nold')).toBe('already');
    // An unknown account gets nothing and takes no identity.
    expect(await grantSignupCredits(env, 'no-such-user', 'github\nfree')).toBe('already');
    expect(await grantSignupCredits(env, legacy.id, 'github\nfree')).toBe('granted');
  });

  it('leave a tombstone saying the sign-up credits were given', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, `github\n${id}`);
    const [statement] = await tombstoneStatements(env, id);
    await statement.run();
    const row = await env.DB.prepare('SELECT trial_used FROM account_tombstones WHERE identity_hash = ?').bind(await identityHash(env.SESSION_SECRET as string, 'github', id)).first<{ trial_used: number }>();
    expect(row?.trial_used).toBe(1);
  });
});

describe('meter', () => {
  beforeEach(resetDatabase);

  it('holds, then charges the real cost and lets go of the rest', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\nmeter');
    const held = await hold(e, id, 30_000, 'session-1');
    if (!held.ok) throw new Error('not held');
    expect(await balanceMc(e, id)).toBe(70_000);
    const usage = [sonnet(10_000, 1_000), { model: 'claude-haiku-5-5', input_tokens: 2_000, output_tokens: 200 }];
    const expected = usage.reduce((n, u) => n + costMc(u, e), 0);
    const settled = await settle(e, held.holdId, usage, 'mock_interview', false);
    // Within a millicredit of the per-call sum: the settle rounds the total once.
    expect(Math.abs(settled.chargedMc - expected)).toBeLessThanOrEqual(1);
    expect(settled.balanceMc).toBe(100_000 - settled.chargedMc);
    // Settling again charges nothing.
    expect(await settle(e, held.holdId, usage, 'mock_interview', false)).toEqual({ chargedMc: 0, balanceMc: settled.balanceMc });
    expect(await charges(id)).toEqual([{ action: 'mock_interview', charged_mc: settled.chargedMc, deep: 0 }]);
    const usageList = (await (await call('/api/credits/usage', { token: `token-${id}` })).json()) as { items: { action: string; credits: number; deep: boolean; ref: string }[] };
    expect(usageList.items).toEqual([expect.objectContaining({ action: 'mock_interview', credits: settled.chargedMc / 1000, deep: false, ref: 'session-1' })]);
  });

  it('never charges more than the hold', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\ncap');
    const held = await hold(e, id, 5_000, 'small');
    if (!held.ok) throw new Error('not held');
    const settled = await settle(e, held.holdId, [sonnet(1_000_000, 100_000)], 'design_partner', true);
    expect(settled.chargedMc).toBe(5_000);
    expect(settled.balanceMc).toBe(95_000);
    expect(await charges(id)).toEqual([{ action: 'design_partner', charged_mc: 5_000, deep: 1 }]);
  });

  it('tops a hold up only when the balance covers it, and the settle is then capped at the larger hold', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\ntopup');
    const held = await hold(e, id, 40_000, 'retry');
    if (!held.ok) throw new Error('not held');
    expect(await topUp(e, held.holdId, id, 60_001)).toBe(false);
    expect(await balanceMc(e, id)).toBe(60_000);
    expect(await topUp(e, held.holdId, id, 50_000)).toBe(true);
    expect(await balanceMc(e, id)).toBe(10_000);
    // Another account can't top up this hold.
    const other = await signedInUser();
    await grantSignupCredits(env, other.id, 'github\ntopup-other');
    expect(await topUp(e, held.holdId, other.id, 1)).toBe(false);
    expect((await settle(e, held.holdId, [sonnet(1_000_000, 100_000)], 'design_partner', false)).chargedMc).toBe(90_000);
    // Gone once settled.
    expect(await topUp(e, held.holdId, id, 1)).toBe(false);
  });

  it('settles a failed call for what the model answered, and releases one that failed before any answer (P34)', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\nfailed');
    const a = await hold(e, id, 50_000, 'a');
    const b = await hold(e, id, 40_000, 'b');
    if (!a.ok || !b.ok) throw new Error('not held');
    const cut = new AiError('truncated', 'cut', { charge: [{ ...sonnet(1_000, 2_000), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }] });
    expect(await settleFailed(e, a.holdId, cut, 'design_partner', false)).toBe(costMc(sonnet(1_000, 2_000), e));
    expect(await settleFailed(e, b.holdId, new AiError('overloaded', 'busy'), 'design_partner', false)).toBe(0);
    expect(await balanceMc(e, id)).toBe(100_000 - costMc(sonnet(1_000, 2_000), e));
  });

  it('charges nothing for a released hold (a failed call)', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\nfail');
    const held = await hold(e, id, 50_000, 'x');
    if (!held.ok) throw new Error('not held');
    await release(e, held.holdId);
    expect(await balanceMc(e, id)).toBe(100_000);
    expect(await settle(e, held.holdId, [sonnet(1000, 1000)], 'verdict', false)).toEqual({ chargedMc: 0, balanceMc: 0 });
    expect(await balanceMc(e, id)).toBe(100_000);
    expect(await charges(id)).toEqual([]);
  });

  it('refuses a hold the balance can’t cover, with what was needed', async () => {
    const { id } = await signedInUser();
    expect(await hold(e, id, 1, 'r')).toEqual({ ok: false, neededMc: 1, balanceMc: 0 });
    await topup(id, 1, 'order-small');
    expect(await hold(e, id, 1_001, 'r')).toEqual({ ok: false, neededMc: 1_001, balanceMc: 1_000 });
    expect((await hold(e, id, 1_000, 'r')).ok).toBe(true);
  });

  it('never lets parallel holds overdraw', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\nrace');
    // 100 credits, 25 holds of 10 at once: 10 pass.
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => hold(e, id, 10_000, `race-${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await balanceMc(e, id)).toBe(0);
    // Settled at once, each for its real cost: the balance is exactly what is left.
    const settled = await Promise.all(results.flatMap((r) => (r.ok ? [settle(e, r.holdId, [sonnet(1000, 100)], 'design_partner', false)] : [])));
    const total = settled.reduce((n, s) => n + s.chargedMc, 0);
    expect(await balanceMc(e, id)).toBe(100_000 - total);
    const sum = await env.DB.prepare('SELECT SUM(delta_mc) AS s FROM credits WHERE user_id = ?').bind(id).first<{ s: number }>();
    expect(sum?.s).toBe(100_000 - total);
  });

  it('stops counting a hold once it expires, so a crash can’t lock credits; the cron deletes old ones', async () => {
    const { id } = await signedInUser();
    await grantSignupCredits(env, id, 'github\nexpiry');
    const held = await hold(e, id, 80_000, 'crashed', 1_000);
    if (!held.ok) throw new Error('not held');
    expect(await balanceMc(e, id)).toBe(20_000);
    await env.DB.prepare('UPDATE credit_holds SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, held.holdId).run();
    expect(await balanceMc(e, id)).toBe(100_000);
    expect(await pruneHolds(env)).toBe(0);
    expect(await pruneHolds(env, Date.now() + 2 * 86_400_000)).toBe(1);
    expect(HOLD_TTL_MS).toBe(5 * 60_000);
  });

  it('spends the monthly allowance, then the sign-up credits, then the top-up', async () => {
    const { id } = await signedInUser();
    await setPlan(id, 'pro');
    await grantSignupCredits(env, id, 'github\norder');
    await topup(id, 1000, 'order-1');
    const charge = async (mc: number) => {
      const held = await hold(e, id, mc, 'spend');
      if (!held.ok) throw new Error('not held');
      // Opus output at $20 a million: 1 mc is 1/38 of a token, so use the hold's own size via a cap.
      return settle(e, held.holdId, [{ model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 10_000_000 }], 'design_partner', false);
    };
    await charge(700_000);
    expect(await buckets(env, id)).toMatchObject({ monthly: 100_000, signup: 100_000, topup: 1_000_000 });
    await charge(150_000);
    expect(await buckets(env, id)).toMatchObject({ monthly: 0, signup: 50_000, topup: 1_000_000 });
    await charge(80_000);
    expect(await buckets(env, id)).toMatchObject({ monthly: 0, signup: 0, topup: 970_000 });
    expect((await creditsView(env, id)).balance).toBe(970);
  });
});

describe('top-ups', () => {
  beforeEach(resetDatabase);

  it('are granted once per order and kept after a downgrade', async () => {
    const { id } = await signedInUser();
    await setPlan(id, 'max');
    await topup(id, 1000, 'order-x');
    await topup(id, 1000, 'order-x');
    await setPlan(id, 'free');
    expect(await creditsView(env, id)).toMatchObject({ balance: 1000, topup: 1000, monthly: null });
  });

  it('are taken back on a refund once, what is left of them, never below 0', async () => {
    const { id } = await signedInUser();
    await topup(id, 1000, 'order-a');
    await topup(id, 1000, 'order-b');
    await revokeStatement(env.DB, 'order-a').run();
    await revokeStatement(env.DB, 'order-a').run();
    expect((await buckets(env, id)).topup).toBe(1_000_000);
    const held = await hold(e, id, 700_000, 'spend');
    if (!held.ok) throw new Error('not held');
    await settle(e, held.holdId, [{ model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 10_000_000 }], 'design_partner', false);
    await revokeStatement(env.DB, 'order-b').run();
    expect((await buckets(env, id)).topup).toBe(0);
    await revokeStatement(env.DB, 'no-such-order').run();
    expect((await buckets(env, id)).topup).toBe(0);
  });
});
