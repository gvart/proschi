import { describe, expect, it } from 'vitest';
import type { AchievementsAnswer, AchievementStatus } from '../../learn/achievements';
import type { PublicProfile } from '../../services/api';
import { ACHIEVEMENTS } from '../achievementList';
import type { ProblemListing } from '../listing';
import { ownProfile, profileBadge, profileIdOf, publicProfile, solvedByDifficulty } from './profile';

const problems = [
  { id: 'url-shortener', title: 'URL Shortener', difficulty: 'easy', tags: [] },
  { id: 'pastebin', title: 'Pastebin', difficulty: 'easy', tags: [] },
  { id: 'chat', title: 'Chat', difficulty: 'hard', tags: [] },
] as unknown as ProblemListing[];

const status = (id: string, earned: boolean, current = 0, target = 1): AchievementStatus => ({
  ...ACHIEVEMENTS.find((a) => a.id === id)!,
  earned,
  current,
  target,
  unseen: earned,
  ...(earned ? { earnedAt: 1_700_000_000 } : {}),
});

describe('profile routes', () => {
  it('reads the user id of `u/<id>`, empty when it cannot be one', () => {
    expect(profileIdOf('u/3f2a-11')).toBe('3f2a-11');
    expect(profileIdOf('u/')).toBe('');
    expect(profileIdOf('u/a b')).toBe('');
    expect(profileIdOf('u/a/b')).toBe('');
    expect(profileIdOf('me')).toBeUndefined();
    expect(profileIdOf('url-shortener')).toBeUndefined();
  });
});

describe('profile models', () => {
  it('counts solves per difficulty, every difficulty present', () => {
    expect(solvedByDifficulty([{ difficulty: 'easy' }, { difficulty: 'hard' }, { difficulty: 'easy' }])).toEqual({ easy: 2, medium: 0, hard: 1 });
  });

  it('keeps a locked badge’s progress and drops what a profile does not show', () => {
    const locked = profileBadge(status('reviews-100', false, 12, 100));
    expect(locked).toMatchObject({ id: 'reviews-100', earned: false, progress: { current: 12, target: 100 } });
    expect(locked).not.toHaveProperty('unseen');
    const earned = profileBadge(status('first-card', true, 1, 1));
    expect(earned).toMatchObject({ earned: true, earnedAt: 1_700_000_000 });
    expect(earned).not.toHaveProperty('progress');
  });

  it('builds the learner’s own profile from the achievements answer and this browser’s progress', () => {
    const answer: AchievementsAnswer = {
      achievements: [status('first-card', true, 1, 1), status('reviews-100', false, 12, 100)],
      skills: { readiness: 0.42, topics: [{ topic: 'caching', mastery: 0.5 }], weakest: ['caching'] },
      stats: { reviews: 12, mastered: 1, longestStreak: 3, estimateStreak: 0, solved: 1 },
    };
    const model = ownProfile({
      displayName: 'Ada',
      memberSince: 1_690_000_000,
      streak: { current: 2, longest: 3, freezes: 1 },
      challenge: { current: 1, longest: 4, best: 600 },
      answer,
      progress: { chat: { status: 'solved' }, pastebin: { status: 'attempted' }, 'url-shortener': { status: 'solved' } } as never,
      problems,
    });
    expect(model.solved).toEqual([
      { id: 'url-shortener', title: 'URL Shortener', difficulty: 'easy' },
      { id: 'chat', title: 'Chat', difficulty: 'hard' },
    ]);
    expect(model.cards).toEqual({ reviewed: 12, mastered: 1 });
    expect(model.challenge).toEqual({ current: 1, longest: 4, best: 600 });
    expect(model.readiness).toBe(0.42);
    expect(model.badges.map((b) => [b.id, b.earned])).toEqual([
      ['first-card', true],
      ['reviews-100', false],
    ]);
  });

  it('builds a public profile with every badge of the catalog, and nothing only the learner sees', () => {
    const profile: PublicProfile = {
      id: 'u1',
      displayName: 'Ada',
      memberSince: 1_690_000_000,
      solved: [
        { id: 'chat', difficulty: 'hard' },
        { id: 'removed-problem', difficulty: 'easy' },
      ],
      streak: { current: 4, longest: 9 },
      challenge: { current: 2, longest: 5, best: 540 },
      readiness: 0.3,
      topics: [{ topic: 'caching', mastery: 0.25 }],
      badges: [{ id: 'first-solve', earnedAt: 1_700_000_000 }],
    };
    const model = publicProfile(profile, ACHIEVEMENTS, problems);
    expect(model.badges).toHaveLength(ACHIEVEMENTS.length);
    expect(model.badges.filter((b) => b.earned).map((b) => [b.id, b.earnedAt])).toEqual([['first-solve', 1_700_000_000]]);
    expect(model.badges.every((b) => b.progress === undefined)).toBe(true);
    // Only problems this build has.
    expect(model.solved).toEqual([{ id: 'chat', title: 'Chat', difficulty: 'hard' }]);
    expect(model.streak).toEqual({ current: 4, longest: 9 });
    expect(model.challenge).toEqual({ current: 2, longest: 5, best: 540 });
    expect(model.cards).toBeUndefined();
    // Before a first challenge, no challenge stats.
    expect(publicProfile({ ...profile, challenge: null }, ACHIEVEMENTS, problems).challenge).toBeUndefined();
  });
});
