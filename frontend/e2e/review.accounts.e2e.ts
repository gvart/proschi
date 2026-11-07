import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';

/**
 * Design review in the build with accounts and paid plans (API mocked):
 * Pro gets the AI review with the reviews left today, and the automatic
 * review when the day's reviews are used up; the free plan gets the
 * automatic review with a hint that AI review is part of Pro.
 *
 * With REVIEW_SHOTS=<dir>, each test also saves screenshots there, light
 * and dark, desktop and phone.
 */

const SHOTS = process.env.REVIEW_SHOTS;

const AI_REVIEW = {
  summary: 'The cache in front of the database carries the redirects, but the write path has no headroom and one database holds every link.',
  strengths: ['The Redis cache answers most redirects, so the p99 stays under the limit.', 'The API runs two replicas behind the load balancer.'],
  issues: [
    { severity: 'critical', title: 'Redirect fails its availability requirement', detail: 'The single database is on the path of every cache miss: availability is 99.5% against 99.9% required.', nodeId: 'db' },
    { severity: 'major', title: 'The database is 86% busy', detail: 'Writes from Shorten and cache misses from Redirect add up to 860 of its 1000 rps.', nodeId: 'db' },
    { severity: 'minor', title: 'The cache is oversized', detail: 'Three replicas run at 12% each; two would do.' },
  ],
  suggestions: ['Add a read replica to the database.', 'Shard links by short code once writes pass 1000 rps.'],
};

const usage = (used: number) => ({ limit: 20, used, remaining: 20 - used, resetAt: Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000 });

/** The browser logs the 4xx and 5xx answers the page expects as console errors; only those are dropped. */
function allowStatus(errors: string[], status: number) {
  const re = new RegExp(`Failed to load resource: the server responded with a status of ${status}`);
  for (let i = errors.length - 1; i >= 0; i--) if (re.test(errors[i])) errors.splice(i, 1);
}

async function openReview(page: Page) {
  await page.goto('practice/#/url-shortener');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('URL Shortener');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
}

async function shots(page: Page, name: string) {
  if (!SHOTS) return;
  const panel = page.getByTestId('design-review');
  for (const [size, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(viewport);
    if (size === 'phone') {
      // The phone layout shows one pane at a time: back to the tests' Review view, and the review again if the pane forgot it.
      await page.getByRole('tab', { name: 'Tests' }).or(page.getByRole('button', { name: 'Tests', exact: true })).first().click();
      const reviewTab = page.getByRole('button', { name: 'Review', exact: true });
      if (await reviewTab.isVisible()) await reviewTab.click();
      if (!(await panel.getByTestId('review-result').isVisible())) await panel.getByRole('button', { name: 'Review my design' }).click();
      await expect(panel.getByTestId('review-result')).toBeVisible();
    }
    await page.mouse.move(0, 0);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/${name}-${size}-${scheme}.png`, fullPage: size === 'phone' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
}

test('Pro gets the in-depth review, graded on the server, with the reviews left today', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } });
  const sent: unknown[] = [];
  let release!: () => void;
  const answered = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/review/usage', (route) => route.fulfill({ json: usage(3) }));
  await page.route('**/api/review', async (route) => {
    sent.push(route.request().postDataJSON());
    await answered;
    await route.fulfill({ json: { ...AI_REVIEW, usage: usage(4) } });
  });

  await openReview(page);
  const panel = page.getByTestId('design-review');
  await expect(panel.getByText(/An in-depth review: Claude, by Anthropic, reads your design/)).toBeVisible();
  await expect(panel.getByTestId('reviews-left')).toHaveText('17 of 20 in-depth reviews left today');
  await expect(panel.getByTestId('review-upgrade-hint')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Review my design' }).click();
  // Loading: the button waits, and says why it takes a while.
  await expect(panel.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('this can take up to a minute');
  release();

  const result = panel.getByTestId('review-result');
  await expect(result).toHaveAttribute('data-by', 'ai');
  await expect(result.getByText(AI_REVIEW.summary)).toBeVisible();
  await expect(result.getByRole('heading', { name: /^Critical/ })).toBeVisible();
  await expect(result.getByRole('heading', { name: 'Strengths' })).toBeVisible();
  await expect(result.getByText('The in-depth review can be wrong; the tests are the verdict.')).toBeVisible();
  await expect(panel.getByTestId('reviews-left')).toHaveText('16 of 20 in-depth reviews left today');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ problem: { id: 'url-shortener' }, source: expect.any(String) });
  await shots(page, 'ai-review');
});

test('Pro past the day’s in-depth reviews gets the automatic review, with when more come', async ({ page, errors }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } });
  await page.route('**/api/review/usage', (route) => route.fulfill({ json: usage(19) }));
  await page.route('**/api/review', (route) => route.fulfill({ status: 429, json: { error: 'daily_limit', usage: usage(20) } }));
  await openReview(page);
  const panel = page.getByTestId('design-review');
  await expect(panel.getByTestId('reviews-left')).toHaveText('1 of 20 in-depth reviews left today');
  await panel.getByRole('button', { name: 'Review my design' }).click();
  await expect(panel.getByTestId('review-notice')).toContainText('You have used today’s 20 in-depth reviews; more at 12:00 AM. Here is the automatic review meanwhile.');
  await expect(panel.getByTestId('review-result')).toHaveAttribute('data-by', 'rules');
  await expect(panel.getByTestId('reviews-left')).toHaveText('No in-depth reviews left today · more at 12:00 AM');
  allowStatus(errors, 429);
});

test('Pro gets the automatic review when the in-depth review fails', async ({ page, errors }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } });
  await page.route('**/api/review/usage', (route) => route.fulfill({ json: usage(0) }));
  await page.route('**/api/review', (route) => route.fulfill({ status: 502, json: { error: 'review_failed' } }));
  await openReview(page);
  const panel = page.getByTestId('design-review');
  await panel.getByRole('button', { name: 'Review my design' }).click();
  await expect(panel.getByRole('alert')).toContainText('The in-depth review failed (review_failed), so here is the automatic review.');
  await expect(panel.getByTestId('review-result')).toHaveAttribute('data-by', 'rules');
  allowStatus(errors, 502);
});

test('the free plan gets the automatic review, with a hint that the in-depth review is part of Pro', async ({ page }) => {
  await mockSignedIn(page);
  let asked = 0;
  await page.route('**/api/review**', (route) => {
    asked++;
    return route.fulfill({ status: 402, json: { error: 'plan_required' } });
  });
  await openReview(page);
  const panel = page.getByTestId('design-review');
  await expect(panel.getByText('An automatic review, based on the simulation and the tests.')).toBeVisible();
  const hint = panel.getByTestId('review-upgrade-hint');
  await expect(hint).toContainText('The in-depth review is part of Pro');
  await expect(hint.getByRole('link', { name: 'The in-depth review is part of Pro' })).toHaveAttribute('href', '../pricing/');
  await expect(panel.getByTestId('reviews-left')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Review my design' }).click();
  const result = panel.getByTestId('review-result');
  await expect(result).toHaveAttribute('data-by', 'rules');
  await expect(result.getByText('The use case "Redirect" is missing', { exact: true })).toBeVisible();
  expect(asked).toBe(0);
  await shots(page, 'free-fallback');
});
