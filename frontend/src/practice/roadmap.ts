import { statusOf, type Progress, type Status } from './progress';
import type { AccountState } from './useAccount';
import { OPTIONAL_STEPS, type RoadmapStage } from './roadmapStages';

/**
 * The interview prep roadmap: the practice problems as a guided path, in
 * stages, solved in a fixed order (docs/PRACTICE.md, "The roadmap"). Only the
 * roadmap view is gated; the problem list stays open.
 *
 * The order follows the usual shape of system design curricula (foundations,
 * then building blocks, then patterns, then whole systems): replicas and
 * caching before partitioning, queues before the fan-out and streaming
 * patterns built on them, and contention, geo and hot spots last, where a
 * design needs everything before it.
 */

export { OPTIONAL_STEPS, ROADMAP, requiredStages, type RoadmapStage } from './roadmapStages';

/** The practice URL of a problem opened from the roadmap: the problem page then shows where it is on the roadmap. */
export const roadmapHref = (id: string) => `#/roadmap/${id}`;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What is wrong with a roadmap's shape: bad or repeated ids, empty stages, a problem listed twice. Empty when it is fine. */
export function validateRoadmap(stages: RoadmapStage[]): string[] {
  const errors: string[] = [];
  const stageIds = new Set<string>();
  const seen = new Map<string, string>();
  if (stages.length === 0) errors.push('The roadmap has no stages');
  for (const stage of stages) {
    const where = `Stage "${stage.id}"`;
    if (!ID.test(stage.id)) errors.push(`${where}: the id must be lowercase words joined by "-"`);
    if (stageIds.has(stage.id)) errors.push(`${where} appears twice`);
    stageIds.add(stage.id);
    if (!stage.title.trim()) errors.push(`${where} has no title`);
    if (!stage.why.trim()) errors.push(`${where} does not say what it teaches`);
    if (stage.problems.length === 0) errors.push(`${where} has no problems`);
    for (const id of stage.problems) {
      if (!ID.test(id)) errors.push(`${where}: "${id}" is not a problem id`);
      const first = seen.get(id);
      if (first !== undefined) errors.push(`${where}: "${id}" is already in stage "${first}"`);
      else seen.set(id, stage.id);
    }
  }
  return errors;
}

/** The roadmap with only the problems that exist; stages left empty are dropped. */
export function roadmapFor(stages: RoadmapStage[], problemIds: Iterable<string>): RoadmapStage[] {
  const known = new Set(problemIds);
  return stages.map((s) => ({ ...s, problems: s.problems.filter((id) => known.has(id)) })).filter((s) => s.problems.length > 0);
}

export interface RoadmapStep {
  id: string;
  /** Index into the stages. */
  stage: number;
  status: Status;
  /** Not solved, and an earlier problem is not solved either (OPTIONAL_STEPS do not count). */
  locked: boolean;
  /** One of the OPTIONAL_STEPS: recommended, never required. */
  optional: boolean;
}

export interface RoadmapState {
  steps: RoadmapStep[];
  solved: number;
  /**
   * The problem to solve next: the first unsolved one, where an optional step
   * counts only while nothing required is solved yet; undefined once done.
   */
  next?: RoadmapStep;
  /** The first unsolved required problem: what a locked step waits for. */
  blocker?: RoadmapStep;
  /** The stage of `next`, or the last stage when the roadmap is done. */
  currentStage: number;
}

/**
 * Where a learner is on the roadmap. A problem is unlocked when every problem
 * before it is solved; a solved problem stays open (it may have been solved
 * from the open list, out of order).
 */
export function roadmapState(stages: RoadmapStage[], progress: Progress): RoadmapState {
  const steps: RoadmapStep[] = [];
  let blocked = false;
  stages.forEach((stage, i) => {
    for (const id of stage.problems) {
      const status = statusOf(progress, id);
      const optional = OPTIONAL_STEPS.includes(id);
      steps.push({ id, stage: i, status, locked: blocked && status !== 'solved', optional });
      if (status !== 'solved' && !optional) blocked = true;
    }
  });
  const blocker = steps.find((s) => s.status !== 'solved' && !s.optional);
  const started = steps.some((s) => s.status === 'solved' && !s.optional);
  const next = steps.find((s) => s.status !== 'solved' && (!s.optional || !started));
  return {
    steps,
    solved: steps.filter((s) => s.status === 'solved').length,
    next,
    ...(blocker ? { blocker } : {}),
    currentStage: next?.stage ?? Math.max(0, stages.length - 1),
  };
}

/**
 * Whether the viewer may work through the roadmap: `open`, `checking` while
 * the account loads, or `sign-in`. Anyone can see the stages and work through
 * the first one signed out, with progress kept in this browser; the stages
 * after it take an account (see stepLock). This is the one place to put a paid
 * plan later (an `upgrade` answer for an account without one).
 *
 * A build without accounts (`VITE_ACCOUNTS` unset: local development, the e2e
 * build, forks) has nothing to sign in to, so the roadmap is open there.
 */
export type RoadmapAccess = 'open' | 'checking' | 'sign-in';

export function roadmapAccess(account: AccountState): RoadmapAccess {
  switch (account.status) {
    case 'off':
    case 'signed-in':
      return 'open';
    case 'loading':
      return 'checking';
    case 'signed-out':
      return 'sign-in';
  }
}

/** A problem opened from the roadmap: `roadmap/<id>` (lesson first while unread) or `roadmap/<id>/lesson`. */
export function roadmapTarget(route: string): { id: string; lesson: boolean } | undefined {
  if (!route.startsWith('roadmap/')) return undefined;
  const rest = route.slice('roadmap/'.length);
  const lesson = rest.endsWith('/lesson');
  const id = lesson ? rest.slice(0, -'/lesson'.length) : rest;
  return id ? { id, lesson } : undefined;
}

/**
 * Whether a roadmap step's challenge may be opened: `open`;
 * `checking` while the account loads; `sign-in` signed out past the first
 * stage (the first stage is open to everyone, with progress kept in this
 * browser); or `order` while an earlier problem is unsolved (`next` is the one
 * to solve). A problem that is not on the roadmap is only gated by the
 * account. Lessons are never gated (see routeLock): reading is always open,
 * only the challenges keep the roadmap's order. The OPTIONAL_STEPS (the
 * tutorial) open signed out too.
 */
export type StepLock = { kind: 'open' } | { kind: 'checking' } | { kind: 'sign-in' } | { kind: 'order'; next: string };

/** The stages a signed-out viewer may work through: the first. */
export const SIGNED_OUT_STAGES = 1;

export function stepLock(state: RoadmapState, id: string, access: RoadmapAccess): StepLock {
  if (access === 'checking') return { kind: 'checking' };
  // The OPTIONAL_STEPS (the tutorial) are open signed out wherever they sit.
  if (OPTIONAL_STEPS.includes(id) && access === 'sign-in') return { kind: 'open' };
  const step = state.steps.find((s) => s.id === id);
  if (access === 'sign-in' && (!step || step.stage >= SIGNED_OUT_STAGES)) return { kind: 'sign-in' };
  if (step?.locked && state.blocker) return { kind: 'order', next: state.blocker.id };
  return { kind: 'open' };
}

/** The lock on a roadmap address: a lesson (`roadmap/<id>/lesson`) is always open, a challenge as stepLock says. */
export function routeLock(state: RoadmapState, target: { id: string; lesson: boolean }, access: RoadmapAccess): StepLock {
  return target.lesson ? { kind: 'open' } : stepLock(state, target.id, access);
}
