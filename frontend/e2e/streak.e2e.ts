import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The daily goal, streak and celebrations in a build without accounts, where
 * they come from this browser's review log and solve days
 * (src/practice/activity.ts). The browser runs in UTC (playwright.config.ts),
 * so its local days are the UTC dates computed here.
 */

const DAY_MS = 86_400_000;
/** The UTC date `n` days from now (negative goes back). */
const dayFrom = (n: number) => new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10);

/** Reviews of made-up cards, `perDay` on each of `days` (days from today), as the review page stores them. */
function seededReviews(days: number[], perDay: number) {
  return days.flatMap((n) =>
    Array.from({ length: perDay }, (_, i) => ({
      id: `seed-${n}-${i}`,
      cardId: `seed-card-${n}-${i}`,
      version: 1,
      rating: 3,
      reviewedAt: Math.floor((Date.now() + n * DAY_MS) / 1000) - 60 + i,
      durationMs: 1000,
      day: dayFrom(n),
    })),
  );
}

/** Puts `entries` in the browser's storage before the page loads. */
async function seed(page: Page, entries: Record<string, unknown>): Promise<void> {
  await page.addInitScript((items) => {
    // Only on the first load, so the test's own changes survive a reload.
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
  }, entries);
}

const streak = (page: Page) => page.getByRole('group', { name: 'Daily streak' });

/** Answers the current session's card `n` of `of` in whatever way its type takes. */
async function answer(page: Page, n: number, of: number): Promise<void> {
  const card = page.getByRole('article', { name: `Card ${n} of ${of}` });
  const type = await card.getAttribute('data-card-type');
  if (type === 'estimate') {
    await card.getByLabel('Your estimate').fill('1k');
    await card.getByRole('button', { name: 'Check' }).click();
  } else if (type === 'choice') await card.getByRole('listitem').first().getByRole('button').click();
  else await card.getByRole('button', { name: 'Show answer' }).click();
  await (type === 'flip' ? card.getByRole('button', { name: /^Good/ }) : card.getByRole('button', { name: 'Next' })).click();
}

test.describe('daily streak', () => {
  test('a session that reaches a milestone celebrates it, and the streak shows after it', async ({ page }) => {
    // A goal of 5 cards, met yesterday and the day before.
    await seed(page, { 'proschi.goal': 5, 'proschi.cards': seededReviews([-2, -1], 5) });
    // The streak sits at the top of interview prep, on every tab.
    await page.goto('practice/#/roadmap');
    await expect(streak(page)).toContainText('2-day streak');

    await page.getByRole('navigation', { name: 'Interview prep' }).getByRole('link', { name: 'Daily review' }).click();
    await expect(streak(page)).toContainText('2-day streak');
    await expect(streak(page)).toContainText('0 of 5 cards today, or solve a problem');
    await expect(page.getByRole('radio', { name: '5 cards a day' })).toHaveAttribute('aria-checked', 'true');

    await page.getByRole('button', { name: 'Start review · 10 cards' }).click();
    for (let n = 1; n <= 5; n++) await answer(page, n, 10);
    await page.getByRole('button', { name: 'End session' }).click();

    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary.getByRole('heading', { name: '3-day streak!' })).toBeFocused();
    await expect(summary).toContainText(/You reviewed 5 cards/);
    await expect(summary.getByRole('group', { name: 'Daily streak' })).toContainText('3-day streak');
    await expect(summary).toHaveAttribute('aria-live', 'polite');

    await summary.getByRole('button', { name: 'Back to review' }).click();
    await expect(streak(page)).toContainText('3-day streak');
    await expect(streak(page)).toContainText('Today’s goal is met');
    await page.reload();
    await expect(streak(page)).toContainText('3-day streak');
  });

  test('the first session of a day celebrates the goal; the goal can be changed', async ({ page }) => {
    await page.goto('practice/#/review');
    await expect(streak(page)).toContainText('No streak yet');
    await expect(streak(page)).toContainText('0 of 10 cards today');
    await page.getByRole('button', { name: 'Start review · 10 cards' }).click();
    for (let n = 1; n <= 10; n++) await answer(page, n, 10);
    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary.getByRole('heading', { name: 'Daily goal reached' })).toBeVisible();
    await expect(summary.getByRole('group', { name: 'Daily streak' })).toContainText('1-day streak');
    await summary.getByRole('button', { name: 'Back to review' }).click();

    // A higher goal: today's 10 cards no longer meet it.
    await page.getByRole('radio', { name: '20 cards a day' }).click();
    await expect(page.getByRole('radio', { name: '20 cards a day' })).toHaveAttribute('aria-checked', 'true');
    await expect(streak(page)).toContainText('10 of 20 cards today');
    await expect(streak(page)).toContainText('No streak yet');
    await page.reload();
    await expect(page.getByRole('radio', { name: '20 cards a day' })).toHaveAttribute('aria-checked', 'true');
  });

  test('last week’s recap shows once, until dismissed', async ({ page }) => {
    // Every day of the last 14: last week is all goal days.
    await seed(page, { 'proschi.cards': seededReviews(Array.from({ length: 14 }, (_, i) => -1 - i), 10) });
    await page.goto('practice/#/review');
    const recap = page.getByRole('region', { name: 'Your week in review' });
    await expect(recap).toContainText('Cards reviewed70');
    await expect(recap).toContainText('Goal days7 of 7');
    await expect(recap).toContainText('Every day of the week met your goal.');
    // 14 days in a row earn the two freezes.
    await expect(streak(page)).toContainText('14-day streak');
    await expect(streak(page)).toContainText('2 freezes');

    await recap.getByRole('button', { name: 'Dismiss the weekly recap' }).click();
    await expect(recap).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Daily review' })).toBeVisible();
    await expect(recap).toHaveCount(0);
  });
});

