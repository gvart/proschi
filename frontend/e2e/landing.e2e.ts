import { canvasNodes, expect, test, waitForCanvas } from './fixtures';

test.describe('landing page', () => {
  // The hero player starts on its own when motion is welcome; reduced motion keeps it still until asked.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
  });

  test('loads with the hero', async ({ page }) => {
    await expect(page).toHaveTitle(/Proschi/);
    await expect(page.getByRole('heading', { level: 1, name: /Architecture diagrams as text/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /Checkout architecture/ })).toBeVisible();
    // Highlighting ran on the hero source.
    await expect(page.locator('#hero-source code span').first()).toBeAttached();
  });

  test('hero playback plays a step', async ({ page }) => {
    const status = page.locator('#player-status');
    await expect(status).toContainText('Use case “Place order”');
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(status).toContainText(/Step 1 of \d+/);
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(status).toContainText(/Step 2 of \d+/);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toContainText(/Step 3 of \d+/);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('practice list shows 12 problems', async ({ page }) => {
    const practice = page.getByRole('region', { name: 'Practice system design' });
    await expect(practice.getByRole('listitem')).toHaveCount(12);
    await expect(practice.getByRole('link', { name: /URL shortener/i })).toHaveAttribute('href', './practice/#/url-shortener');
  });

  test('example links open the editor with that example', async ({ page }) => {
    const examples = page.getByRole('region', { name: 'Examples' });
    await examples.getByRole('link', { name: /URL shortener HLD/ }).click();
    await expect(page).toHaveURL(/\/proschi\/app\/#code=/);
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('URL Shortener');
    await waitForCanvas(page);
    await expect(canvasNodes(page).filter({ hasText: 'Load Balancer' })).toBeVisible();
  });

  test('"Open this example" opens the hero in playback', async ({ page }) => {
    await page.getByRole('link', { name: 'Open this example' }).click();
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('Checkout');
    await expect(page.getByText(/Step 1 of \d+/)).toBeVisible();
  });
});
