import { loadJson, saveJson } from '../../services/storage';
import { isSafeKey } from '../../playground/sanitize';
import { statusOf, type Progress } from '../progress';
import { roadmapHref } from '../roadmap';

/**
 * "Continue" on the practice home: the last problem opened, while it is not
 * solved yet (the roadmap's next step is the roadmap's own "Up next"). The
 * last problem is remembered in this browser only (docs/PRIVACY.md lists the key).
 */

/** The last problem opened on the practice page, `{ id, roadmap }`. */
export const LAST_PROBLEM_KEY = 'proschi.practice.last';

export interface LastProblem {
  id: string;
  /** Opened from the roadmap (`#/roadmap/<id>`), so it opens there again. */
  roadmap: boolean;
}

export function loadLastProblem(): LastProblem | undefined {
  const raw = loadJson<unknown>(LAST_PROBLEM_KEY, undefined);
  if (!raw || typeof raw !== 'object') return undefined;
  const { id, roadmap } = raw as { id?: unknown; roadmap?: unknown };
  return typeof id === 'string' && isSafeKey(id) ? { id, roadmap: roadmap === true } : undefined;
}

export function saveLastProblem(last: LastProblem): void {
  if (isSafeKey(last.id)) saveJson(LAST_PROBLEM_KEY, last);
}

export interface ContinueTarget {
  href: string;
  id: string;
}

/** Where "Continue" leads: the last problem opened, where it was opened, while it is unsolved; else nowhere. */
export function continueTarget({
  last,
  progress,
  known,
}: {
  last?: LastProblem;
  progress: Progress;
  /** The problem ids this build has. */
  known: ReadonlySet<string>;
}): ContinueTarget | undefined {
  if (!last || !known.has(last.id) || statusOf(progress, last.id) === 'solved') return undefined;
  return { id: last.id, href: last.roadmap ? roadmapHref(last.id) : `#/${last.id}` };
}
