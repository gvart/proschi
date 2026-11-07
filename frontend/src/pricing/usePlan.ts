import { useCallback, useEffect, useState } from 'react';
import { billingEnabled, getPlan, PLAN_CHANGED, type PlanInfo } from '../services/billing';

/** GET /api/me/plan while `signedIn` and billing is on; undefined until it answers (or without billing). `reload` asks again, as does PLAN_CHANGED. */
export function usePlan(signedIn: boolean): { plan?: PlanInfo; error?: string; reload: () => void } {
  const [state, setState] = useState<{ plan?: PlanInfo; error?: string }>({});
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!signedIn || !billingEnabled) return;
    let cancelled = false;
    getPlan().then(
      (plan) => !cancelled && setState({ plan }),
      (e: unknown) => !cancelled && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      cancelled = true;
    };
  }, [signedIn, asked]);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener(PLAN_CHANGED, reload);
    return () => window.removeEventListener(PLAN_CHANGED, reload);
  }, [reload]);
  return { ...state, reload };
}
