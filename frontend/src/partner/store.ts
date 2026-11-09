import { loadJson, saveJson } from '../services/storage';

/**
 * The conversation open per document or problem, kept in this browser so a
 * reload or a revisit picks it up again (GET /api/partner/sessions/:id), with
 * what was decided on each of its changes and which were sent back to be
 * improved. Keys: `editor:<docId>`,
 * `practice:<problemId>`.
 */

export const PARTNER_KEY = 'proschi.partner';

export type Decision = 'accepted' | 'rejected';

export interface Stored {
  id: string;
  decisions?: Record<string, Decision>;
  /** Changes "Improve this" or "Ask again" was sent for: a newer card replaces each. */
  improved?: string[];
}

type All = Record<string, Stored>;

function readAll(): All {
  const raw = loadJson<unknown>(PARTNER_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as All) : {};
}

export function loadStored(key: string): Stored | undefined {
  const all = readAll();
  const s = Object.prototype.hasOwnProperty.call(all, key) ? all[key] : undefined;
  if (!s || typeof s.id !== 'string') return undefined;
  const decisions = s.decisions && typeof s.decisions === 'object' ? Object.fromEntries(Object.entries(s.decisions).filter(([, d]) => d === 'accepted' || d === 'rejected')) : {};
  const improved = Array.isArray(s.improved) ? s.improved.filter((c): c is string => typeof c === 'string') : [];
  return { id: s.id, decisions, ...(improved.length ? { improved } : {}) };
}

/** Saves the conversation of `key`, or forgets it with undefined. */
export function saveStored(key: string, stored: Stored | undefined): void {
  const all = readAll();
  if (stored) all[key] = stored;
  else delete all[key];
  saveJson(PARTNER_KEY, all);
}
