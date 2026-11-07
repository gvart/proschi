import { describe, expect, it } from 'vitest';
import type { AchievementsAnswer, AchievementStatus } from '../../learn/achievements';
import { progressChange } from './progressChange';
import { soloInterviewsDone, soloOnTime } from './record';

const badge = (id: string, earned: boolean, earnedAt?: number): AchievementStatus => ({
  id,
  title: id,
  description: 'x',
  icon: 'mic',
  rule: { kind: 'interviews', min: 1 },
  current: earned ? 1 : 0,
  target: 1,
  earned,
  unseen: earned,
  ...(earnedAt !== undefined ? { earnedAt } : {}),
});

const answer = (over: { caching?: number; estimation?: number; solo?: number; badges?: AchievementStatus[] }): AchievementsAnswer => ({
  achievements: over.badges ?? [],
  skills: {
    readiness: 0,
    topics: [
      { topic: 'caching', mastery: over.caching ?? 0.4 },
      { topic: 'estimation', mastery: over.estimation ?? 0.2 },
    ],
    weakest: [],
  },
  stats: { reviews: 0, mastered: 0, longestStreak: 0, estimateStreak: 0, solved: 1, interviews: 0, soloInterviews: over.solo ?? 0 },
});

describe('what an interview changed', () => {
  it('compares against the progress when the room opened: XP, level, the skills that moved and the new badges', () => {
    const before = answer({ badges: [badge('first-solve', true, 1), badge('interview-first', false)] });
    const after = answer({ caching: 0.425, solo: 1, badges: [badge('first-solve', true, 1), badge('interview-first', true, 2_000)] });
    const change = progressChange(after, before, 1_999_000);
    expect(change.xp).toBe(20);
    expect(change.levelUp).toBe(false);
    expect(change.skills).toEqual([{ topic: 'caching', title: 'Caching', before: 40, after: 42 }]);
    expect(change.badges.map((b) => b.id)).toEqual(['interview-first']);
  });

  it('without the progress before, shows only the badges earned as the interview ended', () => {
    const after = answer({ badges: [badge('first-solve', true, 100), badge('interview-first', true, 2_001)] });
    const change = progressChange(after, undefined, 2_000_000);
    expect(change.xp).toBe(0);
    expect(change.skills).toEqual([]);
    expect(change.badges.map((b) => b.id)).toEqual(['interview-first']);
  });
});

describe('interviews on your own as progress', () => {
  it('is on time within its minutes with every check passing', () => {
    expect(soloOnTime({ overtime: false, tests: { passed: 10, total: 10, solved: true } })).toBe(true);
    expect(soloOnTime({ overtime: true, tests: { passed: 10, total: 10, solved: true } })).toBe(false);
    expect(soloOnTime({ overtime: false })).toBe(false);
    expect(soloInterviewsDone([])).toEqual([]);
  });
});
