import type { Page } from '@playwright/test';
import { GAME_ME, mockSignedIn } from './accounts';
import { copiedText, expect, mockClipboard, test } from './fixtures';

/**
 * Scale or Fail signed in (API mocked): a ranked run is started by the
 * server, which picks the seed and the loadout, and the finished run's
 * actions are sent back to be replayed; the report shows the rank the server
 * answered. A finished daily run can be shared, a square per wave.
 */

/** Keeps the start board every wave until the users churn. */
async function playUntilOver(page: Page) {
  const over = page.getByRole('heading', { level: 1, name: /churned|runway|Run over/ });
  for (let i = 0; i < 12; i++) {
    const deploy = page.getByRole('button', { name: /^Deploy wave/ });
    await expect(deploy.or(over)).toBeVisible();
    if (await over.isVisible()) break;
    await deploy.click();
    await page.getByRole('button', { name: 'Skip' }).click();
    const result = page.getByRole('dialog', { name: /Wave \d/ });
    await expect(result.or(over)).toBeVisible();
    if (await over.isVisible()) break;
    await result.getByRole('button', { name: 'Continue' }).click();
    const skipCard = page.getByRole('dialog', { name: 'Pick a tech card' }).getByRole('button', { name: /^Skip \(/ });
    if (await skipCard.isVisible()) await skipCard.click();
    const noThanks = page.getByRole('dialog', { name: 'A contract is on the table' }).getByRole('button', { name: 'No thanks' });
    if (await noThanks.isVisible()) await noThanks.click();
  }
  await expect(over).toBeVisible();
}

test('a ranked run: the server starts it, and gets the actions to replay at the end', async ({ page }) => {
  await mockSignedIn(page);
  // The server decides the rules from the stored progress: this player has the twists.
  const setup = { scenario: 'shortly', seed: 'e2e-seed', ascension: 0, mode: 'normal', loadout: { unlocked: [], perks: {} }, twists: true };
  let submitted: { actions: { t: string }[]; day?: string } | undefined;
  await page.route('**/api/game/runs', (route) => route.fulfill({ json: { runId: 'run-1', setup } }));
  await page.route('**/api/game/runs/run-1/submit', (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { score: 1234, outcome: 'churned', waves: 4, cleared: false, blueprints: 6, meta: { ...GAME_ME.meta, blueprints: 6 }, rank: 3, players: 10 } });
  });
  await page.goto('practice/#/arcade');
  await page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('dialog', { name: 'New: the twists' }).getByRole('button', { name: /Let.s go/ }).click();
  // Take a mutator: the pick is the run's first action, replayed by the Worker like the rest.
  await page.getByRole('dialog', { name: "Pick this run's mutator" }).getByRole('listitem').first().getByRole('button').click();

  await playUntilOver(page);
  await expect(page.getByText('Rank #3 of 10 on this leaderboard.')).toBeVisible();
  expect(submitted?.actions[0]).toEqual({ t: 'mutator', pick: 0 });
  expect(submitted?.actions[1].t).toBe('deploy');
  // With the local date: a finished run meets the daily goal and keeps the streak.
  expect(submitted?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole('link', { name: 'Open your design in the editor' })).toHaveAttribute('href', /^\.\.\/app\/#/);
  // Only a daily run is shared.
  await expect(page.getByRole('region', { name: 'Share your daily run' })).toBeHidden();
});

test('a daily run: opened from a shared link, then shared with a square per wave and dared to a friend', async ({ page }) => {
  await mockSignedIn(page);
  await mockClipboard(page);
  const setup = { scenario: 'shortly', seed: 'e2e-daily', ascension: 0, mode: 'daily', loadout: { unlocked: [], perks: {} } };
  await page.route('**/api/game/runs', (route) => route.fulfill({ json: { runId: 'run-d', setup } }));
  await page.route('**/api/game/runs/run-d/submit', (route) =>
    route.fulfill({ json: { score: 1234, outcome: 'churned', waves: 4, cleared: false, blueprints: 6, meta: { ...GAME_ME.meta, blueprints: 6 }, rank: 7, players: 40 } }),
  );
  // The link a shared run carries opens on today's daily run.
  await page.goto('practice/#/arcade/daily');
  const daily = page.getByRole('region', { name: 'Today’s daily run' });
  await expect(daily).toBeFocused();
  await daily.getByRole('button', { name: 'Play today’s run' }).click();
  // The daily run always has the twists, so a first daily opens with Kernel's intro to them.
  await page.getByRole('dialog', { name: 'New: the twists' }).getByRole('button', { name: /Let.s go/ }).click();
  await page.getByRole('dialog', { name: "Pick this run's mutator" }).getByRole('button', { name: /Play it straight/ }).click();

  await playUntilOver(page);
  const share = page.getByRole('region', { name: 'Share your daily run' });
  await expect(share).toContainText(`Proschi Scale or Fail · daily ${GAME_ME.daily.day}`);
  await expect(share).toContainText('#7 today');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(share.getByRole('status').first()).toHaveText('Copied to the clipboard.');
  const text = await copiedText(page);
  const [title, marks, score, link] = text.split('\n');
  expect(title).toBe(`Proschi Scale or Fail · daily ${GAME_ME.daily.day}`);
  expect(marks).toMatch(/^(🟩|🟨|🟥)+$/u);
  expect(marks).toContain('🟥');
  expect(score).toMatch(/^Score [\d,]+ · #7 today$/);
  expect(link).toBe('https://proschi.app/practice/#/arcade/daily');

  await share.getByRole('button', { name: 'Beat my score' }).click();
  await expect.poll(() => copiedText(page)).toMatch(/^Beat my score: [\d,]+ in today’s Proschi Scale or Fail daily run\. https:\/\/proschi\.app\/practice\/#\/arcade\/daily$/);
});
