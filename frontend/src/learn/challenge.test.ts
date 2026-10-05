import { describe, expect, it } from 'vitest';
import { cardFromFile, type Card, type ChoiceCard, type ClozeCard, type EstimateCard } from './cards';
import {
  answerFits,
  CHALLENGE_SIZE,
  challengeDay,
  challengeEndsAt,
  challengeRound,
  challengeStats,
  challengeStreak,
  describeAnswer,
  describeRightAnswer,
  gradeChallengeAnswer,
  isPerfect,
  MAX_SCORE,
  pickChallenge,
  readAttempt,
  scoreChallenge,
  shareText,
  speedBonus,
  type ChallengeCard,
} from './challenge';

const repo = Object.entries(import.meta.glob<string>('../practice/cards/*/*.md', { query: '?raw', import: 'default', eager: true })).map(([path, text]) =>
  cardFromFile(path.replace(/^\.\.\/practice\/cards\//, ''), text),
);

const choice = cardFromFile(
  'caching/policy.md',
  '---\ntype: choice\ndifficulty: easy\n---\n## Question\nWhich loses writes?\n## Options\n- [ ] Write-through\n- [x] Write-back\n- [ ] Write-around\n',
) as ChoiceCard;
const estimate = cardFromFile(
  'estimation/qps.md',
  '---\ntype: estimate\ndifficulty: medium\nanswer: 2300\nunit: requests/s\n---\n## Question\nHow many?\n## Solution\nMath.\n',
) as EstimateCard;
const cloze = cardFromFile('caching/stampede.md', '---\ntype: cloze\ndifficulty: hard\n---\n## Text\nA {{cache stampede|thundering herd}} hits the {{database}}.\n') as ClozeCard;
const flip = cardFromFile('caching/flip.md', '---\ntype: flip\ndifficulty: easy\n---\n## Front\nQ?\n## Back\nA.\n');

/** `n` auto-graded cards over `topics` topics, cycling difficulties and types. */
function synthetic(n: number, topics = 6): Card[] {
  const difficulties = ['easy', 'medium', 'hard'];
  return Array.from({ length: n }, (_, i) => {
    const front = `---\ntype: choice\ndifficulty: ${difficulties[i % 3]}\n---\n## Question\nQuestion ${i}?\n## Options\n- [x] Yes\n- [ ] No\n`;
    return cardFromFile(`topic${i % topics}/card-${i}.md`, front);
  });
}

describe('picking the day’s cards', () => {
  const day = '2026-10-06';

  it('picks the same five cards for the same day, whatever order the cards come in', () => {
    const picked = pickChallenge(repo, day).map((c) => c.id);
    expect(picked).toHaveLength(CHALLENGE_SIZE);
    expect(new Set(picked).size).toBe(CHALLENGE_SIZE);
    expect(pickChallenge([...repo].reverse(), day).map((c) => c.id)).toEqual(picked);
    expect(pickChallenge(repo, day).map((c) => c.id)).toEqual(picked);
  });

  it('picks other cards on other days', () => {
    const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10));
    const sets = new Set(days.map((d) => pickChallenge(repo, d).map((c) => c.id).sort().join(',')));
    expect(sets.size).toBeGreaterThan(25);
  });

  it('takes only auto-graded cards that are not retired, with an estimate, mixed topics and difficulties, easy to hard', () => {
    const rank = { easy: 0, medium: 1, hard: 2 };
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const cards = pickChallenge(repo, d);
      expect(cards).toHaveLength(CHALLENGE_SIZE);
      for (const c of cards) {
        expect(['choice', 'estimate', 'cloze']).toContain(c.type);
        expect(c.retired).toBe(false);
      }
      expect(cards.some((c) => c.type === 'estimate')).toBe(true);
      expect(new Set(cards.map((c) => c.topic)).size).toBe(CHALLENGE_SIZE);
      expect(new Set(cards.map((c) => c.difficulty)).size).toBeGreaterThanOrEqual(2);
      const ranks = cards.map((c) => rank[c.difficulty]);
      expect(ranks).toEqual([...ranks].sort());
    }
  });

  it('leaves out flip and retired cards, and makes do with a small pool', () => {
    const retired = { ...choice, id: 'retired', retired: true };
    expect(pickChallenge([flip, retired, choice], day).map((c) => c.id)).toEqual(['policy']);
    expect(pickChallenge([], day)).toEqual([]);
    // Fewer topics than cards: the rest come from topics picked already.
    const few = pickChallenge(synthetic(12, 2), day);
    expect(few).toHaveLength(CHALLENGE_SIZE);
    expect(new Set(few.map((c) => c.topic)).size).toBe(2);
  });

  it('dates the day in UTC and knows when it ends', () => {
    expect(challengeDay(new Date('2026-10-06T23:59:59-05:00'))).toBe('2026-10-07');
    expect(challengeDay(new Date('2026-10-06T00:00:00Z'))).toBe('2026-10-06');
    expect(challengeEndsAt('2026-10-06')).toBe(Date.parse('2026-10-07T00:00:00Z') / 1000);
    expect(challengeRound('1970-01-02')).toBe(1);
    expect(challengeRound('2026-10-07') - challengeRound('2026-10-06')).toBe(1);
  });
});

