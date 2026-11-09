/**
 * What an interview on your own did, beyond the effort that makes it count
 * (mastery.ts soloCounts), and the score per skill read from it
 * (docs/design/paid-plans.md P53). Pure and dependency-free: the browser
 * sends it (practice/interview/record.ts) and the Worker checks and keeps it
 * (backend/src/soloInterviews.ts), so the two can't disagree on the shape.
 */

export const SOLO_PHASES = ['clarify', 'estimate', 'design', 'wrapup'] as const;

export interface SoloResults {
  /** Milliseconds per phase. */
  phases: Record<(typeof SOLO_PHASES)[number], number>;
  questions: { asked: number; good: number; weak: number; goodTotal: number };
  estimates: { answered: number; correct: number; total: number };
  /** The last check run, if any. */
  tests?: { passed: number; total: number };
  checklist: { checked: number; total: number };
}

/** The skills an interview on your own shows; communication needs someone listening. */
export const SOLO_SKILLS = ['requirements', 'estimation', 'design', 'tradeoffs'] as const;
export type SoloSkill = (typeof SOLO_SKILLS)[number];

const LIMIT = 1_000;
const MAX_MS = 86_400_000;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMIT;
const part = (v: unknown, keys: readonly string[]): Record<string, number> | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return keys.every((k) => count(o[k])) ? Object.fromEntries(keys.map((k) => [k, o[k] as number])) : undefined;
};

/** `raw` as SoloResults, or undefined when it isn't one (the parts are checked, extra fields dropped). */
export function readSoloResults(raw: unknown): SoloResults | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const p = r.phases as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object' || !SOLO_PHASES.every((k) => Number.isInteger(p[k]) && (p[k] as number) >= 0 && (p[k] as number) <= MAX_MS)) return undefined;
  const questions = part(r.questions, ['asked', 'good', 'weak', 'goodTotal']);
  const estimates = part(r.estimates, ['answered', 'correct', 'total']);
  const checklist = part(r.checklist, ['checked', 'total']);
  const tests = r.tests === undefined || r.tests === null ? undefined : part(r.tests, ['passed', 'total']);
  if (!questions || !estimates || !checklist || (r.tests !== undefined && r.tests !== null && !tests)) return undefined;
  return {
    phases: Object.fromEntries(SOLO_PHASES.map((k) => [k, p[k] as number])) as SoloResults['phases'],
    questions: questions as SoloResults['questions'],
    estimates: estimates as SoloResults['estimates'],
    ...(tests ? { tests: tests as { passed: number; total: number } } : {}),
    checklist: checklist as SoloResults['checklist'],
  };
}

/** A share from 0 to 1 as a score from 1 to 5. */
const score = (done: number, of: number) => 1 + Math.round(4 * (of > 0 ? Math.min(1, Math.max(0, done / of)) : 0));

/**
 * The score per skill, 1 to 5, as the verdict's scale: requirements by the
 * good questions asked of those there are, estimation by the estimates in
 * range, design by the checks passing on the last run (1 with none run),
 * trade-offs by the self-review ticked.
 */
export function soloScores(r: SoloResults): Record<SoloSkill, number> {
  return {
    requirements: score(r.questions.good, r.questions.goodTotal),
    estimation: score(r.estimates.correct, r.estimates.total),
    design: r.tests ? score(r.tests.passed, r.tests.total) : 1,
    tradeoffs: score(r.checklist.checked, r.checklist.total),
  };
}
