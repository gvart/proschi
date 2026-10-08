import { describe, expect, it } from 'vitest';
import listings from 'virtual:practice-listings';
import raw from '../practice/achievements.json';
import { ROADMAP } from '../practice/roadmapStages';
import { cardFromFile, readTopics, type Card } from './cards';
import { DAY, nextState } from './fsrs';
import {
  achievementsAnswer,
  achievementStatuses,
  buildSnapshot,
  checkAchievements,
  liveAchievements,
  longestRightRun,
  longestStreak,
  masteredCount,
  ruleProgress,
  RULE_KINDS,
  writeAchievementsLock,
  type Achievement,
  type AchievementContext,
  type Rule,
  type StatsSnapshot,
  NO_GAME,
} from './achievements';
import type { ProblemInfo } from './mastery';
import { addDays, goalFor } from './streak';

const problems: ProblemInfo[] = [
  { id: 'a', difficulty: 'easy', tags: ['caching'] },
  { id: 'b', difficulty: 'hard', tags: ['caching', 'queues'] },
  { id: 'c', difficulty: 'hard', tags: ['queues'] },
  { id: 'd', difficulty: 'medium', tags: [] },
];
const context: AchievementContext = { problems, stages: [{ id: 'one', problems: ['a', 'b', 'gone'] }] };

const empty: StatsSnapshot = { reviews: 0, mastered: 0, longestStreak: 0, estimateStreak: 0, solved: [], mastery: {}, challenges: { completed: 0, perfect: 0, longestStreak: 0 }, game: NO_GAME, lessons: [] };
const snap = (over: Partial<StatsSnapshot>): StatsSnapshot => ({ ...empty, ...over });
const solved = (...ids: string[]) => ids.map((id) => ({ id, firstRun: false, underReference: false }));

describe('rules', () => {
  it.each<[Rule, StatsSnapshot, number, number]>([
    [{ kind: 'reviews', min: 100 }, snap({ reviews: 42 }), 42, 100],
    [{ kind: 'reviews', min: 10 }, snap({ reviews: 42 }), 10, 10],
    [{ kind: 'mastered', min: 5 }, snap({ mastered: 3 }), 3, 5],
    [{ kind: 'streak', min: 7 }, snap({ longestStreak: 8 }), 7, 7],
    [{ kind: 'estimate-streak', min: 3 }, snap({ estimateStreak: 2 }), 2, 3],
    [{ kind: 'game-waves', min: 5 }, snap({ game: { ...NO_GAME, reached: 8 } }), 5, 5],
    [{ kind: 'game-clears', min: 4 }, snap({ game: { ...NO_GAME, clears: 1 } }), 1, 4],
    [{ kind: 'game-ascension', min: 3 }, snap({ game: { ...NO_GAME, ascension: -1 } }), 0, 3],
    [{ kind: 'solved', min: 2 }, snap({ solved: solved('a', 'd') }), 2, 2],
    [{ kind: 'solved', min: 2, difficulty: 'hard' }, snap({ solved: solved('a', 'b') }), 1, 2],
    [{ kind: 'solved', min: 2, tag: 'caching' }, snap({ solved: solved('a', 'c') }), 1, 2],
    [{ kind: 'solved', min: 1, tag: 'caching', difficulty: 'hard' }, snap({ solved: solved('a') }), 0, 1],
    [{ kind: 'all-solved', tag: 'queues' }, snap({ solved: solved('b') }), 1, 2],
    [{ kind: 'first-run', min: 2 }, snap({ solved: [{ id: 'a', firstRun: true, underReference: false }, ...solved('b')] }), 1, 2],
    [{ kind: 'under-reference', min: 1 }, snap({ solved: [{ id: 'a', firstRun: false, underReference: true }] }), 1, 1],
    [{ kind: 'mastery', topic: 'caching', min: 0.8 }, snap({ mastery: { caching: 0.795 } }), 79, 80],
    [{ kind: 'mastery', topic: 'caching', min: 0.8 }, snap({ mastery: { caching: 0.8 } }), 80, 80],
    [{ kind: 'mastery', topic: 'queues', min: 0.5 }, snap({}), 0, 50],
    // Only the stage's problems this catalog has.
    [{ kind: 'stage', stage: 'one' }, snap({ solved: solved('a') }), 1, 2],
    [{ kind: 'stage', stage: 'nope' }, snap({ solved: solved('a') }), 0, 1],
    [{ kind: 'challenges', min: 1 }, snap({ challenges: { completed: 3, perfect: 0, longestStreak: 2 } }), 1, 1],
    [{ kind: 'challenge-perfect', min: 1 }, snap({ challenges: { completed: 3, perfect: 0, longestStreak: 2 } }), 0, 1],
    [{ kind: 'challenge-streak', min: 7 }, snap({ challenges: { completed: 3, perfect: 0, longestStreak: 2 } }), 2, 7],
  ])('%j on a snapshot is %d of %d', (rule, s, current, target) => {
    expect(ruleProgress(rule, s, context)).toEqual({ current, target });
  });

  it('never earns an unknown kind', () => {
    expect(ruleProgress({ kind: 'nope' } as unknown as Rule, snap({ reviews: 1e6 }), context)).toEqual({ current: 0, target: 1 });
  });
});

