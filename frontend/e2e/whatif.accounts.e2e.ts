import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { canvasNodes, expect, test } from './fixtures';
import { openDoc, resultsTab, WITH_WHATIFS } from './whatif';

/**
 * Saved what-ifs and the sweep in Results (saved_whatifs, Pro;
 * docs/design/paid-plans.md P57) in the build with paid plans: Pro compares
 * the blocks and sweeps, Free sees their names and a locked teaser. With
 * WHATIF_SHOTS=<dir>, saves screenshots there.
 */

const SHOTS = process.env.WHATIF_SHOTS;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function open(page: Page, plan: 'free' | 'pro') {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan } });
  await openDoc(page, WITH_WHATIFS);
  await resultsTab(page).click();
}

test('Pro compares each saved what-if with the design and previews it on the canvas', async ({ page }) => {
  await open(page, 'pro');
  const table = page.getByTestId('saved-whatifs');
  const rows = table.getByTestId('whatif-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Launch day');
  await expect(rows.nth(0)).toContainText('pass');
  await expect(rows.nth(1)).toContainText('Database down');
  await expect(rows.nth(1)).toContainText('fail');
  await expect(page.getByTestId('whatif-teaser')).toHaveCount(0);
  await table.scrollIntoViewIfNeeded();
  if (SHOTS) await shot(page, 'pro-whatifs');

  await rows.nth(0).getByRole('button', { name: 'Preview Launch day on the canvas' }).click();
  await expect(page.getByTestId('whatif-open')).toHaveAccessibleName('What-if: Launch day');
  await expect(canvasNodes(page).filter({ hasText: 'Notes API' }).locator('.pc-node')).toHaveAttribute('data-bottleneck', 'true');
  await resultsTab(page).click();
  await expect(page.getByTestId('whatif-impact')).toContainText('What-if: Launch day');
  await expect(rows.nth(0).getByRole('button', { name: 'Preview Launch day on the canvas' })).toHaveAttribute('aria-pressed', 'true');
});

test('Pro sweeps a use case: the highest rate that passes and where each node saturates', async ({ page }) => {
  await open(page, 'pro');
  const sweep = page.getByTestId('sweep');
  await sweep.getByRole('button', { name: /^Sweep 250 rps to 5k rps$/ }).click();
  const chart = sweep.getByTestId('sweep-chart');
  await expect(chart).toContainText(/"Read a note" passes up to [\d.]+k? rps/);
  await expect(chart.getByRole('row').filter({ hasText: 'api' })).toContainText(/2k rps/);
  await chart.scrollIntoViewIfNeeded();
  if (SHOTS) await shot(page, 'pro-sweep');
});

test('Free sees the names of the saved what-ifs and a locked teaser, with the way to Pro', async ({ page }) => {
  await open(page, 'free');
  const teaser = page.getByTestId('whatif-teaser');
  await expect(teaser.getByRole('listitem')).toHaveText(['Launch day', 'Database down']);
  await expect(teaser).toContainText('Part of Pro');
  await expect(teaser.getByTestId('whatif-upgrade')).toHaveAttribute('href', /pricing/);
  await expect(page.getByTestId('saved-whatifs')).toHaveCount(0);
  await expect(page.getByTestId('sweep')).toHaveCount(0);
  // The live what-if stays free.
  await expect(page.getByRole('tablist', { name: 'Diagram view' })).toBeVisible();
  await teaser.scrollIntoViewIfNeeded();
  if (SHOTS) await shot(page, 'free-teaser');
});
