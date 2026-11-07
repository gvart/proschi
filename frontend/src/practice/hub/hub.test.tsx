import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LeaderboardPanel from '../LeaderboardPanel';
import { roadmapState, type RoadmapStage } from '../roadmap';
import { continueTarget } from './continue';
import { asksGoal, parseGoal, wantsInterview, wantsStreak } from './goal';
import { HUB_GROUPS, HUB_TABS, hubTabOf, mockInterviewHref } from './tabs';

describe('practice hub', () => {
  it('has the problems first, the rest grouped as interview prep and more practice, and progress last', () => {
    expect(HUB_TABS.map((t) => [t.label, t.href])).toEqual([
      ['Problems', '#/'],
      ['Roadmap', '#/roadmap'],
      ['Review cards', '#/review'],
      ['Daily challenge', '#/challenge'],
      ['Arcade', '#/arcade'],
      ['Progress', '#/progress'],
    ]);
    expect(HUB_GROUPS.map((g) => [g.label, g.tabs])).toEqual([
      ['Interview prep', ['roadmap']],
      ['More practice', ['review', 'challenge', 'arcade']],
    ]);
    expect(mockInterviewHref()).toBe('#/url-shortener?interview=mock');
  });

  it('marks the tab of every address that opens inside it', () => {
    expect(hubTabOf('')).toBe('problems');
    expect(hubTabOf('roadmap')).toBe('roadmap');
    expect(hubTabOf('roadmap/approach')).toBe('roadmap');
    expect(hubTabOf('review')).toBe('review');
    expect(hubTabOf('review/caching')).toBe('review');
    expect(hubTabOf('challenge')).toBe('challenge');
    expect(hubTabOf('arcade')).toBe('arcade');
    expect(hubTabOf('arcade/daily')).toBe('arcade');
    expect(hubTabOf('progress')).toBe('progress');
    expect(hubTabOf('url-shortener')).toBeUndefined();
    expect(hubTabOf('me')).toBeUndefined();
    expect(hubTabOf('u/a1b2')).toBeUndefined();
  });
});

describe('continue', () => {
  const stages: RoadmapStage[] = [
    { id: 'one', title: 'One', why: 'Basics.', problems: ['a', 'b'] },
    { id: 'two', title: 'Two', why: 'More.', problems: ['c'] },
  ];
  const known = new Set(['a', 'b', 'c', 'x']);

  it('picks up the last problem opened while it is unsolved, where it was opened', () => {
    const progress = { x: { status: 'attempted' as const } };
    const roadmap = roadmapState(stages, progress);
    expect(continueTarget({ last: { id: 'x', roadmap: false }, progress, known, roadmap, access: 'open' })).toEqual({ kind: 'last', id: 'x', href: '#/x' });
    expect(continueTarget({ last: { id: 'x', roadmap: true }, progress, known, roadmap, access: 'open' })?.href).toBe('#/roadmap/x');
  });

  it('otherwise leads to the roadmap’s next step, or to the roadmap when that step is locked', () => {
    const progress = { a: { status: 'solved' as const }, b: { status: 'solved' as const } };
    const roadmap = roadmapState(stages, progress);
    expect(continueTarget({ last: { id: 'b', roadmap: true }, progress, known, roadmap, access: 'open' })).toEqual({ kind: 'roadmap', id: 'c', href: '#/roadmap/c' });
    expect(continueTarget({ last: { id: 'gone', roadmap: false }, progress, known, roadmap, access: 'sign-in' })).toEqual({ kind: 'roadmap', id: 'c', href: '#/roadmap' });
  });

  it('leaves the roadmap out unless asked for (interview prep): only an unsolved last problem continues', () => {
    const progress = { a: { status: 'solved' as const }, x: { status: 'attempted' as const } };
    const roadmap = roadmapState(stages, progress);
    expect(continueTarget({ progress, known, roadmap, access: 'open', roadmapStep: false })).toBeUndefined();
    expect(continueTarget({ last: { id: 'x', roadmap: false }, progress, known, roadmap, access: 'open', roadmapStep: false })?.id).toBe('x');
  });

  it('has nothing to continue once the roadmap is done', () => {
    const progress = { a: { status: 'solved' as const }, b: { status: 'solved' as const }, c: { status: 'solved' as const } };
    expect(continueTarget({ progress, known, roadmap: roadmapState(stages, progress), access: 'open' })).toBeUndefined();
  });
});

describe('goal', () => {
  it('reads only the known goals, in their own order, and drops the rest', () => {
    expect(parseGoal(undefined)).toEqual({ goals: [], asked: false });
    expect(parseGoal({ goals: ['habit', 'nope', 'interview'], asked: true })).toEqual({ goals: ['interview', 'habit'], asked: true });
    expect(parseGoal({ goals: 'solve', asked: 'yes', streak: 1 })).toEqual({ goals: [], asked: false });
  });

  it('shows the streak for a daily habit unless switched off, and when switched on without one', () => {
    expect(wantsStreak(parseGoal({ goals: ['habit'] }))).toBe(true);
    expect(wantsStreak(parseGoal({ goals: ['habit'], streak: false }))).toBe(false);
    expect(wantsStreak(parseGoal({ goals: ['solve'], streak: true }))).toBe(true);
    expect(wantsStreak(parseGoal({}))).toBe(false);
    expect(wantsInterview(parseGoal({ goals: ['interview'] }))).toBe(true);
  });

  it('asks the question only when no announcement is on the page, and never once answered', () => {
    const fresh = parseGoal({});
    expect(asksGoal(fresh, 'signed-out', 'loading')).toBe(true);
    expect(asksGoal(fresh, 'off', 'loading')).toBe(true);
    // Signed in: the announcement first, the question once it is gone or there is none.
    expect(asksGoal(fresh, 'signed-in', 'loading')).toBe(false);
    expect(asksGoal(fresh, 'signed-in', 'shown')).toBe(false);
    expect(asksGoal(fresh, 'signed-in', 'none')).toBe(true);
    // Not while the account loads: it may turn out signed in, with an announcement.
    expect(asksGoal(fresh, 'loading', 'loading')).toBe(false);
    expect(asksGoal(parseGoal({ asked: true }), 'signed-in', 'none')).toBe(false);
  });
});

describe('leaderboard', () => {
  it('links each row to the user’s public profile', () => {
    const html = renderToStaticMarkup(
      <LeaderboardPanel
        leaderboard={{
          problems: 25,
          entries: [
            { rank: 1, id: 'a1b2', displayName: 'Ada', solved: 3, lastSolvedAt: 1 },
            { rank: 2, id: 'c3d4', displayName: 'Grace', solved: 1, lastSolvedAt: 2 },
            { rank: 3, id: 'e5f6', displayName: 'Linus', solved: 1, lastSolvedAt: 3 },
          ],
        }}
      />,
    );
    expect(html).toContain('href="#/u/a1b2"');
    expect(html).toContain('href="#/u/c3d4"');
    expect(html).toContain('aria-label="Ada: rank 1, 3 of 25 solved. See their profile"');
  });

  it('shows only an invitation to opt in until it has three entries', () => {
    const html = renderToStaticMarkup(<LeaderboardPanel leaderboard={{ problems: 25, entries: [{ rank: 1, id: 'a1b2', displayName: 'Ada', solved: 3, lastSolvedAt: 1 }] }} />);
    expect(html).not.toContain('Ada');
    expect(html).toContain('opt in to the leaderboard');
    expect(html).toContain('href="#/me"');
  });
});
