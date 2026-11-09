import { describe, expect, it } from 'vitest';
import type { AchievementsAnswer, AchievementStatus } from '../../learn/achievements';
import { progressChange } from './progressChange';
import { MIN_INTERVIEW_MINUTES } from '../../learn/mastery';
import type { InterviewSummary } from '../modes/session';
import { drewOn, soloInterviewsDone, soloOnTime, soloSummaryCounts } from './record';

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

  it('counts only with 10 minutes on the clock, or Design reached with something drawn', () => {
    const phases = (design: number) => ({ clarify: 1000, estimate: 1000, design, wrapup: 0 });
    const summary = (totalMs: number, design: number, drew?: boolean): InterviewSummary => ({
      problem: 'url-shortener',
      startedAt: 1,
      durationMin: 45,
      totalMs,
      overtime: false,
      phases: phases(design),
      questions: { asked: 0, good: 0, weak: 0, goodTotal: 0 },
      estimates: { answered: 0, correct: 0, total: 0, factors: [] },
      checklist: { checked: 0, total: 4 },
      ...(drew !== undefined ? { drew } : {}),
    });
    expect(soloSummaryCounts(summary(1000, 0))).toBe(false);
    expect(soloSummaryCounts(summary(60_000, 5000))).toBe(false);
    expect(soloSummaryCounts(summary(60_000, 0, true))).toBe(false);
    expect(soloSummaryCounts(summary(60_000, 5000, true))).toBe(true);
    expect(soloSummaryCounts(summary(MIN_INTERVIEW_MINUTES * 60_000, 0))).toBe(true);
    expect(soloInterviewsDone([summary(1000, 0), summary(60_000, 5000, true)])).toHaveLength(1);
  });

  it('drew: anything but whitespace and comments changed from the starter', () => {
    const starter = 'import "problem.proschi"\n\n# Add the components.\napi "API" [REST API]\n';
    expect(drewOn(undefined, starter)).toBe(false);
    expect(drewOn(starter, starter)).toBe(false);
    expect(drewOn(`${starter}\n# a note\n   `, starter)).toBe(false);
    expect(drewOn(`${starter}cache "Cache" [Redis]\n`, starter)).toBe(true);
  });
});
