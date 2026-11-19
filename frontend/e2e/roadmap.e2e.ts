import type { Locator, Page } from '@playwright/test';
import { expect, loadReferenceSolution, sectionLink, test, waitForCanvas } from './fixtures';

/** A stage of the roadmap, by its title. */
const stage = (page: Page, title: string) => page.getByRole('listitem', { name: new RegExp(`^Stage \\d+: ${title}$`) });
const progress = (page: Page) => page.getByRole('region', { name: 'Your progress' });
const upNext = (page: Page) => page.getByTestId('up-next');
/** The links that open a problem (not the "Read the lesson" links, which every locked step with a lesson has, nor the first stage's guide). */
const challenges = (scope: Locator) => scope.getByRole('link', { name: /^(?!Read the lesson|How to approach)/ });

test.describe('interview prep roadmap', () => {
  test('opens one problem at a time and unlocks the next after a solve', async ({ page }) => {
    await page.goto('practice/');
    await (await sectionLink(page, 'Roadmap')).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(page).toHaveTitle('Interview prep roadmap · Proschi practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Interview prep roadmap' })).toBeVisible();
    await expect(progress(page).getByText(/^0 of \d+ solved$/)).toBeVisible();
    await expect(progress(page)).toContainText(/Stage 1 of \d+/);

    // The language tutorial comes first and is recommended, but optional: the first required problem is open
    // too, and the rest show a lock; what to solve first is said once for the stage. Only the current stage is open.
    const foundations = stage(page, 'Foundations');
    await expect(foundations.getByRole('button', { name: /Foundations/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(challenges(foundations)).toHaveCount(2);
    await expect(foundations.getByRole('link', { name: /Hello, Proschi/ })).toBeVisible();
    await expect(foundations.getByRole('link', { name: /URL Shortener/ })).toBeVisible();
    await expect(challenges(foundations).filter({ hasText: 'Pastebin' })).toHaveCount(0);
    const pastebinStep = foundations.getByRole('listitem').filter({ hasText: 'Pastebin' });
    await expect(pastebinStep.getByRole('img', { name: 'Locked' })).toBeVisible();
    await expect(foundations).toContainText('solve URL Shortener first');
    await expect(foundations.getByText(/Solve URL Shortener first/i)).toHaveCount(1);
    const caching = stage(page, 'Caching and the edge');
    await expect(caching.getByRole('button', { name: /Caching and the edge/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(caching).toContainText('Unlocks after Foundations');
    await expect(challenges(caching)).toHaveCount(0);

    // The guide is read first: until it is read, "Up next" leads to it and the first problem is a smaller link.
    await expect(upNext(page).getByTestId('up-next-title')).toHaveText(/^How to approach/);
    await expect(upNext(page).getByRole('link', { name: 'Read the guide' })).toHaveAttribute('href', '#/roadmap/approach');
    // The first problem is still open: it opens with the roadmap's banner.
    await upNext(page).getByRole('link', { name: 'or skip to Hello, Proschi' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/hello-proschi$/);
    const banner = page.getByRole('region', { name: 'Roadmap' });
    await expect(banner).toContainText(/Stage 1 of \d+: Foundations · 1 of \d+/);
    await expect(banner.getByRole('link', { name: /Next in roadmap/ })).toHaveCount(0);
    // A step opens on its stage (here Design, by the stages fixture), not its lesson (P52).
    await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);
    await waitForCanvas(page);

    // Solve it with the reference solution (both steps ask for confirmation).
    await loadReferenceSolution(page);
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();

    await banner.getByRole('link', { name: 'Next in roadmap: URL Shortener' }).click();
    await expect(page).toHaveURL(/#\/roadmap\/url-shortener$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');

    // Back on the roadmap, URL Shortener is open and the next one is locked behind it.
    await page.getByRole('region', { name: 'Roadmap' }).getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/#\/roadmap$/);
    await expect(progress(page).getByText(/^1 of \d+ solved$/)).toBeVisible();
    // "Up next" is the next step: its lesson first while unread, its challenge one link away.
    await expect(upNext(page).getByTestId('up-next-title')).toHaveText('URL Shortener');
    await expect(upNext(page).getByRole('link', { name: 'Start the lesson' })).toHaveAttribute('href', '#/roadmap/url-shortener/lesson');
    await expect(upNext(page).getByRole('link', { name: 'or skip to the challenge' })).toHaveAttribute('href', '#/roadmap/url-shortener');
    await expect(challenges(foundations)).toHaveCount(2);
    await expect(foundations.getByRole('link', { name: /Hello, Proschi/ }).getByRole('img', { name: 'Solved' })).toBeVisible();
    await expect(foundations).toContainText('solve URL Shortener first');

    // The problem list is not gated.
    await page.getByRole('link', { name: 'Practice', exact: true }).first().click();
    await page.getByRole('main').getByRole('list').first().getByRole('link', { name: /Always-writable Shopping Cart/ }).click();
    await expect(page).toHaveURL(/#\/shopping-cart$/);
    await expect(page.getByRole('region', { name: 'Roadmap' })).toHaveCount(0);
  });

  test("a locked step's lesson stays open to read; only its challenge waits", async ({ page }) => {
    await page.goto('practice/#/roadmap');
    const foundations = stage(page, 'Foundations');
    const pastebin = foundations.getByRole('listitem').filter({ hasText: 'Pastebin' });
    // The challenge is locked; its lesson is a link.
    await expect(pastebin.getByRole('img', { name: 'Locked' })).toBeVisible();
    const lesson = pastebin.getByRole('link', { name: 'Read the lesson: Pastebin' });
    await expect(lesson).toHaveAttribute('href', '#/roadmap/pastebin/lesson');
    await lesson.click();
    await expect(page).toHaveURL(/#\/roadmap\/pastebin\/lesson$/);
    await expect(page.getByRole('article', { name: 'Lesson' })).toBeVisible();

    // The guide stays open, also listed in the first stage.
    await page.goto('practice/#/roadmap');
    await expect(page.getByRole('link', { name: 'Read the guide' })).toHaveAttribute('href', '#/roadmap/approach');
    await expect(stage(page, 'Foundations').getByRole('link', { name: /How to approach/ })).toHaveAttribute('href', '#/roadmap/approach');

    // A locked stage is one line; opened, its lessons are there to read.
    const caching = stage(page, 'Caching and the edge');
    await caching.getByRole('button', { name: /Caching and the edge/ }).click();
    await expect(caching.getByRole('link', { name: 'Read the lesson: Prioritized Load Shedding' })).toHaveAttribute('href', '#/roadmap/load-shedding/lesson');
    await expect(caching.getByRole('listitem').filter({ hasText: 'Prioritized Load Shedding' }).getByRole('img', { name: 'Locked' })).toBeVisible();

    // A locked challenge's address shows the roadmap with what unlocks it.
    await page.goto('practice/#/roadmap/pastebin');
    await expect(page.getByRole('heading', { level: 1, name: 'Interview prep roadmap' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Pastebin is locked on the roadmap' })).toContainText('Solve URL Shortener first');
    // A locked step in a later stage opens its stage.
    await page.goto('practice/#/roadmap/rate-limiter');
    await expect(stage(page, 'Caching and the edge').getByRole('button', { name: /Caching and the edge/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('article', { name: 'Lesson' })).toHaveCount(0);

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
