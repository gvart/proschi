// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { EstimateQuestion } from '../modes/interviewFile';
import { canOpen, checkEstimate, EMPTY_NOTES, goTo, loadNotes, nextOf, NOTES_KEY, openingScreen, readNotes, saveNotes, stageDone, STAGES } from './flow';

const question: EstimateQuestion = { question: 'Codes a year?', answer: 3.2e9, unit: 'codes', low: 1.5e9, high: 6e9, tolerance: 2, solution: '…' };

describe('the stages of a practice problem', () => {
  it('runs Lesson, Clarify, Estimate, Design, Wrap-up', () => {
    expect(STAGES.map((s) => s.label)).toEqual(['Lesson', 'Clarify', 'Estimate', 'Design', 'Wrap-up']);
    expect(nextOf('lesson')).toBe('clarify');
    expect(nextOf('design')).toBe('wrapup');
    expect(nextOf('wrapup')).toBeUndefined();
  });

  it('opens on the lesson until it is read, then where the learner left off', () => {
    const atDesign = goTo(EMPTY_NOTES, 'design');
    expect(openingScreen(true, 'unread', false, atDesign)).toBe('lesson');
    expect(openingScreen(true, 'unread', true, atDesign)).toBe('design');
    expect(openingScreen(true, 'always', true, atDesign)).toBe('lesson');
    expect(openingScreen(false, 'always', false, EMPTY_NOTES)).toBe('clarify');
  });

  it('remembers the furthest stage, so going back keeps the later ones open', () => {
    const back = goTo(goTo(EMPTY_NOTES, 'design'), 'clarify');
    expect(back).toMatchObject({ stage: 'clarify', reached: 'design' });
    expect(canOpen(back, 'estimate')).toBe(true);
    expect(canOpen(back, 'design')).toBe(true);
    expect(canOpen(back, 'wrapup')).toBe(false);
    expect(canOpen(EMPTY_NOTES, 'lesson')).toBe(true);
  });

  it('checks an estimate once, against its accepted range', () => {
    const low = checkEstimate(EMPTY_NOTES, 0, question, 1e8);
    expect(low.estimates[0]).toMatchObject({ value: 1e8, correct: false, direction: 'low' });
    expect(checkEstimate(low, 0, question, 3e9)).toBe(low);
    expect(checkEstimate(EMPTY_NOTES, 0, question, 3e9).estimates[0].correct).toBe(true);
  });

  it('makes Next the primary action once the stage’s own thinking is done', () => {
    expect(stageDone(EMPTY_NOTES, 'clarify', 2, false)).toBe(false);
    expect(stageDone({ ...EMPTY_NOTES, revealed: true }, 'clarify', 2, false)).toBe(true);
    const one = checkEstimate(EMPTY_NOTES, 0, question, 3e9);
    expect(stageDone(one, 'estimate', 2, false)).toBe(false);
    expect(stageDone(checkEstimate(one, 1, question, 3e9), 'estimate', 2, false)).toBe(true);
    expect(stageDone(EMPTY_NOTES, 'design', 2, true)).toBe(true);
  });
});

describe('the stage notes in storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per problem', () => {
    const notes = { ...goTo(EMPTY_NOTES, 'estimate'), questions: 'How many reads a second?', revealed: true, covered: [0, 2], reflection: 'The cache.' };
    saveNotes('url-shortener', notes);
    expect(loadNotes('url-shortener')).toEqual(notes);
    expect(loadNotes('pastebin')).toEqual(EMPTY_NOTES);
  });

  it('reads damaged entries as not done yet', () => {
    localStorage.setItem(NOTES_KEY('x'), '{"stage":"lesson","reached":"nope","questions":5,"covered":[1,1,"a",-1],"estimates":{"0":{"value":"9"},"1":{"value":2,"correct":true,"factor":1,"direction":"exact"}},"rows":[{"id":"a"}]}');
    expect(loadNotes('x')).toEqual({ ...EMPTY_NOTES, covered: [1], rows: [], estimates: { 1: { value: 2, correct: true, factor: 1, direction: 'exact' } } });
    expect(readNotes(null)).toEqual(EMPTY_NOTES);
    expect(readNotes({ stage: 'wrapup', reached: 'clarify' })).toMatchObject({ stage: 'wrapup', reached: 'wrapup' });
  });
});
