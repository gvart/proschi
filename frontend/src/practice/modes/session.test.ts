import { describe, expect, it } from 'vitest';
import type { Interview } from './interviewFile';
import { formatClock, interviewReducer, phaseElapsed, readSession, remaining, startSession, summarize, totalElapsed, type InterviewAction, type InterviewSession } from './session';

const MIN = 60_000;
const INTERVIEW: Interview = {
  questions: [
    { question: 'Traffic?', good: true, fact: '10k rps', answer: '10k' },
    { question: 'Latency?', good: true, fact: '50 ms', answer: '50 ms' },
    { question: 'Language?', good: false, answer: 'Weak.' },
  ],
  estimates: [
    { question: 'Per day?', answer: 1000, unit: 'x', low: 500, high: 2000, tolerance: 2, solution: '…' },
    { question: 'Per hour?', answer: 100, unit: 'x', low: 80, high: 120, tolerance: 1.25, solution: '…' },
  ],
};

const run = (s: InterviewSession, ...actions: InterviewAction[]) => actions.reduce(interviewReducer, s);

describe('interview session', () => {
  it('walks the four phases and records the time spent in each', () => {
    let s = startSession('url-shortener', 45, 0);
    expect(s.phase).toBe('clarify');
    expect(remaining(s, 5 * MIN)).toBe(40 * MIN);
    s = run(s, { type: 'advance', now: 5 * MIN });
    expect(s.phase).toBe('estimate');
    s = run(s, { type: 'advance', now: 9 * MIN });
    expect(s.phase).toBe('design');
    s = run(s, { type: 'advance', now: 39 * MIN });
    expect(s.phase).toBe('wrapup');
    s = run(s, { type: 'advance', now: 44 * MIN });
    expect(s.finishedAt).toBe(44 * MIN);
    expect(s.runningSince).toBeUndefined();
    expect(s.spent).toEqual({ clarify: 5 * MIN, estimate: 4 * MIN, design: 30 * MIN, wrapup: 5 * MIN });
    // Finished: nothing changes any more, and the clock stays stopped.
    expect(run(s, { type: 'resume', now: 50 * MIN }, { type: 'ask', index: 0 })).toBe(s);
    expect(totalElapsed(s, 90 * MIN)).toBe(44 * MIN);
  });

  it('pauses and resumes the clock', () => {
    let s = startSession('p', 30, 0);
    s = run(s, { type: 'pause', now: 2 * MIN });
    expect(phaseElapsed(s, 'clarify', 20 * MIN)).toBe(2 * MIN);
    // Moving on while paused keeps the clock stopped.
    s = run(s, { type: 'advance', now: 20 * MIN });
    expect(s.phase).toBe('estimate');
    expect(s.runningSince).toBeUndefined();
    s = run(s, { type: 'resume', now: 25 * MIN }, { type: 'resume', now: 26 * MIN });
    expect(s.runningSince).toBe(25 * MIN);
    expect(phaseElapsed(s, 'estimate', 28 * MIN)).toBe(3 * MIN);
    expect(remaining(s, 60 * MIN)).toBe(30 * MIN - 2 * MIN - 35 * MIN);
  });

  it('asks questions only while clarifying, each once', () => {
    let s = startSession('p', 45, 0);
    s = run(s, { type: 'ask', index: 2 }, { type: 'ask', index: 0 }, { type: 'ask', index: 2 });
    expect(s.asked).toEqual([2, 0]);
    s = run(s, { type: 'advance', now: MIN }, { type: 'ask', index: 1 });
    expect(s.asked).toEqual([2, 0]);
  });

  it('grades estimates against their range, once each, only while estimating', () => {
    let s = startSession('p', 45, 0);
    const e0 = { type: 'estimate', index: 0, value: 1500, question: INTERVIEW.estimates[0] } as const;
    expect(run(s, e0).estimates).toEqual({});
    s = run(s, { type: 'advance', now: MIN }, e0, { type: 'estimate', index: 1, value: 300, question: INTERVIEW.estimates[1] });
    expect(s.estimates[0]).toMatchObject({ value: 1500, correct: true, direction: 'high' });
    expect(s.estimates[1]).toMatchObject({ value: 300, correct: false, factor: 3, direction: 'high' });
    // Answered: a second try does not replace it.
    expect(run(s, { ...e0, value: 1 }).estimates[0].value).toBe(1500);
  });

  it('records test runs in the design phase and the checklist in the wrap-up', () => {
    let s = startSession('p', 45, 0);
    s = run(s, { type: 'tests', passed: 1, total: 5, solved: false });
    expect(s.tests).toBeUndefined();
    s = run(s, { type: 'advance', now: 1 }, { type: 'advance', now: 2 }, { type: 'tests', passed: 4, total: 5, solved: false }, { type: 'tests', passed: 5, total: 5, solved: true });
    expect(s.tests).toEqual({ passed: 5, total: 5, solved: true });
    s = run(s, { type: 'check', id: 'failures', checked: true });
    expect(s.checked).toEqual([]);
    s = run(s, { type: 'advance', now: 3 }, { type: 'check', id: 'failures', checked: true }, { type: 'check', id: 'tradeoffs', checked: true }, { type: 'check', id: 'failures', checked: false });
    expect(s.checked).toEqual(['tradeoffs']);
  });

  it('summarizes time, questions, estimates, tests and the self-review', () => {
    let s = startSession('p', 30, 0);
    s = run(
      s,
      { type: 'ask', index: 0 },
      { type: 'ask', index: 2 },
      { type: 'advance', now: 4 * MIN },
      { type: 'estimate', index: 0, value: 900, question: INTERVIEW.estimates[0] },
      { type: 'advance', now: 8 * MIN },
      { type: 'tests', passed: 7, total: 10, solved: false },
      { type: 'advance', now: 33 * MIN },
      { type: 'check', id: 'bottlenecks', checked: true },
      { type: 'advance', now: 35 * MIN },
    );
    expect(summarize(s, INTERVIEW, 99 * MIN)).toEqual({
      problem: 'p',
      startedAt: 0,
      durationMin: 30,
      totalMs: 35 * MIN,
      overtime: true,
      phases: { clarify: 4 * MIN, estimate: 4 * MIN, design: 25 * MIN, wrapup: 2 * MIN },
      questions: { asked: 2, good: 1, weak: 1, goodTotal: 2 },
      estimates: { answered: 1, correct: 1, total: 2, factors: [expect.closeTo(1.11, 2)] },
      tests: { passed: 7, total: 10, solved: false },
      checklist: { checked: 1, total: 4 },
    });
  });

  it('formats the clock, over time too', () => {
    expect(formatClock(45 * MIN)).toBe('45:00');
    expect(formatClock(61_500)).toBe('1:01');
    expect(formatClock(-90_000)).toBe('-1:30');
  });

  it('reads a stored session back, and refuses a damaged one', () => {
    const s = run(startSession('p', 60, 10), { type: 'advance', now: 20 }, { type: 'estimate', index: 0, value: 1000, question: INTERVIEW.estimates[0] });
    expect(readSession(JSON.parse(JSON.stringify(s)), 'p')).toEqual(s);
    expect(readSession(s, 'other')).toBeUndefined();
    expect(readSession({ ...s, durationMin: 50 }, 'p')).toBeUndefined();
    expect(readSession({ ...s, phase: 'lunch' }, 'p')).toBeUndefined();
    expect(readSession({ ...s, asked: ['x'] }, 'p')).toBeUndefined();
    expect(readSession(null, 'p')).toBeUndefined();
    // A damaged estimate is dropped, the rest kept.
    expect(readSession({ ...s, estimates: { 0: s.estimates[0], 1: { value: 'x' } } }, 'p')?.estimates).toEqual({ 0: s.estimates[0] });
  });
});
