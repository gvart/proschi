import { GAME_ME, mockSignedIn } from './accounts';
import { expect, test } from './fixtures';

/**
 * Scale or Fail signed in (API mocked): a ranked run is started by the
 * server, which picks the seed and the loadout, and the finished run's
 * actions are sent back to be replayed; the report shows the rank the server
 * answered.
 */

test('a ranked run: the server starts it, and gets the actions to replay at the end', async ({ page }) => {
  await mockSignedIn(page);
  const setup = { scenario: 'shortly', seed: 'e2e-seed', ascension: 0, mode: 'normal', loadout: { unlocked: [], perks: {} } };
  let submitted: { actions: { t: string }[] } | undefined;
  await page.route('**/api/game/runs', (route) => route.fulfill({ json: { runId: 'run-1', setup } }));
  await page.route('**/api/game/runs/run-1/submit', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { score: 1234, outcome: 'churned', waves: 4, cleared: false, blueprints: 6, meta: { ...GAME_ME.meta, blueprints: 6 }, rank: 3, players: 10 } });
  });
  await page.goto('practice/#/arcade');
  await page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true }).click();

  // Keep the start board every wave until the users churn.
  for (let i = 0; i < 12; i++) {
    const deploy = page.getByRole('button', { name: /^Deploy wave/ });
    const over = page.getByRole('heading', { level: 1, name: /churned|runway|Run over/ });
    await expect(deploy.or(over)).toBeVisible();
    if (await over.isVisible()) break;
    await deploy.click();
    await page.getByRole('button', { name: 'Skip' }).click();
    const result = page.getByRole('dialog', { name: /Wave \d/ });
    await expect(result.or(over)).toBeVisible();
    if (await over.isVisible()) break;
    await result.getByRole('button', { name: 'Continue' }).click();
    const skipCard = page.getByRole('dialog', { name: 'Pick a tech card' }).getByRole('button', { name: /Skip/ });
    if (await skipCard.isVisible()) await skipCard.click();
    const noThanks = page.getByRole('dialog', { name: 'A contract is on the table' }).getByRole('button', { name: 'No thanks' });
    if (await noThanks.isVisible()) await noThanks.click();
  }
  await expect(page.getByText('Rank #3 of 10 on this leaderboard.')).toBeVisible();
  expect(submitted?.actions[0].t).toBe('deploy');
  await expect(page.getByRole('link', { name: 'Open your design in the editor' })).toHaveAttribute('href', /^\.\.\/app\/#/);
});
