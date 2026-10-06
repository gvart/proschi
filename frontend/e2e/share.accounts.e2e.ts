import { mockSignedIn, SIGNED_IN } from './accounts';
import { copiedText, expect, mockClipboard, test } from './fixtures';

/**
 * Sharing signed in (API mocked): a new badge's toast can share it, with a
 * link to the public profile, when the profile is public; the account page
 * shares the profile's own address.
 */

const FIRST_SOLVE = {
  id: 'first-solve',
  title: 'First design',
  description: 'Solve your first practice problem.',
  icon: 'trophy',
  rule: { kind: 'solved', min: 1 },
  current: 1,
  target: 1,
  earned: true,
  earnedAt: 1_767_398_400,
  unseen: true,
};

async function withNewBadge(page: Parameters<typeof mockSignedIn>[0], publicProfile: boolean) {
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, publicProfile } });
  // Registered after mockSignedIn's, so these answer first.
  await page.route(/\/api\/me\/achievements(\?|$)/, (route) =>
    route.fulfill({
      json: { achievements: [FIRST_SOLVE], skills: { readiness: 0, topics: [], weakest: [] }, stats: { reviews: 0, mastered: 0, longestStreak: 0, estimateStreak: 0, solved: 1 } },
    }),
  );
  await page.route('**/api/me/achievements/seen', (route) => route.fulfill({ json: { ok: true } }));
}

test('a new badge can be shared with a link to the public profile', async ({ page }) => {
  await mockClipboard(page);
  await withNewBadge(page, true);
  await page.goto('practice/');
  const toast = page.getByRole('status', { name: 'New badge' });
  await expect(toast).toContainText('First design');
  await toast.getByRole('button', { name: 'Share' }).click();
  await expect.poll(() => copiedText(page)).toBe(`I earned the “First design” badge on Proschi\nhttps://proschi.app/u/${SIGNED_IN.user.id}`);
});

test('without a public profile the badge has no share link', async ({ page }) => {
  await withNewBadge(page, false);
  await page.goto('practice/');
  const toast = page.getByRole('status', { name: 'New badge' });
  await expect(toast).toContainText('First design');
  await expect(toast.getByRole('button', { name: 'Share' })).toHaveCount(0);
});

test('the account page shares the public profile’s own address', async ({ page }) => {
  await mockClipboard(page);
  await mockSignedIn(page);
  // The account page shows the challenge streak: none yet.
  await page.route('**/api/challenge/today', (route) =>
    route.fulfill({
      json: { day: new Date().toISOString().slice(0, 10), cardIds: [], endsAt: Math.floor(Date.now() / 1000) + 3600, maxScore: 600, attempt: null, startedAt: null, streak: { current: 0, longest: 0, todayDone: false }, best: null },
    }),
  );
  await page.goto('practice/#/me');
  await page.getByRole('button', { name: 'Share your profile' }).click();
  await expect.poll(() => copiedText(page)).toBe(`My system design practice on Proschi\nhttps://proschi.app/u/${SIGNED_IN.user.id}`);
});
