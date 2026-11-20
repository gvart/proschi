import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, expect, setMode, test, waitForCanvas } from './fixtures';

// The Flows pane is a Visual mode tool of wider screens (a phone keeps the list in its sheet, selection-tab.e2e.ts).
test.use({ mode: 'visual' });

/**
 * The Flows pane: on a wider screen Flows opens under the canvas, which gets
 * shorter but stays in view. It draws the chosen use case as a sequence
 * diagram (a lane per component, a numbered message per step, a frame per
 * par block, a tab per scenario), and a step selected there, in the list or
 * with the arrow keys lights up on the canvas. Its height is dragged or keyed,
 * and remembered.
 */

const SOURCE = `shopper "Shopper" [Browser]
api "Checkout API" [REST API]
cache "Cart cache" [Redis]
db "Orders DB" [PostgreSQL]
events "Order events" [AWS SNS]

shopper -> api : HTTPS
api -> cache : RESP
api -> db : SQL
api -> events : Publish

usecase "Checkout" {
  shopper -> api : POST /checkout
  api -> cache : GET cart
  alt "Cart cached" {
    cache --> api : cart
  } alt "Cart expired" {
    cache --> api : nil
    api -> db : SELECT cart
  }
  par {
    api -> db : INSERT order
    api ->> events : PUBLISH OrderPlaced
  }
  api --> shopper : 201
}
`;

const link = (source: string) => `app/#code=${lz.compressToEncodedURIComponent(source)}`;
const flows = (page: Page) => page.getByRole('region', { name: 'Flows' });
const sequence = (page: Page) => flows(page).getByRole('listbox', { name: 'Sequence of Checkout' });
const handle = (page: Page) => page.getByRole('separator', { name: 'Resize the flows pane' });

/** The canvas's viewport transform, as React Flow sets it. */
const viewport = (page: Page) => page.locator('.react-flow__viewport').first().evaluate((el) => (el as HTMLElement).style.transform);

/** Waits until the layout is done and the view stops moving (the nodes stop gliding). */
async function settled(page: Page) {
  await expect(page.locator('[data-layout-busy]')).toHaveCount(0);
  let last = '';
  await expect
    .poll(
      async () => {
        const now = `${await viewport(page)}|${JSON.stringify(await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())))}`;
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [250] },
    )
    .toBe(true);
}

async function openEditor(page: Page) {
  await page.goto(link(SOURCE));
  await waitForCanvas(page, 5);
  await settled(page);
}

