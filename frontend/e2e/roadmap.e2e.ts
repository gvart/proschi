import type { Locator, Page } from '@playwright/test';
import { expect, test, waitForCanvas } from './fixtures';

/** A stage of the roadmap, by its title. */
const stage = (page: Page, title: string) => page.getByRole('listitem', { name: new RegExp(`^Stage \\d+: ${title}$`) });
const progress = (page: Page) => page.getByRole('region', { name: 'Your progress' });
/** The links that open a problem (not the "Read the lesson" links, which every step with a lesson has). */
const challenges = (scope: Locator) => scope.getByRole('link', { name: /^(?!Read the lesson)/ });

test.describe('interview prep roadmap', () => {
  test('opens one problem at a time and unlocks the next after a solve', async ({ page }) => {
    await page.goto('practice/');
    await page.getByRole('link', { name: 'Interview prep roadmap' }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(page).toHaveTitle('Interview prep roadmap · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Interview prep roadmap' })).toBeVisible();
    await expect(progress(page).getByText(/^0 of \d+ solved$/)).toBeVisible();
    await expect(progress(page)).toContainText('Current stage 1. Foundations');

    // Only the first problem is open; the rest show a lock and what to solve first.
    const foundations = stage(page, 'Foundations');
    await expect(challenges(foundations)).toHaveCount(1);
    await expect(foundations.getByRole('link', { name: /URL Shortener/ })).toBeVisible();
    await expect(challenges(foundations).filter({ hasText: 'Pastebin' })).toHaveCount(0);
    const pastebin = foundations.getByRole('listitem').filter({ hasText: 'Pastebin' });
    await expect(pastebin.getByRole('img', { name: 'Locked' })).toBeVisible();
    await expect(pastebin).toContainText('Solve URL Shortener first');
    await expect(challenges(stage(page, 'Caching and the edge'))).toHaveCount(0);

    // Start opens the first problem with the roadmap's banner.
    await progress(page).getByRole('link', { name: 'Start: URL Shortener' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/url-shortener$/);
    const banner = page.getByRole('region', { name: 'Roadmap' });
    await expect(banner).toContainText(/Stage 1 of \d+: Foundations · 1 of \d+/);
    await expect(banner.getByRole('link', { name: /Next in roadmap/ })).toHaveCount(0);
    // A step is a lesson first, then the challenge.
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();
    await page.getByRole('button', { name: 'Start the challenge' }).first().click();
    await waitForCanvas(page);

    // Solve it with the reference solution (both steps ask for confirmation).
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Show reference solution' }).click();
    await page.getByRole('button', { name: 'Load into the editor' }).click();
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();

    await banner.getByRole('link', { name: 'Next in roadmap: Pastebin' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/pastebin$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pastebin');

    // Back on the roadmap, Pastebin is open and the next one is locked behind it.
    await page.getByRole('region', { name: 'Roadmap' }).getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(progress(page).getByText(/^1 of \d+ solved$/)).toBeVisible();
    await expect(progress(page).getByRole('link', { name: 'Continue: Pastebin' })).toBeVisible();
    await expect(challenges(foundations)).toHaveCount(2);
    await expect(foundations.getByRole('link', { name: /URL Shortener/ }).getByRole('img', { name: 'Solved' })).toBeVisible();
    await expect(foundations.getByRole('listitem').filter({ hasText: 'Always-writable Shopping Cart' })).toContainText('Solve Pastebin first');

    // The problem list is not gated.
    await page.getByRole('link', { name: 'All problems' }).click();
    await page.getByRole('main').getByRole('list').first().getByRole('link', { name: /Always-writable Shopping Cart/ }).click();
    await expect(page).toHaveURL(/#\/shopping-cart$/);
    await expect(page.getByRole('region', { name: 'Roadmap' })).toHaveCount(0);
  });
});
