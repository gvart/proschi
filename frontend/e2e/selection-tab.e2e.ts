import type { Locator, Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, editorText, expect, test, waitForCanvas } from './fixtures';

// The Selection tab is a Visual mode tool.
test.use({ mode: 'visual' });

/**
 * The Selection tab: selecting a node or a connection shows its settings in
 * the rail beside the canvas, never over the diagram; its type is changed with
 * a picker that lists the document's own types first, and a card says what the
 * type is.
 */

const SOURCE = `type OrdersDb extends PostgreSQL {
  doc "The orders and their lines"
  op read listOrders
}

client "Shop" [Browser]
api "Orders API" [REST API]
db "Orders" [PostgreSQL]
client -> api
api -> db
`;

const link = (source: string) => `app/#code=${lz.compressToEncodedURIComponent(source)}`;
const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });

/** Waits until the layout is done and the nodes stop gliding. */
async function settled(page: Page) {
  await expect(page.locator('[data-layout-busy]')).toHaveCount(0);
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())));
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [250] })
    .toBe(true);
}

/** No node lies under the rail, in whole or in part. */
async function expectNothingUnder(page: Page, rail: Locator) {
  const r = (await rail.boundingBox())!;
  const boxes = await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    const overlaps = b.left < r.x + r.width && b.right > r.x && b.top < r.y + r.height && b.bottom > r.y;
    expect(overlaps, `a node at ${JSON.stringify(b)} under the rail at ${JSON.stringify(r)}`).toBe(false);
  }
}

test.describe('the Selection tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('selecting a component opens the Selection tab beside the canvas, over no node; clicking away keeps the rail', async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 3);
    await node(page, 'Orders API').click();
    const rail = page.getByTestId('palette-dock');
    await expect(rail.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
    await expect(rail.getByRole('region', { name: 'Orders API settings' })).toBeVisible();
    await expect(rail).not.toHaveAttribute('data-floating', 'true');
    await settled(page);
    await expectNothingUnder(page, rail);

    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 300 } });
    await expect(rail.getByText('Nothing selected')).toBeVisible();
    // The other tabs are a click away.
    await rail.getByRole('tab', { name: 'Components' }).click();
    await expect(rail.getByRole('region', { name: 'Components' })).toBeVisible();
    // Flows opens its pane under the canvas, and the rail keeps its tab.
    await rail.getByRole('tab', { name: 'Flows' }).click();
    const flows = page.getByRole('region', { name: 'Flows' });
    await expect(flows).toBeVisible();
    await expect(rail.getByRole('region', { name: 'Components' })).toBeVisible();
    expect((await flows.boundingBox())!.y).toBeGreaterThanOrEqual((await page.locator('.react-flow').boundingBox())!.y + 100);
  });

  test('the type picker lists the design’s own types first, and the type card reads the type', async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 3);
    await node(page, 'Orders').filter({ hasNotText: 'API' }).click();
    const settings = page.getByRole('region', { name: 'Orders settings' });
    const card = settings.getByRole('region', { name: 'PostgreSQL type' });
    await expect(card).toContainText('PostgreSQL › Database');
    await expect(card.getByRole('list', { name: 'Reads' })).toContainText('SELECT');
    await expect(card.getByRole('list', { name: 'Writes' })).toContainText('INSERT');

    await settings.getByRole('button', { name: /Change type/ }).click();
    const types = settings.getByRole('listbox', { name: 'Types' });
    const groups = types.getByRole('group');
    await expect(groups.first()).toHaveAccessibleName('In this design');
    await expect(groups.first().getByRole('option')).toHaveText(['OrdersDbThe orders and their lines']);
    await expect(groups.nth(1)).toHaveAccessibleName('Clients');
    await groups.first().getByRole('option', { name: /OrdersDb/ }).click();
    await expect.poll(() => editorText(page)).toContain('db "Orders" [OrdersDb]');

    const own = settings.getByRole('region', { name: 'OrdersDb type' });
    await expect(own).toContainText('OrdersDb › PostgreSQL › Database');
    await expect(own).toContainText('The orders and their lines');
    await expect(own.getByRole('list', { name: 'Reads' }).getByRole('listitem').first()).toHaveText('listOrders');
  });

  test('the type picker searches, and Escape puts it away', async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 3);
    await node(page, 'Orders API').click();
    const settings = page.getByRole('region', { name: 'Orders API settings' });
    await settings.getByRole('button', { name: /Change type/ }).click();
    const search = settings.getByRole('combobox', { name: 'Search types' });
    await search.fill('graphql');
    await search.press('Enter');
    await expect.poll(() => editorText(page)).toContain('api "Orders API" [GraphQL]');
    await expect(settings.getByRole('button', { name: /Type: GraphQL\./ })).toBeVisible();
    await settings.getByRole('button', { name: /Change type/ }).click();
    await settings.getByRole('combobox', { name: 'Search types' }).press('Escape');
    await expect(settings.getByRole('listbox', { name: 'Types' })).toHaveCount(0);
  });

  test('on the practice canvas, selecting opens the Selection tab over no node', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await waitForCanvas(page, 2);
    await settled(page);
    await node(page, 'Shortener API').click();
    const rail = page.getByTestId('palette-dock');
    await expect(rail.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
    await expect(rail.getByRole('region', { name: 'Shortener API settings' })).toBeVisible();
    await settled(page);
    await expectNothingUnder(page, rail);
  });
});

