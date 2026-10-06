import { gradeEstimateAnswer, type EstimateResult } from '../../learn/grade';
import type { EstimateQuestion, Interview } from './interviewFile';

/**
 * Interview mode as a state machine: four phases against a clock, the
 * questions asked, the estimates given, the last test run and the
 * self-review. Pure: every action that touches the clock carries `now`
 * (milliseconds), so the tests drive time and the page passes Date.now().
 */

export type Phase = 'clarify' | 'estimate' | 'design' | 'wrapup';

export const PHASES: { id: Phase; label: string }[] = [
  { id: 'clarify', label: 'Clarify' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'design', label: 'Design' },
  { id: 'wrapup', label: 'Wrap-up' },
];

export const DURATIONS = [30, 45, 60] as const;
export type Duration = (typeof DURATIONS)[number];
export const DEFAULT_DURATION: Duration = 45;

/** A suggested share of the time per phase, for the start screen. */
export const PHASE_SHARE: Record<Phase, number> = { clarify: 0.1, estimate: 0.1, design: 0.7, wrapup: 0.1 };

/** The self-review of the wrap-up phase. */
export const CHECKLIST: { id: string; label: string }[] = [
  { id: 'bottlenecks', label: 'I can name the bottleneck of my design and what it takes to remove it.' },
  { id: 'failures', label: 'I know what happens when each component fails, and what the user sees.' },
  { id: 'tradeoffs', label: 'I can explain one trade-off I made and the option I rejected.' },
  { id: 'more-time', label: 'I know what I would add or change with more time.' },
];

export interface EstimateAnswer extends EstimateResult {
  value: number;
}

export interface InterviewSession {
  version: 1;
  problem: string;
  durationMin: Duration;
  startedAt: number;
  phase: Phase;
  /** Set once the wrap-up is done: the clock has stopped and the summary is final. */
  finishedAt?: number;
  /** Milliseconds spent per phase, without the stretch running now. */
  spent: Record<Phase, number>;
  /** When the clock was last started; undefined while paused or finished. */
  runningSince?: number;
  /** Indexes into the interview's questions, in the order asked. */
  asked: number[];
  /** Estimate index → the answer given. */
  estimates: Record<number, EstimateAnswer>;
  /** The last test run of the design phase. */
  tests?: { passed: number; total: number; solved: boolean };
  /** Checklist ids ticked in the wrap-up. */
  checked: string[];
}

export type InterviewAction =
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'ask'; index: number }
  | { type: 'estimate'; index: number; value: number; question: EstimateQuestion }
  | { type: 'tests'; passed: number; total: number; solved: boolean }
  | { type: 'check'; id: string; checked: boolean }
  /** To the next phase; from the wrap-up it finishes the interview. */
  | { type: 'advance'; now: number };

const ZERO: Record<Phase, number> = { clarify: 0, estimate: 0, design: 0, wrapup: 0 };

export function startSession(problem: string, durationMin: Duration, now: number): InterviewSession {
  return { version: 1, problem, durationMin, startedAt: now, phase: 'clarify', spent: { ...ZERO }, runningSince: now, asked: [], estimates: {}, checked: [] };
}

/** The session with the running stretch added to the current phase and the clock stopped. */
function stopClock(s: InterviewSession, now: number): InterviewSession {
  if (s.runningSince === undefined) return s;
  const { runningSince, ...rest } = s;
  return { ...rest, spent: { ...s.spent, [s.phase]: s.spent[s.phase] + Math.max(0, now - runningSince) } };
}

export function interviewReducer(s: InterviewSession, a: InterviewAction): InterviewSession {
  if (s.finishedAt !== undefined) return s;
  switch (a.type) {
    case 'pause':
      return stopClock(s, a.now);
    case 'resume':
      return s.runningSince === undefined ? { ...s, runningSince: a.now } : s;
    case 'ask':
      return s.phase === 'clarify' && !s.asked.includes(a.index) && a.index >= 0 ? { ...s, asked: [...s.asked, a.index] } : s;
    case 'estimate': {
      if (s.phase !== 'estimate' || s.estimates[a.index] || !Number.isFinite(a.value)) return s;
      const result = gradeEstimateAnswer({ answer: a.question.answer, tolerance: a.question.tolerance }, a.value, { low: a.question.low, high: a.question.high });
      return { ...s, estimates: { ...s.estimates, [a.index]: { value: a.value, ...result } } };
    }
    case 'tests':
      return s.phase === 'design' ? { ...s, tests: { passed: a.passed, total: a.total, solved: a.solved } } : s;
    case 'check':
      if (s.phase !== 'wrapup') return s;
      return { ...s, checked: a.checked ? [...new Set([...s.checked, a.id])] : s.checked.filter((id) => id !== a.id) };
    case 'advance': {
      const running = s.runningSince !== undefined;
      const stopped = stopClock(s, a.now);
      const next = PHASES[PHASES.findIndex((p) => p.id === s.phase) + 1]?.id;
      if (!next) return { ...stopped, finishedAt: a.now };
      return { ...stopped, phase: next, ...(running ? { runningSince: a.now } : {}) };
    }
  }
}