const defs: Achievement[] = [
  { id: 'one-review', title: 'One', description: 'Review one.', icon: 'layers', rule: { kind: 'reviews', min: 1 } },
  { id: 'ten-reviews', title: 'Ten', description: 'Review ten.', icon: 'layers', tier: 'bronze', rule: { kind: 'reviews', min: 10 } },
  { id: 'mastery', title: 'Master', description: 'Know it.', icon: 'target', rule: { kind: 'mastery', topic: 'caching', min: 0.5 } },
];

describe('earning', () => {
  it('earns what the snapshot reaches, keeps what was earned before, and flags the unseen', () => {
    const { statuses, newly } = achievementStatuses(defs, snap({ reviews: 3, mastery: { caching: 0.1 } }), context, { mastery: { earnedAt: 5, seenAt: 6 } }, 100);
    expect(newly).toEqual(['one-review']);
    expect(statuses.map((s) => [s.id, s.earned, s.unseen, s.current, s.target, s.earnedAt])).toEqual([
      ['one-review', true, true, 1, 1, 100],
      ['ten-reviews', false, false, 3, 10, undefined],
      // Mastery fell since, but a badge stays earned.
      ['mastery', true, false, 50, 50, 5],
    ]);
    const again = achievementStatuses(defs, snap({ reviews: 3 }), context, { 'one-review': { earnedAt: 100 } }, 200);
    expect(again.newly).toEqual([]);
    expect(again.statuses[0]).toMatchObject({ earned: true, unseen: true, earnedAt: 100 });
  });

  it('ignores stored rows of badges that no longer exist and prototype keys', () => {
    const { statuses, newly } = achievementStatuses(defs, empty, context, JSON.parse('{"gone": {"earnedAt": 1}, "__proto__": {"earnedAt": 1}}'), 1);
    expect(newly).toEqual([]);
    expect(statuses.every((s) => !s.earned)).toBe(true);
  });
});

describe('the snapshot', () => {
  const card = (file: string): Card => cardFromFile(file, '---\ntype: flip\ndifficulty: easy\n---\n## Front\nQ?\n## Back\nA.\n');
  const cards = [card('caching/x.md'), card('caching/y.md'), card('caching/z.md')];
  const topics = readTopics('[{"id": "caching", "title": "Caching", "summary": "Caches."}]');
  const NOW = 1_800_000_000;

  it('takes the longest streak from streak.ts: the daily goal, solves and freezes', () => {
    const goal = goalFor(10);
    const TODAY = '2026-04-01';
    const days = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06'].map((day) => ({ day, reviews: 10, solves: 0 }));
    expect(longestStreak(days, TODAY, goal)).toBe(3);
    expect(longestStreak([...days, { day: '2026-03-04', reviews: 9, solves: 0 }], TODAY, goal)).toBe(3);
    expect(longestStreak([...days, { day: '2026-03-04', reviews: 12, solves: 0 }], TODAY, goal)).toBe(6);
    // A solve meets the goal too.
    expect(longestStreak([...days, { day: '2026-03-04', reviews: 0, solves: 1 }], TODAY, goal)).toBe(6);
    // The user's own goal: 20 cards a day.
    expect(longestStreak(days, TODAY, goalFor(20))).toBe(0);
    // Across a month's end, in any order.
    expect(longestStreak([{ day: '2026-03-01', reviews: 10, solves: 0 }, { day: '2026-02-28', reviews: 10, solves: 0 }], TODAY, goal)).toBe(2);
    // 7 days in a row earn a freeze, which carries the streak over a missed day (not counted itself).
    const week = Array.from({ length: 7 }, (_, i) => ({ day: addDays('2026-03-10', i), reviews: 10, solves: 0 }));
    const after = [addDays('2026-03-10', 8), addDays('2026-03-10', 9)].map((day) => ({ day, reviews: 10, solves: 0 }));
    expect(longestStreak([...week, ...after], TODAY, goal)).toBe(9);
    // Days after `today` (a clock ahead) do not count.
    expect(longestStreak(days, '2026-03-02', goal)).toBe(2);
    expect(longestStreak([], TODAY, goal)).toBe(0);
  });

  it('counts right answers in a row and mastered cards', () => {
    expect(longestRightRun([3, 3, 1, 4, 3, 3, 2, 1])).toBe(4);
    expect(longestRightRun([1, 1])).toBe(0);
    let strong = nextState(undefined, 4, NOW - 200 * DAY);
    for (let t = NOW - 150 * DAY; t < NOW; t += 40 * DAY) strong = nextState(strong, 3, t);
    expect(strong.stability).toBeGreaterThanOrEqual(21);
    expect(masteredCount(cards, { x: strong, y: nextState(undefined, 3, NOW) })).toBe(1);
    // A card whose answer changed is not mastered any more.
    expect(masteredCount([{ ...cards[0], version: 2 }], { x: strong })).toBe(0);
  });

  it('builds the snapshot and the answer the API sends', () => {
    const { snapshot, skills } = buildSnapshot({
      cards,
      topics,
      states: { x: nextState(undefined, 3, NOW) },
      now: NOW,
      problems,
      estimateRatings: [3, 3, 3],
      reviews: 7,
      longestStreak: 2,
      solvedProblems: solved('a'),
    });
    expect(snapshot).toMatchObject({ reviews: 7, mastered: 0, longestStreak: 2, estimateStreak: 3, solved: solved('a') });
    expect(snapshot.mastery.caching).toBe(skills.topics[0].mastery);
    expect(snapshot.mastery.caching).toBeGreaterThan(0);
    const { statuses } = achievementStatuses(defs, snapshot, context, {}, NOW);
    const answer = achievementsAnswer(statuses, skills, snapshot);
    expect(answer.stats).toEqual({ reviews: 7, mastered: 0, longestStreak: 2, estimateStreak: 3, solved: 1 });
    expect(answer.skills.weakest).toEqual(['caching']);
    expect(JSON.parse(JSON.stringify(answer))).toEqual(answer);
  });
});