test.describe('the Flows pane', () => {
  test('opens under the canvas, which stays in view above it, and draws the use case as lanes and numbered messages', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const pane = flows(page);
    await expect(pane).toBeVisible();
    // Below the canvas, across its width, and the canvas still shows every node above it.
    const canvas = (await page.locator('.react-flow').first().boundingBox())!;
    const box = (await page.getByTestId('flows-pane').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    expect(box.width).toBeGreaterThanOrEqual(canvas.width - 1);
    expect(canvas.height).toBeGreaterThan(200);
    await settled(page);
    for (const node of await canvasNodes(page).all()) {
      const b = (await node.boundingBox())!;
      expect(b.y + b.height, 'a node below the canvas').toBeLessThanOrEqual(canvas.y + canvas.height + 1);
    }

    // A lane per component, in the order the steps first meet them.
    await expect(pane.locator('[data-lane]')).toHaveCount(5);
    expect(await pane.locator('[data-lane]').evaluateAll((els) => els.map((e) => e.getAttribute('data-lane')))).toEqual(['shopper', 'api', 'cache', 'db', 'events']);
    // The main flow: its own steps, numbered, the scenarios folded and the par block framed.
    await expect(sequence(page).getByRole('option')).toHaveText(['1POST /checkout', '2GET cart', '3INSERT order', '4PUBLISH OrderPlacedmessage', '5201']);
    await expect(sequence(page).getByRole('option').nth(4)).toHaveAccessibleName('5. Checkout API answers Shopper: 201 (response)');
    await expect(pane.locator('[data-frame-title="parallel"]')).toContainText('At the same time');
    const parallel = (await pane.locator('[data-frame="parallel"]').boundingBox())!;
    for (const i of [2, 3]) {
      const b = (await sequence(page).getByRole('option').nth(i).boundingBox())!;
      expect(b.y).toBeGreaterThan(parallel.y);
      expect(b.y + b.height).toBeLessThan(parallel.y + parallel.height);
    }

    // A scenario's tab shows its steps in place of the set.
    const tabs = pane.getByRole('tablist', { name: 'Scenarios' });
    await expect(tabs.getByRole('tab')).toHaveText(['Main flow', 'Cart cached', 'Cart expired']);
    await tabs.getByRole('tab', { name: 'Cart expired' }).click();
    await expect(tabs.getByRole('tab', { name: 'Cart expired' })).toHaveAttribute('aria-selected', 'true');
    await expect(sequence(page).getByRole('option')).toHaveText(['1POST /checkout', '2GET cart', '3nil', '4SELECT cart', '5INSERT order', '6PUBLISH OrderPlacedmessage', '7201']);
    await expect(pane.locator('[data-frame-title="scenario"]')).toContainText('Scenario: Cart expired');
    // The folded set on the main flow opens a scenario's tab too.
    await tabs.getByRole('tab', { name: 'Main flow' }).click();
    await pane.getByRole('button', { name: 'Show the scenario Cart cached' }).click();
    await expect(tabs.getByRole('tab', { name: 'Cart cached' })).toHaveAttribute('aria-selected', 'true');
    await expect(sequence(page).getByRole('option').nth(2)).toHaveText('3cart');

    // A new scenario from the header gets its own tab, chosen.
    await pane.getByRole('button', { name: 'Add scenario', exact: true }).click();
    const name = pane.getByRole('textbox', { name: 'New scenario' });
    await expect(name).toBeFocused();
    await name.fill('Out of stock');
    await name.press('Enter');
    await expect(tabs.getByRole('tab', { name: 'Out of stock' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a step clicked in the diagram lights up on the canvas and has its form beside it, and Up and Down move it', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const options = sequence(page).getByRole('option');
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(1)).toBeFocused();
    // Its two components and the connection it travels, as playback lights a step.
    await expect(page.locator('.react-flow__node.pc-active')).toHaveCount(2);
    expect(await page.locator('.react-flow__node.pc-active').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort())).toEqual(['api', 'cache']);
    await expect(page.locator('.react-flow__edge.pc-active')).toHaveCount(1);
    const selected = flows(page).getByRole('region', { name: 'Selected step' });
    const edit = selected.getByRole('form', { name: 'Edit step' });
    await expect(selected).toContainText('Step 2');
    await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('GET cart');

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(2)).toBeFocused();
    expect(await page.locator('.react-flow__node.pc-active').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort())).toEqual(['api', 'db']);
    await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('INSERT order');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('.react-flow__node.pc-active').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort())).toEqual(['api', 'shopper']);

    // A scenario's step, on its tab, is numbered as that tab draws it; another tab lets it go.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await sequence(page).getByRole('option', { name: /SELECT cart/ }).click();
    await expect(sequence(page).getByRole('option', { name: /SELECT cart/ })).toHaveAccessibleName(/^4\. /);
    await expect(selected).toContainText('Step 4');
    await flows(page).getByRole('tab', { name: 'Cart cached' }).click();
    await expect(selected).toHaveCount(0);
    await expect(sequence(page).getByRole('option', { selected: true })).toHaveCount(0);

    // Closed, the pane lets the canvas go.
    await flows(page).getByRole('button', { name: 'Close the flows' }).click();
    await expect(flows(page)).toHaveCount(0);
    await expect(page.locator('.pc-active')).toHaveCount(0);
  });

  test('the handle resizes the pane with the mouse and the keys, and the height is remembered', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const pane = page.getByTestId('flows-pane');
    const before = (await pane.boundingBox())!.height;
    const h = (await handle(page).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y - 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await pane.boundingBox())!.height)).toBe(Math.round(before + 100 + h.height / 2));
    const dragged = Math.round((await pane.boundingBox())!.height);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', String(dragged));

    await handle(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', String(dragged - 24));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', String(dragged + 24));
    // Never past 70% of the column, nor under its least height.
    await page.keyboard.press('End');
    const max = Number(await handle(page).getAttribute('aria-valuemax'));
    await expect(handle(page)).toHaveAttribute('aria-valuenow', String(max));
    const column = (await page.locator('.react-flow').first().boundingBox())!.height + max;
    expect(max).toBeLessThanOrEqual(Math.ceil(column * 0.7) + 2);
    await page.keyboard.press('Home');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '160');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '256');

    await page.reload();
    await waitForCanvas(page, 5);
    await expect(flows(page)).toBeVisible();
    await expect(handle(page)).toHaveAttribute('aria-valuenow', '256');
    expect(Math.round((await page.getByTestId('flows-pane').boundingBox())!.height)).toBe(256);
  });

  test('a view zoomed by hand stays as it is when the pane opens and is resized; an untouched one fits again', async ({ page }) => {
    await openEditor(page);
    // Untouched: opening the pane glides the diagram to fit the shorter canvas.
    const fitted = await viewport(page);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    await settled(page);
    expect(await viewport(page)).not.toBe(fitted);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    await expect(flows(page)).toHaveCount(0);
    await settled(page);

    // Zoomed by hand: the view is kept.
    const canvas = (await page.locator('.react-flow__pane').first().boundingBox())!;
    const whole = await viewport(page);
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 3);
    await page.mouse.wheel(0, -300);
    await settled(page);
    const zoomed = await viewport(page);
    expect(zoomed).not.toBe(whole);

    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    await expect(flows(page)).toBeVisible();
    await page.waitForTimeout(700);
    await settled(page);
    expect(await viewport(page)).toBe(zoomed);

    await handle(page).focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    const h = (await handle(page).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + 80, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    await settled(page);
    expect(await viewport(page)).toBe(zoomed);
  });

  test('Code mode has no pane', async ({ page }) => {
    await openEditor(page);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    await expect(flows(page)).toBeVisible();
    await setMode(page, 'code');
    await expect(page.getByTestId('flows-pane')).toHaveCount(0);
    await expect(flows(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Flows', exact: true })).toHaveCount(0);
    // Back in Visual mode it is where it was.
    await setMode(page, 'visual');
    await expect(flows(page)).toBeVisible();
  });

  test('practice has the pane too', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await waitForCanvas(page, 2);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const pane = flows(page);
    await expect(pane).toBeVisible();
    const canvas = (await page.locator('.react-flow').first().boundingBox())!;
    expect((await page.getByTestId('flows-pane').boundingBox())!.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
    await expect(handle(page)).toBeVisible();
    // A use case the problem asks for, and its first step from the canvas, drawn in the diagram.
    const picker = pane.getByRole('combobox', { name: 'Use case' });
    await expect(picker).toBeVisible();
    await pane.getByRole('button', { name: 'New use case' }).first().click();
    const name = pane.getByRole('textbox', { name: 'New use case' });
    await name.fill('Try it');
    await name.press('Enter');
    await pane.getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = pane.getByRole('form', { name: 'New step' });
    await canvasNodes(page).filter({ hasText: 'Visitor' }).click();
    await canvasNodes(page).filter({ hasText: 'Shortener API' }).click();
    await step.getByRole('combobox', { name: 'Operation' }).fill('GET /abc');
    await step.getByRole('button', { name: 'Add step' }).click();
    const option = pane.getByRole('listbox', { name: 'Sequence of Try it' }).getByRole('option');
    await expect(option).toHaveText(['1GET /abc']);
    // Selected, it lights up on the practice canvas too.
    await step.getByRole('button', { name: 'Done' }).click();
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    expect(await page.locator('.react-flow__node.pc-active').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort())).toEqual(['api', 'visitor']);
    await expect(page.locator('.react-flow__edge.pc-active')).toHaveCount(1);
  });
});
