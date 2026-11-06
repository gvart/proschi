import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { codeEditor, expect, test } from './fixtures';

/**
 * Pro and packs (backend/src/billing.ts) in the build with accounts and
 * billing (`npm run build:accounts` sets VITE_BILLING=true). The API and
 * Polar's hosted checkout and portal are mocked: Polar's pages are stand-ins
 * on this origin, so no request leaves the machine.
 */

type Plan = Record<string, unknown>;

const FREE_PLAN: Plan = {
  plan: 'free',
  billing: true,
  subscription: null,
  customer: false,
  limits: { documents: 5, versionsPerDocument: 20, documentBytes: 65536, interviewsPerMonth: 0 },
  credits: { total: 1, monthly: 0, trial: 1, pack: 0, period: '2026-11' },
};

const PRO_PLAN: Plan = {
  plan: 'pro',
  billing: true,
  subscription: { status: 'active', product: 'pro_yearly', currentPeriodEnd: Date.parse('2027-11-06T00:00:00Z'), cancelAtPeriodEnd: false },
  customer: true,
  limits: { documents: null, versionsPerDocument: null, documentBytes: 524288, interviewsPerMonth: 4 },
  credits: { total: 5, monthly: 4, trial: 1, pack: 0, period: '2026-11' },
};

/** The billing API on top of mockSignedIn, with `plan()` as GET /api/me/plan; returns what was POSTed. */
async function mockBilling(page: Page, plan: () => Plan) {
  const posts: { path: string; body: unknown }[] = [];
  await mockSignedIn(page);
  await page.route(/\/api\/(me\/plan|billing\/[a-z]+)$/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') return route.fulfill({ json: plan() });
    posts.push({ path, body: request.postDataJSON() as unknown });
    const here = new URL(request.url()).origin;
    if (path.endsWith('/checkout')) return route.fulfill({ json: { url: `${here}/polar/checkout/abc` } });
    return route.fulfill({ json: { url: `${here}/polar/portal/xyz` } });
  });
  // Polar's hosted pages.
  await page.route(/\/polar\/(checkout|portal)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Polar</title><h1>${route.request().url().includes('checkout') ? 'Polar checkout' : 'Polar portal'}</h1>` }),
  );
  return posts;
}

test('upgrade: pricing, Polar checkout, back to Plan & billing on Pro', async ({ page }) => {
  let current = FREE_PLAN;
  const posts = await mockBilling(page, () => current);
  await page.goto('pricing/');
  await expect(page.getByRole('heading', { name: 'Free to design. Pro to go further.' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Yearly/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('€89', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await expect(page.getByText('€12', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Yearly/ }).click();

  await page.getByRole('button', { name: 'Upgrade to Pro, €89 a year' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  expect(posts).toEqual([{ path: '/api/billing/checkout', body: { product: 'pro_yearly' } }]);

  // Polar sends the browser back once paid; the webhook has made the account Pro.
  current = PRO_PLAN;
  await page.goto('practice/?checkout=done#/me');
  const billing = page.getByRole('region', { name: 'Plan & billing' });
  await expect(billing.getByRole('status')).toContainText('Thank you!');
  await expect(billing).toContainText('Pro yearly, renews on 6 November 2027.');
  await expect(billing.getByTestId('credits')).toHaveText('AI interviews left: 5 (4 of 4 this month, 1 free one).');
  await expect(page).not.toHaveURL(/checkout=done/);
  await expect(billing.getByRole('link', { name: 'Upgrade to Pro' })).toHaveCount(0);

  await billing.getByRole('button', { name: 'Manage billing and invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Polar portal' })).toBeVisible();
  expect(posts.at(-1)).toEqual({ path: '/api/billing/portal', body: null });
});

test('pricing: signed out, the buttons sign in first; a pack can be bought from the account page', async ({ page }) => {
  const posts = await mockBilling(page, () => FREE_PLAN);
  // Signed out: /api/me answers 401.
  await page.route(/\/api\/me$/, (route) => route.fulfill({ status: 401, json: { error: 'Not signed in' } }));
  await page.goto('pricing/');
  await expect(page.getByRole('button', { name: 'Sign in with GitHub to upgrade' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google to buy' })).toBeVisible();
  await page.unroute(/\/api\/me$/);

  await page.goto('practice/#/me');
  const billing = page.getByRole('region', { name: 'Plan & billing' });
  await expect(billing).toContainText('5 diagrams in your account, 20 versions each.');
  await expect(billing.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '../pricing/');
  await expect(billing.getByRole('button', { name: 'Manage billing and invoices' })).toHaveCount(0);
  await billing.getByRole('button', { name: 'Buy 5 interviews, €15' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  expect(posts).toEqual([{ path: '/api/billing/checkout', body: { product: 'pack_5' } }]);
});

test('the editor offers Pro where the account is full', async ({ page }) => {
  await mockBilling(page, () => FREE_PLAN);
  // An account with room for one diagram: this browser's takes it.
  await page.route(/\/api\/me\/documents$/, (route) => route.fulfill({ json: { documents: [], cursor: 0, limit: 1, used: 0 } }));
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  const sidebar = page.getByRole('complementary', { name: 'Diagrams' });
  const hint = sidebar.getByTestId('upgrade-hint');
  await expect(hint).toHaveText('Upgrade to Pro for unlimited diagrams');
  await expect(hint).toHaveAttribute('href', '../pricing/');
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menu').getByTestId('upgrade-hint')).toBeVisible();
});
