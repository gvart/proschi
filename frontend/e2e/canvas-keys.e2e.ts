import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, editorText, expect, test, waitForCanvas } from './fixtures';

// The command bar and the canvas keys are Visual mode's; the last test checks Code mode leaves them alone.
test.use({ mode: 'visual' });

/**
 * The keyboard on the canvas: the command bar (A or Ctrl/Cmd+K) takes plain
 * words and adds a component connected from the selection, or runs an action;
 * Tab walks the components, C adds one after the selection, T changes its
 * type, + and - its replicas.
 */

const SOURCE = `client "Shop" [Browser]
api "Orders API" [REST API]
db "Orders" [PostgreSQL]
client -> api
api -> db
`;

const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });

async function open(page: Page) {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(SOURCE)}`);
  await waitForCanvas(page, 3);
  await expect(page.locator('[data-layout-busy]')).toHaveCount(0);
}

const selected = (page: Page) => page.locator('.react-flow__node.selected');

test.describe('the command bar', () => {
  test('A, "redis" and Enter add a Redis connected from the selected component', async ({ page }) => {
    await open(page);
    await node(page, 'Orders API').click();
    await page.keyboard.press('a');
    const bar = page.getByRole('dialog', { name: 'Command bar' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('connected from Orders API');
    await page.keyboard.type('redis');
    await expect(bar.getByRole('option').first()).toContainText('Add Redis');
    await page.keyboard.press('Enter');
    await expect(bar).toHaveCount(0);
    // Named in place, as a palette click adds it.
    await page.locator('.pc-node__name-field').press('Escape');
    await expect.poll(() => editorText(page)).toMatch(/^redis "Redis" \[Redis\]$/m);
    expect(await editorText(page)).toMatch(/^api -> redis : RESP$/m);
  });

  test('Ctrl/Cmd+K lists the actions; one runs by its words', async ({ page }) => {
    await open(page);
    await node(page, 'Orders API').click();
    await page.keyboard.press('ControlOrMeta+k');
    const bar = page.getByRole('dialog', { name: 'Command bar' });
    await expect(bar.getByRole('option')).toHaveText([/New use case/, /Rename/, /Delete/, /Fit view/, /Switch to Code/]);
    await page.keyboard.type('rename');
    await page.keyboard.press('Enter');
    const field = page.locator('.pc-node__name-field');
    await expect(field).toBeFocused();
    await field.fill('Checkout API');
    await field.press('Enter');
    await expect.poll(() => editorText(page)).toContain('api "Checkout API" [REST API]');

    await page.keyboard.press('a');
    await page.keyboard.type('switch to code');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('radio', { name: 'Code', exact: true })).toBeChecked();
  });

  test('New use case asks its name and opens it in Flows', async ({ page }) => {
    await open(page);
    await canvasNodes(page).first().click();
    await page.keyboard.press('a');
    await page.keyboard.type('new use case');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'New use case' });
    await dialog.getByLabel('Name').fill('Checkout');
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect.poll(() => editorText(page)).toContain('usecase "Checkout" {');
    await expect(page.getByRole('region', { name: 'Flows' })).toBeVisible();
  });
});

test.describe('canvas keys', () => {
  test('Tab and Shift+Tab walk the components in reading order', async ({ page }) => {
    await open(page);
    await node(page, 'Shop').click();
    await expect(selected(page)).toContainText('Shop');
    await page.keyboard.press('Tab');
    await expect(selected(page)).toContainText('Orders API');
    await expect(page.getByRole('region', { name: 'Orders API settings' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(selected(page)).toHaveCount(1);
    await expect(selected(page)).not.toContainText('API');
    await page.keyboard.press('Shift+Tab');
    await expect(selected(page)).toContainText('Orders API');
  });

  test('+ and - change the replicas, T the type, C adds one after the selection', async ({ page }) => {
    await open(page);
    await node(page, 'Orders API').click();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect.poll(() => editorText(page)).toContain('api "Orders API" [REST API] x3');
    await page.keyboard.press('-');
    await expect.poll(() => editorText(page)).toContain('api "Orders API" [REST API] x2');

    await page.keyboard.press('t');
    const search = page.getByRole('combobox', { name: 'Search types' });
    await expect(search).toBeFocused();
    await search.fill('graphql');
    await search.press('Enter');
    await expect.poll(() => editorText(page)).toContain('api "Orders API" [GraphQL] x2');

    // The type picked, the keys are the canvas's again.
    await page.keyboard.press('c');
    const picker = page.getByRole('dialog', { name: /^Add after Orders API/ });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Redis', exact: true }).click();
    await page.locator('.pc-node__name-field').press('Escape');
    await expect.poll(() => editorText(page)).toMatch(/^api -> redis : RESP$/m);
  });

  test('on the practice canvas too: A adds connected from the selection, + raises replicas', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await waitForCanvas(page, 2);
    await node(page, 'Shortener API').click();
    await page.keyboard.press('+');
    await expect.poll(() => editorText(page)).toMatch(/^api "Shortener API" \[REST API\] x2$/m);
    await page.keyboard.press('a');
    await page.keyboard.type('redis');
    await page.keyboard.press('Enter');
    await page.locator('.pc-node__name-field').press('Escape');
    await expect.poll(() => editorText(page)).toMatch(/^api -> redis : RESP$/m);
  });
});

test.describe('in Code mode', () => {
  test.use({ mode: 'code' });

  test('none of the keys edits the view-only diagram', async ({ page }) => {
    await open(page);
    const before = await editorText(page);
    await node(page, 'Orders API').click();
    for (const key of ['a', 'ControlOrMeta+k', 'c', 't', '+', '-', 'r']) await page.keyboard.press(key);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('palette-dock')).toHaveCount(0);
    // Tab leaves the canvas as it would anywhere: it does not walk the components.
    await page.keyboard.press('Tab');
    await expect(selected(page)).toContainText('Orders API');
    expect(await editorText(page)).toBe(before);
  });
});
