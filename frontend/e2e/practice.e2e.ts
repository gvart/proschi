import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { canvasNodes, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

const problemList = (page: Page) => page.getByRole('main').getByRole('list').first();

/** The status line of the tests panel, e.g. "3 / 7 passed". */
const passedCount = (page: Page) => page.getByText(/^\d+ \/ \d+ passed/);

test.describe('practice', () => {
  test('lists 26 problems', async ({ page }) => {
    await page.goto('practice/');
    await expect(page.getByRole('heading', { level: 1, name: 'System design practice' })).toBeVisible();
    await expect(problemList(page).getByRole('link')).toHaveCount(26);
    await expect(page.getByText('0 of 26 solved')).toBeVisible();
  });

  test('ends with links to contribute a problem or suggest one, in a new tab', async ({ page }) => {
    await page.goto('practice/');
    const contribute = page.getByRole('complementary', { name: 'Contribute a problem' });
    await expect(contribute).toContainText('Have a system design problem in mind?');
    const write = contribute.getByRole('link', { name: 'Contribute it' });
    await expect(write).toHaveAttribute('href', 'https://github.com/gvart/proschi/blob/main/CONTRIBUTING.md#adding-a-new-problem');
    const suggest = contribute.getByRole('link', { name: 'suggest an idea' });
    await expect(suggest).toHaveAttribute('href', 'https://github.com/gvart/proschi/issues/new?template=problem-idea.md');
    for (const link of [write, suggest]) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
    }
  });

  test('filters by the company whose published system a problem is based on', async ({ page }) => {
    await page.goto('practice/');
    await page.getByRole('button', { name: 'Filters' }).click();
    const company = page.getByRole('combobox', { name: 'Company' });
    await expect(company.getByRole('option', { name: 'Twitter' })).toHaveCount(1);
    await company.selectOption('Twitter');
    const links = problemList(page).getByRole('link');
    await expect(links.filter({ hasText: 'Snowflake IDs' })).toHaveCount(1);
    await expect(links.filter({ hasText: 'URL Shortener' })).toHaveCount(0);
    for (const link of await links.all()) await expect(link.locator('[data-company="Twitter"]')).toHaveCount(1);
    await company.selectOption('');
    await expect(links.filter({ hasText: 'URL Shortener' })).toHaveCount(1);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the filters fold into one row, with removable chips', async ({ page }) => {
      await page.goto('practice/');
      const links = problemList(page).getByRole('link');
      await expect(links.first()).toBeVisible();
      const all = await links.count();
      const search = page.getByRole('searchbox', { name: 'Search' });
      const button = page.getByRole('button', { name: 'Filters' });
      // Collapsed: the search and the button share one row, and no select shows.
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('combobox')).toHaveCount(0);
      const [s, b] = [await search.boundingBox(), await button.boundingBox()];
      expect(Math.abs(s!.y + s!.height / 2 - (b!.y + b!.height / 2))).toBeLessThan(4);

      // Opening moves focus into the panel; Escape closes it and gives focus back.
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      const panel = page.getByRole('group', { name: 'Filters', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('id', (await button.getAttribute('aria-controls'))!);
      await expect(page.getByRole('combobox', { name: 'Difficulty' })).toBeFocused();
      await page.getByRole('combobox', { name: 'Difficulty' }).selectOption('easy');
      await page.getByRole('combobox', { name: 'Status' }).selectOption('todo');
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(button).toBeFocused();
      await expect(button).toHaveAccessibleName('Filters, 2 active');

      // The active filters are chips: one removes one, Clear all the rest.
      const chips = page.getByRole('group', { name: 'Active filters' });
      await expect(chips.getByRole('button', { name: /^Remove filter/ })).toHaveCount(2);
      await expect(button).toHaveText(/^Filters\s*·\s*2$/);
      await expect(links.filter({ hasText: 'URL Shortener' })).toHaveCount(1);
      await chips.getByRole('button', { name: 'Remove filter Difficulty: Easy' }).click();
      await expect(chips.getByRole('button', { name: /^Remove filter/ })).toHaveCount(1);
      await expect(button).toHaveAccessibleName('Filters, 1 active');
      await chips.getByRole('button', { name: 'Clear all' }).click();
      await expect(chips).toHaveCount(0);
      await expect(links).toHaveCount(all);
    });
  });

  test('the review explains what the starter is missing, from the simulation and the tests', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByText('An automatic review, based on the simulation and the tests. An AI reviewer is coming.')).toBeVisible();
    await page.getByRole('button', { name: 'Review my design' }).click();
    const result = page.getByTestId('review-result');
    await expect(result.getByRole('heading', { name: /^Critical/ })).toBeVisible();
    await expect(result.getByText('The use case "Redirect" is missing', { exact: true })).toBeVisible();
    await expect(result.getByRole('listitem').first()).toBeVisible();
    // A finding about one of the solver's nodes jumps to its line in the code.
    await expect(result.getByRole('button', { name: 'api', exact: true })).toBeVisible();
    // Running the tests brings them back into view.
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(passedCount(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review my design' })).toBeHidden();
  });

  test('the Twitter-based problem shows its company', async ({ page }) => {
    await page.goto('practice/#/snowflake-ids');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Snowflake IDs');
    await expect(page.locator('header [data-company="Twitter"]')).toBeVisible();
  });

  test("a problem's own page shows the statement and opens it in practice", async ({ page }) => {
    await page.goto('practice/url-shortener/');
    await expect(page).toHaveTitle('URL Shortener: system design practice · Proschi');
    await expect(page.getByRole('heading', { level: 1, name: 'URL Shortener' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pastebin', exact: true })).toHaveAttribute('href', '../pastebin/');
    await page.getByRole('link', { name: /Solve it in your browser/ }).click();
    await expect(page).toHaveURL(/\/practice\/#\/url-shortener$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');
  });

  test('url-shortener: starter fails, reference solution solves it, progress persists', async ({ page }) => {
    await page.goto('practice/');
    await problemList(page).getByRole('link', { name: /URL shortener/i }).click();
    await expect(page).toHaveURL(/#\/url-shortener$/);
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toContainText('URL Shortener');
    await expect(title.getByRole('img', { name: 'To do' })).toBeVisible();
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page);

    // The starter does not meet the requirements.
    const run = page.getByRole('button', { name: 'Run tests' });
    await run.click();
    await expect(passedCount(page)).toBeVisible();
    const [passed, total] = (await passedCount(page).textContent())!.match(/\d+/g)!.map(Number);
    expect(total).toBeGreaterThan(0);
    expect(passed).toBeLessThan(total);
    await expect(page.getByRole('img', { name: 'Attempted' }).first()).toBeVisible();
    await expect(page.getByText('Solved.')).toBeHidden();

    // Load the reference solution through the UI; both steps ask for confirmation.
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Show reference solution' }).click();
    await page.getByRole('button', { name: 'Load into the editor' }).click();
    await expect(passedCount(page)).toContainText('edited since');
    await run.click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
    await expect(passedCount(page)).toHaveText(/^(\d+) \/ \1 passed$/);
    await expect(title.getByRole('img', { name: 'Solved' })).toBeVisible();
    const solution = await editorText(page);

    // Progress and the code survive a reload.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 }).getByRole('img', { name: 'Solved' })).toBeVisible();
    await expect.poll(() => editorText(page)).toBe(solution);

    await page.getByRole('link', { name: /Problems/ }).click();
    await expect(page.getByText('1 of 26 solved')).toBeVisible();
    await expect(problemList(page).getByRole('link', { name: /URL shortener/i }).getByRole('img', { name: 'Solved' })).toBeVisible();
  });

  test('a failed run names the common mistake it makes, opens its lesson section and adds its cards to the review', async ({ page }) => {
    // The known wrong design, as if the learner had written it.
    const source = await readFile(new URL('../src/practice/problems/url-shortener/wrong/miss-never-fills-cache.proschi', import.meta.url), 'utf8');
    await page.addInitScript((src) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('proschi.practice', JSON.stringify({ 'url-shortener': { status: 'attempted', source: src } }));
    }, source);
    await page.goto('practice/#/url-shortener');
    await waitForCanvas(page);
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(passedCount(page)).toBeVisible();

    const mistake = page.getByRole('region', { name: 'Common mistake' });
    await expect(mistake.getByRole('heading')).toHaveText('Common mistake: Cache misses that never fill the cache');
    await expect(mistake).toContainText('After a miss, SET the code in the cache.');
    // The cards that train it lead to their topic in the review.
    await expect(mistake.getByRole('link', { name: /cache-aside pattern/ })).toHaveAttribute('href', '#/review/caching');
    await expect(mistake.getByRole('link')).toHaveCount(3);

    // The lesson opens at the section that teaches the fix.
    await mistake.getByRole('button', { name: 'Lesson: Cache-aside (lazy loading)' }).click();
    const lesson = page.getByRole('article', { name: 'Lesson' });
    await expect(lesson.getByRole('heading', { level: 3, name: 'Cache-aside (lazy loading)' })).toBeInViewport();

    // Its cards go to the review, due now and first in the queue.
    await mistake.getByRole('button', { name: 'Add these cards to my review' }).click();
    await expect(mistake.getByRole('status')).toContainText('Added to your review, due now.');
    await mistake.getByRole('link', { name: 'Review them' }).click();
    await expect(page).toHaveURL(/#\/review$/);
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today).toContainText('3 cards from a mistake you made come first, due now.');
    await today.getByRole('button', { name: /^Start review/ }).click();
    await expect(page.getByRole('article', { name: /^Card 1 of / })).toContainText('A cache hit takes 1 ms');
  });

  test('Hello, Proschi: the language tutorial comes first, and its reference solution solves it', async ({ page }) => {
    await page.goto('practice/');
    const first = problemList(page).getByRole('link').first();
    await expect(first).toContainText('Hello, Proschi');
    await first.click();
    await expect(page).toHaveURL(/#\/hello-proschi$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Proschi');
    await waitForCanvas(page);

    // The starter fails every check, one per idea, and points at the name the traffic uses.
    const run = page.getByRole('button', { name: 'Run tests' });
    await run.click();
    await expect(passedCount(page)).toHaveText(/^0 \/ 6 passed/);
    for (const name of ['A service answers the user', 'Say hello answers with 200', 'The greeting is read from a database', 'Every component has a spare']) {
      await expect(page.locator('[data-tour="tests"]').getByText(name).first()).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Common mistake' })).toContainText('A use case name that does not match the traffic');

    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Show reference solution' }).click();
    await page.getByRole('button', { name: 'Load into the editor' }).click();
    await run.click();
    await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
    await expect(passedCount(page)).toHaveText(/^6 \/ 6 passed$/);
    await expect(page.getByRole('region', { name: 'Common mistake' })).toHaveCount(0);
  });
});

test.describe('practice on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('shows the tabbed layout', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    const tabs = page.getByRole('tablist', { name: 'View', exact: true });
    await expect(tabs.getByRole('tab')).toHaveText(['Lesson', 'Problem', 'Code', 'Diagram', 'Tests']);
    await expect(tabs.getByRole('tab', { name: 'Problem' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Show reference solution' })).toBeVisible();
    await expect(codeEditor(page)).toHaveCount(0);

    await tabs.getByRole('tab', { name: 'Code' }).click();
    await expect(codeEditor(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show reference solution' })).toBeHidden();

    await tabs.getByRole('tab', { name: 'Diagram' }).click();
    await waitForCanvas(page);
    await expect(codeEditor(page)).toHaveCount(0);

    await tabs.getByRole('tab', { name: 'Tests' }).click();
    await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
    await expect(canvasNodes(page)).toHaveCount(0);
  });
});