const checkContext = { problems, topics: ['caching', 'estimation'], stages: ['one'] };
const ok = { id: 'ok', title: 'Ok', description: 'Fine.', icon: 'star', rule: { kind: 'reviews', min: 1 } };

describe('the achievements check', () => {
  it('passes the repository’s achievements.json against the real problems, topics and stages', () => {
    const topics = readTopics(Object.values(import.meta.glob<string>('../practice/cards/tags.json', { query: '?raw', import: 'default', eager: true }))[0]);
    const lock = Object.values(import.meta.glob<string>('../practice/achievements.lock', { query: '?raw', import: 'default', eager: true }))[0];
    expect(lock).toBeDefined();
    const check = checkAchievements(raw, { problems: listings, topics: topics.map((t) => t.id), stages: ROADMAP.map((s) => s.id), lock });
    expect(check.violations).toEqual([]);
    // The lock is as `proschi achievements lock` writes it.
    expect(lock).toBe(writeAchievementsLock([], (raw as { id: string }[]).map((a) => a.id)));
    expect(check.achievements.length).toBeGreaterThanOrEqual(25);
    expect(check.achievements.length).toBeLessThanOrEqual(45);
    // Every rule kind is used.
    expect(new Set(check.achievements.map((a) => a.rule.kind))).toEqual(new Set(RULE_KINDS));
  });

  it.each<[string, unknown, RegExp]>([
    ['not a list', { ok }, /JSON list/],
    ['an unknown field', [{ ...ok, colour: 'red' }], /Unknown field "colour"/],
    ['a bad id', [{ ...ok, id: 'Bad Id' }], /lowercase words/],
    ['a duplicate id', [ok, { ...ok, rule: { kind: 'reviews', min: 2 } }], /Duplicate id "ok"/],
    ['a long title', [{ ...ok, title: 'x'.repeat(40) }], /at most 32 fit a phone/],
    ['no description', [{ ...ok, description: '' }], /"description" must be a non-empty string/],
    ['an unknown icon', [{ ...ok, icon: 'rocket' }], /"icon" must be one of/],
    ['an unknown tier', [{ ...ok, tier: 'platinum' }], /"tier" must be one of bronze, silver, gold/],
    ['an unknown rule kind', [{ ...ok, rule: { kind: 'karma', min: 1 } }], /Unknown rule kind "karma"/],
    ['a field the kind lacks', [{ ...ok, rule: { kind: 'reviews', min: 1, tag: 'caching' } }], /"reviews" rule has no field "tag"/],
    ['a missing field', [{ ...ok, rule: { kind: 'mastery', min: 0.5 } }], /needs "topic"/],
    ['a fractional count', [{ ...ok, rule: { kind: 'reviews', min: 1.5 } }], /whole number from 1/],
    ['a mastery above 1', [{ ...ok, rule: { kind: 'mastery', topic: 'caching', min: 80 } }], /share above 0 and at most 1/],
    ['an unknown tag', [{ ...ok, rule: { kind: 'all-solved', tag: 'blockchain' } }], /"blockchain", which no practice problem has/],
    ['an unknown topic', [{ ...ok, rule: { kind: 'mastery', topic: 'queues', min: 0.5 } }], /"queues", which is not a topic/],
    ['an unknown stage', [{ ...ok, rule: { kind: 'stage', stage: 'two' } }], /"two", which is not a roadmap stage/],
    ['a bad difficulty', [{ ...ok, rule: { kind: 'solved', min: 1, difficulty: 'brutal' } }], /"difficulty" must be one of/],
    ['more solves than problems', [{ ...ok, rule: { kind: 'solved', min: 3, difficulty: 'hard' } }], /only 2 problem\(s\) can count/],
    ['a repeated rule', [ok, { ...ok, id: 'again' }], /Same rule as "ok"/],
  ])('reports %s', (_name, input, message) => {
    const check = checkAchievements(input, checkContext);
    expect(check.violations.map((v) => v.message).join('\n')).toMatch(message);
  });

  describe('achievements.lock', () => {
    const lock = writeAchievementsLock([], ['ok', 'old']);
    const old = { ...ok, id: 'old', rule: { kind: 'reviews', min: 5 } };

    it('passes when every id is locked and every locked id has an achievement', () => {
      expect(checkAchievements([ok, old], { ...checkContext, lock }).violations).toEqual([]);
    });

    it('reports an achievement missing from the lock', () => {
      const check = checkAchievements([ok, old, { ...ok, id: 'fresh', rule: { kind: 'reviews', min: 9 } }], { ...checkContext, lock });
      expect(check.violations).toEqual([{ index: 2, id: 'fresh', message: expect.stringMatching(/^New achievement: add its id to achievements\.lock with `proschi achievements lock`/) }]);
    });

    it('reports a locked id with no achievement', () => {
      const check = checkAchievements([ok], { ...checkContext, lock });
      expect(check.violations).toEqual([{ id: 'old', inLock: true, message: expect.stringMatching(/lists "old", which has no achievement: never delete one, set "retired": true/) }]);
    });

    it('reports a lock out of order or with a repeated id', () => {
      const messages = (text: string) => checkAchievements([ok, old], { ...checkContext, lock: text }).violations.map((v) => v.message);
      expect(messages('old\nok\n')).toEqual([expect.stringMatching(/not sorted/)]);
      expect(messages('ok\nok\nold\n')).toEqual([expect.stringMatching(/not sorted, or an id appears twice/)]);
    });

    it('is not checked without its text', () => {
      expect(checkAchievements([ok], checkContext).violations).toEqual([]);
    });

    it('adds ids sorted and once', () => {
      expect(writeAchievementsLock(['b', 'a'], ['c', 'a'])).toMatch(/^#[^]*\na\nb\nc\n$/);
    });
  });

  describe('a retired achievement', () => {
    const retired = { ...ok, id: 'old', retired: true, rule: { kind: 'all-solved', tag: 'gone' } };

    it('stays in the file and the lock, need not name what exists, and its rule may be reused', () => {
      const check = checkAchievements([ok, retired, { ...ok, id: 'again', rule: { kind: 'all-solved', tag: 'caching' } }, { ...retired, id: 'older', rule: ok.rule }], {
        ...checkContext,
        lock: writeAchievementsLock([], ['ok', 'old', 'again', 'older']),
      });
      expect(check.violations).toEqual([]);
      expect(check.achievements.map((a) => a.id)).toEqual(['ok', 'old', 'again', 'older']);
    });

    it('still needs a rule of a known kind, and "retired" is only true', () => {
      expect(checkAchievements([{ ...retired, rule: { kind: 'karma' } }], checkContext).violations[0].message).toMatch(/Unknown rule kind/);
      expect(checkAchievements([{ ...ok, retired: false }], checkContext).violations[0].message).toMatch(/"retired" is true or left out/);
    });

    it('is neither evaluated nor shown, while what was earned stays stored', () => {
      const defs = [ok, { ...ok, id: 'old', retired: true, rule: { kind: 'reviews', min: 1 } }] as Achievement[];
      expect(liveAchievements(defs).map((a) => a.id)).toEqual(['ok']);
      const earned = { old: { earnedAt: 1 } };
      const { statuses, newly } = achievementStatuses(defs, snap({ reviews: 3 }), context, earned, 10);
      expect(statuses.map((a) => a.id)).toEqual(['ok']);
      expect(newly).toEqual(['ok']);
      expect(earned).toEqual({ old: { earnedAt: 1 } });
    });
  });

  it('keeps the entries that read well and names the bad ones', () => {
    const check = checkAchievements([ok, { ...ok, id: 'bad', icon: 'rocket', rule: { kind: 'streak', min: 3 } }], checkContext);
    expect(check.achievements.map((a) => a.id)).toEqual(['ok']);
    expect(check.violations).toEqual([{ index: 1, id: 'bad', message: expect.stringMatching(/icon/) }]);
  });
});
