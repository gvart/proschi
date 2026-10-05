import { describe, expect, it } from 'vitest';
import { cardFromFile, readTopics, type Card } from './cards';
import { DAY, nextState, retrievability, type Rating } from './fsrs';
import { estimateAccuracy, MASTERY_WEIGHTS, percent, relatedProblems, skills, topicMastery, type MasteryInput, type ProblemInfo } from './mastery';
import type { CardStates } from './review';

const topics = readTopics(
  JSON.stringify([
    { id: 'estimation', title: 'Estimation', summary: 'Numbers.' },
    { id: 'caching', title: 'Caching', summary: 'Caches.' },
    { id: 'queues', title: 'Queues', summary: 'Queues.' },
    { id: 'empty', title: 'Empty', summary: 'No cards.' },
  ]),
);

function card(file: string, extra = ''): Card {
  return cardFromFile(file, `---\ntype: flip\ndifficulty: easy\n${extra}---\n## Front\nQ?\n## Back\nA.\n`);
}

const cards = [
  card('caching/c1.md', 'related: [url-shortener]\n'),
  card('caching/c2.md'),
  card('caching/c3.md', 'status: retired\n'),
  card('estimation/e1.md'),
  card('queues/q1.md', 'tags: [caching]\n'),
];

const problems: ProblemInfo[] = [
  { id: 'url-shortener', difficulty: 'easy', tags: ['read-heavy'] },
  { id: 'cdn', difficulty: 'medium', tags: ['caching', 'cdn'] },
  { id: 'feed', difficulty: 'medium', tags: ['caching', 'queues'] },
  { id: 'chat', difficulty: 'medium', tags: ['websocket'] },
];

const NOW = 1_800_000_000;

/** A card reviewed `good` at `at`. */
const good = (at: number) => nextState(undefined, 3, at);

function input(over: Partial<MasteryInput> = {}): MasteryInput {
  return { cards, topics, states: {}, now: NOW, problems, solved: [], estimateRatings: [], ...over };
}

describe('topic mastery', () => {
  it('is 0 with nothing done', () => {
    expect(topicMastery('caching', input())).toMatchObject({ mastery: 0, recall: 0, coverage: 0, problems: 0, cards: 3 });
  });

  it('blends recall over every card, coverage and related problems, documented weights', () => {
    const states: CardStates = { c1: good(NOW - DAY), q1: good(NOW - DAY) };
    const m = topicMastery('caching', input({ states, solved: ['cdn'] }));
    // Three reviewable cards (the retired one is out); c2 never seen counts 0.
    const r = retrievability(states.c1, NOW);
    expect(m.recall).toBeCloseTo((2 * r) / 3);
    expect(m.coverage).toBeCloseTo(2 / 3);
    // Related: url-shortener (c1's related), cdn and feed (tagged caching): 1 of 3 solved.
    expect(m.problems).toBeCloseTo(1 / 3);
    const w = MASTERY_WEIGHTS;
    expect(m.mastery).toBeCloseTo((w.recall * m.recall + w.coverage * m.coverage + w.problems * m.problems!) / (w.recall + w.coverage + w.problems));
  });

  it('leaves out problems when none relate, and counts three solved in full', () => {
    expect(topicMastery('estimation', input()).problems).toBeUndefined();
    expect(relatedProblems('caching', cards, problems)).toEqual(['cdn', 'feed', 'url-shortener']);
    expect(topicMastery('caching', input({ solved: ['cdn', 'feed', 'url-shortener'] })).problems).toBe(1);
    // Fewer than three related: all of them count in full.
    expect(topicMastery('queues', input({ solved: ['feed'] })).problems).toBe(1);
  });

  it('adds estimation accuracy over the latest 20 answers, for estimation only', () => {
    const ratings: Rating[] = [...Array(30).fill(1), ...Array(15).fill(3), ...Array(5).fill(1)];
    expect(estimateAccuracy(ratings)).toBeCloseTo(15 / 20);
    expect(estimateAccuracy([])).toBe(0);
    const states: CardStates = { e1: good(NOW) };
    const m = topicMastery('estimation', input({ states, estimateRatings: ratings }));
    expect(m.accuracy).toBeCloseTo(0.75);
    const w = MASTERY_WEIGHTS;
    expect(m.mastery).toBeCloseTo((w.recall * 1 + w.coverage * 1 + w.accuracy * 0.75) / (w.recall + w.coverage + w.accuracy));
    expect(topicMastery('caching', input({ estimateRatings: ratings })).accuracy).toBeUndefined();
  });

  it('decays as recall does', () => {
    const states: CardStates = { e1: good(NOW - 2 * DAY) };
    const soon = topicMastery('estimation', input({ states, now: NOW })).mastery;
    const later = topicMastery('estimation', input({ states, now: NOW + 60 * DAY })).mastery;
    expect(later).toBeLessThan(soon);
  });

  it('starts a card over when its answer changed', () => {
    const states: CardStates = { e1: { ...good(NOW), version: 1 } };
    const changed = [...cards.filter((c) => c.id !== 'e1'), { ...cards.find((c) => c.id === 'e1')!, version: 2 }];
    expect(topicMastery('estimation', input({ cards: changed, states })).coverage).toBe(0);
  });
});

describe('readiness', () => {
  it('weights topics by their cards, skips topics without cards and names the weakest three', () => {
    const states: CardStates = { e1: good(NOW), c1: good(NOW), c2: good(NOW) };
    const s = skills(input({ states }));
    expect(s.topics.map((t) => t.topic)).toEqual(['estimation', 'caching', 'queues']);
    const total = s.topics.reduce((sum, t) => sum + t.cards, 0);
    expect(s.readiness).toBeCloseTo(s.topics.reduce((sum, t) => sum + t.mastery * t.cards, 0) / total);
    expect(s.weakest).toEqual(['queues', 'caching', 'estimation']);
  });

  it('breaks ties in tags.json order', () => {
    expect(skills(input()).weakest).toEqual(['estimation', 'caching', 'queues']);
    expect(skills(input()).readiness).toBe(0);
  });

  it('shows percentages rounded down', () => {
    expect(percent(0.795)).toBe(79);
    expect(percent(0.8)).toBe(80);
    expect(percent(1.2)).toBe(100);
    expect(percent(-1)).toBe(0);
  });
});

describe('the Scale or Fail bonus', () => {
  it('adds up to GAME_BONUS to a topic, never takes away', async () => {
    const { skills, GAME_BONUS, GAME_LESSONS_FOR_FULL } = await import('./mastery');
    const topics = [{ id: 'caching', title: 'Caching', summary: 'x' }];
    const base = { cards: [], topics, states: {}, now: 0, problems: [], solved: [], estimateRatings: [] };
    expect(skills(base).topics).toEqual([]);
    const card = { id: 'c1', topic: 'caching', tags: ['caching'], type: 'flip' as const, front: 'q', back: 'a', difficulty: 'easy' as const, related: [], decks: [], version: 1, retired: false, distinctFrom: [] };
    const without = skills({ ...base, cards: [card] }).topics[0];
    const some = skills({ ...base, cards: [card], gameLessons: { caching: 1 } }).topics[0];
    const full = skills({ ...base, cards: [card], gameLessons: { caching: GAME_LESSONS_FOR_FULL + 5 } }).topics[0];
    expect(some.mastery).toBeCloseTo(without.mastery + GAME_BONUS / GAME_LESSONS_FOR_FULL);
    expect(full.mastery).toBeCloseTo(without.mastery + GAME_BONUS);
    expect(full.game).toBe(GAME_BONUS);
  });
});
