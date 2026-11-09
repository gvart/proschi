import { expect, test } from './fixtures';
import { openDeltaCompare } from './versionsDiff';

/**
 * The simulation deltas of a version comparison in the build with accounts
 * but no paid plans: design_diff follows the server as share_links does, so
 * an account on Pro keeps it, and Free keeps the plain numbers with no
 * teaser and no way to Pro.
 */

test('Free sees the plain numbers, with no teaser or upgrade link', async ({ page }) => {
  const compare = await openDeltaCompare(page, 'free');
  await expect(compare.getByRole('rowheader', { name: 'Cost' })).toBeVisible();
  await expect(compare.getByTestId('sim-delta-teaser')).toHaveCount(0);
  await expect(compare.getByTestId('sim-delta')).toHaveCount(0);
  await expect(compare.getByRole('link', { name: /Pro/ })).toHaveCount(0);
});

test('an account on Pro keeps the deltas', async ({ page }) => {
  const compare = await openDeltaCompare(page, 'pro');
  await expect(compare.getByTestId('sim-delta')).toContainText('+$650/mo');
});
