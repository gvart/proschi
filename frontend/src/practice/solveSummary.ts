import { statusOf, type Progress } from './progress';
import { roadmapState, type RoadmapStage } from './roadmap';

/**
 * What a problem's first solve shows (SolveCelebration.tsx): how the design
 * compares with the reference solution, and what the solve did on the
 * roadmap. Pure, so it is tested without a page.
 */

/** "12% cheaper", "3× slower", "the same as the reference": `mine` against the reference's `theirs`, lower being better. */
export function compareToReference(mine: number, theirs: number, better: string, worse: string): string {
  if (!(theirs > 0) || Math.abs(mine - theirs) / theirs < 0.005) return 'the same as the reference';
  const ratio = mine / theirs;
  const times = (r: number) => `${r.toFixed(r >= 10 ? 0 : 1).replace(/\.0$/, '')}×`;
  if (ratio >= 2) return `${times(ratio)} ${worse} than the reference`;
  if (ratio <= 0.5) return `${times(1 / ratio)} ${better} than the reference`;
  return `${Math.round(Math.abs(1 - ratio) * 100)}% ${ratio < 1 ? better : worse} than the reference`;
}

export interface RoadmapAfterSolve {
  /** The stage the solve completed (its index into the stages). */
  completed?: number;
  /** The roadmap's next problem to solve, when `id` is on the roadmap and one is left. */
  next?: string;
}

/** What solving `id` did on the roadmap, from the progress before the solve. */
export function roadmapAfterSolve(stages: RoadmapStage[], id: string, before: Progress): RoadmapAfterSolve {
  const index = stages.findIndex((s) => s.problems.includes(id));
  if (index < 0) return {};
  const firstSolve = statusOf(before, id) !== 'solved';
  const completed = firstSolve && stages[index].problems.every((p) => p === id || statusOf(before, p) === 'solved');
  const next = roadmapState(stages, { ...before, [id]: { ...before[id], status: 'solved' } }).next;
  return { ...(completed ? { completed: index } : {}), ...(next ? { next: next.id } : {}) };
}
