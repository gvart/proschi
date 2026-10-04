import type { ProviderId, ServerProgress } from '../services/api';
import type { Progress, Status } from './progress';

/**
 * Practice accounts (backend/): the sign-in redirect's URL parameter and how
 * browser and server progress combine. Signed out, nothing here runs and
 * progress stays in the browser.
 */

/**
 * The sign-in error (`login_error`) or linked provider (`linked`) the API
 * appended to the page URL, and the URL without them, to put back in the
 * address bar.
 */
export function takeLoginError(href: string): { error?: string; linked?: string; cleanUrl: string } {
  const url = new URL(href);
  const error = url.searchParams.get('login_error') ?? undefined;
  const linked = url.searchParams.get('linked') ?? undefined;
  url.searchParams.delete('login_error');
  url.searchParams.delete('linked');
  return { ...(error ? { error } : {}), ...(linked ? { linked } : {}), cleanUrl: url.toString() };
}

export const PROVIDER_LABEL: Record<ProviderId, string> = { github: 'GitHub', google: 'Google' };

/** What to tell the user about the sign-in or linking the API redirected back from. */
export function loginMessage({ error, linked }: { error?: string; linked?: string }): string | undefined {
  if (error === 'cancelled') return 'Sign-in cancelled.';
  if (error === 'identity_in_use') return 'That sign-in already belongs to another Proschi account; delete that account first to link it here.';
  if (error === 'provider_linked') return 'This account already has a sign-in with that provider; unlink it first.';
  if (error) return 'Sign-in failed; try again.';
  if (linked) return `${PROVIDER_LABEL[linked as ProviderId] ?? linked} sign-in linked: you can now sign in with either.`;
  return undefined;
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
