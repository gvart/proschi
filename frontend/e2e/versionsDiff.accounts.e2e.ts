import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openDeltaCompare } from './versionsDiff';

/**
 * The simulation deltas of a version comparison (design_diff, Pro;
 * docs/design/paid-plans.md P54) in the build with paid plans: Pro sees what
 * the change does, Free the plain numbers and a locked teaser. With
 * DIFF_SHOTS=<dir>, saves screenshots there.
 */

const SHOTS = process.env.DIFF_SHOTS;

/** A screenshot once the canvas has finished fitting the diagram (an animation, so a pause, as docs-screenshots does). */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('Pro sees what the change does: cost, p99, the checks that flipped and the load that moved', async ({ page }) => {
  const compare = await openDeltaCompare(page, 'pro');
  const delta = compare.getByTestId('sim-delta');
  await expect(delta).toBeVisible();
  const tiles = delta.getByTestId('delta-tile');
  await expect(tiles.filter({ hasText: 'Cost' })).toContainText('$1,250/mo');
  await expect(tiles.filter({ hasText: 'Cost' }).getByText('+$650/mo')).toHaveClass(/text-fail/);
  await expect(tiles.filter({ hasText: 'Worst p99' })).toContainText('38.2 ms');
  await expect(tiles.filter({ hasText: 'Worst p99' }).getByText('was 59.9 ms')).toHaveClass(/text-pass/);
  await expect(delta).toContainText('Checks: 0 of 2 → 2 of 2 pass');
  const checks = delta.getByTestId('delta-checks');
  await expect(checks.getByRole('listitem').filter({ hasText: 'survive failure of db' })).toContainText('✓ now passes');
  await expect(delta.getByTestId('delta-use-cases')).toContainText('p99 59.9→38.2 ms');
  await expect(delta.getByTestId('delta-load')).toContainText('Utilisation · db');
  // The plain side-by-side table and the teaser are for other plans.
  await expect(compare.getByRole('rowheader', { name: 'Cost' })).toHaveCount(0);
  await expect(compare.getByTestId('sim-delta-teaser')).toHaveCount(0);
  if (SHOTS) await shot(page, 'pro-diff');
});

test('Free keeps the plain numbers and sees a locked teaser with no numbers, and the way to Pro', async ({ page }) => {
  const compare = await openDeltaCompare(page, 'free');
  await expect(compare.getByRole('rowheader', { name: 'Cost' })).toBeVisible();
  const teaser = compare.getByTestId('sim-delta-teaser');
  await expect(teaser).toBeVisible();
  await expect(teaser).toContainText('Part of Pro');
  await expect(teaser.getByTestId('design-diff-upgrade')).toHaveAttribute('href', /pricing/);
  await expect(compare.getByTestId('sim-delta')).toHaveCount(0);
  await expect(compare.getByText('+$650/mo')).toHaveCount(0);
  await expect(compare.getByText('now passes')).toHaveCount(0);
  if (SHOTS) await shot(page, 'free-teaser');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the deltas fit the screen under the canvas', async ({ page }) => {
    const compare = await openDeltaCompare(page, 'pro');
    const delta = compare.getByTestId('sim-delta');
    await delta.scrollIntoViewIfNeeded();
    await expect(delta).toBeVisible();
    const box = (await delta.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    if (SHOTS) {
      await compare.getByRole('complementary', { name: 'Changes' }).evaluate((el) => el.scrollTo(0, 0));
      await shot(page, 'phone-pro-diff');
    }
  });
});
