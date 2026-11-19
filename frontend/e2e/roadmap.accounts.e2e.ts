import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The roadmap signed out, in the build with accounts (API mocked): the first
 * stage is open, with progress in this browser, and signing in is offered as
 * optional; the stages after it wait for a sign-in.
 */

async function mockSignedOut(page: Page): Promise<void> {
  const answers: [RegExp, number, unknown][] = [
    [/^\/api\/me$/, 401, { error: 'signed out' }],
    [/^\/auth\/providers$/, 200, { providers: ['github'] }],
    [/^\/api\/stats$/, 200, { problems: {}, solvers: 0 }],
    [/^\/api\/stats\/[^/]+$/, 200, { attempted: 0, solved: 0, medianRunsToSolve: null, costUsd: null, p99Ms: null, you: null }],
    [/^\/api\/leaderboard$/, 200, { problems: 0, entries: [] }],
  ];
  await page.route(
    (url) => /^\/(api|auth)\//.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      const answer = route.request().method() === 'GET' ? answers.find(([path]) => path.test(pathname)) : undefined;
      return answer ? route.fulfill({ status: answer[1], json: answer[2] }) : route.fulfill({ status: 404, json: { error: `not mocked: ${pathname}` } });
    },
  );
}

test('signed out, the first stage opens and sign-in is optional', async ({ page, errors }) => {
  await mockSignedOut(page);
  await page.goto('practice/#/roadmap');

  // Within the first stage, signing in is a quiet line in "Up next", not its one action.
  const keep = page.getByTestId('up-next').getByTestId('keep-progress');
  await expect(keep).toContainText('Stage 1 is open without an account');
  await expect(keep.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your progress', exact: true })).toContainText(/0 of \d+ solved/);

  // Stage 1's first problem opens; the next stage's are locked behind a sign-in.
  const stage1 = page.getByRole('listitem', { name: /^Stage 1:/ });
  const first = stage1.getByRole('link').first();
  await expect(first).toBeVisible();
  const stage2 = page.getByRole('listitem', { name: /^Stage 2:/ });
  await expect(stage2).toContainText('Unlocks when you sign in');
  await stage2.getByRole('button').first().click();
  await expect(stage2).toContainText('Sign in to open this stage');
  // Only their lessons open: reading is never gated.
  await expect(stage2.getByRole('link', { name: /^(?!Read the lesson)/ })).toHaveCount(0);
  await expect(stage2.getByRole('img', { name: 'Locked' }).first()).toBeVisible();

  await page.getByRole('link', { name: /^or skip to / }).click();
  await expect(page).toHaveURL(/#\/roadmap\/[a-z0-9-]+$/);
  await expect(page.getByRole('region', { name: 'Roadmap' })).toContainText('Stage 1 of');

  // Signed out, GET /api/me answers 401, which Chromium logs as a failed resource load.
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1);
});

test('signed out with the first stage done, the one thing up next is to sign in', async ({ page, errors }) => {
  await mockSignedOut(page);
  await page.addInitScript(() =>
    localStorage.setItem('proschi.practice', JSON.stringify(Object.fromEntries(['url-shortener', 'pastebin', 'shopping-cart', 'snowflake-ids'].map((id) => [id, { status: 'solved' }])))),
  );
  await page.goto('practice/#/roadmap');
  const upNext = page.getByTestId('up-next');
  await expect(upNext.getByTestId('up-next-title')).toHaveText('Sign in to continue with Caching and the edge');
  await expect(upNext.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
  await expect(upNext.getByTestId('keep-progress')).toHaveCount(0);
  // Nothing suggests a problem the roadmap keeps locked.
  await expect(upNext.getByRole('link', { name: /Rate Limiter|Load Shedding/ })).toHaveCount(0);
  for (let i = errors.length - 1; i >= 0; i--) if (/status of 401/.test(errors[i])) errors.splice(i, 1);
});
