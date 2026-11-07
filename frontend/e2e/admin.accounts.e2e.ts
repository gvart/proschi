import { mockAdmin, PRO_USER, USER } from './admin';
import { expect, test } from './fixtures';

/**
 * The admin panel (/admin/) in the build with accounts, API mocked with
 * seeded data (e2e/admin.ts): the passkey gate before setup and after, and
 * signed in, the overview, an account's detail and blocking it, the billing
 * and AI tabs, the webhook log, the health page's paid configuration, live
 * share links, and granting credits and comping Pro (each with a reason).
 */

const signedIn = { passkeys: true, setupAvailable: false, signedIn: true };

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
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('figure', { name: /Sign-ups/ })).toBeVisible();
    await expect(page.getByRole('figure', { name: /AI interview spend/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Server error: 2' })).toBeVisible();

    await page.getByRole('tab', { name: 'Users' }).click();
    await expect(page).toHaveURL(/#\/users$/);
    await page.getByRole('button', { name: 'spammer9000' }).click();
    await expect(page).toHaveURL(new RegExp(`#/users/${USER}$`));
    await expect(page.getByRole('heading', { name: 'spammer9000' })).toBeVisible();
    await expect(page.getByText('free plan')).toBeVisible();

    await page.getByLabel('Reason for blocking').fill('spam');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Block', exact: true }).click();
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
    await expect(page.getByText('3 monthly · 0 trial · 6 pack')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Credit ledger (7)' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ord_01JAZ4X9Q2' })).toHaveAttribute('href', 'https://sandbox.polar.sh/to/dashboard/sales/ord_01JAZ4X9Q2');

    await page.getByRole('button', { name: 'Grant or revoke credits' }).click();
    const dialog = page.getByRole('dialog', { name: 'Credits for Ada Lovelace' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Pack credits').fill('2');
    // The reason is required: the browser keeps the form from submitting without one.
    await dialog.getByRole('button', { name: 'Grant 2 credits' }).click();
    expect(posts).toEqual([]);
    await dialog.getByLabel('Reason (in the audit log)').fill('Support ticket 1234');
    await dialog.getByRole('button', { name: 'Grant 2 credits' }).click();
    await expect(page.getByText('Granted 2 pack credits.')).toBeVisible();
    expect(posts).toEqual([{ method: 'POST', path: `/api/admin/users/${PRO_USER}/credits`, body: { kind: 'grant', credits: 2, ref: expect.stringMatching(/^[0-9a-f-]{36}$/), reason: 'Support ticket 1234' } }]);

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

  test('the billing tab: subscribers, orders, refunds and the webhook log', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/billing');
    await expect(page.getByRole('tab', { name: 'Billing' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Pro accounts (4)' })).toBeVisible();
    await expect(page.getByText('Comp until')).toBeVisible();
    await expect(page.getByRole('link', { name: 'ord_01JC7N2V8F' })).toHaveAttribute('href', 'https://sandbox.polar.sh/to/dashboard/sales/ord_01JC7N2V8F');
    await expect(page.getByRole('heading', { name: 'Webhook log' })).toBeVisible();
    await expect(page.getByText('Bad signature', { exact: true })).toBeVisible();
    await expect(page.getByText('subscription.updated')).toBeVisible();
  });

  test('the AI tab: interviews per day, cost, top accounts and the token cap', async ({ page }) => {
    await mockAdmin(page, signedIn);
    await page.goto('admin/#/ai');
    await expect(page.getByRole('figure', { name: /AI interviews, by the UTC day/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Series' }).getByRole('listitem')).toHaveCount(4);
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

    await page.getByRole('tab', { name: 'Links' }).click();
    await expect(page.getByRole('heading', { name: 'Live share links' })).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect.poll(() => posts).toEqual([{ method: 'DELETE', path: '/api/admin/document-shares/AbCdEfGhIjKlMnOpQrStUv', body: null }]);
  });
});
