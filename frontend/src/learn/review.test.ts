import { describe, expect, it } from 'vitest';
import { cardFromFile, readTopics, type Card } from './cards';
import { DAY, nextState, type Rating } from './fsrs';
import {
  applyReviews,
  autoRating,
  buildSession,
  dayCounts,
  daysBetween,
  formatInterval,
  isDay,
  isDue,
  isNew,
  localDay,
  withPending,
  newCardOrder,
  overview,
  reviewable,
  statesFromLog,
  type CardReview,
  type CardStates,
} from './review';

const topics = readTopics(
  JSON.stringify([
    { id: 'estimation', title: 'Estimation', summary: 'Numbers.' },
    { id: 'caching', title: 'Caching', summary: 'Caches.' },
    { id: 'queues', title: 'Queues', summary: 'Queues.' },
  ]),
);

function card(file: string, difficulty = 'medium', extra = ''): Card {
  return cardFromFile(file, `---\ntype: flip\ndifficulty: ${difficulty}\n${extra}---\n## Front\nQ?\n## Back\nA.\n`);
}

const cards = [
  card('caching/b-medium.md'),
  card('caching/a-hard.md', 'hard'),
  card('caching/c-easy.md', 'easy', 'decks: [sample]\n'),
  card('estimation/e-easy.md', 'easy', 'decks: [sample]\n'),
  card('estimation/f-medium.md', 'medium', 'tags: [caching]\n'),
  card('queues/q-old.md', 'easy', 'status: retired\n'),
  card('queues/r-medium.md'),
];

const NOW = 1_800_000_000;

