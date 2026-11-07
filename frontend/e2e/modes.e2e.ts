import { expect, test } from './fixtures';

/**
 * Guided mode on a problem page: opt-in, remembered in this browser. Without
 * opting in, the page is unchanged; Interview mode links to the mock
 * interview's set-up (interview.e2e.ts).
 */
test.describe('practice modes', () => {
  test('the default problem page shows the whole statement and no clock', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Interview mode' })).toHaveAttribute('href', '#/interview?problem=url-shortener');
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Guided walkthrough' })).toHaveCount(0);
  });

  test('guided mode: the first step unlocks the second, and progress is kept', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Guided walkthrough' }).click();
    const guide = page.getByRole('region', { name: 'Guided walkthrough' });
    await expect(guide.locator('[aria-current="step"]')).toContainText('Step 1: Start from the API');
    await expect(guide.getByText('0 of 6 steps')).toBeVisible();
    await guide.getByRole('button', { name: 'Check my design' }).click();
    await expect(guide.locator('[aria-current="step"]')).toContainText('Step 2: Store every code in a database');
    await expect(guide.getByText('1 of 6 steps')).toBeVisible();

    // The second step's checkpoint fails on the starter.
    await guide.getByRole('button', { name: 'Check my design' }).click();
    await expect(guide.getByRole('status')).toHaveText('Not there yet: change the design and check again.');
    await expect(guide.getByLabel('Not yet').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Guided walkthrough' }).locator('[aria-current="step"]')).toContainText('Step 2');
    await page.getByRole('button', { name: 'Close the walkthrough' }).click();
    await expect(page.getByRole('region', { name: 'Guided walkthrough' })).toHaveCount(0);
  });
});
