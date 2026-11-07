import type { Env } from './env';
import { estimateMc, hold, release, settle, topUp, type Usage } from './meter';

/**
 * Design partner's use of the credit ledger (src/meter.ts, docs/design/
 * paid-plans.md P27): a thin seam, so the routes call the meter through one
 * object the tests can spy on. A turn holds its estimate before the model is
 * called (and tops it up before a retry or a repair), then settles with the
 * real usage of every call the model answered, or releases the hold when the
 * turn failed before the model answered (nothing is charged, P34).
 */
export const partnerBilling = {
  estimateMc: (model: string, maxOutputTokens: number, approxInputTokens: number, env: Env): number => estimateMc(model, maxOutputTokens, approxInputTokens, env),
  hold: (env: Env, userId: string, amountMc: number, ref: string) => hold(env, userId, amountMc, ref),
  settle: (env: Env, holdId: string, usage: Usage[], deep: boolean) => settle(env, holdId, usage, 'design_partner', deep),
  release: (env: Env, holdId: string): Promise<void> => release(env, holdId),
  topUp: (env: Env, holdId: string, userId: string, extraMc: number): Promise<boolean> => topUp(env, holdId, userId, extraMc),
};

/** Millicredits as the contract's credits: a decimal with up to 3 places. */
export const credits = (mc: number): number => Math.round(mc) / 1000;
