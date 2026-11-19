import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LeaderboardPanel from '../LeaderboardPanel';
import { continueTarget } from './continue';
import { asksGoal, landsOnRoadmap, parseGoal, setGoal, wantsInterview, wantsStreak } from './goal';
import { BAR_TABS, HUB_GROUPS, HUB_TABS, hubTabOf } from './tabs';

describe('practice hub', () => {
  it('has flat tabs, Roadmap, All problems and Mock interview, one Daily menu, and progress last', () => {
    expect(HUB_TABS.map((t) => [t.label, t.href])).toEqual([
      ['Roadmap', '#/roadmap'],
      ['All problems', '#/'],
      ['Mock interview', '#/interview'],
      ['Review cards', '#/review'],
      ['Daily challenge', '#/challenge'],
      ['Arcade', '#/arcade'],
      ['Progress', '#/progress'],
    ]);
    expect(BAR_TABS).toEqual(['roadmap', 'problems', 'interview']);
    expect(HUB_GROUPS.map((g) => [g.label, g.tabs])).toEqual([['Daily', ['review', 'challenge', 'arcade']]]);
    // A phone's shorter names are part of the full ones (the accessible names).
    for (const t of HUB_TABS) if (t.short) expect(t.label.toLowerCase()).toContain(t.short.toLowerCase());
  });

  it('marks the tab of every address that opens inside it', () => {
    expect(hubTabOf('')).toBe('problems');
    expect(hubTabOf('roadmap')).toBe('roadmap');
    expect(hubTabOf('roadmap/approach')).toBe('roadmap');
    expect(hubTabOf('interview')).toBe('interview');
    expect(hubTabOf('review')).toBe('review');
    expect(hubTabOf('review/caching')).toBe('review');
    expect(hubTabOf('challenge')).toBe('challenge');
    expect(hubTabOf('arcade')).toBe('arcade');
    expect(hubTabOf('arcade/daily')).toBe('arcade');
    expect(hubTabOf('progress')).toBe('progress');
    expect(hubTabOf('url-shortener')).toBeUndefined();
    // A mock interview's room stays without the bar.
    expect(hubTabOf('interview/url-shortener')).toBeUndefined();
    expect(hubTabOf('me')).toBeUndefined();
    expect(hubTabOf('u/a1b2')).toBeUndefined();
  });
});

describe('continue', () => {
  const known = new Set(['a', 'b', 'x']);

  it('picks up the last problem opened while it is unsolved, where it was opened', () => {
    const progress = { x: { status: 'attempted' as const } };
    expect(continueTarget({ last: { id: 'x', roadmap: false }, progress, known })).toEqual({ id: 'x', href: '#/x' });
    expect(continueTarget({ last: { id: 'x', roadmap: true }, progress, known })?.href).toBe('#/roadmap/x');
  });

  it('has nothing to continue once it is solved, gone, or there is none (the roadmap has its own Up next)', () => {
    const progress = { a: { status: 'solved' as const } };
    expect(continueTarget({ progress, known })).toBeUndefined();
    expect(continueTarget({ last: { id: 'a', roadmap: true }, progress, known })).toBeUndefined();
    expect(continueTarget({ last: { id: 'gone', roadmap: false }, progress, known })).toBeUndefined();
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

  it('lands interview prep on the roadmap only when the page opens with no address', () => {
    setGoal(() => ({ goals: ['interview'], asked: true }));
    expect(landsOnRoadmap('')).toBe(true);
    expect(landsOnRoadmap('#')).toBe(true);
    // `#/` is All problems; any other address is kept.
    expect(landsOnRoadmap('#/')).toBe(false);
    expect(landsOnRoadmap('#/review')).toBe(false);
    setGoal(() => ({ goals: ['solve', 'habit'], asked: true }));
    expect(landsOnRoadmap('')).toBe(false);
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
