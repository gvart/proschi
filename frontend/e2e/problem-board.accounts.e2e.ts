import { mockSignedIn } from './accounts';
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

  const section = page.getByRole('region', { name: 'Leaderboard' });
  await expect(section).toBeVisible();
  await expect(page.getByText('Solved by 12 of 20 who tried')).toBeVisible();
  const rows = section.getByRole('list', { name: 'Cheapest passing designs' }).getByRole('link');
  await expect(rows).toHaveCount(2);
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
