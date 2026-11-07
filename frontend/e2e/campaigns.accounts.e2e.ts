import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { mockAdmin } from './admin';
import { mockCampaigns } from './campaigns';
import { expect, test } from './fixtures';

/**
 * Admin campaigns (src/admin/CampaignsTab.tsx), API mocked (e2e/campaigns.ts):
 * the history, the launch template in the composer with the live count and
 * the preview, a test send, the confirm step that says what will happen and
 * asks for a reason, the progress while sending; and, for a user, the
 * announcement on the practice page and the Product news switch in Settings.
 */

const signedIn = { passkeys: true, setupAvailable: false, signedIn: true };
const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' });

test.describe('admin campaigns', () => {
  test('lists campaigns with their numbers', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await mockCampaigns(page);
    await page.goto('admin/');
    await expect(nav(page).getByText('Outreach', { exact: true })).toBeVisible();
    await nav(page).getByRole('link', { name: 'Campaigns' }).click();
    await expect(page).toHaveURL(/#\/campaigns$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Campaigns' })).toBeVisible();
    const row = page.getByRole('row', { name: /Scale or Fail is out/ });
    await expect(row.getByText('Done')).toBeVisible();
    await expect(row.getByRole('cell', { name: '12', exact: true })).toBeVisible();
    await expect(page.getByText('Tests go to v***@example.com.')).toBeVisible();
  });

  test('composes from the launch template, tests, confirms with a reason, and follows the send', async ({ page }) => {
    await mockAdmin(page, signedIn);
    const calls = await mockCampaigns(page);
    await page.goto('admin/#/campaigns');
    await page.getByRole('button', { name: 'New campaign' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New campaign' })).toBeVisible();
    await page.getByRole('button', { name: 'Use launch template' }).click();
    await expect(page.getByLabel('Subject (also the announcement’s title)')).toHaveValue('{{credits}} credits are on your Proschi account');
    await expect(page.getByLabel('Credits per account')).toHaveValue('150');
    await expect(page.getByLabel('Body (Markdown)')).toContainText('Mock interviews');
    await expect(page.getByLabel('Body (Markdown)')).not.toContainText(/\bAI\b/);

    // The live count and the preview, in the email's layout and in the app.
    await expect(page.getByText('email reaches')).toContainText('27');
    await expect(page.frameLocator('iframe[title="Email preview"]').locator('#subject')).toHaveText('{{credits}} credits are on your Proschi account');
    await page.getByRole('group', { name: 'Preview' }).getByRole('button', { name: 'In the app' }).click();
    const card = page.getByRole('complementary', { name: 'Announcement' });
    await expect(card.getByRole('heading', { name: '150 credits are on your Proschi account' })).toBeVisible();
    await expect(card.getByText('+150 credits on your account')).toBeVisible();

    await page.getByRole('button', { name: 'Send a test to me' }).click();
    await expect(page.getByText('Test sent to v***@example.com. Nothing was granted.')).toBeVisible();
    expect(calls.some((c) => c.path === '/api/admin/campaigns/test')).toBe(true);

    await page.getByRole('button', { name: 'Review and send…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send this campaign' });
    await expect(dialog.getByText('Grant 150 credits to 30 accounts, email 27 and show the announcement to 30.')).toBeVisible();
    await expect(dialog.getByText('3 skipped for email: 2 turned product news off, 1 has no confirmed address.')).toBeVisible();
    // No reason, no send.
    await dialog.getByRole('button', { name: 'Send now' }).click();
    expect(calls.some((c) => c.path.endsWith('/send'))).toBe(false);
    await dialog.getByLabel('Reason (in the audit log)').fill('Launch gift for the early accounts');
    await dialog.getByRole('button', { name: 'Send now' }).click();

    await expect(page).toHaveURL(/#\/campaigns\/camp-1$/);
    await expect(page.getByRole('progressbar', { name: 'Recipients processed' })).toBeVisible();
    await expect(page.getByText('sending in the background')).toBeVisible();
    // Polled until done.
    await expect(page.getByText('Done', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('30 of 30 recipients processed')).toBeVisible();
    const send = calls.find((c) => c.path.endsWith('/send'));
    expect(send?.body).toEqual({ reason: 'Launch gift for the early accounts' });
    const created = calls.find((c) => c.path === '/api/admin/campaigns' && c.method === 'POST');
    expect(created?.body).toMatchObject({ credits: 150, email: true, inapp: true, audience: { type: 'all' } });
  });
});

test.describe('product news for a user', () => {
  test('shows the announcement on the practice page until dismissed', async ({ page }) => {
    await mockSignedIn(page);
    const posts: string[] = [];
    await page.route('**/api/me/announcement**', (route) => {
      if (route.request().method() === 'POST') {
        posts.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({
        json: {
          announcement: {
            id: 'camp-1',
            title: '{{credits}} credits are on your Proschi account',
            body: 'Hi {{name}}, try a **mock interview**.\n\n<script>alert(1)</script>',
            link: { url: 'https://proschi.app/pricing/', label: 'See the plans' },
            credits: 150,
            values: { name: 'Ada', credits: '150' },
          },
        },
      });
    });
    await page.goto('practice/');
    const card = page.getByRole('complementary', { name: 'Announcement' });
    await expect(card.getByRole('heading', { name: '150 credits are on your Proschi account' })).toBeVisible();
    await expect(card.getByText('mock interview')).toHaveJSProperty('tagName', 'STRONG');
    await expect(card.getByText('<script>alert(1)</script>')).toBeVisible();
    await card.getByRole('button', { name: 'Dismiss announcement' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(() => posts).toEqual(['/api/me/announcement/camp-1/dismiss']);
  });

  test('turns product news off in Settings', async ({ page }) => {
    await mockSignedIn(page);
    const puts: unknown[] = [];
    await page.route('**/api/me/news', (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { on: boolean };
        puts.push(body);
        return route.fulfill({ json: { on: body.on, email: 'ada@example.com', source: 'github' } });
      }
      return route.fulfill({ json: { on: true, email: 'ada@example.com', source: 'github' } });
    });
    await page.goto('practice/#/me');
    const toggle = page.getByRole('switch', { name: 'Product news' });
    await expect(toggle).toBeChecked();
    await expect(page.getByText('the address GitHub verified')).toBeVisible();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(puts).toEqual([{ on: false }]);
  });
});
