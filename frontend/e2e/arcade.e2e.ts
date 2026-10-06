import type { Page } from '@playwright/test';
import { appendCode, expect, test } from './fixtures';

/**
 * Scale or Fail, signed out (the build without accounts): the Arcade tab of
 * Interview prep, a first wave planned by tapping (a load balancer placed and
 * wired for you, an app server scaled), deployed and run, its result and the
 * draft, a run that survives a reload, and the shop. On a phone nothing
 * scrolls sideways.
 */

const board = (page: Page) => page.getByRole('group', { name: 'Your architecture' });

async function startShortly(page: Page) {
  await page.goto('practice/#/arcade');
  await expect(page.getByRole('heading', { level: 1, name: 'Scale or Fail' })).toBeVisible();
  const play = page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true });
  await play.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 400);
  await play.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shortly' })).toBeVisible();
  // The run opens at the top, whatever the scenario list was scrolled to.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // Three mutators are on offer; these tests play it straight.
  const mutators = page.getByRole('dialog', { name: "Pick this run's mutator" });
  await expect(mutators.getByRole('listitem')).toHaveCount(3);
  await mutators.getByRole('button', { name: /Play it straight/ }).click();
  await expect(mutators).toBeHidden();
  await expect(page.getByRole('region', { name: 'Forecast' })).toContainText('Wave 1');
}