const repo = Object.entries(import.meta.glob<string>('../practice/cards/*/*.md', { query: '?raw', import: 'default', eager: true })).map(([path, text]) =>
  cardFromFile(path.replace(/^\.\.\/practice\/cards\//, ''), text),
);
const repoTopics = readTopics(Object.values(import.meta.glob<string>('../practice/cards/tags.json', { query: '?raw', import: 'default', eager: true }))[0]);

describe('which cards to review', () => {
  it('introduces new cards a topic at a time in tags.json order, easy before hard', () => {
    const order = newCardOrder(reviewable(cards), topics).map((c) => c.id);
    expect(order).toEqual(['e-easy', 'c-easy', 'r-medium', 'f-medium', 'b-medium', 'a-hard']);
  });

  it('leaves out retired cards and filters by topic (folder or tag) and deck', () => {
    expect(reviewable(cards).map((c) => c.id)).not.toContain('q-old');
    expect(reviewable(cards, { topic: 'caching' }).map((c) => c.id).sort()).toEqual(['a-hard', 'b-medium', 'c-easy', 'f-medium']);
    expect(reviewable(cards, { deck: 'sample' }).map((c) => c.id).sort()).toEqual(['c-easy', 'e-easy']);
  });

  it('treats a card reviewed before its version went up as new', () => {
    const state = nextState(undefined, 3, NOW - 10 * DAY);
    expect(isNew({ version: 1 }, state)).toBe(false);
    expect(isDue({ version: 1 }, state, NOW)).toBe(true);
    expect(isNew({ version: 2 }, state)).toBe(true);
    expect(isDue({ version: 2 }, state, NOW)).toBe(false);
    expect(isNew({ version: 1 }, undefined)).toBe(true);
  });

  it('puts due cards first, the most overdue first, then new cards up to the limits', () => {
    const states: CardStates = {
      'b-medium': nextState(undefined, 3, NOW - 5 * DAY), // due 2 days ago
      'r-medium': nextState(undefined, 3, NOW - 10 * DAY), // due 7 days ago
      'a-hard': nextState(undefined, 4, NOW - DAY), // not due for two weeks
    };
    const session = buildSession(cards, states, topics, { now: NOW, newLimit: 2 });
    expect(session.map((s) => [s.card.id, s.isNew])).toEqual([
      ['r-medium', false],
      ['b-medium', false],
      ['e-easy', true],
      ['c-easy', true],
    ]);
    expect(buildSession(cards, states, topics, { now: NOW, max: 3 })).toHaveLength(3);
    expect(buildSession(cards, states, topics, { now: NOW, newLimit: 0 }).every((s) => !s.isNew)).toBe(true);
    expect(buildSession(cards, states, topics, { now: NOW, newLimit: -3 }).every((s) => !s.isNew)).toBe(true);
    expect(buildSession(cards, states, topics, { now: NOW, topic: 'queues' }).map((s) => s.card.id)).toEqual(['r-medium']);
    expect(buildSession(cards, {}, topics, { now: NOW, deck: 'sample' }).map((s) => s.card.id)).toEqual(['e-easy', 'c-easy']);
  });

  it('counts due, new and total cards overall and per topic, with the next due time', () => {
    const states: CardStates = { 'b-medium': nextState(undefined, 3, NOW - 5 * DAY), 'a-hard': nextState(undefined, 4, NOW) };
    const o = overview(cards, states, topics, { now: NOW });
    expect(o).toMatchObject({ due: 1, new: 4, total: 6, nextDue: states['b-medium'].due });
    expect(o.topics.map((t) => [t.topic.id, t.due, t.new, t.total])).toEqual([
      ['estimation', 0, 2, 2],
      ['caching', 1, 2, 4],
      ['queues', 0, 1, 1],
    ]);
    expect(overview(cards, {}, topics, { now: NOW, deck: 'sample' }).topics.map((t) => t.topic.id)).toEqual(['estimation', 'caching']);
    expect(overview(cards, {}, topics, { now: NOW }).nextDue).toBeUndefined();
  });

  it('starts the repo deck with one card of each of the first topics, covering every card type', () => {
    const session = buildSession(repo, {}, repoTopics, { now: NOW });
    expect(session).toHaveLength(10);
    expect(new Set(session.map((s) => s.card.topic)).size).toBe(10);
    expect(new Set(session.map((s) => s.card.type))).toEqual(new Set(['flip', 'choice', 'estimate', 'cloze']));
    expect(session[0].card.topic).toBe(repoTopics[0].id);
  });
});

const review = (cardId: string, rating: Rating, reviewedAt: number, day: string, version = 1): CardReview => ({
  id: `${cardId}-${reviewedAt}`,
  cardId,
  version,
  rating,
  reviewedAt,
  durationMs: 1000,
  day,
});

describe('review logs', () => {
  const log = [
    review('a', 3, NOW - 3 * DAY, '2027-01-12'),
    review('a', 3, NOW, '2027-01-15'),
    review('b', 1, NOW + 60, '2027-01-15'),
    review('c', 3, NOW - 2 * DAY, '2027-01-13'),
    review('c', 4, NOW + 120, '2027-01-15', 2),
  ];

  it('counts a day’s reviews, and as new the first review of a card or of its new version', () => {
    expect(dayCounts(log, '2027-01-15')).toEqual({ reviews: 3, new: 2 });
    expect(dayCounts(log, '2027-01-12')).toEqual({ reviews: 1, new: 1 });
    expect(dayCounts([], '2027-01-12')).toEqual({ reviews: 0, new: 0 });
  });

  it('derives states by replaying the log, the same as applying the reviews one by one', () => {
    const states = statesFromLog(log);
    expect(Object.keys(states).sort()).toEqual(['a', 'b', 'c']);
    expect(states.c.version).toBe(2);
    expect(applyReviews({}, log)).toEqual(states);
    expect(applyReviews(statesFromLog(log.slice(0, 2)), log.slice(2))).toEqual(states);
  });

  it('puts reviews not yet sent on top of the server’s states and counts', () => {
    const server = statesFromLog(log.slice(0, 1));
    // log[0] is on the server already; log[1] and z's review are not.
    const pending = [log[0], log[1], review('z', 3, NOW, '2027-01-15')];
    const { states, today } = withPending(server, { reviews: 4, new: 1 }, pending, '2027-01-15');
    expect(states.a).toEqual(statesFromLog(log.slice(0, 2)).a);
    expect(states.z).toEqual(nextState(undefined, 3, NOW));
    expect(today).toEqual({ reviews: 6, new: 2 });
  });

  it('reads and writes local dates', () => {
    expect(['2027-01-15', '2024-02-29', '2027-02-29', '2027-1-15', 'x', 20270115].map(isDay)).toEqual([true, true, false, false, false, false]);
    expect(localDay(new Date(2027, 0, 5, 23, 59))).toBe('2027-01-05');
    expect(daysBetween('2027-01-30', '2027-02-02')).toBe(3);
  });
});

describe('grading', () => {
  it('maps automatic grading to ratings', () => {
    expect([autoRating(false), autoRating(true), autoRating(true, true), autoRating(false, true)]).toEqual([1, 3, 4, 1]);
  });

  it('formats intervals for the rating buttons', () => {
    expect([0.5, 1, 3, 13, 21, 59, 90, 364, 365, 800].map(formatInterval)).toEqual(['<1d', '1d', '3d', '13d', '3w', '8w', '3mo', '12mo', '1y', '2.2y']);
  });
});
