import { loadJson, saveJson } from '../services/storage';
import type { Problem } from './types';
import { isSafeKey } from '../playground/sanitize';

/**
 * Practice progress, kept in this browser only: per problem its status and the
 * last source typed. Storage access is guarded in services/storage.ts; a
 * missing or damaged entry reads as no progress.
 */

export type Status = 'todo' | 'attempted' | 'solved';

export interface ProblemProgress {
  status: Status;
  /** The last source in the editor, when it differs from the starter. */
  source?: string;
}

export type Progress = Record<string, ProblemProgress>;

export const PROGRESS_KEY = 'proschi.practice';

const STATUSES: Status[] = ['todo', 'attempted', 'solved'];

export function loadProgress(): Progress {
  return readProgress(loadJson<unknown>(PROGRESS_KEY, {}));
}

/**
 * Progress from storage or a backup file: entries with a known status are
 * kept, anything else (and prototype keys such as `__proto__`) is dropped.
 */
export function readProgress(raw: unknown): Progress {
  const progress: Progress = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return progress;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<ProblemProgress> | null;
    if (!isSafeKey(id) || !entry || typeof entry !== 'object' || !STATUSES.includes(entry.status as Status)) continue;
    progress[id] = { status: entry.status as Status, ...(typeof entry.source === 'string' ? { source: entry.source } : {}) };
  }
  return progress;
}

/**
 * Restores progress from a backup into the current progress: per problem the
 * better status wins (solved > attempted > todo); on a tie the current entry,
 * with its last source, stays.
 */
export function mergeProgress(current: Progress, restored: Progress): Progress {
  const out: Progress = { ...current };
  for (const [id, entry] of Object.entries(restored)) {
    const mine = out[id];
    if (!mine || STATUSES.indexOf(entry.status) > STATUSES.indexOf(mine.status)) out[id] = entry;
  }
  return out;
}

export function saveProgress(progress: Progress): void {
  saveJson(PROGRESS_KEY, progress);
}

export function statusOf(progress: Progress, id: string): Status {
  return progress[id]?.status ?? 'todo';
}

/** The source to open a problem with: the last one typed, or the starter. */
export function sourceOf(progress: Progress, problem: Problem): string {
  return progress[problem.id]?.source ?? problem.starter;
}

/** Records an edit: changing the starter makes a problem attempted; a solved problem stays solved. */
export function withSource(progress: Progress, problem: Problem, source: string): Progress {
  const current = statusOf(progress, problem.id);
  const changed = source.trim() !== problem.starter.trim();
  const status: Status = current === 'solved' ? 'solved' : changed ? 'attempted' : current;
  return { ...progress, [problem.id]: { status, ...(changed ? { source } : {}) } };
}

/** Records a test run: all passing solves the problem; any other run makes it at least attempted. */
export function withRun(progress: Progress, problem: Problem, solved: boolean): Progress {
  const entry = progress[problem.id] ?? { status: 'todo' };
  return { ...progress, [problem.id]: { ...entry, status: solved || entry.status === 'solved' ? 'solved' : 'attempted' } };
}

/**
 * Lessons (and roadmap guides) read in this browser, `{ [id]: true }`: a
 * problem opened from the roadmap shows its lesson first until it is read,
 * the roadmap marks what was read, and the reading badges count it. Signed
 * in, reads also go to the account (PracticeApp), which sends back the
 * reads of other devices.
 */
export const LESSONS_KEY = 'proschi.lessons';

function readLessons(): Record<string, unknown> {
  const read = loadJson<unknown>(LESSONS_KEY, {});
  return read && typeof read === 'object' && !Array.isArray(read) ? (read as Record<string, unknown>) : {};
}

export function lessonRead(id: string): boolean {
  const read = readLessons();
  return Object.prototype.hasOwnProperty.call(read, id) && read[id] === true;
}

/** Every lesson and guide read in this browser, sorted. */
export function lessonsRead(): string[] {
  return Object.entries(readLessons())
    .filter(([id, v]) => v === true && isSafeKey(id))
    .map(([id]) => id)
    .sort();
}

/** Where reads come from: read here, or read on another device and sent by the account. */
export type ReadSource = 'here' | 'account';

const listeners = new Set<(ids: string[], source: ReadSource) => void>();

/** Called with the ids newly marked read and where they come from; answers the way to stop listening. */
export function onLessonsRead(listener: (ids: string[], source: ReadSource) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remembers lessons as read; storage errors are ignored (services/storage.ts). Listeners hear the ids that were new. */
export function markLessonsRead(ids: readonly string[], source: ReadSource = 'here'): void {
  const read = readLessons();
  const fresh = [...new Set(ids)].filter((id) => isSafeKey(id) && read[id] !== true);
  if (!fresh.length) return;
  saveJson(LESSONS_KEY, { ...read, ...Object.fromEntries(fresh.map((id) => [id, true])) });
  listeners.forEach((l) => l(fresh, source));
}

/** Remembers that the lesson (or guide) `id` was read. */
export function markLessonRead(id: string): void {
  markLessonsRead([id]);
}
