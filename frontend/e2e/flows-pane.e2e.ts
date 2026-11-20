import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, expect, setMode, test, waitForCanvas } from './fixtures';

// The Flows view is a Visual mode tool of wider screens (a phone keeps the list in its sheet, selection-tab.e2e.ts).
test.use({ mode: 'visual' });

/**
 * The Flows view: on a wider screen the `Architecture | Flows` switch (or F)
 * shows Flows over the whole canvas column, the canvas kept under it as it
 * was. It draws the chosen use case as a sequence diagram (a lane per
 * component, a numbered message per step, a frame per par block, a tab per
 * scenario) on one scrolling surface, and a floating map of the architecture
 * lights up the selected step.
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
const map = (page: Page) => page.getByTestId('flows-map');
const switchTo = (page: Page, view: 'Architecture' | 'Flows') => page.getByRole('group', { name: 'View' }).getByRole('button', { name: view, exact: true });
/** The ids of the map's lit components, sorted. */
const litNodes = (page: Page) => map(page).locator('[data-map-node][data-active]').evaluateAll((els) => els.map((e) => e.getAttribute('data-map-node')).sort());

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

async function openEditor(page: Page, source = SOURCE) {
  await page.goto(link(source));
  await waitForCanvas(page, 5);
  await settled(page);
}

