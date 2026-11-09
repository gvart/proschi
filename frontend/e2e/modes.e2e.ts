import { expect, STAGES_KEY, test } from './fixtures';

/**
 * The practice modes. A problem from the list (P51) has the Interview mode
 * and Guided walkthrough buttons on its brief; on the roadmap's stages (P50)
 * the guided walkthrough is "Walk me through it, step by step" in the Design
 * stage, opt-in and remembered in this browser, and Interview mode is
 * "Practice this as a mock interview" in the Wrap-up, linking to the mock
 * interview's set-up (interview.e2e.ts).
 */
test.describe('practice modes', () => {
  test('a problem from the list shows the whole statement, no clock, and the mode buttons', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Guided walkthrough' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Interview mode' })).toHaveAttribute('href', '#/interview?problem=url-shortener');
    await expect(page.getByRole('button', { name: 'Guided walkthrough' })).toBeVisible();
  });

  test('on the roadmap the full editor has no mode buttons; the mock interview is in the Wrap-up', async ({ page }) => {
    await page.goto('practice/#/roadmap/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Interview mode' })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name: 'Wrap-up' }).click();
    await expect(page.getByRole('link', { name: /Practice this as a mock interview/ })).toHaveAttribute('href', '#/interview?problem=url-shortener');
  });

  test.describe('on the whiteboard', () => {
    test.use({ stages: 'fresh' });

    test('guided mode: the first step unlocks the second, and progress is kept', async ({ page }) => {
      await page.addInitScript((key) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ stage: 'design', reached: 'design' }));
      }, `${STAGES_KEY}url-shortener`);
      await page.goto('practice/#/roadmap/url-shortener');
      await page.getByRole('button', { name: 'Walk me through it, step by step' }).click();
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
      await expect(page.getByRole('button', { name: 'Walk me through it, step by step' })).toBeVisible();
    });
  });
});