test.describe('solve celebration', () => {
  /** Loads the reference solution of the open problem and runs the tests. */
  async function solveWithReference(page: Page): Promise<void> {
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Show reference solution' }).click();
    await page.getByRole('button', { name: 'Load into the editor' }).click();
    await page.getByRole('button', { name: 'Run tests' }).click();
  }

  test('a first solve shows what it took next to the reference, and where to go next', async ({ page }) => {
    // The roadmap's tutorial is done, so the next step after URL Shortener is Pastebin.
    await seed(page, { 'proschi.practice': { 'hello-proschi': { status: 'solved' } } });
    await page.goto('practice/#/url-shortener');
    await solveWithReference(page);
    // The verdict and the results stay in view.
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
    const celebration = page.getByRole('region', { name: 'First solve' });
    await expect(celebration.getByRole('heading', { name: 'First solve: URL Shortener' })).toBeVisible();
    await expect(celebration).toContainText('Test runs1');
    await expect(celebration).toContainText('Monthly cost');
    await expect(celebration).toContainText('Worst p99');
    await expect(celebration.getByText('the same as the reference')).toHaveCount(2);
    await expect(page.getByText(/^\d+ \/ \d+ passed/)).toBeVisible();
    await expect(celebration.getByRole('link', { name: /Review (the card|\d+ cards) on Estimation/ })).toBeVisible();
    await expect(celebration.getByRole('link', { name: /Next on the roadmap: Pastebin/ })).toHaveAttribute('href', '#/roadmap/pastebin');

    // The solve meets today's goal.
    await page.getByRole('link', { name: /Problems/ }).click();
    await page.getByRole('main').getByRole('link', { name: /Interview prep/ }).click();
    await expect(streak(page)).toContainText('1-day streak');
    // A second solve of the same problem is not a first one.
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'First solve' })).toHaveCount(0);
  });

  test('solving the last problem of a roadmap stage completes it', async ({ page }) => {
    const solved = { status: 'solved' };
    await seed(page, { 'proschi.practice': { 'hello-proschi': solved, 'url-shortener': solved, pastebin: solved, 'shopping-cart': solved } });
    await page.goto('practice/#/roadmap/snowflake-ids');
    await page.getByRole('button', { name: 'Start the challenge' }).first().click();
    await solveWithReference(page);
    const celebration = page.getByRole('region', { name: 'First solve' });
    await expect(celebration.getByRole('heading', { name: 'Stage complete: Foundations' })).toBeVisible();
    await expect(celebration).toContainText('Roadmap stage 1 of 8');
    await expect(celebration.getByRole('link', { name: /Next on the roadmap: Rate Limiter/ })).toBeVisible();
  });
});

test.describe('with reduced motion', () => {
  test('celebrations show their summary without confetti', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('practice/#/review');
    await page.getByRole('button', { name: 'Start review · 10 cards' }).click();
    await answer(page, 1, 10);
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('region', { name: 'Session summary' })).toContainText('You reviewed 1 card');
    await expect(page.locator('.ps-celebrate')).toHaveCount(0);
  });
});
