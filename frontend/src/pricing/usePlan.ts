import type { PlanInfo } from '../services/billing';
import { refreshCredits, usePlanState } from '../services/useCredits';

/** GET /api/me/plan while `signedIn` and billing is on (shared with useCredits); undefined until it answers (or without billing). `reload` asks again, as does PLAN_CHANGED. */
export function usePlan(signedIn: boolean): { plan?: PlanInfo; error?: string; reload: () => void } {
  return { ...usePlanState(signedIn), reload: refreshCredits };
}