/** Milliseconds spent in a phase, the running stretch included. */
export function phaseElapsed(s: InterviewSession, phase: Phase, now: number): number {
  const running = s.runningSince !== undefined && s.phase === phase ? Math.max(0, now - s.runningSince) : 0;
  return s.spent[phase] + running;
}

export function totalElapsed(s: InterviewSession, now: number): number {
  return PHASES.reduce((sum, p) => sum + phaseElapsed(s, p.id, now), 0);
}

/** Milliseconds left; negative once over time. */
export function remaining(s: InterviewSession, now: number): number {
  return s.durationMin * 60_000 - totalElapsed(s, now);
}

/** `12:05`, or `-1:30` over time. */
export function formatClock(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface InterviewSummary {
  problem: string;
  startedAt: number;
  durationMin: Duration;
  totalMs: number;
  overtime: boolean;
  phases: Record<Phase, number>;
  questions: { asked: number; good: number; weak: number; goodTotal: number };
  estimates: { answered: number; correct: number; total: number; /** The answers' factors off, for "within 1.4× on average". */ factors: number[] };
  tests?: { passed: number; total: number; solved: boolean };
  checklist: { checked: number; total: number };
}

export function summarize(s: InterviewSession, interview: Interview, now: number): InterviewSummary {
  const at = s.finishedAt ?? now;
  const asked = s.asked.map((i) => interview.questions[i]).filter((q) => q !== undefined);
  const answers = Object.entries(s.estimates).filter(([i]) => interview.estimates[Number(i)] !== undefined).map(([, a]) => a);
  const totalMs = totalElapsed(s, at);
  return {
    problem: s.problem,
    startedAt: s.startedAt,
    durationMin: s.durationMin,
    totalMs,
    overtime: totalMs > s.durationMin * 60_000,
    phases: Object.fromEntries(PHASES.map((p) => [p.id, phaseElapsed(s, p.id, at)])) as Record<Phase, number>,
    questions: { asked: asked.length, good: asked.filter((q) => q.good).length, weak: asked.filter((q) => !q.good).length, goodTotal: interview.questions.filter((q) => q.good).length },
    estimates: { answered: answers.length, correct: answers.filter((a) => a.correct).length, total: interview.estimates.length, factors: answers.map((a) => a.factor) },
    ...(s.tests ? { tests: s.tests } : {}),
    checklist: { checked: s.checked.filter((id) => CHECKLIST.some((c) => c.id === id)).length, total: CHECKLIST.length },
  };
}

/**
 * A session from storage, or undefined when it is missing, damaged or of
 * another problem. Only the shape is checked; values the reducer ignores
 * (an index past the questions) are harmless.
 */
export function readSession(raw: unknown, problem: string): InterviewSession | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Partial<InterviewSession>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (s.version !== 1 || s.problem !== problem || !DURATIONS.includes(s.durationMin as Duration) || !num(s.startedAt)) return undefined;
  if (!PHASES.some((p) => p.id === s.phase) || !s.spent || typeof s.spent !== 'object' || !PHASES.every((p) => num((s.spent as Record<string, unknown>)[p.id]))) return undefined;
  if (!Array.isArray(s.asked) || !s.asked.every((i) => Number.isInteger(i)) || !Array.isArray(s.checked) || !s.checked.every((c) => typeof c === 'string')) return undefined;
  if (!s.estimates || typeof s.estimates !== 'object' || Array.isArray(s.estimates)) return undefined;
  if ((s.runningSince !== undefined && !num(s.runningSince)) || (s.finishedAt !== undefined && !num(s.finishedAt))) return undefined;
  const estimates: Record<number, EstimateAnswer> = {};
  for (const [i, a] of Object.entries(s.estimates as Record<string, Partial<EstimateAnswer> | null>)) {
    if (/^\d+$/.test(i) && a && num(a.value) && typeof a.correct === 'boolean' && num(a.factor) && ['high', 'low', 'exact'].includes(a.direction as string)) estimates[Number(i)] = a as EstimateAnswer;
  }
  const t = s.tests;
  const tests = t && num(t.passed) && num(t.total) && typeof t.solved === 'boolean' ? { tests: { passed: t.passed, total: t.total, solved: t.solved } } : {};
  const rest: InterviewSession = { ...(s as InterviewSession) };
  delete rest.tests;
  return { ...rest, ...tests, estimates };
}
