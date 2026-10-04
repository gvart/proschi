import { loadJson, saveJson } from '../services/storage';
import type { ServerProgress } from '../services/api';
import type { Progress, Status } from './progress';

/**
 * Practice accounts (backend/): the session token kept in this browser, the
 * sign-in redirect's URL parameters, and how browser and server progress
 * combine. Signed out, nothing here runs and progress stays in the browser.
 */

export const SESSION_KEY = 'proschi.session';
export const NONCE_KEY = 'proschi.login-nonce';

export interface Session {
  token: string;
  /** Unix seconds. */
  expiresAt: number;
}

export function loadSession(now = Date.now()): Session | undefined {
  const s = loadJson<Partial<Session> | null>(SESSION_KEY, null);
  if (!s || typeof s.token !== 'string' || typeof s.expiresAt !== 'number' || s.expiresAt * 1000 <= now) return undefined;
  return { token: s.token, expiresAt: s.expiresAt };
}

export function saveSession(session: Session | undefined): void {
  if (session) saveJson(SESSION_KEY, session);
  else
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Storage unavailable: nothing was saved.
    }
}

/**
 * A new sign-in nonce, kept in this tab until the API redirects back; the
 * login code is exchanged only together with it. Undefined without storage.
 */
export function newLoginNonce(): string | undefined {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem(NONCE_KEY, nonce);
    return nonce;
  } catch {
    return undefined;
  }
}

/** The nonce of the sign-in this tab started, once. */
export function takeLoginNonce(): string | undefined {
  try {
    const nonce = sessionStorage.getItem(NONCE_KEY) ?? undefined;
    sessionStorage.removeItem(NONCE_KEY);
    return nonce;
  } catch {
    return undefined;
  }
}

/**
 * The sign-in result the API appended to the page URL (`login` code or
 * `login_error`), and the URL without them, to put back in the address bar.
 */
export function takeLoginParams(href: string): { code?: string; error?: string; cleanUrl: string } {
  const url = new URL(href);
  const code = url.searchParams.get('login') ?? undefined;
  const error = url.searchParams.get('login_error') ?? undefined;
  url.searchParams.delete('login');
  url.searchParams.delete('login_error');
  return { ...(code ? { code } : {}), ...(error ? { error } : {}), cleanUrl: url.toString() };
}

const RANK: Status[] = ['todo', 'attempted', 'solved'];

/**
 * Browser progress with the server's added: per problem the better status
 * wins, and the browser's last design stays (the server's fills in where the
 * browser has none, e.g. on a new device).
 */
export function mergeServerProgress(local: Progress, server: Record<string, ServerProgress>): Progress {
  const out: Progress = { ...local };
  for (const [id, remote] of Object.entries(server)) {
    const mine = out[id];
    const status = !mine || RANK.indexOf(remote.status) > RANK.indexOf(mine.status) ? remote.status : mine.status;
    const source = mine?.source ?? remote.source;
    out[id] = { status, ...(source !== undefined ? { source } : {}) };
  }
  return out;
}

/** Browser progress the server does not have yet, to upload on sign-in. */
export function progressToImport(local: Progress, server: Record<string, ServerProgress>): { id: string; source: string; solved: boolean }[] {
  return Object.entries(local)
    .filter(([id, entry]) => !server[id] && entry.source !== undefined && entry.status !== 'todo')
    .map(([id, entry]) => ({ id, source: entry.source!, solved: entry.status === 'solved' }));
}
