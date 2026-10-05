import type { APIRequestContext, Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';
import { PROFILE } from './profile';

/**
 * The daily challenge signed in (the build with accounts, API mocked): it is
 * the interview prep hub's Challenge tab, its leaderboard's rows open the
 * players' public profiles, and the account page and a public profile show
 * the challenge streak and best score. On a phone none of these pages
 * scrolls sideways.
 */

/** A public profile with daily challenge stats, as GET /api/users/<id>/profile answers it. */
const CHALLENGER = { ...PROFILE, challenge: { current: 3, longest: 8, best: 560 } };

/** Five cards the page knows (any will do: the API names the day's cards). */
async function someCardIds(request: APIRequestContext): Promise<string[]> {
  const bundle = (await (await request.get('practice/cards.json')).json()) as { cards: { id: string; type: string; retired?: boolean }[] };
  return bundle.cards.filter((c) => !c.retired && ['choice', 'estimate', 'cloze'].includes(c.type)).slice(0, 5).map((c) => c.id);
}

/** Signed in, with today's challenge not played yet, a leaderboard of two who opted in, and CHALLENGER's profile. */
async function mockChallenge(page: Page, request: APIRequestContext): Promise<void> {
  const cardIds = await someCardIds(request);
  const day = new Date().toISOString().slice(0, 10);
  await mockSignedIn(page);
  // Registered after mockSignedIn, so these answer first.
  await page.route('**/api/challenge/today', (route) =>
    route.fulfill({
      json: { day, cardIds, endsAt: Math.floor(Date.now() / 1000) + 3600, maxScore: 600, attempt: null, startedAt: null, streak: { current: 2, longest: 5, todayDone: false }, best: 540 },
    }),
  );
  await page.route('**/api/challenge/leaderboard?*', (route) =>
    route.fulfill({
      json: {
        day,
        players: 7,
        maxScore: 600,
        entries: [
          { rank: 1, id: CHALLENGER.id, displayName: CHALLENGER.displayName, score: 560, correct: 5 },
          { rank: 3, id: 'c3d4e5f6-0000-4000-8000-000000000000', displayName: 'A rather long display name that has to truncate', score: 340, correct: 3 },
        ],
        you: null,
      },
    }),
  );
  await page.route(`**/api/users/${CHALLENGER.id}/profile`, (route) => route.fulfill({ json: CHALLENGER, headers: { 'Cache-Control': 'no-store' } }));
}

const prepNav = (page: Page) => page.getByRole('navigation', { name: 'Interview prep' });

async function expectNoSideways(page: Page, where: string): Promise<void> {
  const { scrollWidth, width } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
  expect(scrollWidth, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(width);
}

test('the challenge is the hub’s Challenge tab, and its leaderboard links to public profiles', async ({ page, request }) => {
  await mockChallenge(page, request);
  // Not on the problem list: the list links to interview prep only.
  await page.goto('practice/');
  await expect(page.getByRole('main').getByRole('link', { name: 'Play today’s challenge' })).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: /Interview prep/ }).click();
  await prepNav(page).getByRole('link', { name: 'Challenge' }).click();
  await expect(page).toHaveURL(/#\/challenge$/);
  await expect(prepNav(page).getByRole('link', { name: 'Challenge' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Daily challenge' })).toBeVisible();

  const board = page.getByRole('region', { name: 'Today’s leaderboard' });
  const rows = board.getByRole('link');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute('href', `#/u/${CHALLENGER.id}`);
  await expect(rows.first()).toHaveAccessibleName(`${CHALLENGER.displayName}: rank 1, 560 points, 5 of 5 right. See their profile`);
  await rows.first().click();
  await expect(page).toHaveURL(new RegExp(`#/u/${CHALLENGER.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: CHALLENGER.displayName })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: /^Challenge streak$/ })).toHaveCount(1);
  await expect(page.getByTestId('profile-challenge-best')).toHaveText('560/ 600');
  await expect(page.getByText('Longest 8 days')).toBeVisible();
});

test('the account page shows your challenge streak and best score', async ({ page, request }) => {
  await mockChallenge(page, request);
  await page.goto('practice/#/me');
  await expect(page.getByRole('heading', { level: 1, name: SIGNED_IN.user.displayName })).toBeVisible();
  await expect(page.getByTestId('profile-challenge-best')).toHaveText('540/ 600');
  await expect(page.getByText('Longest 5 days')).toBeVisible();
});

for (const width of [320, 360]) {
  test.describe(`signed in at ${width}px`, () => {
    test.use({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });

    test('the hub’s tabs, the challenge, the Arcade, the account page and a public profile fit the screen', async ({ page, request }) => {
      await mockChallenge(page, request);
      for (const path of ['practice/#/roadmap', 'practice/#/review', 'practice/#/challenge', 'practice/#/arcade', 'practice/#/progress', 'practice/#/me', `practice/#/u/${CHALLENGER.id}`]) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        if (path.endsWith('challenge')) await expect(page.getByRole('region', { name: 'Today’s leaderboard' }).getByRole('link')).toHaveCount(2);
        if (path.includes('#/u/') || path.endsWith('#/me')) await expect(page.getByTestId('profile-challenge-best')).toBeVisible();
        await expectNoSideways(page, path);
      }
      // Every tab of the hub can be reached in its strip (it scrolls sideways inside itself, never the page).
      await page.goto('practice/#/progress');
      const tabs = prepNav(page).getByRole('link');
      await expect(tabs).toHaveText(['Roadmap', 'Daily review', 'Challenge', 'Arcade', 'Progress']);
      for (const tab of await tabs.all()) {
        await tab.scrollIntoViewIfNeeded();
        await expect(tab).toBeInViewport();
      }
      await expectNoSideways(page, 'the hub’s tabs');
    });
  });
}
