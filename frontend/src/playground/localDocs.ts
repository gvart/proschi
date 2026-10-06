import { loadJson, saveJson } from '../services/storage';
import { DOCS_KEY, SYNC_KEY, readState } from './documents';
import { forgetSynced, readStoredSync } from './sync';

/**
 * Signing out from a page other than the editor (the practice account
 * menu): the editor's diagrams synced with the account, read and written
 * straight in localStorage.
 */

/** How many diagrams in this browser are synced with the account (0 without cloud sync). */
export function syncedInBrowser(): number {
  const meta = readStoredSync(loadJson<unknown>(SYNC_KEY, null)).meta;
  const state = readState(loadJson<unknown>(DOCS_KEY, null));
  return meta && state ? state.docs.filter((d) => Object.hasOwn(meta.docs, d.id)).length : 0;
}

/** Removes the synced, unchanged diagrams from this browser (they are safe in the account); answers how many. */
export function removeSyncedFromBrowser(): number {
  const stored = readStoredSync(loadJson<unknown>(SYNC_KEY, null));
  const state = readState(loadJson<unknown>(DOCS_KEY, null));
  if (!stored.meta || !state) return 0;
  const result = forgetSynced(state, stored.meta);
  saveJson(SYNC_KEY, { ...stored, meta: result.meta });
  try {
    if (result.state) saveJson(DOCS_KEY, result.state);
    else localStorage.removeItem(DOCS_KEY);
  } catch {
    // Storage unavailable: nothing was stored either.
  }
  return result.removed;
}
