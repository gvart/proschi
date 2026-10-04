import type { ServerProgress } from '../services/api';
import type { Progress, Status } from './progress';

/**
 * Practice accounts (backend/): the sign-in redirect's URL parameter and how
 * browser and server progress combine. Signed out, nothing here runs and
 * progress stays in the browser.
 */

/** The sign-in error the API appended to the page URL (`login_error`), and the URL without it, to put back in the address bar. */
export function takeLoginError(href: string): { error?: string; cleanUrl: string } {
  const url = new URL(href);
  const error = url.searchParams.get('login_error') ?? undefined;
  url.searchParams.delete('login_error');
  return { ...(error ? { error } : {}), cleanUrl: url.toString() };
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
