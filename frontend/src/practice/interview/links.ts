import type { Kind } from './prefs';

/**
 * The mock interview's addresses (P45): `#/interview` is the set-up,
 * `?problem=<id>` preselects a problem and `?with=mock|solo` the
 * interviewer; `#/interview/<problem id>` is the room of the interview open
 * on that problem, then its result.
 */

export const setupHref = (problem?: string, kind?: Kind): string => {
  const q = new URLSearchParams();
  if (problem) q.set('problem', problem);
  if (kind) q.set('with', kind);
  const s = q.toString();
  return `#/interview${s ? `?${s}` : ''}`;
};

export const roomHref = (problem: string): string => `#/interview/${encodeURIComponent(problem)}`;