test.describe('the Flows view', () => {
  test('takes the whole canvas column and draws the use case as lanes and numbered messages', async ({ page }) => {
    await openEditor(page);
    const canvas = (await page.locator('.react-flow').first().boundingBox())!;
    await switchTo(page, 'Flows').click();
    const view = flows(page);
    await expect(view).toBeVisible();
    await expect(switchTo(page, 'Flows')).toHaveAttribute('aria-pressed', 'true');
    // Over the canvas column (the canvas and the rail beside it), the canvas hidden under it.
    const box = (await page.getByTestId('flows-view').boundingBox())!;
    expect(box.x).toBeLessThanOrEqual(canvas.x + 1);
    expect(box.width).toBeGreaterThanOrEqual(canvas.width - 1);
    expect(box.height).toBeGreaterThanOrEqual(canvas.height - 1);
    await expect(page.locator('.react-flow').first()).toBeHidden();
    await expect(page.getByRole('separator', { name: /Resize/ })).toHaveCount(0);

    // A lane per component, in the order the steps first meet them.
    await expect(view.locator('[data-lane]')).toHaveCount(5);
    expect(await view.locator('[data-lane]').evaluateAll((els) => els.map((e) => e.getAttribute('data-lane')))).toEqual(['shopper', 'api', 'cache', 'db', 'events']);
    // The main flow: its own steps, numbered, the scenarios folded and the par block framed.
    await expect(sequence(page).getByRole('option')).toHaveText(['1POST /checkout', '2GET cart', '3INSERT order', '4PUBLISH OrderPlacedmessage', '5201']);
    await expect(sequence(page).getByRole('option').nth(4)).toHaveAccessibleName('5. Checkout API answers Shopper: 201 (response)');
    await expect(view.locator('[data-frame-title="parallel"]')).toContainText('At the same time');
    const parallel = (await view.locator('[data-frame="parallel"]').boundingBox())!;
    for (const i of [2, 3]) {
      const b = (await sequence(page).getByRole('option').nth(i).boundingBox())!;
      expect(b.y).toBeGreaterThan(parallel.y);
      expect(b.y + b.height).toBeLessThan(parallel.y + parallel.height);
    }

    // A scenario's tab shows its steps in place of the set.
    const tabs = view.getByRole('tablist', { name: 'Scenarios' });
    await expect(tabs.getByRole('tab')).toHaveText(['Main flow', 'Cart cached', 'Cart expired']);
    await tabs.getByRole('tab', { name: 'Cart expired' }).click();
    await expect(tabs.getByRole('tab', { name: 'Cart expired' })).toHaveAttribute('aria-selected', 'true');
    await expect(sequence(page).getByRole('option')).toHaveText(['1POST /checkout', '2GET cart', '3nil', '4SELECT cart', '5INSERT order', '6PUBLISH OrderPlacedmessage', '7201']);
    await expect(view.locator('[data-frame-title="scenario"]')).toContainText('Scenario: Cart expired');
    // The folded set on the main flow opens a scenario's tab too.
    await tabs.getByRole('tab', { name: 'Main flow' }).click();
    await view.getByRole('button', { name: 'Show the scenario Cart cached' }).click();
    await expect(tabs.getByRole('tab', { name: 'Cart cached' })).toHaveAttribute('aria-selected', 'true');
    await expect(sequence(page).getByRole('option').nth(2)).toHaveText('3cart');

    // A new scenario from the bar gets its own tab, chosen.
    await view.getByRole('button', { name: 'Add scenario', exact: true }).click();
    const name = page.getByRole('dialog', { name: 'Add a scenario' }).getByRole('textbox', { name: 'New scenario' });
    await expect(name).toBeFocused();
    await name.fill('Out of stock');
    await name.press('Enter');
    await expect(tabs.getByRole('tab', { name: 'Out of stock' })).toHaveAttribute('aria-selected', 'true');
  });

  test('a step clicked in the diagram lights up on the map and has its form beside it, and Up and Down move it', async ({ page }) => {
    await openEditor(page);
    await switchTo(page, 'Flows').click();
    await expect(map(page)).toBeVisible();
    const options = sequence(page).getByRole('option');
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(1)).toBeFocused();
    // Its two components and the connection it travels, the rest faded.
    await expect.poll(() => litNodes(page)).toEqual(['api', 'cache']);
    await expect(map(page).locator('[data-map-edge][data-active]')).toHaveCount(1);
    await expect(map(page).locator('[data-map-node="shopper"]')).toHaveCSS('opacity', '0.4');
    const selected = flows(page).getByRole('region', { name: 'Selected step' });
    const edit = selected.getByRole('form', { name: 'Edit step' });
    await expect(selected).toContainText('Step 2');
    await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('GET cart');

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
    await expect(options.nth(2)).toBeFocused();
    await expect.poll(() => litNodes(page)).toEqual(['api', 'db']);
    await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('INSERT order');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => litNodes(page)).toEqual(['api', 'shopper']);

    // A scenario's step, on its tab, is numbered as that tab draws it; another tab lets it go.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await sequence(page).getByRole('option', { name: /SELECT cart/ }).click();
    await expect(sequence(page).getByRole('option', { name: /SELECT cart/ })).toHaveAccessibleName(/^4\. /);
    await expect(selected).toContainText('Step 4');
    await flows(page).getByRole('tab', { name: 'Cart cached' }).click();
    await expect(selected).toHaveCount(0);
    await expect(sequence(page).getByRole('option', { selected: true })).toHaveCount(0);
    await expect.poll(() => litNodes(page)).toEqual([]);

    // Back on the architecture, the canvas shows and the view is gone.
    await switchTo(page, 'Architecture').click();
    await expect(flows(page)).toHaveCount(0);
    await expect(page.locator('.react-flow').first()).toBeVisible();
  });

  test('F switches the view from the canvas and back, not while typing; the choice is remembered and the canvas keeps its view', async ({ page }) => {
    await openEditor(page);
    // A view zoomed by hand, which the round trip must keep.
    const pane = (await page.locator('.react-flow__pane').first().boundingBox())!;
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 3);
    await page.mouse.wheel(0, -300);
    await settled(page);
    const zoomed = await viewport(page);

    // F on the canvas: Flows, with the focus in it.
    await page.mouse.click(pane.x + 20, pane.y + pane.height - 20);
    await page.keyboard.press('f');
    await expect(flows(page)).toBeVisible();
    await expect(switchTo(page, 'Flows')).toHaveAttribute('aria-pressed', 'true');
    await expect(sequence(page).getByRole('option').first()).toBeFocused();

    // Typed in a field, F is a letter.
    await sequence(page).getByRole('option').nth(1).click();
    const field = flows(page).getByRole('form', { name: 'Edit step' }).getByRole('combobox', { name: 'Operation' });
    await field.focus();
    await page.keyboard.press('End');
    await page.keyboard.type('f');
    await expect(field).toHaveValue('GET cartf');
    await expect(flows(page)).toBeVisible();

    // F on the diagram: back to the canvas, focused, its view as it was.
    await sequence(page).getByRole('option').nth(1).focus();
    await page.keyboard.press('f');
    await expect(flows(page)).toHaveCount(0);
    await expect(switchTo(page, 'Architecture')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-canvas-focus]')).toBeFocused();
    expect(await viewport(page)).toBe(zoomed);

    // Remembered: a reload opens on Flows.
    await page.keyboard.press('f');
    await expect(flows(page)).toBeVisible();
    await page.reload();
    await expect(sequence(page)).toBeVisible();
    await expect(switchTo(page, 'Flows')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the map lights up a step, collapses to a pill and back (by its buttons or M), and stays as it was left', async ({ page }) => {
    await openEditor(page);
    await switchTo(page, 'Flows').click();
    // Open at first on a wide screen, in the corner of the diagram, clear of the column beside it.
    await expect(map(page)).toHaveAttribute('aria-label', 'Architecture map');
    const m = (await map(page).boundingBox())!;
    const column = (await flows(page).getByRole('region', { name: 'Use case Checkout' }).boundingBox())!;
    const view = (await page.getByTestId('flows-view').boundingBox())!;
    expect(m.x + m.width).toBeLessThanOrEqual(column.x);
    expect(m.y + m.height).toBeLessThanOrEqual(view.y + view.height);
    expect(m.y + m.height).toBeGreaterThan(view.y + view.height - 40);
    // Every component of the use case is drawn, and a selected answer lights the connection it goes back along.
    await expect(map(page).locator('[data-map-node]')).toHaveCount(5);
    await sequence(page).getByRole('option', { name: /201/ }).click();
    await expect.poll(() => litNodes(page)).toEqual(['api', 'shopper']);
    await expect(map(page).locator('[data-map-edge][data-active]')).toHaveAttribute('data-map-edge', /.+/);

    await map(page).getByRole('button', { name: 'Collapse the architecture map' }).click();
    await expect(map(page)).toHaveAttribute('aria-label', 'Show the architecture map');
    await expect(map(page).locator('[data-map-node]')).toHaveCount(0);
    expect((await map(page).boundingBox())!.height).toBeLessThanOrEqual(40);
    // M, on the diagram, opens it again and collapses it.
    await sequence(page).getByRole('option').first().focus();
    await page.keyboard.press('m');
    await expect(map(page)).toHaveAttribute('aria-label', 'Architecture map');
    await page.keyboard.press('m');
    await expect(map(page)).toHaveAttribute('aria-label', 'Show the architecture map');

    // Collapsed, it stays so after a reload, and the pill opens it.
    await page.reload();
    await expect(sequence(page)).toBeVisible();
    await expect(map(page)).toHaveAttribute('aria-label', 'Show the architecture map');
    await map(page).click();
    await expect(map(page)).toHaveAttribute('aria-label', 'Architecture map');
    await page.reload();
    await expect(sequence(page)).toBeVisible();
    await expect(map(page)).toHaveAttribute('aria-label', 'Architecture map');
  });

  test('Code mode has no Flows view', async ({ page }) => {
    await openEditor(page);
    await switchTo(page, 'Flows').click();
    await expect(flows(page)).toBeVisible();
    await setMode(page, 'code');
    await expect(page.getByTestId('flows-view')).toHaveCount(0);
    await expect(flows(page)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'View' })).toHaveCount(0);
    // F does nothing there.
    await page.locator('.react-flow__pane').first().click();
    await page.keyboard.press('f');
    await expect(flows(page)).toHaveCount(0);
    // Back in Visual mode it is where it was.
    await setMode(page, 'visual');
    await expect(flows(page)).toBeVisible();
  });

  test('practice has the view too: a use case and its first step, picked on the map', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await waitForCanvas(page, 2);
    await switchTo(page, 'Flows').click();
    const view = flows(page);
    await expect(view).toBeVisible();
    await expect(page.locator('.react-flow').first()).toBeHidden();
    // A use case the problem asks for, and its first step from the map, drawn in the diagram.
    const picker = view.getByRole('combobox', { name: 'Use case' });
    await expect(picker).toBeVisible();
    await view.getByRole('button', { name: 'New use case' }).first().click();
    const name = view.getByRole('textbox', { name: 'New use case' });
    await name.fill('Try it');
    await name.press('Enter');
    await view.getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = view.getByRole('form', { name: 'New step' });
    await map(page).getByRole('button', { name: 'Visitor', exact: true }).click();
    await map(page).getByRole('button', { name: 'Shortener API', exact: true }).click();
    await step.getByRole('combobox', { name: 'Operation' }).fill('GET /abc');
    await step.getByRole('button', { name: 'Add step' }).click();
    const option = view.getByRole('listbox', { name: 'Sequence of Try it' }).getByRole('option');
    await expect(option).toHaveText(['1GET /abc']);
    // Selected, it lights up on the map.
    await step.getByRole('button', { name: 'Done' }).click();
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => litNodes(page)).toEqual(['api', 'visitor']);
    await expect(map(page).locator('[data-map-edge][data-active]')).toHaveCount(1);
  });
});