/** A phone has no room for a rail: the same tabs are a sheet under the canvas, which gets shorter instead of covered. */
test.describe('the canvas sheet on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('selecting opens the sheet on Selection, over no node; a tap on the canvas, the tabs and closing work as the rail does', async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 3);
    await settled(page);
    await node(page, 'Orders API').click();
    const sheet = page.getByTestId('palette-dock');
    await expect(sheet).toHaveAttribute('data-sheet', 'true');
    await expect(sheet.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByRole('region', { name: 'Orders API settings' })).toBeVisible();
    await settled(page);
    await expectNothingUnder(page, sheet);

    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await pane.click({ position: { x: box.width - 6, y: box.height / 2 } });
    await expect(sheet.getByText('Nothing selected')).toBeVisible();
    await sheet.getByRole('tab', { name: 'Components' }).click();
    await expect(sheet.getByRole('region', { name: 'Components' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add component' })).toHaveAttribute('aria-expanded', 'true');
    await sheet.getByRole('tab', { name: 'Flows' }).click();
    await expect(sheet.getByRole('region', { name: 'Flows' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Close the flows' }).click();
    await expect(sheet).toHaveCount(0);

    // The toolbar's Flows opens the sheet on its tab, and a palette tap adds and puts the sheet away.
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    await expect(sheet.getByRole('tab', { name: 'Flows' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Add component' }).click();
    await sheet.getByRole('button', { name: 'Redis', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await page.locator('.pc-node__name-field').press('Escape');
    await expect.poll(() => editorText(page)).toMatch(/^redis "Redis" \[Redis\]$/m);
  });

  test('a node selected after a pan is brought back above the sheet', async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 3);
    await settled(page);
    // Drag the diagram down, so the next node sits where the sheet will be.
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.move(pane.x + pane.width - 20, pane.y + 100);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width - 20, pane.y + 300, { steps: 8 });
    await page.mouse.up();
    await node(page, 'Orders API').click();
    const sheet = page.getByTestId('palette-dock');
    await expect(sheet.getByRole('region', { name: 'Orders API settings' })).toBeVisible();
    const top = (await sheet.boundingBox())!.y;
    await expect.poll(async () => {
      const b = (await node(page, 'Orders API').boundingBox())!;
      return b.y >= pane.y && b.y + b.height <= top;
    }).toBe(true);
  });

  test('on the practice canvas, selecting opens the sheet on Selection, over no node', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await page.getByRole('tab', { name: 'Diagram' }).click();
    await waitForCanvas(page, 2);
    await settled(page);
    await node(page, 'Shortener API').click();
    const sheet = page.getByTestId('palette-dock');
    await expect(sheet.getByRole('tab', { name: 'Selection' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet.getByRole('region', { name: 'Shortener API settings' })).toBeVisible();
    await settled(page);
    await expectNothingUnder(page, sheet);
    await sheet.getByRole('tab', { name: 'Flows' }).click();
    await expect(sheet.getByRole('region', { name: 'Flows' })).toBeVisible();
  });
});