describe('grading', () => {
  it('grades a choice by the option’s index as written', () => {
    expect(gradeChallengeAnswer(choice, 1)).toBe(true);
    expect(gradeChallengeAnswer(choice, 0)).toBe(false);
    expect(gradeChallengeAnswer(choice, 7)).toBe(false);
    expect(gradeChallengeAnswer(choice, null)).toBe(false);
  });

  it('grades an estimate within its tolerance', () => {
    expect(gradeChallengeAnswer(estimate, 2300)).toBe(true);
    expect(gradeChallengeAnswer(estimate, 4000)).toBe(true);
    expect(gradeChallengeAnswer(estimate, 23_000)).toBe(false);
    expect(gradeChallengeAnswer(estimate, -2300)).toBe(false);
  });

  it('grades a cloze card when every gap is right, ignoring case and a plural', () => {
    expect(gradeChallengeAnswer(cloze, ['Thundering herd', 'databases'])).toBe(true);
    expect(gradeChallengeAnswer(cloze, ['cache stampede'])).toBe(false);
    expect(gradeChallengeAnswer(cloze, ['cache stampede', 'cache'])).toBe(false);
    expect(gradeChallengeAnswer(cloze, [])).toBe(false);
  });

  it('checks an answer’s shape per card type', () => {
    expect(answerFits(choice, 1.5)).toBe(false);
    expect(answerFits(choice, '1')).toBe(false);
    expect(answerFits(estimate, Infinity)).toBe(false);
    expect(answerFits(estimate, ['2300'])).toBe(false);
    expect(answerFits(cloze, ['a', 'b', 'c'])).toBe(false);
    expect(answerFits(cloze, ['x'.repeat(201)])).toBe(false);
    expect(answerFits(cloze, [1])).toBe(false);
    for (const c of [choice, estimate, cloze]) expect(answerFits(c, null)).toBe(true);
  });

  it('describes answers for the result screen', () => {
    expect(describeAnswer(choice, 0)).toBe('Write-through');
    expect(describeAnswer(estimate, 2300)).toBe('2,300 requests/s');
    expect(describeAnswer(cloze, ['herd', ''])).toBe('herd, …');
    expect(describeAnswer(cloze, null)).toBe('No answer');
    expect(describeRightAnswer(choice)).toBe('Write-back');
    expect(describeRightAnswer(estimate)).toBe('2,300 requests/s');
    expect(describeRightAnswer(cloze)).toBe('cache stampede, database');
  });
});

