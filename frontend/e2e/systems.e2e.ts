import type { Page } from '@playwright/test';
import { droneOrgSource } from '../src/playground/droneStartup';
import { canvasNodes, codeEditor, editorText, expect, test } from './fixtures';
import { droneLink } from './drone';

/** A system box on the canvas, by its name. */
const box = (page: Page, name: string) => page.locator('.react-flow__node-systemNode', { hasText: name });
const status = (page: Page, name: string) => box(page, name).locator('.pc-system__pill');
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' });

/** Waits until the boxes have glided into their layout, so a pointer lands where it aims. */
async function layoutSettled(page: Page) {
  const positions = () => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).style.transform).join('|'));
  let last = '';
  await expect
    .poll(async () => {
      const now = await positions();
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [300] })
    .toBe(true);
}

test.describe('team systems in the editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(droneLink(100));
    await expect(codeEditor(page)).toBeVisible();
    await expect(box(page, 'Order Processing')).toBeVisible();
    await layoutSettled(page);
  });

  test('a collapsed box shows its team, promise, load and OK status', async ({ page }) => {
    const orders = box(page, 'Order Processing');
    await expect(orders).toContainText('@Orders');
    await expect(orders).toContainText('p99 < 150 ms · ≥ 99.9%');
    await expect(orders).toContainText(/100 \/ 1\.2k rps/);
    await expect(orders.getByRole('list', { name: 'Entry points' })).toHaveText('api');
    await expect(status(page, 'Order Processing')).toHaveText('OK');
    await expect(box(page, 'Payments')).toContainText('Declared, no design linked');
    await expect(page.locator('.pc-system[data-status="over"]')).toHaveCount(0);
  });

  test('more traffic through the frontend turns Orders red, with who to ask', async ({ page }) => {
    await codeEditor(page).click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(droneOrgSource(2000));
    await expect.poll(() => editorText(page)).toContain('"Buy drone" 2000 rps');

    await expect(status(page, 'Order Processing')).toHaveText('Saturated');
    await expect(box(page, 'Order Processing').locator('.pc-system')).toHaveAttribute('data-status', 'over');
    await expect(box(page, 'Order Processing')).toContainText(/2k \/ 1\.2k rps/);
    // The other teams still hold.
    await expect(status(page, 'Frontend')).toHaveText('OK');

    // The findings and the hint, on hover or focus of the status.
    await layoutSettled(page);
    await status(page, 'Order Processing').focus();
    const tip = box(page, 'Order Processing').getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText(/Saturated · db at \d+%/);
    await expect(tip).toContainText('You send 2k rps');
    await expect(tip).toContainText(/Takes at most 1\.2k rps before db saturates/);
    await expect(tip).toContainText('ask the Orders team to add capacity for it (their bottleneck is db)');
    // Beside the box, so the Frontend box above stays clear.
    const tipBox = (await tip.boundingBox())!;
    const ordersBox = (await box(page, 'Order Processing').boundingBox())!;
    const frontendBox = (await box(page, 'Frontend').boundingBox())!;
    expect(tipBox.x).toBeGreaterThanOrEqual(ordersBox.x + ordersBox.width);
    expect(tipBox.y + tipBox.height <= frontendBox.y || tipBox.y >= frontendBox.y + frontendBox.height || tipBox.x >= frontendBox.x + frontendBox.width).toBe(true);
    // The entry point chip stays whole beside the buttons on a red box.
    const chip = (await box(page, 'Order Processing').getByRole('list', { name: 'Entry points' }).getByText('api').boundingBox())!;
    const open = (await box(page, 'Order Processing').getByRole('button', { name: 'Open Order Processing' }).boundingBox())!;
    expect(chip.height).toBeGreaterThan(10);
    expect(chip.x + chip.width).toBeLessThanOrEqual(open.x);
    expect(chip.y + chip.height).toBeLessThanOrEqual(ordersBox.y + ordersBox.height);

    // Results list the system too.
    await page.getByRole('tab', { name: /Results/ }).click();
    const systems = page.getByRole('region', { name: 'Systems' });
    await expect(systems.getByRole('row', { name: /Order Processing/ })).toContainText('Saturated');
    await expect(systems.getByRole('row', { name: /Payments/ })).toContainText('declared, no design linked');
  });

  test('double-click opens a team design, and the breadcrumb goes back', async ({ page }) => {
    const before = await editorText(page);
    page.on('dialog', (dialog) => {
      throw new Error(`Unexpected dialog: ${dialog.message()}`);
    });
    await box(page, 'Order Processing').dblclick();
    await expect(breadcrumb(page)).toContainText('Drone startup');
    await expect(breadcrumb(page).locator('[aria-current="page"]')).toHaveText('Order Processing');
    await expect(page.locator('.react-flow__node', { hasText: 'Orders DB' })).toBeVisible();
    // The design is shown under its own traffic plus what the org sends.
    await expect(breadcrumb(page)).toContainText('incl. 100 rps from Drone startup');
    await expect(box(page, 'Frontend')).toHaveCount(0);
    // Its use cases are the team's own.
    await expect(page.getByRole('combobox').first()).toContainText('Place order');

    await breadcrumb(page).getByRole('button', { name: 'Drone startup', exact: true }).click();
    await expect(breadcrumb(page)).toBeHidden();
    await expect(box(page, 'Frontend')).toBeVisible();
    // Navigating is a view: the text is untouched.
    expect(await editorText(page)).toBe(before);

    // The Open button works from the keyboard too.
    await box(page, 'Warehouse').getByRole('button', { name: 'Open Warehouse' }).focus();
    await page.keyboard.press('Enter');
    await expect(breadcrumb(page).locator('[aria-current="page"]')).toHaveText('Warehouse');
    await breadcrumb(page).getByRole('button', { name: 'Back to Drone startup' }).click();
    await expect(box(page, 'Warehouse')).toBeVisible();
  });

  test('a box expands in place and collapses again', async ({ page }) => {
    const before = await editorText(page);
    await box(page, 'Order Processing').getByRole('button', { name: 'Expand Order Processing', exact: true }).click();
    const frame = page.locator('.react-flow__node-groupNode', { hasText: 'Order Processing' });
    await expect(frame).toBeVisible();
    await expect(page.locator('.react-flow__node', { hasText: 'Orders DB' })).toBeVisible();
    await expect(frame.locator('.pc-system__pill')).toHaveText('OK');
    // With the load overlay on, its members show their load like any node.
    await page.getByRole('button', { name: 'Overlay: load' }).click();
    await expect(page.locator('.react-flow__node', { hasText: 'Orders DB' }).locator('.pc-node[data-load]')).toBeVisible();
    await expect(page.locator('.react-flow__node', { hasText: 'Orders DB' })).toContainText(/\d+%/);
    await page.getByRole('button', { name: 'Overlay: load' }).click();
    // A long use case name does not widen the picker; its full name is in the title.
    const picker = page.getByRole('combobox', { name: 'Use case' });
    expect((await picker.boundingBox())!.width).toBeLessThanOrEqual(11 * 16 + 1);
    await expect(picker).toHaveAttribute('title', /\S/);
    // The rest of the org stays collapsed.
    await expect(box(page, 'Frontend')).toBeVisible();
    await expect(box(page, 'Order Processing')).toHaveCount(0);

    await frame.getByRole('button', { name: 'Collapse Order Processing' }).click();
    await expect(box(page, 'Order Processing')).toBeVisible();
    await expect(page.locator('.react-flow__node', { hasText: 'Orders DB' })).toHaveCount(0);
    expect(await editorText(page)).toBe(before);
  });
});

