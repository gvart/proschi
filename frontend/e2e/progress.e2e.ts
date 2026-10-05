import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The progress page in a build without accounts: the skill map, the
 * readiness score and the badges are computed from this browser's reviews
 * and solves (src/practice/skills/localAchievements.ts), and a new badge is
 * celebrated once.
 */

const badge = (page: Page, id: string) => page.locator(`[data-achievement="${id}"]`);
const toast = (page: Page) => page.getByRole('status', { name: 'New badge' });

test.describe('progress page', () => {
  test('renders the skill map, readiness and locked badges for a new learner', async ({ page }) => {
    await page.goto('practice/');
    const strip = page.getByRole('link', { name: /^Your progress: 0% interview ready, 0 of \d+ badges$/ });
    await expect(strip).toBeVisible();
    await strip.click();
    await expect(page).toHaveURL(/#\/progress$/);
    await expect(page).toHaveTitle('Your progress · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Your progress' })).toBeVisible();
    await expect(page.getByTestId('readiness')).toHaveText('0%');
    await expect(page.getByRole('img', { name: /^Topic mastery, from 0 to 100%/ })).toBeVisible();
    // The table for screen readers has every topic.
    const table = page.getByRole('table', { name: 'Mastery per topic' });
    await expect(table.getByRole('row')).toHaveCount(16);
    await expect(table.getByRole('row', { name: /Estimation 0%/ })).toHaveCount(1);
    // Three weakest topics, each with a way to train it.
    const train = page.getByRole('link', { name: /^Train this topic: / });
    await expect(train).toHaveCount(3);
    await train.first().click();
    await expect(page).toHaveURL(/#\/review\/estimation$/);
    await page.goBack();
    await expect(badge(page, 'first-card')).toHaveAttribute('data-earned', 'false');
    await expect(badge(page, 'reviews-100').getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    await expect(page.getByText(/^0 of \d+ earned$/)).toBeVisible();
  });

  test('a short review session earns a badge, celebrated once', async ({ page }) => {
    await page.goto('practice/#/review');
    await expect(page.getByRole('link', { name: 'Skill map and badges' })).toBeVisible();
    await page.getByRole('region', { name: 'Today' }).getByRole('button', { name: /^Start review/ }).click();
    const card = page.getByRole('article', { name: /^Card 1 of \d+$/ });
    await card.getByLabel('Your estimate').fill('2.3k');
    await card.getByRole('button', { name: 'Check' }).click();
    await card.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'End session' }).click();

    await expect(toast(page)).toContainText('First card');
    await toast(page).getByRole('link', { name: 'See your badges' }).click();
    await expect(page).toHaveURL(/#\/progress$/);
    await expect(badge(page, 'first-card')).toHaveAttribute('data-earned', 'true');
    await expect(badge(page, 'first-card')).toContainText(/Earned \w+/);
    await expect(badge(page, 'reviews-100').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await expect(page.getByText(/^1 of \d+ earned$/)).toBeVisible();
    // Estimation was reviewed: its mastery is above 0.
    await expect(page.getByRole('table', { name: 'Mastery per topic' }).getByRole('row', { name: /Estimation [1-9]\d*%/ })).toHaveCount(1);

    // Seen: a reload does not celebrate it again.
    await page.goto('practice/');
    await expect(page.getByRole('link', { name: /^Your progress: \d+% interview ready, 1 of \d+ badges$/ })).toBeVisible();
    await expect(toast(page)).toHaveCount(0);
  });

  test('solving a problem earns badges, celebrated back on the list', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Show reference solution' }).click();
    await page.getByRole('button', { name: 'Load into the editor' }).click();
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
    // Never over the editor: the toast waits for the list.
    await expect(toast(page)).toHaveCount(0);

    await page.getByRole('link', { name: 'Problems' }).first().click();
    // The reference solution solves it on the first run (and costs the same as the reference).
    await expect(toast(page)).toContainText('2 new badges');
    await expect(toast(page)).toContainText('First design');
    await expect(toast(page)).toContainText('Clean run');
    await toast(page).getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast(page)).toHaveCount(0);
    await page.getByRole('link', { name: /^Your progress/ }).click();
    await expect(badge(page, 'first-solve')).toHaveAttribute('data-earned', 'true');
    await expect(badge(page, 'first-run-1')).toHaveAttribute('data-earned', 'true');
    await expect(badge(page, 'under-reference-1')).toHaveAttribute('data-earned', 'false');
    await expect(badge(page, 'stage-foundations').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });
});
