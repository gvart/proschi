import { cfUsage, mockAdmin } from './admin';
import { expect, test } from './fixtures';

/**
 * The admin's Cloudflare usage page (/admin/#/cloudflare), API mocked
 * (e2e/admin.ts cfUsage): the verdict, a meter per quota, Free against Paid,
 * the overview's "Needs attention", Free's daily limits, and the page before
 * it is set up.
 */

const signedIn = { passkeys: true, setupAvailable: false, signedIn: true };

test.describe('admin: Cloudflare usage', () => {
  test('on Paid: the verdict names what passes and its cost, a meter per quota, and Paid recommended', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/cloudflare');
    await expect(page.getByRole('heading', { level: 1, name: 'Cloudflare usage' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Cloudflare usage' })).toHaveAttribute('aria-current', 'page');

    const verdict = page.getByRole('region', { name: 'Verdict' });
    await expect(verdict).toContainText(/D1 rows read will pass the included 25B around \w+ \d+ — about \$\d+\.\d\d extra\./);
    for (const product of ['Workers', 'Workers AI', 'D1', 'R2', 'Email']) await expect(page.getByRole('heading', { level: 2, name: product, exact: true })).toBeVisible();
    await expect(page.locator('.adm-cf__meter')).toHaveCount(10);
    // Workers AI: the daily free allocation, its reset and Paid's price past it.
    const neurons = page.locator('.adm-cf__meter', { has: page.getByRole('heading', { name: 'Workers AI neurons' }) });
    await expect(neurons.getByRole('img')).toHaveAttribute('aria-label', /Workers AI neurons: .* of 10K used .*, projected .*\. Resets at 00:00 UTC\./);
    await expect(neurons).toContainText('Free daily');
    await expect(neurons).toContainText('$0.011 / 1K');
    const rows = page.locator('.adm-cf__meter', { has: page.getByRole('heading', { name: 'D1 rows read' }) });
    await expect(rows.getByText('Watch')).toBeVisible();
    await expect(rows.getByRole('img')).toHaveAttribute('aria-label', /D1 rows read: .* of 25B used .*, projected .*\. Resets \w+ \d+\./);
    await expect(page.getByText('Upgrade to Workers Paid', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Stay on Workers Paid.')).toBeVisible();
    await expect(page.getByText(/limits\.cpu_ms to 1000/)).toBeVisible();
  });

  test('the overview flags a quota to watch', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/');
    const row = page.locator('.adm-attention__row', { hasText: 'Cloudflare quotas' });
    await expect(row).toHaveClass(/is-alert/);
    await expect(row).toContainText('D1 rows read (watch)');
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/#\/cloudflare$/);
  });

  test('on Free: daily limits hit this week, and the upgrade', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.route('**/api/admin/cf-usage', (route) => route.fulfill({ json: cfUsage('free') }));
    await page.goto('admin/#/cloudflare');
    await expect(page.getByRole('region', { name: 'Verdict' })).toContainText('Free plan: Workers requests hit 100K/day 3 times this week — upgrade to Paid ($5/mo).');
    await expect(page.getByText('Upgrade to Workers Paid ($5/month).')).toBeVisible();
    await expect(page.getByText('Resets at 00:00 UTC').first()).toBeVisible();
  });

  test('not set up: says which secrets and permissions to add', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.route('**/api/admin/cf-usage', (route) =>
      route.fulfill({ status: 501, json: { error: 'Cloudflare usage is not set up: add CF_API_TOKEN (Account Analytics Read) and CF_ACCOUNT_ID' } }),
    );
    await page.goto('admin/#/cloudflare');
    await expect(page.getByRole('heading', { name: 'Not set up yet' })).toBeVisible();
    await expect(page.getByText('Account → Account Analytics → Read')).toBeVisible();
    await expect(page.getByText('npx wrangler secret put CF_API_TOKEN')).toBeVisible();
  });

  test('fits a phone: no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/cloudflare');
    await expect(page.locator('.adm-cf__meter').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
