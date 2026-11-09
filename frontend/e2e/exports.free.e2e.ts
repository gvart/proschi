import { mockSignedIn } from './accounts';
import { canvasNodes, expect, test } from './fixtures';
import { FREE, PRO } from './history';

/**
 * Export and proof (docs/design/paid-plans.md P56) in the build with
 * accounts but no paid plans: they cost nothing to run, so, like share
 * links (P53), they follow the server: on for an account on Pro or Max set
 * by hand, and left out with no way to a plan otherwise.
 */

test('Free: no Exports & certificate section, no 3× PNG and no PDF', async ({ page }) => {
  await mockSignedIn(page, FREE);
  await page.goto('practice/#/me');
  await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Exports & certificate' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Exports & certificate' })).toHaveCount(0);

  await page.goto('app/?example=ecommerce');
  await expect(canvasNodes(page).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'PNG image', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /3×/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: 'HLD' }).click();
  await expect(page.getByRole('button', { name: 'HTML' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDF' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /PDF/ })).toHaveCount(0);
});

test('Pro set by hand: the section and the 3× PNG are there', async ({ page }) => {
  await mockSignedIn(page, PRO);
  await page.route(/\/api\/me\/embeds$/, (route) => route.fulfill({ json: { branding: true } }));
  await page.goto('practice/#/me');
  const section = page.getByRole('region', { name: 'Exports & certificate' });
  await expect(section.getByRole('button', { name: 'CSV (.zip)' })).toBeVisible();
  await expect(section.getByRole('switch', { name: 'Embeds without Proschi branding' })).toBeVisible();
  // Max's certificate is neither offered nor sold here.
  await expect(section.getByText('Mastery certificate')).toHaveCount(0);
  await expect(section.getByRole('link')).toHaveCount(0);

  await page.goto('app/?example=ecommerce');
  await expect(canvasNodes(page).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'PNG image, 3× (high-DPI)' })).toBeVisible();
});
