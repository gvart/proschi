import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LeaderboardPanel from '../LeaderboardPanel';
import { PREP_TABS, prepTabOf } from './tabs';

describe('interview prep hub', () => {
  it('has the roadmap, daily review and progress as tabs, in that order', () => {
    expect(PREP_TABS.map((t) => [t.label, t.href])).toEqual([
      ['Roadmap', '#/roadmap'],
      ['Daily review', '#/review'],
      ['Progress', '#/progress'],
    ]);
  });

  it('marks the tab of every address that opens inside it', () => {
    expect(prepTabOf('roadmap')).toBe('roadmap');
    expect(prepTabOf('roadmap/approach')).toBe('roadmap');
    expect(prepTabOf('review')).toBe('review');
    expect(prepTabOf('review/caching')).toBe('review');
    expect(prepTabOf('progress')).toBe('progress');
    expect(prepTabOf('')).toBeUndefined();
    expect(prepTabOf('url-shortener')).toBeUndefined();
    expect(prepTabOf('me')).toBeUndefined();
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
