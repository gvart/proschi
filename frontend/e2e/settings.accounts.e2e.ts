import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';

/**
 * The settings page (`#/me`, src/practice/profile/AccountRoute.tsx) in the
 * build with accounts and billing, API mocked: the sections in order, the
 * side list that jumps to them and marks the one in view, the phone's
 * "Jump to" menu, and the settings that write (public profile, daily goal,
 * cloud copies, sign-in methods), each destructive one asking first.
 */

const SECTIONS = ['Plan & billing', 'Profile', 'Learning', 'Exports & certificate', 'Notifications', 'Connected accounts', 'Data & privacy', 'Danger zone'];

/** Answers the writes on top of mockSignedIn and records them. */
async function mockWrites(page: Page) {
  const writes: { method: string; path: string; body: unknown }[] = [];
  await page.route(
    (url) => /^\/api\/me(\/documents|\/identities\/[a-z]+)?$/.test(url.pathname),
    (route) => {
      const request = route.request();
      if (request.method() === 'GET') return route.fallback();
      const path = new URL(request.url()).pathname;
      writes.push({ method: request.method(), path, body: request.postDataJSON() as unknown });
      if (request.method() === 'PATCH') return route.fulfill({ json: { user: { ...SIGNED_IN.user, ...(request.postDataJSON() as object) } } });
      return route.fulfill({ status: 204 });
    },
  );
  return writes;
}

test('the sections in order, with a side list that jumps to each and marks the one in view', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('practice/#/me');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2 })).toHaveText(SECTIONS);
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('button')).toHaveText(SECTIONS);
  await expect(nav.getByRole('button', { name: 'Plan & billing' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('settings-jump')).toBeHidden();

  await nav.getByRole('button', { name: 'Data & privacy' }).click();
  const data = page.getByRole('region', { name: 'Data & privacy' });
  await expect(data.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(data.getByRole('heading', { level: 2 })).toBeInViewport();
  await expect(nav.getByRole('button', { name: 'Data & privacy' })).toHaveAttribute('aria-current', 'true');
  // The address stays the page's own: the list scrolls, it doesn't route.
  await expect(page).toHaveURL(/#\/me$/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a "Jump to" menu instead of the side list', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('practice/#/me');
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeHidden();
    const jump = page.getByTestId('settings-jump');
    await expect(jump.locator('summary')).toHaveText('Jump to Plan & billing');
    await jump.locator('summary').click();
    await jump.getByRole('button', { name: 'Danger zone' }).click();
    await expect(jump).not.toHaveAttribute('open');
    await expect(page.getByRole('region', { name: 'Danger zone' }).getByRole('button', { name: 'Delete account' })).toBeInViewport();
    await expect(jump.locator('summary')).toHaveText('Jump to Danger zone');
  });
});

