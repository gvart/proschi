import { api } from '../services/api';

/**
 * The sign-in page's API calls (backend src/emailAuth.ts) and what it reads
 * from its address: `?return=` (where to go once signed in), `?link=1` (add
 * an email sign-in to the signed-in account) and the email links' hash,
 * `#confirm=<token>` or `#reset=<token>` (a hash, so the token never reaches
 * a server log or a Referer).
 */

export type SignupReason = 'unconfirmed' | 'granted' | 'disposable' | 'seen_before' | 'ip_limit';
export interface SignupCredits {
  outcome: 'pending' | 'granted' | 'refused';
  reason: SignupReason;
}

export interface EmailStatus {
  signedIn: boolean;
  email: string | null;
  confirmed: boolean;
  signupCredits: SignupCredits | null;
}

export interface Place {
  returnTo: string;
  link: boolean;
  confirm?: string;
  reset?: string;
}

/** A path on this site; anything else becomes the practice page. */
export function safeReturn(path: string | null): string {
  return path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') && ![...path].some((c) => c.charCodeAt(0) < 32) ? path : '/practice/';
}

export function readPlace(href: string): Place {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    returnTo: safeReturn(url.searchParams.get('return')),
    link: url.searchParams.get('link') === '1',
    ...(hash.get('confirm') ? { confirm: hash.get('confirm')! } : {}),
    ...(hash.get('reset') ? { reset: hash.get('reset')! } : {}),
  };
}

/** What the page says about the sign-up credits. No "AI" anywhere (P25). */
export function creditsMessage(credits: SignupCredits | null | undefined): { tone: 'good' | 'info' | 'warn'; text: string } | undefined {
  if (!credits) return undefined;
  if (credits.outcome === 'granted') return { tone: 'good', text: 'Your free sign-up credits are in your account.' };
  if (credits.outcome === 'pending') return { tone: 'warn', text: 'Confirm your email to get your free sign-up credits.' };
  if (credits.reason === 'disposable') {
    return { tone: 'info', text: "Free credits aren't given to disposable email addresses. Your account works, and you can buy credits any time." };
  }
  return { tone: 'info', text: 'Free credits are limited to one account per person, so this account has none. It works as usual, and you can buy credits any time.' };
}

export const getProviders = () => api<{ providers: string[]; turnstileSiteKey?: string }>('/auth/providers');
export const getStatus = () => api<EmailStatus>('/auth/email/status');
export const signUp = (body: { email: string; password: string; turnstile?: string; link?: boolean }) => api<{ message: string }>('/auth/email/signup', { method: 'POST', body });
export const signIn = (body: { email: string; password: string; turnstile?: string }) => api<{ confirmed: boolean }>('/auth/email/login', { method: 'POST', body });
export const confirmEmail = (token: string) => api<{ confirmed: true; signupCredits: SignupCredits | null }>('/auth/email/confirm', { method: 'POST', body: { token } });
export const resendConfirmation = () => api<{ sent?: boolean; message?: string; confirmed?: boolean }>('/auth/email/resend', { method: 'POST' });
export const requestReset = (body: { email: string; turnstile?: string }) => api<{ message: string }>('/auth/email/reset-request', { method: 'POST', body });
export const resetPassword = (token: string, password: string) => api<{ reset: true; signupCredits: SignupCredits | null }>('/auth/email/reset', { method: 'POST', body: { token, password } });

export const MIN_PASSWORD = 10;
