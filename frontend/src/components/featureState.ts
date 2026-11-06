import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AccountState } from '../practice/useAccount';
import { billingEnabled, getPlan } from '../services/billing';
import type { FeatureAccess, FeatureId, FeatureReason } from '../services/featureContract';

/**
 * The paid features on the page (docs/design/paid-plans.md P22). The server
 * decides who gets what (backend/src/features.ts) and says so in GET
 * /api/me/plan's `features`; the page only reads that answer, never the plan.
 *
 *   const features = useFeatures(account.state)    once per app, given to <FeaturesContext.Provider value={features}>
 *   useFeature('ai_review')                        {ok, reason, loading} inside it
 *   <Feature name="share_links" pro={…} free={…} />    ./Feature.tsx
 */

export interface FeatureState {
  ok: boolean;
  /** Why not, when the answer is known; absent while loading or when the plan could not be read. */
  reason?: FeatureReason;
  /** The account or its plan is still loading: show neither the paid UI nor the hint yet. */
  loading: boolean;
}

const LOADING: FeatureState = { ok: false, loading: true };
const SIGNED_OUT: FeatureState = { ok: false, reason: 'signed_out', loading: false };
const UNKNOWN: FeatureState = { ok: false, loading: false };

export type FeatureLookup = (id: FeatureId) => FeatureState;

/** Outside an app's provider (a build without accounts, a test): signed out. */
export const FeaturesContext = createContext<FeatureLookup>(() => SIGNED_OUT);

/** Reads the signed-in account's features once per account; `account` is the app's (practice/useAccount.ts). */
export function useFeatures(account: AccountState): FeatureLookup {
  const userId = account.status === 'signed-in' ? account.user.id : undefined;
  const [answer, setAnswer] = useState<{ userId: string; features: Partial<Record<FeatureId, FeatureAccess>> | null }>();
  useEffect(() => {
    if (!userId) return;
    let live = true;
    getPlan().then(
      (plan) => live && setAnswer({ userId, features: plan.features ?? null }),
      () => live && setAnswer({ userId, features: null }),
    );
    return () => {
      live = false;
    };
  }, [userId]);
  const status = account.status;
  return useCallback(
    (id: FeatureId) => {
      if (status === 'loading') return LOADING;
      if (status !== 'signed-in') return SIGNED_OUT;
      if (!answer || answer.userId !== userId) return LOADING;
      const f = answer.features?.[id];
      if (!f) return UNKNOWN;
      return f.ok ? { ok: true, loading: false } : { ok: false, reason: f.reason, loading: false };
    },
    [status, userId, answer],
  );
}

export const useFeature = (id: FeatureId): FeatureState => useContext(FeaturesContext)(id);

/** Whether the page offers the way to Pro: paid plans are on and the viewer is signed out or on a plan without the feature. */
export const showsUpgrade = (state: FeatureState): boolean => billingEnabled && !state.ok && (state.reason === 'needs_pro' || state.reason === 'signed_out');
