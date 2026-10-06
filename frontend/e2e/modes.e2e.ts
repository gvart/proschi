import { expect, test } from './fixtures';

/**
 * Interview mode and guided mode on a problem page: both opt-in, both
 * remembered in this browser. Without opting in, the page is unchanged.
 */
test.describe('practice modes', () => {
  test('the default problem page shows the whole statement and no clock', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(page.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Interview mode' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Guided walkthrough' })).toHaveCount(0);
  });

  test('interview mode: clarify, reveal, estimate, then design against the clock', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await page.getByRole('button', { name: 'Interview mode' }).click();

    const panel = page.getByRole('region', { name: 'Interview mode' });
    await panel.getByRole('radio', { name: '30 min' }).click();
    await panel.getByRole('button', { name: 'Start the interview' }).click();
    await expect(panel.getByRole('timer', { name: 'Time left' })).toHaveText(/^(30:00|29:5\d)$/);

    // Phase 1: the scale and constraints are hidden until asked for.
    await expect(panel.getByRole('heading', { level: 2, name: 'Functional requirements' })).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: 'Scale' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Ask: How fast must a redirect be?' }).click();
    await expect(panel.getByText('Good question')).toBeVisible();
    await expect(panel.getByText(/The p99 of a redirect must stay under/)).toBeVisible();
    await panel.getByRole('button', { name: 'Ask: Can I use Kubernetes?' }).click();
    await expect(panel.getByText('Weak question')).toBeVisible();
    await expect(panel.getByRole('heading', { name: /2 asked, 1 good/ })).toBeVisible();

    // Phase 2: the rest is revealed; estimates are graded against their range.
    await panel.getByRole('button', { name: 'Reveal the rest' }).click();
    await expect(panel.locator('[aria-current="step"]')).toHaveText('2. Estimate');
    await expect(panel.getByRole('link', { name: 'Numbers to know' })).toHaveAttribute('href', '../docs/numbers/');
    await panel.getByLabel('How many short codes are created in a year at 100 a second?').fill('3B');
    await panel.getByRole('button', { name: 'Check' }).first().click();
    await expect(panel.getByText(/In range: the answer is 3,200,000,000 codes/)).toBeVisible();
    await expect(panel.getByText(/100\/s × 86,400 s\/day/)).toBeVisible();

    // Phase 3: the normal statement and editor, with the clock in the header.
    await panel.getByRole('button', { name: 'Start designing' }).click();
    await expect(panel.locator('[aria-current="step"]')).toHaveText('3. Design');
    await expect(panel.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
    await page.getByRole('button', { name: 'Run tests' }).click();
    await expect(panel.getByText(/Last run: \d+ of 10 tests passed/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Design, \d+:\d\d left/ })).toBeVisible();

    // Pausing stops the clock, and the interview survives a reload.
    await panel.getByRole('button', { name: 'Pause' }).click();
    await expect(panel.getByText('Paused. The clock stops until you resume.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Interview mode' }).locator('[aria-current="step"]')).toHaveText('3. Design');

    // Phase 4 and the summary.
    await page.getByRole('region', { name: 'Interview mode' }).getByRole('button', { name: 'Wrap up' }).click();
    await page.getByLabel(/I can explain one trade-off/).check();
    await page.getByRole('button', { name: 'Finish the interview' }).click();
    const summary = page.getByRole('region', { name: 'Interview summary' });
    await expect(summary).toContainText('2 asked: 1 good (of 6), 1 weak');
    await expect(summary).toContainText('1 of 3 in range, 2 not answered');
    await expect(summary).toContainText('Self-review: 1 of 4 ticked');
    await summary.getByRole('button', { name: 'Leave interview mode' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Scale' })).toBeVisible();
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
