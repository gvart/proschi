import { MAX_PREP_CELL, MAX_PREP_ROWS, MAX_PREP_TEXT, type PrepRow, type PrepTurn } from '../../partner/prep';
import { loadJson, saveJson } from '../../services/storage';
import { questionOf, type WorksheetRow } from '../interview/stages';
import type { StageId, StageNotes } from './flow';

/**
 * The Interview coach on a roadmap problem's interview prep stages
 * (docs/design/paid-plans.md P59): what each of its turns carries besides
 * the message (the stage on screen and the learner's own notes, cut to the
 * server's caps), its example asks per stage, and the "select to ask" tip,
 * shown until the learner asks about a selection or dismisses it.
 */

const cut = (text: string, max: number) => text.trim().slice(0, max);

/** The stage on screen and the notes as they stand; empty notes are left out. `rows` is the estimate worksheet as the page shows it. */
export function prepTurnOf(stage: StageId, notes: StageNotes, rows: WorksheetRow[]): PrepTurn {
  const worksheet: PrepRow[] = rows
    .map((row) => {
      const i = questionOf(row);
      const check = i === undefined ? undefined : notes.estimates[i];
      return {
        label: cut(row.label, MAX_PREP_CELL),
        expression: cut(row.expression, MAX_PREP_CELL),
        unit: cut(row.unit, MAX_PREP_CELL),
        ...(check ? { checked: { value: check.value, correct: check.correct } } : {}),
      };
    })
    .filter((r) => r.expression || r.checked)
    .slice(0, MAX_PREP_ROWS);
  const questions = cut(notes.questions, MAX_PREP_TEXT);
  const reflection = cut(notes.reflection, MAX_PREP_TEXT);
  return { stage, ...(questions ? { questions } : {}), ...(worksheet.length ? { worksheet } : {}), ...(reflection ? { reflection } : {}) };
}

/** Two or three things to ask the coach on each stage; a tap puts one in the composer. */
export const COACH_EXAMPLES: Record<StageId, string[]> = {
  lesson: ['Which part of this lesson comes up most in interviews?', 'Quiz me on one idea from the lesson.'],
  clarify: ['Which questions should I ask first, and why?', 'What would I assume if the interviewer says “you decide”?', 'Are my questions missing anything important?'],
  estimate: ['Check my method for the write rate.', 'Is my storage estimate the right order of magnitude?', 'How do I explain an estimate out loud?'],
  design: ['How should I walk the interviewer through this design?', 'What will the interviewer probe first?', 'Which trade-off should I name here?'],
  wrapup: ['Help me answer “what breaks first at 10×?”', 'How do I sum up my design in a minute?', 'What would I change with more time?'],
};

export const ASK_TIP_KEY = 'proschi.prep.askTip';

/** Whether the "select to ask" tip was used or dismissed in this browser. */
export const askTipDone = (): boolean => loadJson<unknown>(ASK_TIP_KEY, false) === true;
export const markAskTipDone = (): void => saveJson(ASK_TIP_KEY, true);
