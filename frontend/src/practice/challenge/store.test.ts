import { describe, expect, it } from 'vitest';
import { cardFromFile, type ChoiceCard, type EstimateCard } from '../../learn/cards';
import { localDay } from '../../learn/review';
import { readResult, scoreLocally, type ChallengeResult } from './store';

const choice = cardFromFile('caching/policy.md', '---\ntype: choice\ndifficulty: easy\n---\n## Question\nWhich?\n## Options\n- [ ] A\n- [x] B\n') as ChoiceCard;
const estimate = cardFromFile('estimation/qps.md', '---\ntype: estimate\ndifficulty: medium\nanswer: 2300\nunit: requests/s\n---\n## Question\nHow many?\n## Solution\nMath.\n') as EstimateCard;

describe('the challenge in the browser', () => {
  it('scores like the server and keeps the answers for the result screen', () => {
    const result = scoreLocally('2026-10-06', [choice, estimate], [
      { cardId: 'policy', answer: 1, ms: 3000 },
      { cardId: 'qps', answer: 99, ms: 3000 },
    ]);
    expect(result).toEqual({
      day: '2026-10-06',
      score: 120,
      maxScore: 600,
      correct: 1,
      perfect: false,
      totalMs: 6000,
      results: [
        { cardId: 'policy', answer: 1, ms: 3000, correct: true, points: 120, bonus: 20 },
        { cardId: 'qps', answer: 99, ms: 3000, correct: false, points: 0, bonus: 0 },
      ],
      // This device's date, for the daily streak.
      localDay: localDay(new Date()),
    });
    // What storage gives back reads the same; anything malformed is dropped.
    expect(readResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(readResult({ ...result, day: 'today' })).toBeUndefined();
    expect(readResult({ ...result, results: [{ cardId: 'policy' }] })).toBeUndefined();
    expect(readResult(null)).toBeUndefined();
    // Results kept before the local day was recorded read without it (the streak takes the challenge's day), and a bad one is dropped.
    const older: ChallengeResult = { ...result };
    delete older.localDay;
    expect(readResult(older)).toEqual(older);
    expect(readResult({ ...result, localDay: 'yesterday' })).toEqual(older);
  });
});
