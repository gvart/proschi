import { loadJson, saveJson } from '../../services/storage';
import { gradeEstimateAnswer } from '../../learn/grade';
import type { EstimateQuestion, Interview } from '../modes/interviewFile';
import type { EstimateAnswer } from '../modes/session';
import type { WorksheetRow } from '../interview/stages';

/**
 * A practice problem worked through in stages (docs/design/paid-plans.md
 * P50): the lesson, then Clarify, Estimate, Design and Wrap-up, self-paced.
 * Each stage asks for the learner's own answer before it shows the given
 * facts or the worked answer. Pure helpers and the notes kept per problem in
 * this browser, like the practice progress (progress.ts).
 */

export type StageId = 'lesson' | 'clarify' | 'estimate' | 'design' | 'wrapup';

export const STAGES: { id: StageId; label: string }[] = [
  { id: 'lesson', label: 'Lesson' },
  { id: 'clarify', label: 'Clarify' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'design', label: 'Design' },
  { id: 'wrapup', label: 'Wrap-up' },
];

/** The working stages: the lesson is read, not worked on. */
export type WorkStage = Exclude<StageId, 'lesson'>;

export const stageAt = (id: StageId) => STAGES.findIndex((s) => s.id === id);
export const labelOf = (id: StageId) => STAGES[stageAt(id)].label;
export const nextOf = (id: StageId): StageId | undefined => STAGES[stageAt(id) + 1]?.id;
const isWork = (v: unknown): v is WorkStage => STAGES.some((s) => s.id === v && s.id !== 'lesson');

export interface StageNotes {
  /** The working stage the learner is on (the lesson is shown over it). */
  stage: WorkStage;
  /** The furthest stage reached: the rail opens it and every one before. */
  reached: WorkStage;
  /** Design is open in the full editor (code, tests, playback, analysis), not on the whiteboard. */
  editor: boolean;
  /** The brief was typed out once. */
  briefRead: boolean;
  /** Clarify: the learner's own questions and assumptions. */
  questions: string;
  /** Clarify: compared with the interviewer's answers. */
  revealed: boolean;
  /** Clarify: the good questions (by index) the learner says they covered. */
  covered: number[];
  /** Estimate: the worksheet, once touched. */
  rows?: WorksheetRow[];
  /** Estimate: the problem's estimates checked, by question index. */
  estimates: Record<number, EstimateAnswer>;
  /** Wrap-up: what the learner recalls (what breaks first at 10×). */
  reflection: string;
}

export const EMPTY_NOTES: StageNotes = { stage: 'clarify', reached: 'clarify', editor: false, briefRead: false, questions: '', revealed: false, covered: [], estimates: {}, reflection: '' };

export const NOTES_KEY = (problem: string) => `proschi.practice.stages.${problem}`;
const MAX_TEXT = 8000;
const MAX_ROWS = 24;

const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

/** Notes from storage: anything missing or damaged reads as not done yet. */
export function readNotes(raw: unknown): StageNotes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_NOTES;
  const r = raw as Record<string, unknown>;
  const stage = isWork(r.stage) ? r.stage : 'clarify';
  const reached = isWork(r.reached) && stageAt(r.reached) >= stageAt(stage) ? r.reached : stage;
  const rows = Array.isArray(r.rows)
    ? (r.rows as Partial<WorksheetRow>[]).filter((x) => !!x && typeof x.id === 'string' && typeof x.label === 'string' && typeof x.expression === 'string' && typeof x.unit === 'string').slice(0, MAX_ROWS) as WorksheetRow[]
    : undefined;
  const estimates: Record<number, EstimateAnswer> = {};
  if (r.estimates && typeof r.estimates === 'object') {
    for (const [k, v] of Object.entries(r.estimates as Record<string, Partial<EstimateAnswer>>)) {
      if (/^\d+$/.test(k) && v && typeof v.value === 'number' && typeof v.correct === 'boolean' && typeof v.factor === 'number' && (v.direction === 'high' || v.direction === 'low' || v.direction === 'exact'))
        estimates[Number(k)] = { value: v.value, correct: v.correct, factor: v.factor, direction: v.direction };
    }
  }
  return {
    stage,
    reached,
    editor: r.editor === true,
    briefRead: r.briefRead === true,
    questions: text(r.questions),
    revealed: r.revealed === true,
    covered: Array.isArray(r.covered) ? [...new Set(r.covered.filter((i): i is number => Number.isInteger(i) && i >= 0))] : [],
    ...(rows ? { rows } : {}),
    estimates,
    reflection: text(r.reflection),
  };
}

export const loadNotes = (problem: string): StageNotes => readNotes(loadJson<unknown>(NOTES_KEY(problem), undefined));
export const saveNotes = (problem: string, notes: StageNotes): void => saveJson(NOTES_KEY(problem), notes);

/** Moves to `stage`, which then counts as reached. */
export function goTo(notes: StageNotes, stage: WorkStage): StageNotes {
  return { ...notes, stage, reached: stageAt(stage) > stageAt(notes.reached) ? stage : notes.reached };
}

/** Whether the rail may open `stage`: the lesson and every stage up to the furthest reached (no skipping ahead of your own thinking). */
export const canOpen = (notes: StageNotes, stage: StageId): boolean => stage === 'lesson' || stageAt(stage) <= stageAt(notes.reached);

/**
 * The screen a problem opens on: its lesson when asked for (`always`) or not
 * read yet (`unread`), else the stage the learner left it on.
 */
export function openingScreen(hasLesson: boolean, openLesson: 'always' | 'unread' | undefined, read: boolean, notes: StageNotes): StageId {
  if (hasLesson && (openLesson === 'always' || (openLesson === 'unread' && !read))) return 'lesson';
  return notes.stage;
}

/** Checks an estimate once (a checked one stays as it was), against the question's accepted range. */
export function checkEstimate(notes: StageNotes, index: number, question: EstimateQuestion, value: number): StageNotes {
  if (notes.estimates[index] || !Number.isFinite(value)) return notes;
  const result = gradeEstimateAnswer({ answer: question.answer, tolerance: question.tolerance }, value, { low: question.low, high: question.high });
  return { ...notes, estimates: { ...notes.estimates, [index]: { value, ...result } } };
}

/** Whether a stage's own thinking is done, so its Next is the primary action. */
export function stageDone(notes: StageNotes, stage: WorkStage, estimateCount: number, solved: boolean): boolean {
  switch (stage) {
    case 'clarify':
      return notes.revealed;
    case 'estimate':
      return Object.keys(notes.estimates).length >= estimateCount;
    case 'design':
      return solved;
    default:
      return false;
  }
}

/** The given facts: what the good clarifying questions find out. */
export const factsOf = (interview?: Interview): string[] => interview?.questions.filter((q) => q.good).map((q) => q.fact ?? q.question) ?? [];
