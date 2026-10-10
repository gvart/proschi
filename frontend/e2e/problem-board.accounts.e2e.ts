import { mockSignedIn, SIGNED_IN } from './accounts';
import { codeEditor, expect, test, waitForCanvas } from './fixtures';

/**
 * A problem's leaderboards signed in (API mocked): after a run, under how
 * others did, the cheapest and the lowest-p99 passing designs of those who
 * opted in, each linking to a profile, and your own rank.
 */

const board = (metric: string) => ({
  problem: 'url-shortener',
  metric,
  players: 12,
  entries:
    metric === 'cost'
      ? [
          { rank: 1, id: 'u-ada', displayName: 'ada', value: 1840, at: 1_790_000_000 },
          { rank: 3, id: 'u-grace', displayName: 'grace', value: 2210, at: 1_790_000_100 },
          { rank: 4, id: 'u-linus', displayName: 'linus', value: 2400, at: 1_790_000_200 },
        ]
      : [{ rank: 1, id: 'u-grace', displayName: 'grace', value: 21.5, at: 1_790_000_100 }],
  you: metric === 'cost' ? { rank: 5, value: 2500, players: 12 } : { rank: 2, value: 24, players: 12 },
});

test('a problem shows its cheapest and fastest boards after a run, with your rank', async ({ page }) => {
  await mockSignedIn(page);
  const asked: string[] = [];
  await page.route('**/api/problems/url-shortener/runs', (route) => route.fulfill({ json: { progress: { status: 'attempted', runs: 1 } } }));
  await page.route('**/api/problems/url-shortener/leaderboard?*', (route) => {
    const metric = new URL(route.request().url()).searchParams.get('metric') ?? 'cost';
    asked.push(metric);
    return route.fulfill({ json: board(metric) });
  });
  await page.route('**/api/stats/url-shortener', (route) =>
    route.fulfill({ json: { attempted: 20, solved: 12, medianRunsToSolve: 3, costUsd: null, p99Ms: null, you: null } }),
  );

  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page);
  // Nothing about others before a run.
  await expect(page.getByRole('region', { name: 'Leaderboard' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Run tests' }).click();
  // While tests fail, how others did is folded under the results.
  await page.getByText('How others did').click();

  const section = page.getByRole('region', { name: 'Leaderboard' });
  await expect(section).toBeVisible();
  await expect(page.getByText('Solved by 12 of 20 who tried')).toBeVisible();
  const rows = section.getByRole('list', { name: 'Cheapest passing designs' }).getByRole('link');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAccessibleName('ada: rank 1, $1,840/month. See their profile');
  await expect(rows.first()).toHaveAttribute('href', '#/u/u-ada');
  await expect(rows.nth(1)).toContainText('3');
  await expect(section.getByTestId('problem-board-you')).toHaveText('You: rank 5 of 12, $2,500/month');

  await section.getByRole('button', { name: 'Lowest p99' }).click();
  await expect(section.getByRole('button', { name: 'Lowest p99' })).toHaveAttribute('aria-pressed', 'true');
  const fast = section.getByRole('list', { name: 'Lowest p99 passing designs' }).getByRole('link');
  await expect(fast).toHaveCount(1);
  await expect(fast.first()).toHaveAccessibleName('grace: rank 1, 21.5 ms. See their profile');
  await expect(section.getByTestId('problem-board-you')).toHaveText('You: rank 2 of 12, 24 ms');
  expect(asked).toContain('cost');
  expect(asked).toContain('p99');
  await expect(fast.first()).toHaveAttribute('href', '#/u/u-grace');
});

test('a board with fewer than three entries is only an invitation to opt in', async ({ page }) => {
  const user = { ...SIGNED_IN.user, publicProfile: false };
  await mockSignedIn(page, { ...SIGNED_IN, user });
  const updates: unknown[] = [];
  await page.route('**/api/me', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    updates.push(route.request().postDataJSON());
    return route.fulfill({ json: { user: { ...user, publicProfile: true } } });
  });
  await page.route('**/api/problems/url-shortener/runs', (route) => route.fulfill({ json: { progress: { status: 'attempted', runs: 1 } } }));
  await page.route('**/api/problems/url-shortener/leaderboard?*', (route) => route.fulfill({ json: { ...board('p99'), metric: 'cost' } }));
  await page.route('**/api/stats/url-shortener', (route) =>
    route.fulfill({ json: { attempted: 2, solved: 1, medianRunsToSolve: 3, costUsd: null, p99Ms: null, you: null } }),
  );

  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Run tests' }).click();
  await page.getByText('How others did').click();
  await expect(page.getByText('Solved by 1 of 2 who tried')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Leaderboard' })).toHaveCount(0);
  await page.getByRole('button', { name: 'opt in to the leaderboard' }).click();
  await expect.poll(() => updates).toContainEqual({ publicProfile: true });
  await expect(page.getByRole('button', { name: 'opt in to the leaderboard' })).toHaveCount(0);
});

test('a first solve offers the leaderboard and email reminders right there', async ({ page }) => {
  const user = { ...SIGNED_IN.user, publicProfile: false };
  await mockSignedIn(page, { ...SIGNED_IN, user });
  await page.route('**/api/problems/url-shortener/runs', (route) => route.fulfill({ json: { progress: { status: 'solved', runs: 1, runsToSolve: 1 }, verdict: { solved: true } } }));

  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Show reference solution' }).click();
  await page.getByRole('button', { name: 'Load into the editor' }).click();
  await page.getByRole('button', { name: 'Run tests' }).click();

  const celebration = page.getByRole('region', { name: 'First solve' });
  await expect(celebration.getByRole('switch', { name: 'Show me on the leaderboard, with a public profile' })).not.toBeChecked();
  await celebration.getByText('Keep your streak: remind me when cards are due').click();
  await expect(celebration.getByRole('button', { name: 'Send confirmation link' })).toBeVisible();
  // Offered once a page: not again under the boards.
  await expect(page.getByRole('button', { name: 'opt in to the leaderboard' })).toHaveCount(0);
});
