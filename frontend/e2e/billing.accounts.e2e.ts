import type { Page } from '@playwright/test';
import { mockSignedIn, planAnswer } from './accounts';
import { codeEditor, expect, test } from './fixtures';

/**
 * Plans and credits (backend/src/billing.ts, docs/design/paid-plans.md P26)
 * in the build with accounts and billing (`npm run build:accounts` sets
 * VITE_BILLING=true). The API and Polar's hosted checkout and portal are
 * mocked: Polar's pages are stand-ins on this origin, so no request leaves
 * the machine.
 */

type Plan = Record<string, unknown>;

const FREE_PLAN: Plan = planAnswer('free');
const PRO_PLAN: Plan = planAnswer('pro', { balance: 652, monthly: { allowance: 800, left: 612, resetsAt: Date.parse('2026-12-01T00:00:00Z') }, signup: 40, topup: 0 });
const MAX_PLAN: Plan = { ...planAnswer('max'), subscription: { status: 'active', product: 'pro_yearly', currentPeriodEnd: Date.parse('2027-11-06T00:00:00Z'), cancelAtPeriodEnd: false } };
const MAX_PLAN_NOW: Plan = planAnswer('max');

const USAGE = {
  items: [
    { at: Date.parse('2026-11-06T14:05:00Z'), action: 'verdict', ref: 'iv-2', credits: 31.25, deep: true },
    { at: Date.parse('2026-11-06T13:20:00Z'), action: 'mock_interview', ref: 'iv-2', credits: 41.5, deep: false },
    { at: Date.parse('2026-11-05T09:12:00Z'), action: 'design_partner', ref: 'ps-1', credits: 8.4, deep: false },
    { at: Date.parse('2026-11-05T09:13:00Z'), action: 'next_steps', ref: 'iv-1', credits: 0.6, deep: false },
  ],
};