test('a first wave: place by tapping, scale, deploy, watch it run, then draft', async ({ page }) => {
  await startShortly(page);
  // Kernel briefs the wave; tap to show it all, "Got it" puts it away, and the cat button brings briefings back.
  const brief = page.getByRole('complementary', { name: "Kernel's briefing" });
  await expect(brief).toContainText('Redirect must answer in under 200 ms for 99% of requests.');
  await brief.getByRole('button', { name: 'Got it' }).click();
  await expect(brief).toBeHidden();
  const cat = page.getByRole('button', { name: "Kernel's briefings" });
  await cat.click();
  await expect(cat).toHaveAttribute('aria-pressed', 'false');
  await cat.click();
  await expect(brief).toBeVisible();
  await brief.getByRole('button', { name: 'Got it' }).click();
  // Locked components say what they cost; the starters can be placed.
  await expect(page.getByRole('toolbar', { name: 'Components' }).getByRole('button', { name: /Cache/ })).toBeDisabled();

  await page.getByRole('toolbar', { name: 'Components' }).getByRole('button', { name: 'Load Balancer' }).click();
  await board(page).getByRole('button', { name: /Place it in the edge row/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Load Balancer placed and wired (2 wires)' })).toBeVisible();
  await expect(board(page).getByRole('button', { name: /^Load Balancer, 1 replica/ })).toBeVisible();

  await board(page).getByRole('button', { name: /^App Server/ }).click();
  const inspector = page.getByRole('region', { name: 'App Server settings' });
  await inspector.getByRole('button', { name: 'More replicas' }).click();
  await expect(board(page).getByRole('button', { name: /^App Server, 2 replicas/ })).toBeVisible();

  // A wire that makes no sense is refused with the reason.
  await board(page).getByRole('button', { name: /^Users/ }).click();
  await page.getByRole('region', { name: 'Users settings' }).getByRole('button', { name: 'Wire to…' }).click();
  await board(page).getByRole('button', { name: /^SQL Database/ }).click();
  await expect(page.getByText("Clients don't call data stores directly")).toBeVisible();

  await page.getByRole('button', { name: 'Deploy wave 1' }).click();
  await expect(page.getByRole('status', { name: 'Run status' })).toContainText('tick');
  // The on-call's menu: a rate limit costs a little Trust and one of three attention.
  const oncall = page.getByRole('group', { name: 'On-call' });
  await expect(oncall.getByLabel('On-call attention: 3 left')).toBeVisible();
  await oncall.getByRole('button', { name: /^Rate limit/ }).click();
  await expect(oncall.getByLabel('On-call attention: 2 left')).toBeVisible();
  await expect(oncall.getByRole('button', { name: 'Rate-limited' })).toBeDisabled();
  await page.getByRole('button', { name: 'Skip' }).click();
  const result = page.getByRole('dialog', { name: /Wave 1/ });
  await expect(result).toContainText('Revenue');
  await result.getByRole('button', { name: 'Continue' }).click();
  const draft = page.getByRole('dialog', { name: 'Pick a tech card' });
  await expect(draft.getByRole('listitem')).toHaveCount(3);
  await draft.getByRole('button', { name: /Skip/ }).click();
  await expect(page.getByRole('region', { name: 'Forecast' })).toContainText('Wave 2');

  // The run survives a reload.
  await page.reload();
  await expect(page.getByText('You have a run of Shortly in progress.')).toBeVisible();
  await page.getByRole('button', { name: 'Carry on' }).click();
  await expect(page.getByRole('region', { name: 'Forecast' })).toContainText('Wave 2');
  await expect(board(page).getByRole('button', { name: /^Load Balancer/ })).toBeVisible();
});

test('in Shortly the code pane first watches the board: each change writes its line', async ({ page }) => {
  await startShortly(page);
  await page.getByRole('complementary', { name: "Kernel's briefing" }).getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.getByTestId('code-hint')).toContainText('You can type here from wave 3');
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('toolbar', { name: 'Components' }).getByRole('button', { name: 'Load Balancer' }).click();
  await page.getByRole('tab', { name: 'Board' }).click();
  await board(page).getByRole('button', { name: /Place it in the edge row/ }).click();
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.cm-content')).toContainText('lb "Load Balancer" [Load Balancer]');
  // The Compiled tab shows the whole document the simulation reads.
  await page.getByRole('tab', { name: 'Compiled' }).click();
  await expect(page.locator('.cm-content')).toContainText('usecase "Redirect"');
  await expect(page.locator('.cm-content')).toContainText('requirements {');
});

test('the board can be written as Proschi text, and the canvas follows', async ({ page }) => {
  await page.goto('practice/#/arcade');
  await page.getByRole('listitem').filter({ hasText: 'Pawprint' }).getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.cm-content')).toContainText('api "App Server" [Service]');
  await appendCode(page, '\nlb "Load Balancer" [Load Balancer] x2\nusers -> lb\nlb -> api\ncapacity {\n  db size M\n}\n');
  // A locked component is refused with the reason, and the board is left as it was.
  await appendCode(page, 'c [CDN]\n');
  await expect(page.getByText(/CDN is locked/)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(board(page).getByRole('button', { name: /^Load Balancer, 2 replicas/ })).toBeVisible();
  await expect(board(page).locator('.pc-node__stats').filter({ hasText: /\bM\b/ })).toBeVisible();
});

test('the shop sells unlocks for Blueprints', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('proschi.game.meta', JSON.stringify({ v: 1, blueprints: 12, unlocked: [], perks: {}, equipped: [], scenarios: {}, seen: [], runs: 1 })));
  await page.goto('practice/#/arcade');
  await page.getByRole('button', { name: 'Shop' }).click();
  const shop = page.getByRole('dialog', { name: 'Shop' });
  // Each tab says what it sells, and each item what it does.
  await expect(shop.getByRole('tabpanel')).toContainText('New building blocks for your board');
  const cache = shop.getByRole('listitem').filter({ has: page.getByText('Cache', { exact: true }) });
  await expect(cache).toContainText('cache-aside');
  await cache.getByRole('button', { name: /5/ }).click();
  await expect(cache).toContainText('Owned');
  await expect(shop).toContainText('7 Blueprints');
  await shop.getByRole('tab', { name: 'Perks' }).click();
  await expect(shop.getByRole('tabpanel')).toContainText('Permanent bonuses for every run');
  await expect(shop.getByRole('listitem').filter({ has: page.getByText('Friendly vendor', { exact: true }) })).toContainText('first reroll of every draft is free');
  await shop.getByRole('tab', { name: 'Components' }).click();
  await shop.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true }).click();
  // Take the first mutator on offer: the forecast names it, with this wave's bounties to choose from.
  const mutators = page.getByRole('dialog', { name: "Pick this run's mutator" });
  const first = mutators.getByRole('listitem').first();
  const name = (await first.locator('.font-display').textContent())!;
  await first.getByRole('button').click();
  const forecast = page.getByRole('region', { name: 'Forecast' });
  await expect(forecast).toContainText(name);
  const bounties = forecast.getByRole('group', { name: 'Bounties' });
  await expect(bounties.getByRole('button')).toHaveCount(3);
  await bounties.getByRole('button').first().click();
  await expect(forecast.getByLabel('Bounty')).toContainText(/Bounty: .+ Pays \$\d+ and \d+ points\./);
  await expect(bounties).toBeHidden();
  // The peak is a range: the forecast is an estimate.
  await expect(forecast).toContainText('the real peak lands within ±12%');
  await expect(page.getByRole('complementary', { name: "Kernel's briefing" })).toContainText(`This run's twist is ${name}`);
  await expect(page.getByRole('toolbar', { name: 'Components' }).getByRole('button', { name: 'Cache' })).toBeEnabled();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });

  test('the Arcade and a run fit the screen, with the controls in a thumb dock', async ({ page }) => {
    await startShortly(page);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sideways()).toBeLessThanOrEqual(0);
    // The dock: status, palette and Deploy are on screen without scrolling.
    await expect(page.getByRole('button', { name: 'Deploy wave 1' })).toBeInViewport();
    await expect(page.getByRole('status', { name: 'Run status' })).toBeInViewport();
    await page.getByRole('toolbar', { name: 'Components' }).getByRole('button', { name: 'Load Balancer' }).tap();
    await board(page).getByRole('button', { name: /Place it in the edge row/ }).tap();
    // Tapping a node opens its settings as a sheet, with the node still in view above it.
    await page.getByRole('region', { name: 'Load Balancer settings' }).getByRole('button', { name: 'Close' }).tap();
    await board(page).getByRole('button', { name: /^SQL Database/ }).tap();
    const sheet = page.getByRole('region', { name: 'SQL Database settings' });
    await expect(sheet.getByRole('button', { name: 'More replicas' })).toBeInViewport();
    await expect(board(page).getByRole('button', { name: /^SQL Database/ })).toBeInViewport();
    await sheet.getByRole('button', { name: 'Close' }).tap();
    await page.getByRole('button', { name: 'Deploy wave 1' }).tap();
    await expect(page.getByRole('button', { name: 'Skip' })).toBeInViewport();
    await page.getByRole('button', { name: 'Skip' }).tap();
    await expect(page.getByRole('dialog', { name: /Wave 1/ })).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
  });
});