/** Many steps between lanes with long names: taller and wider than the view at 1024x768. */
const LONG = `${['gateway "Public API gateway"', 'orders "Order orchestration service"', 'payments "Payment authorisation service"', 'stock "Inventory reservation service"', 'ledger "Accounting ledger writer"', 'mail "Customer notification sender"', 'audit "Compliance audit trail"']
  .map((n) => `${n} [REST API]`)
  .join('\n')}

usecase "Checkout" {
${Array.from({ length: 14 }, (_, i) => `  gateway -> orders : POST /orders/${i}/confirm-and-reserve
  orders -> payments : POST /authorise-payment-${i}
  payments --> orders : 201
  orders -> audit : POST /audit-record-${i}`).join('\n')}
}
`;

test.describe('one scrolling surface', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('nothing in the view scrolls but the view itself: down and sideways on one surface, the lane headers pinned', async ({ page }) => {
    await page.goto(link(LONG));
    await waitForCanvas(page, 7);
    await switchTo(page, 'Flows').click();
    await expect(sequence(page)).toBeVisible();
    // Every element in the view (the diagram, the column, the composer, the map, the bar): one with a scroll of its own.
    const scrollers = () =>
      page.getByTestId('flows-view').evaluate((root) =>
        [root, ...Array.from(root.querySelectorAll('*'))]
          .filter((el) => /(auto|scroll)/.test(`${getComputedStyle(el).overflowX} ${getComputedStyle(el).overflowY}`))
          .map((el) => (el.hasAttribute('data-flows-scroller') ? 'surface' : el.outerHTML.slice(0, 120))),
      );
    expect(await scrollers()).toEqual(['surface']);
    // A step selected (its form beside), and the composer open: still one.
    await sequence(page).getByRole('option').nth(3).click();
    expect(await scrollers()).toEqual(['surface']);
    await sequence(page).getByRole('option').first().hover();
    await flows(page).getByRole('button', { name: 'Add a step before step 3', exact: true }).click();
    await expect(flows(page).getByRole('dialog', { name: 'Add a step here' })).toBeVisible();
    expect(await scrollers()).toEqual(['surface']);
    await page.keyboard.press('Escape');

    // The surface scrolls both ways; scrolled, the lane headers stay at its top.
    const surface = page.locator('[data-flows-scroller]');
    const size = await surface.evaluate((el) => ({ down: el.scrollHeight > el.clientHeight, across: el.scrollWidth > el.clientWidth, top: el.getBoundingClientRect().top }));
    expect(size).toMatchObject({ down: true, across: true });
    await surface.evaluate((el) => el.scrollTo(0, 600));
    const lane = (await flows(page).locator('[data-lane="gateway"]').boundingBox())!;
    expect(Math.abs(lane.y - size.top)).toBeLessThanOrEqual(12);
    // Scrolled to the far end, the last lane is in sight, left of the column.
    await surface.evaluate((el) => el.scrollTo(10_000, 0));
    const last = (await flows(page).locator('[data-lane="audit"]').boundingBox())!;
    const column = (await flows(page).getByRole('region', { name: 'Use case Checkout' }).boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(column.x + 1);
  });

  test("Add scenario's card is over the lane headers, whole, and takes clicks", async ({ page }) => {
    await page.goto(link(SOURCE));
    await waitForCanvas(page, 5);
    await switchTo(page, 'Flows').click();
    await expect(sequence(page)).toBeVisible();
    await flows(page).getByRole('button', { name: 'Add scenario', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Add a scenario' });
    await expect(card).toBeVisible();
    // The card runs over the lane headers' strip: its title, help, field and button are its own, nothing painted over them.
    const headers = (await flows(page).locator('[data-lane]').first().boundingBox())!;
    const box = (await card.boundingBox())!;
    expect(box.y).toBeLessThan(headers.y + headers.height);
    const own = (target: string) => card.locator(target).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
      return !!hit && el.closest('[role="dialog"]')!.contains(hit);
    });
    for (const target of ['label', 'p', 'input', 'button[type="submit"]']) expect(await own(target), target).toBe(true);
    // A click lands: typed and added with its button, not by Enter.
    await card.getByRole('textbox', { name: 'New scenario' }).fill('Out of stock');
    await card.getByRole('button', { name: 'Add the scenario' }).click();
    await expect(card).toHaveCount(0);
    await expect(flows(page).getByRole('tab', { name: 'Out of stock' })).toHaveAttribute('aria-selected', 'true');
    // Escape and a click outside close it.
    await flows(page).getByRole('button', { name: 'Add scenario', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await flows(page).getByRole('button', { name: 'Add scenario', exact: true }).click();
    await sequence(page).getByRole('option').first().click();
    await expect(card).toHaveCount(0);
  });
});
