import { loadJson, saveJson } from '../../services/storage';
import { readGuidedProgress, type GuidedProgress } from './guidedFile';
import { readSession, type InterviewSession, type InterviewSummary } from './session';

/**
 * Interview and guided mode remember their state in this browser only
 * (services/storage.ts guards every access): the interview in progress per
 * problem, the summaries of finished interviews, and how far the guided
 * walkthrough got. Nothing here is synced; the account's progress only
 * knows runs and solves.
 */

const SESSION_KEY = (problem: string) => `proschi.interview.${problem}`;
export const HISTORY_KEY = 'proschi.interview.history';
const GUIDED_KEY = (problem: string) => `proschi.guided.${problem}`;
const HISTORY_MAX = 50;

export function loadSession(problem: string): InterviewSession | undefined {
  return readSession(loadJson<unknown>(SESSION_KEY(problem), undefined), problem);
}

export function saveSession(session: InterviewSession | undefined, problem: string): void {
  if (session) saveJson(SESSION_KEY(problem), session);
  else {
    try {
      localStorage.removeItem(SESSION_KEY(problem));
    } catch {
      // Storage unavailable: nothing was stored.
    }
  }
}

export function loadHistory(): InterviewSummary[] {
  const raw = loadJson<unknown>(HISTORY_KEY, []);
  return Array.isArray(raw) ? (raw.filter((s) => s && typeof s === 'object' && typeof (s as InterviewSummary).problem === 'string') as InterviewSummary[]) : [];
}

/** Keeps the newest summaries. */
export function appendHistory(summary: InterviewSummary): void {
  saveJson(HISTORY_KEY, [...loadHistory(), summary].slice(-HISTORY_MAX));
}

export interface GuidedState extends GuidedProgress {
  /** The panel is open: the solver chose guided mode and has not left it. */
  active: boolean;
}

export function loadGuided(problem: string, steps: number): GuidedState {
  const raw = loadJson<unknown>(GUIDED_KEY(problem), undefined);
  return { ...readGuidedProgress(raw, steps), active: (raw as Partial<GuidedState> | undefined)?.active === true };
}

export function saveGuided(problem: string, state: GuidedState): void {
  saveJson(GUIDED_KEY(problem), state);
}