test('profile and learning: the public profile switch, what is visible, and the daily goal', async ({ page }) => {
  await mockSignedIn(page);
  const writes = await mockWrites(page);
  await page.goto('practice/#/me');
  const profile = page.getByRole('region', { name: 'Profile' });
  const visible = profile.getByText(/When on, anyone can see your display name/);
  await expect(visible).toBeHidden();
  await profile.getByText('What’s visible').click();
  await expect(visible).toBeVisible();
  await expect(profile.getByRole('link', { name: 'See your public profile' })).toHaveAttribute('href', `#/u/${SIGNED_IN.user.id}`);
  const toggle = profile.getByRole('switch', { name: 'Show me on the leaderboard, with a public profile' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(profile.getByRole('link', { name: 'See your public profile' })).toHaveCount(0);

  // What you're here for, kept in this browser and sent to the account: a daily habit switches the streak on, and with it the daily goal.
  const learning = page.getByRole('region', { name: 'Learning' });
  const focus = learning.getByRole('group', { name: 'What you’re here for' });
  const streak = learning.getByRole('switch', { name: 'Daily streak' });
  await expect(streak).not.toBeChecked();
  await expect(learning.getByRole('radiogroup', { name: 'Daily goal' })).toHaveCount(0);
  await focus.getByRole('button', { name: 'Prepare for an interview' }).click();
  await expect(focus.getByRole('button', { name: 'Prepare for an interview' })).toHaveAttribute('aria-pressed', 'true');
  await focus.getByRole('button', { name: 'Build a daily habit' }).click();
  await expect(streak).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.practice.goal') ?? 'null'))).toEqual({ goals: ['interview', 'habit'], asked: true });
  const goal = learning.getByRole('radiogroup', { name: 'Daily goal' });
  await expect(goal.getByRole('radio', { name: '10 cards a day' })).toHaveAttribute('aria-checked', 'true');
  await goal.getByRole('radio', { name: '20 cards a day' }).click();
  await expect(goal.getByRole('radio', { name: '20 cards a day' })).toHaveAttribute('aria-checked', 'true');
  expect(writes).toEqual([
    { method: 'PATCH', path: '/api/me', body: { publicProfile: false } },
    { method: 'PATCH', path: '/api/me', body: { practiceGoal: { goals: ['interview'], asked: true } } },
    { method: 'PATCH', path: '/api/me', body: { practiceGoal: { goals: ['interview', 'habit'], asked: true } } },
    { method: 'PATCH', path: '/api/me', body: { dailyGoal: 20 } },
  ]);
});

test("the account's learning goal replaces this browser's on sign-in", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('proschi.practice.goal', JSON.stringify({ goals: ['solve'], asked: true })));
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, practiceGoal: { goals: ['habit'], asked: true } } });
  await page.goto('practice/#/me');
  const learning = page.getByRole('region', { name: 'Learning' });
  await expect(learning.getByRole('switch', { name: 'Daily streak' })).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.practice.goal') ?? 'null'))).toEqual({ goals: ['habit'], asked: true });
});

test('connected accounts list the app and CLI sign-ins with what they may do', async ({ page }) => {
  await mockSignedIn(page);
  await page.route('**/api/me/apps', (route) =>
    route.fulfill({ json: { apps: [{ id: 'f1', scopes: ['profile:read', 'documents:read'], createdAt: 1_790_000_000, refreshedAt: 1_790_000_000, expiresAt: 1_795_000_000 }] } }),
  );
  await page.goto('practice/#/me');
  const accounts = page.getByRole('region', { name: 'Connected accounts' });
  const list = accounts.getByRole('list', { name: 'App sign-ins' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Can read your name and read your synced diagrams.');
});

test('destructive actions ask first: cloud copies, unlinking and deleting the account', async ({ page }) => {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, providers: ['github', 'google'] } });
  const writes = await mockWrites(page);
  await page.goto('practice/#/me');

  const data = page.getByRole('region', { name: 'Data & privacy' });
  await data.getByRole('button', { name: 'Delete my cloud copies' }).click();
  await expect(data.getByRole('alert')).toHaveText(/Delete every diagram saved in your account\?/);
  await data.getByRole('alert').getByRole('button', { name: 'Cancel' }).click();
  await expect(data.getByRole('alert')).toHaveCount(0);
  expect(writes).toEqual([]);
  await data.getByRole('button', { name: 'Delete my cloud copies' }).click();
  await data.getByRole('alert').getByRole('button', { name: 'Delete my cloud copies' }).click();
  await expect(data.getByRole('status')).toContainText('Your cloud copies were deleted');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('proschi.docs.sync') ?? '{}').off)).toBe(true);

  const accounts = page.getByRole('region', { name: 'Connected accounts' });
  await accounts.getByRole('button', { name: 'Unlink Google' }).click();
  await expect(accounts.getByRole('alert')).toHaveText(/Stop signing in with Google\?/);
  await accounts.getByRole('alert').getByRole('button', { name: 'Cancel' }).click();

  const danger = page.getByRole('region', { name: 'Danger zone' });
  await danger.getByRole('button', { name: 'Delete account' }).click();
  await expect(danger.getByRole('alert')).toHaveText(/Delete your account for good\? This cannot be undone\./);
  await danger.getByRole('alert').getByRole('button', { name: 'Cancel' }).click();
  await expect(danger.getByRole('alert')).toHaveCount(0);
  expect(writes).toEqual([{ method: 'DELETE', path: '/api/me/documents', body: null }]);
});
