import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { mockProfile, PROFILE } from './profile';

/**
 * Practice and interview prep: the problem list is only problems (with one
 * small link to interview prep), and interview prep is a hub with tabs for
 * the roadmap, daily review, the daily challenge and progress, the streak at
 * its top. Then the
 * account page (`#/me`, this browser's data in a build without accounts)
 * and a public profile (`#/u/<id>`), whose API answer is mocked here: this
 * build has no API.
 */

const prepNav = (page: Page) => page.getByRole('navigation', { name: 'Interview prep' });
/** The header's "Interview prep" link (the desktop nav's). */
const headerPrep = (page: Page) => page.locator('.ps-nav__link', { hasText: 'Interview prep' });

test.describe('practice and interview prep', () => {
  test('the problem list shows only problems, with one link to interview prep', async ({ page }) => {
    await page.goto('practice/');
    await expect(page.getByRole('heading', { level: 1, name: 'System design practice' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('group', { name: 'Daily streak' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: /Start (interview prep|daily review)|Continue interview prep|Your progress/ })).toHaveCount(0);
    await expect(main.getByRole('heading', { name: /Daily review|Interview prep roadmap/ })).toHaveCount(0);
    await expect(main.getByRole('radiogroup', { name: 'Daily goal' })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Play today’s challenge' })).toHaveCount(0);
    await expect(prepNav(page)).toHaveCount(0);
    await expect(page.locator('.ps-nav__link', { hasText: 'Practice' })).toHaveAttribute('aria-current', 'page');

    const link = main.getByRole('link', { name: /Interview prep/ });
    await expect(link).toHaveCount(1);
    await expect(link).toContainText('a daily challenge');
    await link.click();
    await expect(page).toHaveURL(/#\/roadmap$/);
  });

  test('the hub’s tabs, the streak on each, and the header marking it on every address', async ({ page }) => {
    await page.goto('practice/#/roadmap');
    await expect(headerPrep(page)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.ps-nav__link', { hasText: 'Practice' })).not.toHaveAttribute('aria-current', 'page');
    await expect(prepNav(page).getByRole('link')).toHaveText(['Roadmap', 'Daily review', 'Challenge', 'Progress']);
    await expect(prepNav(page).getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('group', { name: 'Daily streak' })).toContainText('No streak yet');
    await expect(page.getByRole('group', { name: 'Daily streak' })).toContainText('0 of 10 cards today');

    const tabs: [string, RegExp, string][] = [
      ['Daily review', /#\/review$/, 'Daily review'],
      ['Challenge', /#\/challenge$/, 'Daily challenge'],
      ['Progress', /#\/progress$/, 'Your progress'],
      ['Roadmap', /#\/roadmap$/, 'Interview prep roadmap'],
    ];
    for (const [tab, url, heading] of tabs) {
      await prepNav(page).getByRole('link', { name: tab }).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(prepNav(page).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      await expect(prepNav(page).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('group', { name: 'Daily streak' })).toHaveCount(1);
      await expect(headerPrep(page)).toHaveAttribute('aria-current', 'page');
    }

    // Older addresses open inside the hub, on their tab.
    const inside: [string, string][] = [
      ['practice/#/review/caching', 'Daily review'],
      ['practice/#/roadmap/approach', 'Roadmap'],
    ];
    for (const [path, tab] of inside) {
      await page.goto(path);
      await expect(prepNav(page).getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page');
      await expect(headerPrep(page)).toHaveAttribute('aria-current', 'page');
    }
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
