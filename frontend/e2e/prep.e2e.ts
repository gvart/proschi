import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mockProfile, PROFILE } from './profile';

/**
 * The practice hub: one page whose home (`#/`) is the Today panel (the
 * streak and goal, the cards due, today's challenge and daily run, and
 * "Continue") above the problem list, and one bar of tabs for the problems,
 * the roadmap, daily review, the daily challenge, the Arcade and progress,
 * with the header's Practice link marked on every one. Then the account page
 * (`#/me`, this browser's data in a build without accounts) and a public
 * profile (`#/u/<id>`), whose API answer is mocked here: this build has no API.
 */

const hubNav = (page: Page) => page.getByRole('navigation', { name: 'Practice sections' });
/** The header's "Practice" link (the desktop nav's). */
const headerPractice = (page: Page) => page.locator('.ps-nav__link', { hasText: 'Practice' });
const today = (page: Page) => page.getByRole('region', { name: 'Today', exact: true });

test.describe('practice hub', () => {
  test('the home is the Today panel over the problem list, each part linking to its tab', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      // Today's daily run, played in this browser.
      localStorage.setItem('proschi.game.daily', JSON.stringify({ day: new Date().toISOString().slice(0, 10), score: 4321 }));
    });
    await page.goto('practice/');
    await expect(page.getByRole('heading', { level: 1, name: 'System design practice' })).toBeVisible();
    await expect(headerPractice(page)).toHaveAttribute('aria-current', 'page');
    await expect(hubNav(page).getByRole('link')).toHaveText(['Problems', 'Roadmap', 'Review', 'Challenge', 'Arcade', 'Progress']);
    await expect(hubNav(page).getByRole('link', { name: 'Problems' })).toHaveAttribute('aria-current', 'page');

    const panel = today(page);
    await expect(panel.getByRole('group', { name: 'Daily streak' })).toContainText('No streak yet');
    await expect(panel.getByTestId('today-due')).toHaveText(/^\d+ cards for today$/);
    await expect(panel.getByRole('region', { name: 'Daily challenge status' })).toContainText('Not played yet');
    await expect(panel.getByRole('region', { name: 'Arcade daily run status' })).toContainText('4,321');
    await expect(panel.getByRole('link', { name: 'See the daily run' })).toHaveAttribute('href', '#/arcade/daily');
    // Nothing opened yet: Continue leads to the roadmap's first step.
    await expect(panel.getByRole('region', { name: 'Continue' })).toContainText('Next on the roadmap');
    await expect(panel.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', /^#\/roadmap\/[a-z0-9-]+$/);

    await panel.getByRole('link', { name: 'Take the challenge' }).click();
    await expect(page).toHaveURL(/#\/challenge$/);
    await expect(hubNav(page).getByRole('link', { name: 'Challenge' })).toHaveAttribute('aria-current', 'page');
    await expect(today(page)).toHaveCount(0);

    await hubNav(page).getByRole('link', { name: 'Problems' }).click();
    await today(page).getByRole('link', { name: 'Review now' }).click();
    await expect(page).toHaveURL(/#\/review$/);

    // A problem opened and left unsolved is what Continue picks up.
    await page.goto('practice/#/pastebin');
    await expect(page.getByRole('link', { name: 'Problems' }).first()).toBeVisible();
    await page.goto('practice/');
    await expect(today(page).getByRole('region', { name: 'Continue' })).toContainText('Pick up where you left off');
    await expect(today(page).getByRole('region', { name: 'Continue' })).toContainText('Pastebin');
    await expect(today(page).getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '#/pastebin');
  });

  test('the hub’s tabs, the streak on each, and the header marking Practice on every address', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    await expect(headerPractice(page)).toHaveAttribute('aria-current', 'page');
    await expect(hubNav(page).getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('group', { name: 'Daily streak' })).toContainText('No streak yet');
    await expect(page.getByRole('group', { name: 'Daily streak' })).toContainText('0 of 10 cards today');

    const tabs: [string, RegExp, string][] = [
      ['Review', /#\/review$/, 'Daily review'],
      ['Challenge', /#\/challenge$/, 'Daily challenge'],
      ['Arcade', /#\/arcade$/, 'Scale or Fail'],
      ['Progress', /#\/progress$/, 'Your progress'],
      ['Roadmap', /#\/roadmap$/, 'Interview prep roadmap'],
      ['Problems', /#\/$/, 'System design practice'],
    ];
    for (const [tab, url, heading] of tabs) {
      await hubNav(page).getByRole('link', { name: tab, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(hubNav(page).getByRole('link', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(hubNav(page).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('group', { name: 'Daily streak' })).toHaveCount(1);
      await expect(headerPractice(page)).toHaveAttribute('aria-current', 'page');
    }

    // Older addresses open inside the hub, on their tab.
    const inside: [string, string][] = [
      ['practice/#/review/caching', 'Review'],
      ['practice/#/roadmap/approach', 'Roadmap'],
      ['practice/#/arcade/daily', 'Arcade'],
    ];
    for (const [path, tab] of inside) {
      await page.goto(path);
      await expect(hubNav(page).getByRole('link', { name: tab, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(headerPractice(page)).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the progress tab reads as one system: the level first, then skills, the roadmap and badges', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('proschi.practice', JSON.stringify({ 'url-shortener': { status: 'solved' } }));
    });
    await page.goto('practice/#/progress');
    // One solve: 100 XP, level 2 (src/learn/level.ts).
    await expect(page.getByTestId('level')).toHaveText('Level 2');
    await expect(page.getByTestId('xp')).toHaveText('100 XP');
    await expect(page.getByRole('progressbar', { name: 'Progress to level 3' })).toHaveAttribute('aria-valuenow', '100');
    const headings = await page.getByRole('main').getByRole('heading', { level: 2 }).allTextContents();
    expect(headings.slice(0, 3)).toEqual(['Your level', 'Skills and mastery', 'Roadmap']);
    expect(headings.some((h) => /Badges/.test(h))).toBe(true);
    await expect(page.getByRole('region', { name: 'Roadmap' }).getByRole('progressbar', { name: 'Roadmap progress' })).toHaveAttribute('aria-valuenow', '1');
  });

  test('the account page, from this browser’s progress, with a compact badge grid', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('proschi.practice', JSON.stringify({ 'url-shortener': { status: 'solved' }, pastebin: { status: 'attempted' } }));
      // Two daily challenges in a row, kept in this browser: yesterday's and today's (UTC).
      const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      const result = (d: string, score: number) => ({ day: d, score, maxScore: 600, correct: 4, perfect: false, totalMs: 20_000, results: [] });
      localStorage.setItem('proschi.challenge', JSON.stringify({ [day(-1)]: result(day(-1), 480), [day(0)]: result(day(0), 360) }));
    });
    await page.goto('practice/#/me');
    await expect(page).toHaveTitle('Your profile · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Your profile' })).toBeVisible();
    const totals = page.getByRole('definition').filter({ hasText: /easy/ });
    await expect(totals).toContainText('1 easy · 0 medium · 0 hard');
    await expect(page.getByTestId('profile-readiness')).toContainText('%');
    await expect(page.getByTestId('profile-challenge-best')).toHaveText('480/ 600');
    // Yesterday's and today's: 2 days in a row.
    await expect(page.getByRole('definition').filter({ hasText: 'Longest 2 days' })).toHaveText(/^2\s*days/);
    for (const label of ['Current streak', 'Longest streak', 'Streak freezes', 'Challenge streak', 'Best challenge', 'Interview ready', 'Problems solved', 'Cards reviewed', 'Cards mastered']) {
      await expect(page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
    }
    await expect(page.getByRole('radiogroup', { name: 'Daily goal' })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Topic mastery, from 0 to 100%/ })).toBeVisible();

    // Every badge, small: 40 to 48px each, the grid well short of the page.
    const grid = page.getByTestId('badge-grid');
    const medals = grid.getByRole('button');
    await expect(medals.first()).toBeVisible();
    const count = await medals.count();
    expect(count).toBeGreaterThan(10);
    for (const box of await medals.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.width).toBeLessThanOrEqual(48);
      expect(box.height).toBeLessThanOrEqual(48);
    }
    expect((await grid.boundingBox())!.height).toBeLessThan(300);
    // A badge solving the problem earned, in colour; a tap shows what it is.
    await expect(page.locator('[data-achievement="first-solve"]')).toHaveAttribute('data-earned', 'true');
    await expect(page.locator('[data-achievement="reviews-100"]')).toHaveAttribute('data-earned', 'false');
    await page.locator('[data-achievement="reviews-100"]').getByRole('button').click();
    const detail = page.getByRole('region', { name: 'Badge: Hundred club' });
    await expect(detail).toContainText('Hundred club');
    await expect(detail.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);

    // The problems solved, each a link to it.
    const solved = page.getByRole('region', { name: 'Problems solved' });
    await expect(solved.getByRole('link')).toHaveCount(1);
    await solved.getByRole('link', { name: /URL Shortener/ }).click();
    await expect(page).toHaveURL(/#\/url-shortener$/);
  });

  test('a public profile, as the leaderboard links to it: read only, with what its owner shared', async ({ page }) => {
    await mockProfile(page);
    await page.goto(`practice/#/u/${PROFILE.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeVisible();
    await expect(page).toHaveTitle('Ada Lovelace · Proschi practice');
    await expect(page.getByRole('note')).toContainText('This is a public profile');
    await expect(page.getByText('Member since January 2026')).toBeVisible();
    await expect(page.getByTestId('profile-readiness')).toHaveText('37%');
    await expect(page.getByTestId('profile-challenge-best')).toHaveText('540/ 600');
    await expect(page.getByText('Longest 6 days')).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: /easy/ })).toContainText('2 easy · 0 medium · 0 hard');
    // What only the owner sees is not there.
    for (const label of ['Streak freezes', 'Cards reviewed', 'Cards mastered']) await expect(page.getByRole('term').filter({ hasText: label })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Daily goal' })).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Mastery per topic' }).getByRole('row', { name: /Caching 60%/ })).toHaveCount(1);
    await expect(page.getByText(/^2 of \d+ earned$/)).toBeVisible();
    await expect(page.locator('[data-achievement="first-solve"]')).toHaveAttribute('data-earned', 'true');
    await page.locator('[data-achievement="first-solve"]').getByRole('button').click();
    await expect(page.locator('[data-achievement-detail="first-solve"]')).toContainText(/Earned \w+/);
    await expect(page.getByRole('region', { name: 'Problems solved' }).getByRole('link')).toHaveCount(2);
  });
});
