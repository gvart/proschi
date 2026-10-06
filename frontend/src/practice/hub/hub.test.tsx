import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LeaderboardPanel from '../LeaderboardPanel';
import { roadmapState, type RoadmapStage } from '../roadmap';
import { continueTarget } from './continue';
import { HUB_TABS, hubTabOf } from './tabs';

describe('practice hub', () => {
  it('has the problems, the roadmap, review, the challenge, the Arcade and progress as tabs, in that order', () => {
    expect(HUB_TABS.map((t) => [t.label, t.href])).toEqual([
      ['Problems', '#/'],
      ['Roadmap', '#/roadmap'],
      ['Review', '#/review'],
      ['Challenge', '#/challenge'],
      ['Arcade', '#/arcade'],
      ['Progress', '#/progress'],
    ]);
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

  it('has nothing to continue once the roadmap is done', () => {
    const progress = { a: { status: 'solved' as const }, b: { status: 'solved' as const }, c: { status: 'solved' as const } };
    expect(continueTarget({ progress, known, roadmap: roadmapState(stages, progress), access: 'open' })).toBeUndefined();
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
          ],
        }}
      />,
    );
    expect(html).toContain('href="#/u/a1b2"');
    expect(html).toContain('href="#/u/c3d4"');
    expect(html).toContain('aria-label="Ada: rank 1, 3 of 25 solved. See their profile"');
  });
});
