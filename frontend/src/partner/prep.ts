/**
 * What an Interview coach turn carries besides the message (docs/design/
 * paid-plans.md P59, backend/README.md "Design partner"), shared with the
 * Worker, which checks it against the same caps: no imports, so the
 * backend's type check reads only this file.
 */

/** The interview prep stage on screen when an Interview coach turn is sent. */
export type PrepStage = 'lesson' | 'clarify' | 'estimate' | 'design' | 'wrapup';
export const PREP_STAGES: readonly PrepStage[] = ['lesson', 'clarify', 'estimate', 'design', 'wrapup'];

/** Caps on what an Interview coach turn carries of the stage notes; the page cuts to them, the server refuses more (400). */
export const MAX_PREP_TEXT = 2_000;
export const MAX_PREP_ROWS = 24;
export const MAX_PREP_CELL = 200;

/** One estimate worksheet row as the candidate typed it, with its check once they committed to a number. */
export interface PrepRow {
  label: string;
  expression: string;
  unit: string;
  checked?: { value: number; correct: boolean };
}

/**
 * Sent with each Interview coach turn, never stored: the stage on screen and
 * the candidate's own notes of the problem's stages. The server fences them
 * as data in the request (`<stage>`, `<candidate_notes>`).
 */
export interface PrepTurn {
  stage: PrepStage;
  /** Clarify: their questions and assumptions. */
  questions?: string;
  /** Estimate: the worksheet rows they filled in. */
  worksheet?: PrepRow[];
  /** Wrap-up: what breaks first at 10×, in their words. */
  reflection?: string;
}