test.describe('team systems on a busy org', () => {
  test('the warning tooltip stays on the canvas when the box sits at its right edge', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(droneLink(2000));
    await expect(status(page, 'Order Processing')).toHaveText('Saturated');
    await layoutSettled(page);
    // Drag the canvas until the box touches its right edge.
    const canvas = (await page.locator('.react-flow').boundingBox())!;
    const orders = (await box(page, 'Order Processing').boundingBox())!;
    await page.mouse.move(canvas.x + 5, canvas.y + 60);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 5 + (canvas.x + canvas.width - (orders.x + orders.width) - 10), canvas.y + 60, { steps: 8 });
    await page.mouse.up();

    await status(page, 'Order Processing').focus();
    const tip = box(page, 'Order Processing').getByRole('tooltip');
    await expect(tip).toBeVisible();
    const tipBox = (await tip.boundingBox())!;
    expect(tipBox.x).toBeGreaterThanOrEqual(canvas.x);
    expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  });

  test('a saturated node keeps readable text on its red fill, in the dark theme too', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(droneLink(2000));
    await expect(status(page, 'Order Processing')).toHaveText('Saturated');
    await layoutSettled(page);
    await box(page, 'Order Processing').dblclick();
    await expect(breadcrumb(page).locator('[aria-current="page"]')).toHaveText('Order Processing');
    await page.getByRole('button', { name: 'Overlay: load' }).click();
    const db = page.locator('.react-flow__node', { hasText: 'Orders DB' }).locator('.pc-node');
    await expect(db).toHaveAttribute('data-heat', 'accent');
    // The dark text drawn on accents, not the theme's light ink or its muted grey.
    await expect(db.locator('.pc-node__name')).toHaveCSS('color', 'rgb(17, 17, 17)');
    await expect(db.locator('.pc-node__tech')).toHaveCSS('color', 'rgb(17, 17, 17)');
  });
});

test('a component added from the palette next to team systems leaves every box shown', async ({ page }) => {
  await page.goto(droneLink(100));
  await expect(box(page, 'Order Processing')).toBeVisible();
  const before = await canvasNodes(page).count();
  await page.getByRole('button', { name: 'Add component' }).click();
  const palette = page.getByRole('dialog', { name: 'Add a component' });
  await palette.getByRole('searchbox', { name: 'Search components' }).fill('redis');
  await palette.getByRole('button', { name: 'Redis', exact: true }).click();
  await expect(palette).toBeHidden();
  // A new layout keeps the sizes React Flow measured; a node without one stays hidden until measured again.
  await expect(canvasNodes(page)).toHaveCount(before + 1);
});
