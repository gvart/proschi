import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';
import { openDoc, resultsTab, WITH_WHATIFS } from './whatif';

/**
 * Saved what-ifs in the build with accounts but no paid plans: saved_whatifs
 * costs nothing to run, so it follows the server as design_diff does (on for
 * an account on Pro set by hand), and nobody is shown the way to a plan.
 */

test('an account on Pro set by hand compares the saved what-ifs', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } });
  await openDoc(page, WITH_WHATIFS);
  await resultsTab(page).click();
  await expect(page.getByTestId('saved-whatifs').getByTestId('whatif-row')).toHaveCount(2);
  await expect(page.getByTestId('sweep')).toBeVisible();
});

test('a free account sees the names only, with no way to a plan', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'free' } });
  await openDoc(page, WITH_WHATIFS);
  await resultsTab(page).click();
  const teaser = page.getByTestId('whatif-teaser');
  await expect(teaser.getByRole('listitem')).toHaveText(['Launch day', 'Database down']);
  await expect(teaser).not.toContainText('Pro');
  await expect(page.getByTestId('whatif-upgrade')).toHaveCount(0);
  await expect(page.getByTestId('saved-whatifs')).toHaveCount(0);
});
