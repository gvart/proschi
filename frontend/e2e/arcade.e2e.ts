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
  await page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Shortly' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Forecast' })).toContainText('Wave 1');
}

test('a first wave: place by tapping, scale, deploy, watch it run, then draft', async ({ page }) => {
  await startShortly(page);
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

test('the board can be written as Proschi text, and the canvas follows', async ({ page }) => {
  await startShortly(page);
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.cm-content')).toContainText('api "App Server" [Service]');
  await appendCode(page, '\nlb "Load Balancer" [Load Balancer] x2\nusers -> lb\nlb -> api\ncapacity {\n  db size M\n}\n');
  // A locked component is refused with the reason, and the board is left as it was.
  await appendCode(page, 'c [Cache]\n');
  await expect(page.getByText(/Cache is locked/)).toBeVisible();
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
  await shop.getByRole('listitem').filter({ hasText: 'Cache' }).getByRole('button', { name: /5/ }).click();
  await expect(shop.getByRole('listitem').filter({ hasText: 'Cache' })).toContainText('Owned');
  await expect(shop).toContainText('7 Blueprints');
  await shop.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Shortly' }).getByRole('button', { name: 'Play', exact: true }).click();
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
