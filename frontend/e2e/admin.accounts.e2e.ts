import type { Page } from '@playwright/test';
import { mockAdmin, PRO_USER, USER } from './admin';
import { answerDialog, expect, test } from './fixtures';

/**
 * The admin panel (/admin/) in the build with accounts, API mocked with
 * seeded data (e2e/admin.ts): the passkey gate before setup and after, and
 * signed in, the overview, an account's detail and blocking it, the billing
 * and AI tabs, the webhook log, the health page's paid configuration, live
 * share links, and granting credits and comping Pro (each with a reason).
 */

const signedIn = { passkeys: true, setupAvailable: false, signedIn: true };

const nav = (page: Page) => page.getByRole('navigation', { name: 'Admin sections' });

test.describe('admin panel', () => {
  test('asks for the setup token before the first passkey, and for the passkey after', async ({ page }) => {
    await mockAdmin(page, { passkeys: false, setupAvailable: true, signedIn: false });
    await page.goto('admin/');
    await expect(page.getByRole('heading', { name: 'Set up the admin panel' })).toBeVisible();
    await expect(page.getByLabel('Setup token')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create passkey' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockAdmin(page, { passkeys: true, setupAvailable: false, signedIn: false });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible();
    await expect(page.getByLabel('Setup token')).toHaveCount(0);
  });

  test('without a setup token, says how to set one', async ({ page }) => {
    await mockAdmin(page, { passkeys: false, setupAvailable: false, signedIn: false });
    await page.goto('admin/');
    await expect(page.getByText('npx wrangler secret put ADMIN_SETUP_TOKEN')).toBeVisible();
  });

  test('signed in: the overview, an account, and blocking it', async ({ page }) => {
    const posts = await mockAdmin(page, signedIn);
    await page.goto('admin/');
    await expect(nav(page).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    const kpis = page.getByRole('region', { name: 'Key numbers' });
    for (const label of ['Sign-ups', 'Weekly active users', 'Pro subscribers', 'Interviews finished', 'AI spend', 'Webhook failures']) await expect(kpis.getByText(label, { exact: true })).toBeVisible();
    await expect(kpis.getByText('vs previous 30 days').first()).toBeVisible();
    for (const chart of ['Sign-ups', 'Weekly active users', 'AI spend (USD)', 'AI interviews finished', 'Pro subscribers', 'Credit top-up orders']) {
      await expect(page.getByRole('figure', { name: chart, exact: true })).toBeVisible();
    }
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention.getByText('POLAR_PRODUCT_CREDITS_1000')).toBeVisible();
    await expect(attention.getByText('1 delivery refused or failed in the last 7 days')).toBeVisible();
    await expect(attention.getByRole('link', { name: 'Open Missing secrets' })).toHaveAttribute('href', '#/health');
    await expect(attention.getByText('2 sign-ups refused free credits today (1 seen before, 1 disposable)')).toBeVisible();
    await expect(attention.getByRole('button', { name: 'Server error: 2' })).toBeVisible();

    await nav(page).getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/#\/users$/);
    await expect(nav(page).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await page.getByRole('button', { name: 'spammer9000' }).click();
    await expect(page).toHaveURL(new RegExp(`#/users/${USER}$`));
    const signIn = page.getByRole('region', { name: 'Sign-in and sign-up credits' });
    await expect(signIn.getByText('Email and password')).toBeVisible();
    await expect(signIn.getByText('Refused: this person had an account before (same address or sign-in)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'spammer9000' })).toBeVisible();
    await expect(page.getByText('free plan')).toBeVisible();

    await page.getByLabel('Reason for blocking').fill('spam');
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await answerDialog(page, 'OK');
    await expect(page.getByText('Blocked and signed out.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();
    expect(posts).toEqual([{ method: 'POST', path: `/api/admin/users/${USER}/block`, body: { reason: 'spam' } }]);

    await page.getByRole('button', { name: '← All accounts' }).click();
    await expect(page).toHaveURL(/#\/users$/);
  });

  test('an account’s subscription and ledger; granting credits and comping Pro need a reason', async ({ page }) => {
    const posts = await mockAdmin(page, signedIn);
    await page.goto(`admin/#/users/${PRO_USER}`);
    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible();
    await expect(page.getByText('pro plan')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open in Polar \(sandbox\)/ })).toHaveAttribute('href', 'https://sandbox.polar.sh/to/dashboard/customers/cus_01JAZ2K7M3');
    await expect(page.getByText('721.148 of 800 monthly · 0 sign-up · 1,012.652 top-up')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Credit ledger (7)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ord_01JAZ4X9Q2' })).toHaveAttribute('href', 'https://sandbox.polar.sh/to/dashboard/sales/ord_01JAZ4X9Q2');

    await page.getByRole('button', { name: 'Grant or revoke credits' }).click();
    const dialog = page.getByRole('dialog', { name: 'Credits for Ada Lovelace' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Credits (up to 3 decimals)').fill('12.5');
    // The reason is required: the browser keeps the form from submitting without one.
    await dialog.getByRole('button', { name: 'Grant 12.5 credits' }).click();
    expect(posts).toEqual([]);
    await dialog.getByLabel('Reason (in the audit log)').fill('Support ticket 1234');
    await dialog.getByRole('button', { name: 'Grant 12.5 credits' }).click();
    await expect(page.getByText('Granted 12.5 top-up credits.')).toBeVisible();
    expect(posts).toEqual([{ method: 'POST', path: `/api/admin/users/${PRO_USER}/credits`, body: { kind: 'grant', credits: 12.5, ref: expect.stringMatching(/^[0-9a-f-]{36}$/), reason: 'Support ticket 1234' } }]);

    await page.getByRole('button', { name: 'Comp Pro' }).click();
    const comp = page.getByRole('dialog', { name: 'Comp Pro for Ada Lovelace' });
    await comp.getByLabel('Pro until (the end of this UTC day)').fill('2099-01-31');
    await comp.getByLabel('Reason (in the audit log)').fill('Conference speaker');
    await comp.getByRole('button', { name: 'Comp Pro' }).click();
    await expect(page.getByText('Pro until the end of 2099-01-31 (UTC).')).toBeVisible();
    expect(posts[1]).toEqual({ method: 'POST', path: `/api/admin/users/${PRO_USER}/comp`, body: { until: Date.parse('2099-01-31T23:59:59Z') / 1000, reason: 'Conference speaker' } });

    await page.getByRole('button', { name: 'End comp' }).click();
    const end = page.getByRole('dialog', { name: /End Ada Lovelace's comp/ });
    await end.getByLabel('Reason (in the audit log)').fill('Talk cancelled');
    await end.getByRole('button', { name: 'End comp now' }).click();
    await expect(page.getByText('Comp ended.')).toBeVisible();
    expect(posts[2]).toEqual({ method: 'POST', path: `/api/admin/users/${PRO_USER}/comp/end`, body: { reason: 'Talk cancelled' } });
  });

  test('the overview’s time range scopes every KPI and chart, and lives in the address', async ({ page }) => {
    await mockAdmin(page, signedIn);
    const asked: string[] = [];
    page.on('request', (r) => r.url().includes('/api/admin/trends') && asked.push(new URL(r.url()).searchParams.get('days')!));
    await page.goto('admin/');
    const range = page.getByRole('group', { name: 'Time range' });
    await expect(range.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
    const signups = page.getByRole('figure', { name: 'Sign-ups', exact: true });
    await expect(signups.getByText('in 30 days')).toBeVisible();

    await range.getByRole('button', { name: 'Last 90 days' }).click();
    await expect(page).toHaveURL(/#\/overview\/90$/);
    await expect(range.getByRole('button', { name: 'Last 90 days' })).toHaveAttribute('aria-pressed', 'true');
    await expect(signups.getByText('in 90 days')).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Credit top-up orders', exact: true }).getByText('in 90 days')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Key numbers' }).getByText('vs previous 90 days')).toHaveCount(6);
    // Every day of the range is in the chart's table.
    await signups.getByText('Show numbers').click();
    await expect(signups.getByRole('row')).toHaveCount(91);

    await page.goto('admin/#/overview/7');
    await expect(range.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
    await expect(signups.getByText('in 7 days')).toBeVisible();
    expect(asked).toEqual(['30', '90', '7']);

    // Hovering a day shows its values.
    const plot = page.getByRole('group', { name: /^Weekly active users: arrow keys/ });
    await plot.hover({ position: { x: 5, y: 40 } });
    await expect(page.locator('.adm-tip')).toBeVisible();
  });

  test('the sidebar groups the pages, marks the current one, and keeps the old hashes working', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/shares');
    await expect(page).toHaveURL(/#\/links$/);
    await expect(nav(page).getByRole('link', { name: 'Links' })).toHaveAttribute('aria-current', 'page');
    for (const group of ['People', 'Outreach', 'Revenue', 'AI', 'Content', 'System']) await expect(nav(page).getByText(group, { exact: true })).toBeVisible();
    await expect(nav(page).getByRole('link')).toHaveCount(13);
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);

    await nav(page).getByRole('link', { name: 'Webhooks' }).click();
    await expect(page).toHaveURL(/#\/webhooks$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/links$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Links' })).toBeVisible();
  });

  test('the billing page: subscribers, orders and refunds', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/billing');
    await expect(nav(page).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Paid accounts (5)' })).toBeVisible();
    await expect(page.getByText('Comp until')).toBeVisible();
    await expect(page.getByRole('row', { name: /Margaret Hamilton/ }).getByText('Max', { exact: true })).toBeVisible();
    await expect(page.getByText('Max accounts')).toBeVisible();
    await expect(page.getByText('Top-up orders', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ord_01JC7N2V8F' })).toHaveAttribute('href', 'https://sandbox.polar.sh/to/dashboard/sales/ord_01JC7N2V8F');
  });

  test('the webhooks page: deliveries, filtered by outcome', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/webhooks');
    await expect(page.getByText('subscription.updated')).toBeVisible();
    await expect(page.getByText('Bad signature', { exact: true })).toBeVisible();
    const filter = page.getByRole('group', { name: 'Outcome' });
    await expect(filter.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true');
    const request = page.waitForRequest((r) => r.url().includes('/api/admin/webhooks') && r.url().includes('outcome=bad_signature'));
    await filter.getByRole('button', { name: /Bad signature/ }).click();
    await request;
    await expect(filter.getByRole('button', { name: /Bad signature/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the AI tab: interviews per day, cost, top accounts and the token cap', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/ai');
    const interviews = page.getByRole('figure', { name: /AI interviews, by the UTC day/ });
    await expect(interviews).toBeVisible();
    await expect(interviews.getByRole('list', { name: 'Series' }).getByRole('listitem')).toHaveCount(3);
    // The credits charged per day, against what those calls cost.
    await expect(page.getByRole('figure', { name: /Credits charged \(€\) against/ })).toBeVisible();
    await expect(page.getByText('Credits charged', { exact: true })).toBeVisible();
    await expect(page.getByText('Hit the token cap')).toBeVisible();
    await page.getByRole('button', { name: 'Ada Lovelace' }).click();
    await expect(page).toHaveURL(new RegExp(`#/users/${PRO_USER}$`));
  });

  test('health shows whether each paid secret is set, and links lists live share links', async ({ page }) => {
    const posts = await mockAdmin(page, signedIn);
    await page.goto('admin/#/health');
    await expect(page.getByRole('heading', { name: 'Paid features' })).toBeVisible();
    await expect(page.getByText('POLAR_SERVER: sandbox (test payments)')).toBeVisible();
    await expect(page.getByText(/Billing is off/)).toBeVisible();

    await nav(page).getByRole('link', { name: 'Links' }).click();
    await expect(page.getByRole('heading', { name: 'Live share links' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke' }).click();
    await answerDialog(page, 'Revoke');
    await expect.poll(() => posts).toEqual([{ method: 'DELETE', path: '/api/admin/document-shares/AbCdEfGhIjKlMnOpQrStUv', body: null }]);
  });
});
