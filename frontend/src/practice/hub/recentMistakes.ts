import { loadJson, saveJson } from '../../services/storage';
import { isSafeKey } from '../../playground/sanitize';

/**
 * The known mistakes failed runs matched lately (practice/mistakes.ts), kept
 * in this browser for "Your next steps" (learn/nextSteps.ts): the latest per
 * problem, at most MAX_MISTAKES problems. docs/PRIVACY.md lists the key.
 */
export const MISTAKES_KEY = 'proschi.practice.mistakes';
export const MAX_MISTAKES = 20;

export interface RecentMistake {
  problem: string;
  /** The mistake's title. */
  title: string;
  /** Unix seconds. */
  at: number;
}

/** The list read back from storage: anything malformed is dropped. */
export function readMistakes(raw: unknown): RecentMistake[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is RecentMistake => {
    const v = m as Partial<RecentMistake> | null;
    return !!v && typeof v === 'object' && typeof v.problem === 'string' && isSafeKey(v.problem) && typeof v.title === 'string' && Number.isInteger(v.at);
  });
}

export function loadMistakes(): RecentMistake[] {
  return readMistakes(loadJson<unknown>(MISTAKES_KEY, []));
}

/** Keeps a matched mistake: it replaces the problem's earlier one, the newest first. */
export function recordMistake(problem: string, title: string, now = Math.floor(Date.now() / 1000)): void {
  if (!isSafeKey(problem)) return;
  const rest = loadMistakes().filter((m) => m.problem !== problem);
  saveJson(MISTAKES_KEY, [{ problem, title, at: now }, ...rest].slice(0, MAX_MISTAKES));
}
