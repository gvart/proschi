import { api } from '../services/api';

/**
 * Sign-in methods and the free sign-up credits' checks (backend
 * src/adminSignups.ts; docs/design/paid-plans.md P26).
 */

export type SignupReason = 'unconfirmed' | 'granted' | 'disposable' | 'seen_before' | 'ip_limit';

export interface UserSignIn {
  methods: string[];
  confirmed: boolean;
  confirmedAt: number | null;
  signupCredits: { outcome: 'pending' | 'granted' | 'refused'; reason: SignupReason; decidedAt: number | null } | null;
}

export interface Signups {
  refusedToday: number;
  byReason: { reason: SignupReason; n: number }[];
}

export const getUserSignIn = (id: string) => api<UserSignIn>(`/api/admin/users/${encodeURIComponent(id)}/sign-in`);
export const getSignups = () => api<Signups>('/api/admin/signups');

export const METHOD_LABEL: Record<string, string> = { github: 'GitHub', google: 'Google', email: 'Email and password' };

/** Why an account did or didn't get its sign-up credits, for the admin. */
export const REASON_LABEL: Record<SignupReason, string> = {
  unconfirmed: 'Waiting for the email confirmation',
  granted: 'Granted: passed every check',
  disposable: 'Refused: disposable email domain',
  seen_before: 'Refused: this person had an account before (same address or sign-in)',
  ip_limit: 'Refused: 3 accounts from this IP already got credits this week',
};

/** "2 seen before, 1 disposable". */
export function refusedSummary(s: Signups): string {
  if (!s.refusedToday) return 'No sign-ups refused free credits today';
  const parts = s.byReason.map((r) => `${r.n} ${r.reason.replace('_', ' ')}`);
  return `${s.refusedToday} ${s.refusedToday === 1 ? 'sign-up' : 'sign-ups'} refused free credits today (${parts.join(', ')})`;
}
