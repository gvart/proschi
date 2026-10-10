import { appendCode, canvasNodes, expect, test, waitForCanvas } from './fixtures';
import type { Page } from '@playwright/test';

const demo = (page: Page) => page.locator('#live-demo');
const status = (page: Page) => demo(page).getByRole('status');

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
  });

  test('loads with the hero and the live demo', async ({ page }) => {
    await expect(page).toHaveTitle(/Proschi/);
    await expect(page.getByRole('heading', { level: 1, name: /Draw systems by\s*typing/ })).toBeVisible();
    // Two equally weighted ways in.
    await expect(page.getByRole('main').getByRole('link', { name: /Design a system/ })).toHaveAttribute('href', './app/');
    await expect(page.getByRole('main').getByRole('link', { name: /Prepare for interviews/ })).toHaveAttribute('href', './practice/#/roadmap');
    // The island replaced the poster: the real editor and canvas.
    await expect(demo(page).locator('.cm-content')).toBeVisible();
    await waitForCanvas(page, 4);
  });

  test('under reduced motion the demo starts at the end, with a button to play the tour', async ({ page }) => {
    await expect(status(page)).toHaveText('This is the real editor. Edit anything, or play the tour.');
    await waitForCanvas(page, 4);
    await expect(canvasNodes(page).filter({ hasText: 'OrderEvents' })).toBeVisible();
    await expect(demo(page).getByRole('button', { name: 'Play tour' })).toBeVisible();
    await expect(demo(page).getByRole('button', { name: 'Pause tour' })).toHaveCount(0);

    // Playing a scenario is a click away.
    await demo(page).getByRole('button', { name: /DB down/ }).click();
    await expect(demo(page).getByRole('button', { name: /DB down/ })).toHaveAttribute('aria-pressed', 'true');

    // Asked for, the tour plays (and can be paused).
    await demo(page).getByRole('button', { name: 'Play tour' }).click();
    const pause = demo(page).getByRole('button', { name: 'Pause tour' });
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await pause.click();
    await expect(demo(page).getByRole('button', { name: 'Resume tour' })).toHaveAttribute('aria-pressed', 'true');
    await expect(status(page)).toContainText('Paused');
  });

  test('a visitor can edit the demo and the diagram follows', async ({ page }) => {
    await waitForCanvas(page, 4);
    await appendCode(page, '\ncache "Session Cache" [Redis]\napi -> cache : GET\n');
    await expect(canvasNodes(page).filter({ hasText: 'Session Cache' })).toBeVisible();
    // "Open in the editor" carries the edited document.
    const href = await demo(page).getByRole('link', { name: /Open in the editor/ }).getAttribute('href');
    expect(href).toMatch(/^\.\/app\/#code=/);
    await demo(page).getByRole('link', { name: /Open in the editor/ }).click();
    await expect(page).toHaveURL(/\/proschi\/app\/#code=/);
    await waitForCanvas(page);
    await expect(canvasNodes(page).filter({ hasText: 'Session Cache' })).toBeVisible();
  });

  test('practice shows a few featured problems and links all 29', async ({ page }) => {
    const practice = page.getByRole('region', { name: 'Practice system design' });
    await expect(practice.getByRole('listitem')).toHaveCount(3);
    await expect(practice.getByText('29 system design problems.')).toBeVisible();
    await expect(practice.getByRole('link', { name: /URL shortener/i })).toHaveAttribute('href', './practice/url-shortener/');
    await expect(practice.getByRole('link', { name: 'All 29 problems' })).toHaveAttribute('href', './practice/');
  });

  test('the featured problems are in the page without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('./');
    await expect(page.getByRole('region', { name: 'Practice system design' }).getByRole('listitem')).toHaveCount(3);
    await context.close();
  });

  test('the page is under six screens tall on a desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(6 * 900);
  });

  test('the Arcade is linked from the page and the footer', async ({ page }) => {
    const arcade = page.getByRole('region', { name: 'Scale or Fail' });
    await expect(arcade.getByRole('link', { name: /Play Scale or Fail/ })).toHaveAttribute('href', './practice/#/arcade');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Arcade: Scale or Fail' })).toHaveAttribute('href', './practice/#/arcade');
  });

  test('example links open the editor with that example', async ({ page }) => {
    // The examples sit under the editor's call to action.
    const examples = page.getByRole('list', { name: /open an example/ });
    await expect(examples.getByRole('link', { name: /URL shortener HLD/ })).toHaveAttribute('href', './app/?example=url-shortener');
    await examples.getByRole('link', { name: /URL shortener HLD/ }).click();
    await expect(page).toHaveURL(/\/proschi\/app\/#code=/);
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('URL Shortener');
    await waitForCanvas(page);
    await expect(canvasNodes(page).filter({ hasText: 'Load Balancer' })).toBeVisible();
  });

  test('the story shows its end state without motion', async ({ page }) => {
    await page.locator('#checks').scrollIntoViewIfNeeded();
    await expect(page.getByText('5 / 5 pass')).toBeVisible();
    await expect(page.getByRole('img', { name: /DB down/ })).toBeVisible();
    // No burst under reduced motion.
    await page.getByRole('button', { name: 'Run the tests again' }).click();
    await expect(page.locator('.ps-celebrate')).toHaveCount(0);
  });
});

test.describe('landing page tour', () => {
  // Nothing in the browser before the visit, so "nothing saved" means an empty localStorage.
  test.use({ onboarding: 'fresh' });

  test('types, plays and hands over without moving focus or saving anything', async ({ page }) => {
    await page.goto('./');
    const historyLength = await page.evaluate(() => history.length);
    await expect(status(page)).toContainText(/Write a service|what sits behind it/);
    // The typing is hidden from assistive technology; the status line sums it up.
    await expect(demo(page).locator('.demo__code')).toHaveAttribute('aria-hidden', 'true');
    await expect(demo(page).getByRole('button', { name: 'Pause tour' })).toBeVisible();

    await waitForCanvas(page, 1);
    await expect(status(page)).toContainText('Press play', { timeout: 25_000 });
    await expect(page.locator('.react-flow__edge.animated, .react-flow__edges g rect').first()).toBeAttached({ timeout: 10_000 });

    await demo(page).getByRole('button', { name: 'Skip to the end' }).click();
    await expect(status(page)).toHaveText('Your turn — edit anything.');
    await expect(demo(page).locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
    await expect(demo(page).locator('.cm-content')).not.toBeFocused();

    await appendCode(page, '\nqueue "Jobs" [SQS]\n');
    await waitForCanvas(page, 5);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, location.hash, history.length])).toEqual([0, 0, '', historyLength]);
  });

  test('does not steal focus while it plays', async ({ page }) => {
    await page.goto('./');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    await expect(status(page)).toContainText('Connect them', { timeout: 15_000 });
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(focused);
  });
});
