import { useEffect, useState, useSyncExternalStore } from 'react';
import { billingEnabled, getPlan, PLAN_CHANGED, type CreditBalance, type PlanInfo } from './billing';
import { getEstimates, TYPICAL_COSTS, type CreditEstimates } from './credits';

/**
 * The account's plan and credits, read once for the whole page and shared by
 * the header's chip, Settings and every place that spends credits. Read again
 * on PLAN_CHANGED (a purchase landed) and on `refreshCredits()`, which a page
 * calls after an action charged credits; `reportBalance` shows a balance the
 * API just answered (`credits.balance`) at once.
 *
 *   const { credits, plan } = useCredits(signedIn)
 *   refreshCredits()
 */

interface PlanState {
  plan?: PlanInfo;
  error?: string;
}

let state: PlanState = {};
let asked = 0;
let pending = false;
const listeners = new Set<() => void>();

const set = (next: PlanState) => {
  state = next;
  for (const l of listeners) l();
};

/** Asks GET /api/me/plan again; the latest ask's answer wins. */
export function refreshCredits(): void {
  if (!billingEnabled) return;
  const ask = ++asked;
  pending = true;
  getPlan().then(
    (plan) => ask === asked && set({ plan }),
    (e: unknown) => ask === asked && set({ ...state, error: e instanceof Error ? e.message : String(e) }),
  ).finally(() => {
    if (ask === asked) pending = false;
  });
}

/** A balance an API answer just gave (e.g. a Design partner turn's `credits.balance`): shown now, the breakdown read again. */
export function reportBalance(balance: number): void {
  if (state.plan) set({ ...state, plan: { ...state.plan, credits: { ...state.plan.credits, balance } } });
  refreshCredits();
}

if (typeof window !== 'undefined') window.addEventListener(PLAN_CHANGED, () => listeners.size > 0 && refreshCredits());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The shared plan while `signedIn` and billing is on; undefined until it answers. */
export function usePlanState(signedIn: boolean): PlanState {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const on = signedIn && billingEnabled;
  useEffect(() => {
    if (on && !snapshot.plan && !pending) refreshCredits();
    // Only when it turns on: the store keeps the answer for every later reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return on ? snapshot : {};
}

/** The account's credits and plan name (`free`, `pro`, `max`); undefined until known. */
export function useCredits(signedIn: boolean): { credits?: CreditBalance; plan?: string; error?: string } {
  const { plan, error } = usePlanState(signedIn);
  return { credits: plan?.credits, plan: plan?.plan, error };
}

let estimates: Promise<CreditEstimates> | undefined;

/** GET /api/credits/estimates once a page load while `signedIn`; the typical costs until then, signed out, or if it fails. */
export function useEstimates(signedIn: boolean): CreditEstimates {
  const [answer, setAnswer] = useState<CreditEstimates>(TYPICAL_COSTS);
  useEffect(() => {
    if (!signedIn || !billingEnabled) return;
    let live = true;
    estimates ??= getEstimates().catch(() => {
      estimates = undefined;
      return TYPICAL_COSTS;
    });
    void estimates.then((e) => live && setAnswer(e));
    return () => {
      live = false;
    };
  }, [signedIn]);
  return answer;
}
