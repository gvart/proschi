import { describe, expect, it } from 'vitest';
import { readSoloResults, soloScores, type SoloResults } from './soloInterview';

const MIN = 60_000;
const results: SoloResults = {
  phases: { clarify: 4 * MIN, estimate: 3 * MIN, design: 20 * MIN, wrapup: 2 * MIN },
  questions: { asked: 5, good: 3, weak: 2, goodTotal: 4 },
  estimates: { answered: 2, correct: 1, total: 2 },
  tests: { passed: 6, total: 6 },
  checklist: { checked: 1, total: 4 },
};

describe('an interview on your own, what it did', () => {
  it('reads well-formed results and drops anything else', () => {
    expect(readSoloResults(results)).toEqual(results);
    expect(readSoloResults({ ...results, extra: 1 })).toEqual(results);
    expect(readSoloResults({ ...results, tests: null })).not.toHaveProperty('tests');
    for (const bad of [
      null,
      'x',
      { ...results, phases: { clarify: 1 } },
      { ...results, phases: { ...results.phases, design: 1.5 } },
      { ...results, questions: { ...results.questions, good: -1 } },
      { ...results, estimates: { total: 2 } },
      { ...results, tests: { passed: 'all', total: 6 } },
      { ...results, checklist: { checked: 5000, total: 4 } },
    ]) {
      expect(readSoloResults(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('scores each skill from 1 to 5 by the share done, design by the checks (1 with none run)', () => {
    expect(soloScores(results)).toEqual({ requirements: 4, estimation: 3, design: 5, tradeoffs: 2 });
    const noChecks: SoloResults = { ...results, tests: undefined, estimates: { answered: 0, correct: 0, total: 0 } };
    expect(soloScores(noChecks)).toMatchObject({ design: 1, estimation: 1 });
  });
});
