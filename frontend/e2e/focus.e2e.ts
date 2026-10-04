import type { Page } from '@playwright/test';
import { codeEditor, expect, test, waitForCanvas } from './fixtures';

/** The editor's focus themes (src/components/Playground/editorThemes.ts), as computed backgrounds. */
const FOCUS_DARK = 'rgb(22, 23, 27)';
const FOCUS_LIGHT = 'rgb(255, 253, 246)';

const editorBackground = (page: Page) => page.locator('.cm-editor:visible').evaluate((el) => getComputedStyle(el).backgroundColor);
const themeToggle = (page: Page) => page.locator('.ps-header').getByRole('button', { name: /^Theme:/ });
const header = (page: Page) => page.locator('.ps-header');

async function openEditor(page: Page) {
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page);
}

test.describe('editor focus', () => {
  test('the editor is dark by default, follows an explicit light choice, and keeps it after a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openEditor(page);
    // The page follows the light system theme; the editing area stays on the calm dark theme.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => editorBackground(page)).toBe(FOCUS_DARK);

    // System → dark → light.
    await themeToggle(page).click();
    await expect(themeToggle(page)).toHaveAttribute('data-pref', 'dark');
    await expect.poll(() => editorBackground(page)).toBe(FOCUS_DARK);
    await themeToggle(page).click();
    await expect(themeToggle(page)).toHaveAttribute('data-pref', 'light');
    await expect.poll(() => editorBackground(page)).toBe(FOCUS_LIGHT);

    await page.reload();
    await expect(codeEditor(page)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => editorBackground(page)).toBe(FOCUS_LIGHT);
  });

  test('zen mode: Ctrl+. hides the header, menus and tabs; Escape brings them back', async ({ page }) => {
    await openEditor(page);
    const views = page.getByRole('tablist', { name: 'Diagram view' });
    await expect(header(page)).toBeVisible();
    await expect(views).toBeVisible();

    await page.keyboard.press('ControlOrMeta+Period');
    await expect(page.getByRole('status').filter({ hasText: 'Zen mode on' })).toBeAttached();
    await expect(header(page)).toBeHidden();
    await expect(views).toBeHidden();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeHidden();
    // The work stays.
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page);

    await page.keyboard.press('Escape');
    await expect(header(page)).toBeVisible();
    await expect(views).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Zen mode off' })).toBeAttached();

    // The header button and the on-screen exit work too, and zen survives a reload in the same tab only.
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    await expect(header(page)).toBeHidden();
    await page.reload();
    await expect(codeEditor(page)).toBeVisible();
    await expect(header(page)).toBeHidden();
    await page.getByRole('button', { name: 'Exit zen mode' }).click();
    await expect(header(page)).toBeVisible();
  });

  test('zen mode on a practice problem keeps the tests', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(codeEditor(page)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Period');
    await expect(header(page)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Period');
    await expect(header(page)).toBeVisible();
  });
});

/** Loads the reference solution of the URL shortener and runs the tests. */
async function solveUrlShortener(page: Page) {
  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Show reference solution' }).click();
  await page.getByRole('button', { name: 'Load into the editor' }).click();
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Solved.' })).toBeVisible();
}

test.describe('celebration', () => {
  test('the first solve bursts', async ({ page }) => {
    await solveUrlShortener(page);
    await expect(page.locator('.ps-celebrate')).toBeAttached();
    // It cleans up after itself.
    await expect(page.locator('.ps-celebrate')).toHaveCount(0);
  });

  test.describe('with reduced motion', () => {
    test('there is no burst', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => {
        // Record any burst, however briefly it is in the page.
        new MutationObserver((records) => {
          if (records.some((r) => Array.from(r.addedNodes).some((n) => n instanceof HTMLElement && n.classList.contains('ps-celebrate')))) {
            document.documentElement.dataset.celebrated = 'yes';
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await solveUrlShortener(page);
      await page.waitForTimeout(300);
      await expect(page.locator('.ps-celebrate')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.dataset.celebrated)).toBeUndefined();
    });
  });
});
