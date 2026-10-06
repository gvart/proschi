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
    await page.getByRole('main').getByRole('link', { name: /Interview prep/ }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(page).toHaveTitle('Interview prep roadmap · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Interview prep roadmap' })).toBeVisible();
    await expect(progress(page).getByText(/^0 of \d+ solved$/)).toBeVisible();
    await expect(progress(page)).toContainText('Current stage 1. Foundations');

    // The language tutorial comes first and is recommended, but optional: the first required problem is open
    // too, and the rest show a lock and what to solve first.
    const foundations = stage(page, 'Foundations');
    await expect(challenges(foundations)).toHaveCount(2);
    await expect(foundations.getByRole('link', { name: /Hello, Proschi/ })).toBeVisible();
    await expect(foundations.getByRole('link', { name: /URL Shortener/ })).toBeVisible();
    await expect(challenges(foundations).filter({ hasText: 'Pastebin' })).toHaveCount(0);
    const pastebinStep = foundations.getByRole('listitem').filter({ hasText: 'Pastebin' });
    await expect(pastebinStep.getByRole('img', { name: 'Locked' })).toBeVisible();
    await expect(pastebinStep).toContainText('Solve URL Shortener first');
    await expect(challenges(stage(page, 'Caching and the edge'))).toHaveCount(0);

    // Start opens the first problem with the roadmap's banner.
    await progress(page).getByRole('link', { name: 'Start: Hello, Proschi' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/hello-proschi$/);
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

    await banner.getByRole('link', { name: 'Next in roadmap: URL Shortener' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/url-shortener$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');

    // Back on the roadmap, URL Shortener is open and the next one is locked behind it.
    await page.getByRole('region', { name: 'Roadmap' }).getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(progress(page).getByText(/^1 of \d+ solved$/)).toBeVisible();
    await expect(progress(page).getByRole('link', { name: 'Continue: URL Shortener' })).toBeVisible();
    await expect(challenges(foundations)).toHaveCount(2);
    await expect(foundations.getByRole('link', { name: /Hello, Proschi/ }).getByRole('img', { name: 'Solved' })).toBeVisible();
    await expect(foundations.getByRole('listitem').filter({ hasText: 'Pastebin' })).toContainText('Solve URL Shortener first');

    // The problem list is not gated.
    await page.getByRole('link', { name: 'Practice', exact: true }).first().click();
    await page.getByRole('main').getByRole('list').first().getByRole('link', { name: /Always-writable Shopping Cart/ }).click();
    await expect(page).toHaveURL(/#\/shopping-cart$/);
    await expect(page.getByRole('region', { name: 'Roadmap' })).toHaveCount(0);
  });

  test("a locked step's lesson is locked too, on the roadmap and by its address", async ({ page }) => {
    await page.goto('practice/#/roadmap');
    const foundations = stage(page, 'Foundations');
    const pastebin = foundations.getByRole('listitem').filter({ hasText: 'Pastebin' });
    // The lesson of a locked step shows, disabled, with what unlocks it.
    const lesson = pastebin.getByRole('link', { name: 'Read the lesson: Pastebin, locked' });
    await expect(lesson).toHaveAttribute('aria-disabled', 'true');
    await expect(lesson).toHaveAccessibleDescription('Locked: Solve URL Shortener first');
    await expect(lesson).toHaveAttribute('title', 'Locked: Solve URL Shortener first');
    await expect(lesson).not.toHaveAttribute('href');
    await expect(lesson.locator('svg')).toHaveCount(1);
    await lesson.click({ force: true });
    await expect(page).toHaveURL(/#\/roadmap$/);
    // The guide stays open.
    await expect(page.getByRole('link', { name: /Read first/ })).toHaveAttribute('href', '#/roadmap/approach');

    // A locked step's address, the challenge's or the lesson's, shows the roadmap with what unlocks it.
    for (const hash of ['#/roadmap/pastebin', '#/roadmap/pastebin/lesson']) {
      await page.goto(`practice/${hash}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Interview prep roadmap' })).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'Pastebin is locked on the roadmap' })).toContainText('Solve URL Shortener first');
      await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
    }

    // An open step's lesson address opens on the lesson, with the roadmap's banner.
    await page.goto('practice/#/roadmap/hello-proschi/lesson');
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Roadmap' })).toContainText('Stage 1 of');

    // The problem list's lessons stay open to everyone.
    await page.goto('practice/#/pastebin/lesson');
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pastebin');
  });
});
