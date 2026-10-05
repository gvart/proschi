import { describe, expect, it } from 'vitest';
import { cardFromFile, type ChoiceCard, type ClozeCard, type EstimateCard } from './cards';
import { formatFactor, formatNumber, gradeClozeAnswers, gradeEstimateAnswer, optionOrder, parseNumber } from './grade';

describe('parseNumber', () => {
  it('reads plain numbers, thousands separators, suffixes and exponents', () => {
    const cases: [string, number][] = [
      ['2300', 2300],
      ['2,300', 2300],
      ['2 300', 2300],
      ['1,000,000', 1e6],
      ['2.3k', 2300],
      ['2.3 K', 2300],
      ['1e6', 1e6],
      ['1.5E-3', 0.0015],
      ['5M', 5e6],
      ['5 million', 5e6],
      ['2B', 2e9],
      ['3 bn', 3e9],
      ['.5', 0.5],
      [' 43 ', 43],
      ['-2', -2],
    ];
    for (const [text, value] of cases) expect(parseNumber(text), text).toBeCloseTo(value, 9);
  });

  it('refuses what is not a number, and a lowercase m', () => {
    for (const text of ['', 'abc', '2,30', '12,3456', '5m', '5x', '1e', '2..3', '1/2', 'k']) expect(parseNumber(text), text).toBeUndefined();
  });
});

const estimate = cardFromFile('estimation/qps.md', '---\ntype: estimate\ndifficulty: easy\nanswer: 2300\nunit: requests/s\n---\n## Question\nHow many?\n## Solution\nMath.\n') as EstimateCard;

describe('estimates', () => {
  it('says whether an estimate is within tolerance and how far off it is', () => {
    expect(gradeEstimateAnswer(estimate, 2300)).toEqual({ correct: true, factor: 1, direction: 'exact' });
    expect(gradeEstimateAnswer(estimate, 4000)).toMatchObject({ correct: true, direction: 'high' });
    const high = gradeEstimateAnswer(estimate, 23_000);
    expect(high).toMatchObject({ correct: false, direction: 'high' });
    expect(formatFactor(high.factor)).toBe('10');
    const low = gradeEstimateAnswer(estimate, 690);
    expect(low).toMatchObject({ correct: false, direction: 'low' });
    expect(formatFactor(low.factor)).toBe('3.3');
    expect(formatFactor(2300)).toBe('2,300');
  });

  it('formats answers with thousands separators', () => {
    expect([2300, 2.25, 43, 1e6, 0.0015, 1e25].map(formatNumber)).toEqual(['2,300', '2.25', '43', '1,000,000', '0.0015', '10,000,000,000,000,000,000,000,000']);
  });
});

describe('choice and cloze', () => {
  const choice = cardFromFile('networking/lb.md', '---\ntype: choice\ndifficulty: easy\n---\n## Question\nWhich?\n## Options\n- [ ] A\n- [x] B\n- [ ] C\n- [ ] D\n') as ChoiceCard;

  it('shuffles options the same way for a card and round, differently otherwise', () => {
    const order = optionOrder(choice);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(optionOrder(choice)).toEqual(order);
    const rounds = new Set(Array.from({ length: 12 }, (_, i) => optionOrder(choice, i).join()));
    expect(rounds.size).toBeGreaterThan(1);
  });

  it('grades every gap of a cloze card', () => {
    const cloze = cardFromFile('caching/s.md', '---\ntype: cloze\ndifficulty: easy\n---\n## Text\nA {{cache stampede|thundering herd}}, fixed by {{coalescing}}.\n') as ClozeCard;
    expect(gradeClozeAnswers(cloze, ['Thundering herd', 'coalescing'])).toEqual({ correct: true, gaps: [true, true] });
    expect(gradeClozeAnswers(cloze, ['cache stampedes', ''])).toEqual({ correct: false, gaps: [true, false] });
    expect(gradeClozeAnswers(cloze, [])).toEqual({ correct: false, gaps: [false, false] });
  });
});