test('Chaotic Startup: tickets instead of a draft, and a migration one phase a wave', async ({ page }) => {
  await page.goto('practice/#/arcade');
  const card = page.getByRole('listitem').filter({ hasText: 'Pawprint' });
  await expect(card).toContainText('Chaotic Startup');
  await card.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Ticket: Bookings MVP' })).toContainText('Priya');
  // A board that lasts a few waves, written as code.
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(
    'users "Users" [Actor]\nmail "Email provider" [Email Service]\nlb "Load Balancer" [Load Balancer] x2\napi "App Server" [Service] x6\ndb "SQL Database" [Database] x2\nusers -> lb\nlb -> api\napi -> db\napi -> mail\n',
  );
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByRole('group', { name: 'Your architecture' }).getByRole('button', { name: /^App Server, 6 replicas/ })).toBeVisible();
  for (let wave = 1; wave <= 3; wave++) {
    await page.getByRole('button', { name: `Deploy wave ${wave}` }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('dialog', { name: new RegExp(`Wave ${wave}`) }).getByRole('button', { name: 'Continue' }).click();
    // No card draft in the design-first modes: straight to the next ticket.
    await expect(page.getByRole('dialog', { name: 'Pick a tech card' })).toBeHidden();
  }
  await expect(page.getByRole('article', { name: /Ticket: Multi-pet bookings/ })).toBeVisible();
  const changes = page.getByRole('region', { name: 'Changes in flight' });
  await changes.getByRole('button', { name: 'Next: Expand' }).click();
  await expect(changes.getByRole('list', { name: /Expand$/ })).toBeVisible();
  await expect(changes.getByRole('button', { name: 'Roll back' })).toBeDisabled();
});

test('On-call: name the root cause before deploying, and see why each answer is right or wrong', async ({ page }) => {
  await page.goto('practice/#/arcade');
  await page.getByRole('listitem').filter({ hasText: 'Dinnerbell' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('article', { name: /Ticket: PAGE: menus timing out/ })).toContainText('requests/s 1 310 -> 2 640');
  await expect(page.getByRole('button', { name: 'Deploy wave 1' })).toBeDisabled();
  const diagnosis = page.getByRole('region', { name: 'Diagnosis' });
  await diagnosis.getByLabel('Twice the usual traffic, and the app servers are full').check();
  await diagnosis.getByRole('button', { name: 'Commit to this cause' }).click();
  await expect(diagnosis).toContainText('Right: now fix it on the board.');
  await expect(diagnosis).toContainText('Rolling back would cost time');
  await expect(page.getByRole('button', { name: 'Deploy wave 1' })).toBeEnabled();
});
