import type { Page } from '@playwright/test';
import { canvasNodes, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

const problemList = (page: Page) => page.getByRole('main').getByRole('list').first();

/** The status line of the tests panel, e.g. "3 / 7 passed". */
const passedCount = (page: Page) => page.getByText(/^\d+ \/ \d+ passed/);

test.describe('practice', () => {
  test('lists 25 problems', async ({ page }) => {
    await page.goto('practice/');
    await expect(page.getByRole('heading', { level: 1, name: 'System design practice' })).toBeVisible();
    await expect(problemList(page).getByRole('link')).toHaveCount(25);
    await expect(page.getByText('0 of 25 solved')).toBeVisible();
  });

  test('filters by the company whose published system a problem is based on', async ({ page }) => {
    await page.goto('practice/');
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
    await expect(page.getByRole('link', { name: 'Pastebin' })).toHaveAttribute('href', '../pastebin/');
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
    await expect(page.getByText('1 of 25 solved')).toBeVisible();
    await expect(problemList(page).getByRole('link', { name: /URL shortener/i }).getByRole('img', { name: 'Solved' })).toBeVisible();
  });
});

test.describe('practice on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('shows the tabbed layout', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    const tabs = page.getByRole('tablist', { name: 'View', exact: true });
    await expect(tabs.getByRole('tab')).toHaveText(['Problem', 'Code', 'Diagram', 'Tests']);
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