/** The billing API on top of mockSignedIn, with `plan()` as GET /api/me/plan; returns what was POSTed. */
async function mockBilling(page: Page, plan: () => Plan, usage: unknown = { items: [] }) {
  const posts: { path: string; body: unknown }[] = [];
  await mockSignedIn(page);
  await page.route(/\/api\/credits\/usage/, (route) => route.fulfill({ json: usage }));
  await page.route(/\/api\/(me\/plan|billing\/[a-z-]+)$/, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') return route.fulfill({ json: plan() });
    posts.push({ path, body: request.postDataJSON() as unknown });
    const here = new URL(request.url()).origin;
    if (path.endsWith('/change-plan')) return route.fulfill({ json: { ok: true, plan: 'max', effective: 'now' } });
    if (path.endsWith('/checkout')) return route.fulfill({ json: { url: `${here}/polar/checkout/abc` } });
    return route.fulfill({ json: { url: `${here}/polar/portal/xyz` } });
  });
  // Polar's hosted pages.
  await page.route(/\/polar\/(checkout|portal)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Polar</title><h1>${route.request().url().includes('checkout') ? 'Polar checkout' : 'Polar portal'}</h1>` }),
  );
  return posts;
}

test('pricing: three plans, monthly or yearly, what credits buy, and a checkout per product', async ({ page }) => {
  const posts = await mockBilling(page, () => FREE_PLAN);
  await page.goto('pricing/');
  await expect(page.getByRole('heading', { name: 'Free to design. Credits for the coaching.' })).toBeVisible();
  const pro = page.getByRole('region', { name: 'Pro' });
  const max = page.getByRole('region', { name: 'Max' });
  await expect(page.getByRole('region', { name: 'Free' })).toContainText('100creditsonce, at sign-up');
  await expect(page.getByRole('region', { name: 'Free' })).toContainText('Your plan');
  await expect(pro).toContainText('Recommended');
  await expect(max).toContainText('Most credits');
  await expect(pro).toContainText('800creditsevery month');
  await expect(max).toContainText('2,200creditsevery month');

  await expect(page.getByRole('radio', { name: /Yearly/ })).toHaveAttribute('aria-checked', 'true');
  await expect(pro.getByText('€99', { exact: true })).toBeVisible();
  await expect(pro).toContainText('€8.25 a month, billed yearly, save 31%');
  await expect(max.getByText('€249', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Monthly' }).click();
  await expect(pro.getByText('€12', { exact: true })).toBeVisible();
  await expect(max.getByText('€29', { exact: true })).toBeVisible();

  const costs = page.getByRole('region', { name: 'What credits buy' });
  await expect(costs).toContainText('Mock interview');
  await expect(costs).toContainText('45–60');
  await expect(costs).toContainText('Design partner review');
  await expect(costs).toContainText('5–15');
  await expect(costs).toContainText('20–40');
  await expect(page.getByTestId('pricing-balance')).toHaveText('You have 100 credits.');

  await max.getByRole('button', { name: 'Get Max, €29 a month' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  await page.goBack();
  await page.getByRole('radio', { name: /Yearly/ }).click();
  await page.getByRole('region', { name: 'Pro' }).getByRole('button', { name: 'Get Pro, €99 a year' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  await page.goBack();
  await page.getByRole('region', { name: /Top-up/ }).getByRole('button', { name: 'Buy 1,000 credits, €12' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  expect(posts.map((p) => p.body)).toEqual([{ product: 'max_monthly' }, { product: 'pro_yearly' }, { product: 'credits_1000' }]);
});

test('pricing: on Pro, Max is a switch of the subscription, after a confirm', async ({ page }) => {
  const posts = await mockBilling(page, () => PRO_PLAN);
  await page.goto('pricing/');
  const pro = page.getByRole('region', { name: 'Pro' });
  await expect(pro).toContainText('You are on Pro.');
  await expect(pro.getByRole('button', { name: 'Manage in Polar' })).toBeVisible();
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole('region', { name: 'Max' }).getByRole('button', { name: 'Upgrade to Max, €249 a year' }).click();
  expect(asked).toBe('Switch to Max yearly, €249 a year? Polar charges the difference for the rest of this period.');
  expect(posts).toEqual([]);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('region', { name: 'Max' }).getByRole('button', { name: 'Upgrade to Max, €249 a year' }).click();
  // Back on Settings as from a checkout, waiting for the webhook.
  await expect(page).toHaveURL(/practice\/\?checkout=done&product=max_yearly#\/me$/);
  expect(posts).toEqual([{ path: '/api/billing/change-plan', body: { product: 'max_yearly' } }]);
});

test('pricing: signed out, the buttons sign in first', async ({ page }) => {
  await mockBilling(page, () => FREE_PLAN);
  await page.route(/\/api\/me$/, (route) => route.fulfill({ status: 401, json: { error: 'Not signed in' } }));
  await page.goto('pricing/');
  await expect(page.getByRole('region', { name: 'Pro' }).getByRole('button', { name: 'Sign in with GitHub to get Pro' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Max' }).getByRole('button', { name: 'Sign in with Google to get Max' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Top-up/ }).getByRole('button', { name: 'Sign in with Google to buy' })).toBeVisible();
  await expect(page.getByTestId('credits-chip')).toHaveCount(0);
});

test('header: no credits chip; the account menu says the credits left, links to Plan & billing and warns when low; the plan badge', async ({ page }) => {
  let current = PRO_PLAN;
  await mockBilling(page, () => current);
  await page.goto('pricing/');
  await expect(page.getByTestId('plan-badge')).toHaveText('Pro');
  await expect(page.getByTestId('credits-chip')).toHaveCount(0);
  const account = page.getByRole('button', { name: 'Account' });
  await account.click();
  const credits = page.getByTestId('account-credits');
  await expect(credits).toHaveText(/^652 credits\s*Plan & billing$/);
  await expect(credits).not.toHaveAttribute('data-low');

  current = { ...MAX_PLAN_NOW, credits: { balance: 150, monthly: { allowance: 2200, left: 150, resetsAt: 0 }, signup: 0, topup: 0 } };
  await page.reload();
  await expect(page.getByTestId('plan-badge')).toHaveText('Max');
  await account.click();
  await expect(credits).toContainText('150 credits');
  await expect(credits).toContainText('running low');
  await expect(credits).toHaveAttribute('data-low', 'true');
  await page.getByRole('menuitem', { name: /150 credits/ }).click();
  await expect(page).toHaveURL(/practice\/#\/me$/);
});

test('settings: plan, monthly credits with the reset date, the balances, top-up and the usage list', async ({ page }) => {
  const posts = await mockBilling(page, () => PRO_PLAN, USAGE);
  await page.goto('practice/#/me');
  const billing = page.getByRole('region', { name: 'Plan & billing' });
  await expect(billing).toContainText('Pro yearly, renews on 6 November 2027.');
  await expect(billing.getByRole('meter', { name: 'Monthly credits left' })).toHaveAttribute('aria-valuenow', '612');
  await expect(billing.getByRole('meter', { name: 'Monthly credits left' })).toHaveAttribute('aria-valuemax', '800');
  await expect(billing.getByTestId('credits')).toContainText('This month612 of 800resets on 1 December');
  await expect(billing.getByTestId('credits')).toContainText('Sign-up40of 100, never expire');
  const usage = billing.getByRole('table', { name: 'Credits spent, newest first' });
  await expect(usage.getByRole('row')).toHaveCount(5);
  await expect(usage.getByRole('row').nth(1)).toContainText('VerdictDeep31');
  await expect(usage.getByRole('row').nth(2)).toContainText('Mock interview42');
  await expect(usage.getByRole('row').nth(3)).toContainText('Design partner8.4');
  await expect(usage.getByRole('row').nth(4)).toContainText('Your next steps0.6');

  await billing.getByRole('button', { name: 'Buy 1,000 credits, €12' }).click();
  await expect(page.getByRole('heading', { name: 'Polar checkout' })).toBeVisible();
  expect(posts).toEqual([{ path: '/api/billing/checkout', body: { product: 'credits_1000' } }]);
  await page.goBack();
  await billing.getByRole('button', { name: 'Manage in Polar' }).click();
  await expect(page.getByRole('heading', { name: 'Polar portal' })).toBeVisible();
  expect(posts.at(-1)).toEqual({ path: '/api/billing/portal', body: null });
});

test('settings: on Free, the sign-up credits and the way to the plans; nothing spent yet', async ({ page }) => {
  await mockBilling(page, () => FREE_PLAN);
  await page.goto('practice/#/me');
  const billing = page.getByRole('region', { name: 'Plan & billing' });
  await expect(billing).toContainText('Pro adds 800 credits a month and unlimited diagrams; Max 2,200 and Deep mode.');
  await expect(billing.getByRole('meter', { name: 'Sign-up credits left' })).toHaveAttribute('aria-valuemax', '100');
  await expect(billing.getByRole('meter', { name: 'Diagrams in your account' })).toHaveAttribute('aria-valuemax', '5');
  await expect(billing).toContainText('Nothing spent yet.');
  await expect(billing.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '../pricing/');
  await expect(billing.getByRole('button', { name: 'Manage in Polar' })).toHaveCount(0);
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

// Back from Polar's checkout: the banner while the webhook is on its way (backend/src/billing.ts success_url, src/practice/profile/CheckoutStatus.tsx).

const banner = (page: Page) => page.getByTestId('checkout-return');

test('checkout return: activating, then Pro when the webhook lands after two asks, with the welcome once', async ({ page }) => {
  let current = FREE_PLAN;
  await mockBilling(page, () => current);
  await page.clock.install();
  await page.goto('practice/?checkout=done&product=pro_yearly&checkout_id=chk_2#/me');
  const billing = page.getByRole('region', { name: 'Plan & billing' });
  await expect(banner(page)).toHaveText('Payment received. Activating Pro…');
  await expect(banner(page)).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('plan-badge')).toHaveCount(0);
  // The asks at 1 and 2 s still find the free plan; the webhook lands before the one at 4 s.
  await page.clock.runFor(2500);
  await expect(banner(page)).toHaveText('Payment received. Activating Pro…');
  await expect(page).toHaveURL(/checkout=done&product=pro_yearly/);
  current = PRO_PLAN;
  await page.clock.runFor(2000);
  const welcome = page.getByRole('region', { name: 'Welcome to Pro' });
  await expect(welcome).toContainText("You're on Pro: 800 credits a month, starting now.");
  await expect(welcome).toBeInViewport();
  expect((await welcome.boundingBox())!.y).toBeLessThan((await billing.boundingBox())!.y);
  await expect(welcome.getByRole('link', { name: 'Start a mock interview' })).toHaveAttribute('href', '#/url-shortener?interview=mock');
  await expect(welcome.getByRole('link', { name: 'Ask Design partner' })).toHaveAttribute('href', '../app/');
  await expect(welcome.getByRole('link', { name: 'See your roadmap' })).toHaveAttribute('href', '#/roadmap');
  // The rest of the page and the header read the new plan; the address forgets the checkout.
  await expect(billing).toContainText('Pro yearly, renews on 6 November 2027.');
  await expect(page.getByTestId('plan-badge')).toHaveText('Pro');
  await expect(page).not.toHaveURL(/checkout|product/);
  await welcome.getByRole('button', { name: 'Dismiss the welcome' }).click();
  await expect(welcome).toHaveCount(0);

  // The same checkout again: its welcome was shown, so the banner alone.
  await page.goto('practice/?checkout=done&product=pro_yearly&checkout_id=chk_2#/me');
  await expect(banner(page)).toHaveText("You're on Pro: 800 credits a month, starting now.");
  await expect(page.getByRole('region', { name: 'Welcome to Pro' })).toHaveCount(0);
});

test('checkout return: an upgrade to Max waits for the subscription to change, then welcomes Max', async ({ page }) => {
  let current = PRO_PLAN;
  await mockBilling(page, () => current);
  await page.clock.install();
  await page.goto('practice/?checkout=done&product=max_yearly#/me');
  await expect(banner(page)).toHaveText('Payment received. Activating Max…');
  await page.clock.runFor(1500);
  // Max, but the subscription still has the Pro product: not yet.
  current = MAX_PLAN;
  await page.clock.runFor(1000);
  await expect(banner(page)).toHaveText('Payment received. Activating Max…');
  current = MAX_PLAN_NOW;
  await page.clock.runFor(2000);
  const welcome = page.getByRole('region', { name: 'Welcome to Max' });
  await expect(welcome).toContainText("You're on Max: 2,200 credits a month, Deep mode and printable interview reports.");
  await expect(page.getByTestId('plan-badge')).toHaveText('Max');
});

test('checkout return: slow after a minute without the webhook, and Check again', async ({ page }) => {
  let current = FREE_PLAN;
  await mockBilling(page, () => current);
  await page.clock.install();
  await page.goto('practice/?checkout=done&product=pro_yearly&checkout_id=chk_3#/me');
  await expect(banner(page)).toHaveText('Payment received. Activating Pro…');
  await page.clock.runFor(59_000);
  await expect(banner(page)).toHaveAttribute('data-phase', 'activating');
  await page.clock.runFor(2000);
  await expect(banner(page)).toContainText(
    "Polar hasn't confirmed the payment yet. It usually takes a few seconds; this page updates when it does. If it doesn't within a few minutes, contact support.",
  );
  await expect(banner(page)).toContainText('Checkout reference: chk_3');
  await expect(page).toHaveURL(/checkout=done/);
  current = PRO_PLAN;
  await banner(page).getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('region', { name: 'Welcome to Pro' })).toBeVisible();
});

test('checkout return: a top-up shows the credits added; no parameters, no banner', async ({ page }) => {
  let current = FREE_PLAN;
  await mockBilling(page, () => current);
  await page.clock.install();
  await page.goto('practice/?checkout=done&product=credits_1000&checkout_id=chk_4#/me');
  await expect(banner(page)).toHaveText('Payment received. Adding 1,000 credits…');
  await page.clock.runFor(1500);
  current = { ...FREE_PLAN, customer: true, credits: { balance: 1100, monthly: null, signup: 100, topup: 1000 } };
  await page.clock.runFor(1000);
  const welcome = page.getByRole('region', { name: 'Credits added' });
  await expect(welcome).toContainText('1,000 credits added. They never expire.');
  await expect(page.getByTestId('credits')).toContainText('Top-ups1,000never expire');
  await expect(page.getByTestId('plan-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByTestId('account-credits')).toContainText('1,100 credits');
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/checkout|product/);

  // A reload (the address without the parameters, as after Polar's back button to the pricing page) shows no banner.
  await page.reload();
  await expect(page.getByRole('region', { name: 'Plan & billing' })).toContainText('Credits left');
  await expect(banner(page)).toHaveCount(0);
});