describe('scoring', () => {
  it('gives the whole speed bonus within 10 s, none from 60 s, linear between', () => {
    expect(speedBonus(0)).toBe(20);
    expect(speedBonus(10_000)).toBe(20);
    expect(speedBonus(35_000)).toBe(10);
    expect(speedBonus(59_000)).toBe(0);
    expect(speedBonus(60_000)).toBe(0);
    expect(speedBonus(NaN)).toBe(0);
    for (let ms = 0; ms < 70_000; ms += 1000) expect(speedBonus(ms + 1000)).toBeLessThanOrEqual(speedBonus(ms));
  });

  it('scores 100 plus the bonus per right answer and nothing for a wrong one; 600 at most', () => {
    const cards: ChallengeCard[] = [choice, estimate, cloze];
    const score = scoreChallenge(cards, [
      { cardId: 'policy', answer: 1, ms: 4000 },
      { cardId: 'qps', answer: 2000, ms: 35_000 },
      { cardId: 'stampede', answer: ['nope', 'database'], ms: 1000 },
    ]);
    expect(score.results).toEqual([
      { cardId: 'policy', correct: true, points: 120, bonus: 20, ms: 4000 },
      { cardId: 'qps', correct: true, points: 110, bonus: 10, ms: 35_000 },
      { cardId: 'stampede', correct: false, points: 0, bonus: 0, ms: 1000 },
    ]);
    expect(score).toMatchObject({ score: 230, correct: 2, totalMs: 40_000 });
    expect(isPerfect(score)).toBe(false);
    expect(MAX_SCORE).toBe(600);

    const day = pickChallenge(repo, '2026-10-06');
    const best = scoreChallenge(
      day,
      day.map((c) => ({ cardId: c.id, answer: c.type === 'choice' ? c.options.findIndex((o) => o.correct) : c.type === 'estimate' ? c.answer : c.blanks.map((b) => b[0]), ms: 2000 })),
    );
    expect(best.score).toBe(MAX_SCORE);
    expect(isPerfect(best)).toBe(true);
    // Accuracy dominates: four right at full speed score less than five right at no speed.
    expect(4 * 120).toBeLessThan(5 * 100);
  });

  it('reads an attempt: one answer per card of today, in today’s order, times clamped', () => {
    const cards: ChallengeCard[] = [choice, estimate];
    expect(readAttempt(cards, [{ cardId: 'qps', answer: 1, ms: 5_000_000 }, { cardId: 'policy', answer: null, ms: 3 }])).toEqual({
      answers: [
        { cardId: 'policy', answer: null, ms: 3 },
        { cardId: 'qps', answer: 1, ms: 3_600_000 },
      ],
    });
    const error = (raw: unknown) => ('error' in readAttempt(cards, raw) ? (readAttempt(cards, raw) as { error: string }).error : '');
    expect(error({})).toMatch(/must be a list/);
    expect(error([{ cardId: 'policy', answer: 1, ms: 1 }])).toMatch(/one answer for each of today's 2 cards/);
    expect(error([{ cardId: 'policy', answer: 1, ms: 1 }, { cardId: 'other', answer: 1, ms: 1 }])).toMatch(/not one of today's cards/);
    expect(error([{ cardId: 'policy', answer: 1, ms: 1 }, { cardId: 'policy', answer: 1, ms: 1 }])).toMatch(/answered twice/);
    expect(error([{ cardId: 'policy', answer: 'x', ms: 1 }, { cardId: 'qps', answer: 1, ms: 1 }])).toMatch(/not an answer to a choice card/);
    expect(error([{ cardId: 'policy', answer: 1, ms: -1 }, { cardId: 'qps', answer: 1, ms: 1 }])).toMatch(/ms must be/);
    expect(error([null, { cardId: 'qps', answer: 1, ms: 1 }])).toMatch(/must be \{cardId/);
  });

  it('writes the share text', () => {
    expect(shareText('2026-10-06', 480, [true, true, false, true, true])).toBe('Proschi daily challenge 2026-10-06: 480/600 ✅✅❌✅✅ proschi.app/practice/#/challenge');
  });
});

describe('the challenge streak', () => {
  it('counts UTC days in a row, alive through today while today is open', () => {
    expect(challengeStreak([], '2026-10-06')).toEqual({ current: 0, longest: 0, todayDone: false });
    expect(challengeStreak(['2026-10-04', '2026-10-05'], '2026-10-06')).toEqual({ current: 2, longest: 2, todayDone: false });
    expect(challengeStreak(['2026-10-04', '2026-10-05', '2026-10-06'], '2026-10-06')).toEqual({ current: 3, longest: 3, todayDone: true });
    expect(challengeStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'], '2026-10-06')).toEqual({ current: 1, longest: 3, todayDone: false });
    expect(challengeStreak(['2026-10-01', '2026-10-02'], '2026-10-06')).toEqual({ current: 0, longest: 2, todayDone: false });
    // Duplicates, malformed and future days are ignored.
    expect(challengeStreak(['2026-10-05', '2026-10-05', 'nope', '2026-10-09'], '2026-10-06')).toEqual({ current: 1, longest: 1, todayDone: false });
    // Across a month end.
    expect(challengeStreak(['2026-09-30', '2026-10-01'], '2026-10-01').current).toBe(2);
  });

  it('feeds the badges', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-0${i + 1}`, perfect: i === 3 }));
    expect(challengeStats(days, '2026-10-07')).toEqual({ completed: 7, perfect: 1, longestStreak: 7 });
  });
});
