import { loadJson, saveJson } from '../../services/storage';
import { isSafeKey } from '../../playground/sanitize';
import { statusOf, type Progress } from '../progress';
import { roadmapHref, stepLock, type RoadmapAccess, type RoadmapState } from '../roadmap';

/**
 * "Continue" on the practice hub's Today panel: the last problem opened, while
 * it is not solved yet, else the next step of the roadmap. The last problem is
 * remembered in this browser only (docs/PRIVACY.md lists the key).
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
  /** Why this one: picked up where you left off, or the roadmap's next step. */
  kind: 'last' | 'roadmap';
  id: string;
}

/**
 * Where "Continue" leads, or undefined when there is nothing to continue (the
 * roadmap is done and the last problem solved). A roadmap step that needs a
 * sign-in or an earlier solve leads to the roadmap, which says what unlocks it.
 */
export function continueTarget({
  last,
  progress,
  known,
  roadmap,
  access,
}: {
  last?: LastProblem;
  progress: Progress;
  /** The problem ids this build has. */
  known: ReadonlySet<string>;
  roadmap: RoadmapState;
  access: RoadmapAccess;
}): ContinueTarget | undefined {
  if (last && known.has(last.id) && statusOf(progress, last.id) !== 'solved') {
    return { kind: 'last', id: last.id, href: last.roadmap ? roadmapHref(last.id) : `#/${last.id}` };
  }
  const next = roadmap.next;
  if (!next) return undefined;
  const open = stepLock(roadmap, next.id, access).kind === 'open';
  return { kind: 'roadmap', id: next.id, href: open ? roadmapHref(next.id) : '#/roadmap' };
}
