// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { parseSession } from '../../partner/contract';
import { MAX_PREP_CELL, MAX_PREP_ROWS, MAX_PREP_TEXT } from '../../partner/prep';
import { ASK_TIP_KEY, askTipDone, COACH_EXAMPLES, markAskTipDone, prepTurnOf } from './coach';
import { EMPTY_NOTES, STAGES } from './flow';

const row = (id: string, expression: string, label = 'Writes per second') => ({ id, label, expression, unit: '/s' });

describe('what an Interview coach turn carries', () => {
  it('is the stage alone while there are no notes', () => {
    expect(prepTurnOf('clarify', EMPTY_NOTES, [row('q0', '')])).toEqual({ stage: 'clarify' });
  });

  it('carries the questions, the filled worksheet rows with their checks, and the reflection', () => {
    const notes = { ...EMPTY_NOTES, questions: '  How many links a day?  ', reflection: 'The database.', estimates: { 1: { value: 40, correct: false, factor: 25, direction: 'low' as const } } };
    expect(prepTurnOf('estimate', notes, [row('q0', '100M / 86400 '), row('q1', '40', 'Storage'), row('q2', ''), row('mine', '3 * 4', 'Mine')])).toEqual({
      stage: 'estimate',
      questions: 'How many links a day?',
      worksheet: [
        { label: 'Writes per second', expression: '100M / 86400', unit: '/s' },
        { label: 'Storage', expression: '40', unit: '/s', checked: { value: 40, correct: false } },
        { label: 'Mine', expression: '3 * 4', unit: '/s' },
      ],
      reflection: 'The database.',
    });
  });

  it('is cut to the caps the server checks', () => {
    const notes = { ...EMPTY_NOTES, questions: 'q'.repeat(8000), reflection: 'r'.repeat(8000) };
    const rows = Array.from({ length: 40 }, (_, i) => row(`r${i}`, 'x'.repeat(500), 'l'.repeat(500)));
    const turn = prepTurnOf('wrapup', notes, rows);
    expect(turn.questions).toHaveLength(MAX_PREP_TEXT);
    expect(turn.reflection).toHaveLength(MAX_PREP_TEXT);
    expect(turn.worksheet).toHaveLength(MAX_PREP_ROWS);
    expect(turn.worksheet![0].label).toHaveLength(MAX_PREP_CELL);
    expect(turn.worksheet![0].expression).toHaveLength(MAX_PREP_CELL);
  });

  it('has two or three examples for every stage', () => {
    for (const s of STAGES) expect(COACH_EXAMPLES[s.id].length).toBeGreaterThanOrEqual(2);
  });

  it('reads an interview prep chat back as the coach’s', () => {
    expect(parseSession({ id: 's1', context: { kind: 'prep', problemId: 'url-shortener' }, turns: [] })?.context).toEqual({ kind: 'prep', problemId: 'url-shortener' });
  });
});

describe('the select-to-ask tip', () => {
  beforeEach(() => localStorage.clear());

  it('shows until it is used or dismissed, remembered in this browser', () => {
    expect(askTipDone()).toBe(false);
    markAskTipDone();
    expect(askTipDone()).toBe(true);
    expect(localStorage.getItem(ASK_TIP_KEY)).toBe('true');
  });
});
