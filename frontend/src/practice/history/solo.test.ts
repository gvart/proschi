import { describe, expect, it } from 'vitest';
import type { InterviewSummary } from '../modes/session';
import type { KeptSolo } from './api';
import { mergeSolo, soloOutcome, soloTrend } from './solo';

const MIN = 60_000;
const START = Date.UTC(2026, 10, 1);
const summary = (over: Partial<InterviewSummary> = {}): InterviewSummary => ({
  problem: 'url-shortener',
  startedAt: START,
  durationMin: 45,
  totalMs: 30 * MIN,
  overtime: false,
  phases: { clarify: 5 * MIN, estimate: 5 * MIN, design: 18 * MIN, wrapup: 2 * MIN },
  questions: { asked: 4, good: 2, weak: 2, goodTotal: 4 },
  estimates: { answered: 2, correct: 2, total: 2, factors: [1, 1.2] },
  tests: { passed: 6, total: 6, solved: true },
  checklist: { checked: 4, total: 4 },
  drew: true,
  ...over,
});
const kept = (over: Partial<KeptSolo> = {}): KeptSolo => ({ problem: 'pastebin', startedAt: START - 86_400_000, durationMin: 30, totalMs: 35 * MIN, reachedDesign: true, drew: true, solved: false, ...over });

describe('interviews on your own on the progress page', () => {
  it('merges the browser’s and the account’s, newest first, one per session', () => {
    const results = { phases: { clarify: 0, estimate: 0, design: 0, wrapup: 0 }, questions: { asked: 0, good: 0, weak: 0, goodTotal: 4 }, estimates: { answered: 0, correct: 0, total: 2 }, checklist: { checked: 0, total: 4 } };
    const merged = mergeSolo([summary()], [kept({ results }), kept({ problem: 'url-shortener', startedAt: START, durationMin: 45 })]);
    expect(merged.map((r) => r.problem)).toEqual(['url-shortener', 'pastebin']);
    expect(merged[0].results?.questions.good).toBe(2);
    expect(merged[1]).toMatchObject({ overtime: true, counts: true, solved: false, results });
  });

  it('names how each ended, and scores only those that count and say what they did', () => {
    const short = summary({ startedAt: START + 1, totalMs: MIN, drew: false, phases: { clarify: MIN, estimate: 0, design: 0, wrapup: 0 } });
    const records = mergeSolo([summary(), short], [kept()]);
    expect(records.map(soloOutcome)).toEqual(['Too short to count', 'Solved on time', 'Over time']);
    expect(soloTrend(records)).toEqual([{ id: `url-shortener-${START}`, problem: 'url-shortener', startedAt: START, scores: { requirements: 3, estimation: 5, design: 5, tradeoffs: 5 }, outcome: 'Solved on time' }]);
  });
});
