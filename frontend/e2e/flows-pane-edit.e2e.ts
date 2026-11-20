import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, chooseOption, codeEditor, editorText, expect, setMode, test, waitForCanvas } from './fixtures';

test.use({ mode: 'visual' });

/**
 * Editing a use case on the Flows pane's sequence diagram: a "+" between the
 * messages or a drag from one lifeline to another opens a composer there, a
 * selected message's form is beside the diagram, Alt+Up and Down move it and
 * Delete removes it, several selected run at the same time, and a par frame
 * ungroups or takes one more. Every edit is one of the text, which the code
 * editor's undo takes back.
 */

const SOURCE = `shopper "Shopper" [Browser]
api "Checkout API" [REST API]
cache "Cart cache" [Redis]
db "Orders DB" [PostgreSQL]
events "Order events" [AWS SNS]
mail "Email" [SendGrid]

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

const flows = (page: Page) => page.getByRole('region', { name: 'Flows' });
const sequence = (page: Page) => flows(page).getByRole('listbox', { name: 'Sequence of Checkout' });
const option = (page: Page, n: number) => sequence(page).getByRole('option', { name: new RegExp(`^${n}\\. `) });
const composer = (page: Page) => flows(page).getByRole('dialog', { name: 'Add a step here' });
/** The use case's text, from the code editor. */
const useCase = async (page: Page) => /usecase "Checkout" \{\n[\s\S]*?\n\}/.exec(await editorText(page))?.[0] ?? '';

async function openPane(page: Page, source = SOURCE) {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(source)}`);
  await waitForCanvas(page, 6);
  await page.getByRole('button', { name: 'Flows', exact: true }).click();
  await expect(sequence(page)).toBeVisible();
}

/** The "+"s show while the pointer is over the diagram. */
async function insertPoint(page: Page, name: string) {
  await sequence(page).getByRole('option').first().hover();
  return flows(page).getByRole('button', { name, exact: true });
}

test.describe('editing on the Flows pane', () => {
  test('a "+" opens the composer there: from where the last step went, to any component, a new lane for a new one', async ({ page }) => {
    await openPane(page);
    await (await insertPoint(page, 'Add a step before step 2')).click();
    const step = composer(page);
    await expect(step).toBeVisible();
    // It starts where step 1 went; with no end yet, the focus is on where it goes.
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await expect(step.getByLabel('Goes to')).toBeFocused();
    // Any component, the ones not in the flow too; never the one it starts at.
    await step.getByLabel('Goes to').click();
    await expect(page.getByRole('option', { name: 'Checkout API', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Email', exact: true }).click();
    await step.getByRole('combobox', { name: 'Operation' }).fill('SEND receipt');
    await step.getByRole('combobox', { name: 'Operation' }).press('Enter');
    await expect(step).toHaveCount(0);
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout\n  api -> mail : SEND receipt\n  api -> cache : GET cart\n');
    await expect.poll(() => editorText(page)).toContain('api -> mail');
    // Its lane is added, and it is selected with its form beside the diagram.
    await expect(flows(page).locator('[data-lane="mail"]')).toBeVisible();
    await expect(option(page, 2)).toHaveAccessibleName('2. Checkout API to Email: SEND receipt');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toBeFocused();
    await expect(flows(page).getByRole('region', { name: 'Selected step' })).toContainText('Step 2');

    // On a scenario's tab, the "+" at the end of its frame adds to it.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await (await insertPoint(page, 'Add a step at the end of Cart expired')).click();
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'db');
    await canvasNodes(page).filter({ hasText: 'Checkout API' }).click();
    // The answer to the open request, by default.
    await expect(composer(page).getByRole('radio', { name: 'Response' })).toHaveAttribute('aria-checked', 'true');
    await composer(page).getByRole('combobox', { name: 'Answer' }).fill('3 rows');
    await composer(page).getByRole('button', { name: 'Add step' }).click();
    await expect.poll(() => useCase(page)).toContain('    api -> db : SELECT cart\n    db --> api : 3 rows\n  }\n');

    // Escape closes it, the focus back on the diagram.
    await (await insertPoint(page, 'Add a step at the end')).click();
    await expect(composer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(composer(page)).toHaveCount(0);
    await expect(sequence(page).getByRole('option').first()).toBeFocused();
  });

  test('a drag from one lifeline to another opens the composer with both ends, to a lane next to it or farther', async ({ page }) => {
    await openPane(page);
    const lifeline = async (id: string) => (await flows(page).locator(`[data-lifeline="${id}"]`).boundingBox())!;
    const drag = async (from: string, to: string, y: number) => {
      const [a, b] = [await lifeline(from), await lifeline(to)];
      await page.mouse.move(a.x + a.width / 2, a.y + y);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, a.y + y, { steps: 8 });
      await page.mouse.up();
    };
    // Onto its own lifeline: nothing (a step goes from one component to another).
    const own = await lifeline('api');
    await page.mouse.move(own.x + own.width / 2, own.y + 30);
    await page.mouse.down();
    await page.mouse.move(own.x + own.width / 2 + 3, own.y + 60, { steps: 4 });
    await page.mouse.up();
    await expect(composer(page)).toHaveCount(0);

    // Between steps 1 and 2, from the shopper past the API to the cache.
    const first = (await option(page, 1).boundingBox())!;
    const top = (await lifeline('shopper')).y;
    await drag('shopper', 'cache', first.y + first.height - top + 2);
    const step = composer(page);
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'shopper');
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'cache');
    // With both ends, the focus is on the label.
    await expect(step.getByRole('combobox', { name: 'Operation' })).toBeFocused();
    await page.keyboard.type('GET session');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout\n  shopper -> cache : GET session\n  api -> cache : GET cart\n');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');

    // To the lane next to it, at the end (scrolled to the bottom).
    await sequence(page).evaluate((el) => el.closest('.bg-paper')!.scrollTo(0, 10_000));
    const last = (await sequence(page).getByRole('option').last().boundingBox())!;
    await drag('api', 'cache', last.y + last.height - (await lifeline('api')).y + 14);
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await expect(composer(page).getByLabel('Goes to')).toHaveAttribute('data-value', 'cache');
    await page.keyboard.type('DEL cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}api --> shopper : 201\n {2}api -> cache : DEL cart\n\}$/);
  });

  test("a selected step's form is beside the diagram, and the selection follows a change of its ends and kind", async ({ page }) => {
    await openPane(page);
    // Nothing selected: a hint and the form to add a step.
    await expect(flows(page).getByText(/Click a message to change it/)).toBeVisible();
    await expect(flows(page).getByRole('button', { name: 'Add a step', exact: true })).toBeVisible();
    // The list of every step is gone from the pane (the phone's sheet keeps it).
    await expect(flows(page).getByRole('list', { name: 'Steps' })).toHaveCount(0);

    await option(page, 2).click();
    const edit = flows(page).getByRole('form', { name: 'Edit step' });
    await expect(edit.getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await expect(edit.getByLabel('Goes to')).toHaveAttribute('data-value', 'cache');
    await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('GET cart');
    // Its own vocabulary: the cache is Redis.
    await expect(edit.getByText(/one of Redis's \d+ operations/)).toBeVisible();

    await chooseOption(edit.getByLabel('Goes to'), 'Order events');
    await edit.getByRole('radio', { name: 'Message' }).click();
    await edit.getByRole('combobox', { name: 'Operation' }).fill('PUBLISH CartRead');
    await edit.getByRole('button', { name: 'Save step' }).click();
    await expect.poll(() => useCase(page)).toContain('  api ->> events : PUBLISH CartRead\n');
    // Still selected, with its new ends, on the diagram, the canvas and in the form.
    await expect(option(page, 2)).toHaveAccessibleName('2. Checkout API to Order events: PUBLISH CartRead (message)');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(flows(page).getByRole('form', { name: 'Edit step' }).getByLabel('Goes to')).toHaveAttribute('data-value', 'events');
    expect(await page.locator('.react-flow__node.pc-active').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')).sort())).toEqual(['api', 'events']);

    // Enter on a message goes to its form; Escape on the diagram lets it go.
    await option(page, 2).focus();
    await page.keyboard.press('Enter');
    await expect(flows(page).getByRole('form', { name: 'Edit step' }).getByLabel('Starts at')).toBeFocused();
    await option(page, 2).focus();
    await page.keyboard.press('Escape');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'false');
    await expect(flows(page).getByRole('form', { name: 'Edit step' })).toHaveCount(0);
  });

  test('Alt+Up and Down and the buttons move the selected step, Delete and the button remove it, and undo takes each back', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    await option(page, 5).click();
    // Past the par block, then past the scenarios, the focus staying on it.
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => useCase(page)).toContain('  }\n  api --> shopper : 201\n  par {\n');
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  api --> shopper : 201\n  alt "Cart cached" {\n');
    await expect(sequence(page).getByRole('option', { name: /answers Shopper: 201/ })).toBeFocused();
    await expect(sequence(page).getByRole('option', { name: /answers Shopper: 201/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);

    // The buttons beside it.
    await option(page, 1).click();
    await flows(page).getByRole('button', { name: 'Move the step down' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  shopper -> api : POST /checkout\n');
    await flows(page).getByRole('button', { name: 'Move the step up' }).click();
    await expect.poll(() => useCase(page)).toBe(original);

    // Delete removes it, and the next is selected; the button too.
    await option(page, 1).click();
    await page.keyboard.press('Delete');
    await expect.poll(() => useCase(page)).not.toContain('POST /checkout');
    await expect(option(page, 1)).toHaveAccessibleName(/GET cart/);
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 1)).toBeFocused();
    await flows(page).getByRole('button', { name: 'Delete the step' }).click();
    await expect.poll(() => useCase(page)).not.toContain('GET cart');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test('several selected run at the same time, the refusal shows, undo takes the group back, and a par frame ungroups and takes one more', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    await option(page, 1).click();
    await option(page, 2).click({ modifiers: ['Shift'] });
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toBeFocused();
    const selected = flows(page).getByRole('region', { name: 'Selected steps' });
    await expect(selected).toContainText('2 steps selected');
    await selected.getByRole('button', { name: 'Run at the same time' }).click();
    await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n    api -> cache : GET cart\n  }\n');
    await expect(flows(page).locator('[data-frame="parallel"]')).toHaveCount(2);
    // Undo, by the keys, straight after.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);

    // Steps that can't run at the same time say why, in the pane; Cmd/Ctrl-click adds one to the selection, and the header has the action too.
    await option(page, 1).click();
    await option(page, 5).click({ modifiers: ['ControlOrMeta'] });
    await flows(page).getByRole('button', { name: 'Run at the same time' }).first().click();
    await expect(flows(page).getByRole('alert')).toHaveText(/follow each other/);
    expect(await useCase(page)).toBe(original);

    // A par frame's actions: one more step alongside, then ungroup.
    await option(page, 1).click();
    await flows(page).getByRole('button', { name: 'Add alongside' }).click();
    const step = composer(page);
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'events');
    await chooseOption(step.getByLabel('Starts at'), 'Checkout API');
    await chooseOption(step.getByLabel('Goes to'), 'Cart cache');
    await step.getByRole('combobox', { name: 'Operation' }).fill('DEL cart');
    await step.getByRole('button', { name: 'Add step' }).click();
    await expect.poll(() => useCase(page)).toContain('    api ->> events : PUBLISH OrderPlaced\n    api -> cache : DEL cart\n  }\n');
    await flows(page).getByRole('button', { name: 'Ungroup' }).click();
    await expect.poll(() => useCase(page)).toContain('  }\n  api -> db : INSERT order\n  api ->> events : PUBLISH OrderPlaced\n  api -> cache : DEL cart\n  api --> shopper : 201\n');
    await expect(flows(page).locator('[data-frame="parallel"]')).toHaveCount(0);
  });

  test('after Run at the same time the block\'s first step is selected, and steps already in a block are never offered it', async ({ page }) => {
    await openPane(page);
    const run = flows(page).getByRole('button', { name: 'Run at the same time' });
    await option(page, 1).click();
    await option(page, 2).click({ modifiers: ['Shift'] });
    await expect(run).toHaveCount(2);
    await run.first().click();
    await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n    api -> cache : GET cart\n  }\n');
    // The block's first step, alone: the action is gone from the header and the column.
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'false');
    await expect(flows(page).getByRole('region', { name: 'Selected step' })).toContainText('Step 1');
    await expect(run).toHaveCount(0);
    // Both steps of the new block, selected again: not offered, and the column says why.
    await option(page, 2).click({ modifiers: ['Shift'] });
    await expect(flows(page).getByRole('region', { name: 'Selected steps' })).toContainText('2 steps selected');
    await expect(run).toHaveCount(0);
    await expect(flows(page).getByRole('region', { name: 'Selected steps' })).toContainText('already runs at the same time as others: ungroup its block first');
    // A step of the block with one outside it: not offered either.
    await option(page, 5).click();
    await option(page, 4).click({ modifiers: ['ControlOrMeta'] });
    await expect(flows(page).getByRole('region', { name: 'Selected steps' })).toContainText('Step 4 already runs at the same time');
    await expect(run).toHaveCount(0);
  });

  test('Add reply answers a selected request right after it, before the block that follows', async ({ page }) => {
    await openPane(page);
    await option(page, 2).click();
    await flows(page).getByRole('button', { name: 'Add reply' }).click();
    const step = composer(page);
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'cache');
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'api');
    await expect(step.getByRole('radio', { name: 'Response' })).toHaveAttribute('aria-checked', 'true');
    await step.getByRole('combobox', { name: 'Answer' }).fill('cart');
    await step.getByRole('combobox', { name: 'Answer' }).press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache --> api : cart\n  alt "Cart cached" {\n');
    // A response has no reply.
    await expect(flows(page).getByRole('button', { name: 'Add reply' })).toHaveCount(0);
  });

  test('by the keyboard alone: a "+" takes the focus, Shift+Down selects several, and the header runs them at the same time', async ({ page }) => {
    await openPane(page);
    const end = flows(page).getByRole('button', { name: 'Add a step at the end', exact: true });
    await end.focus();
    await expect(end).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(composer(page)).toBeVisible();
    await page.keyboard.press('Escape');

    // The first Down selects the first message, the next the one after it.
    await option(page, 1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 1)).toBeFocused();
    const header = flows(page).getByRole('button', { name: 'Run at the same time' }).first();
    await header.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n    api -> cache : GET cart\n  }\n');
    // The focus is back on the diagram, so undo works at once.
    await expect(sequence(page).getByRole('option', { name: /POST \/checkout/ })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).not.toContain('par {\n    shopper');
  });
});

test.describe('the Flows pane, polished', () => {
  test('labels keep a sensible width: the diagram scrolls sideways rather than starve them, beside the column, never under it', async ({ page }) => {
    const long = SOURCE.replace('POST /checkout', 'POST /checkout {"cart": 42, "coupon": "WINTER-SALE-2026"}');
    const label = (n: number) => option(page, n).locator('span.truncate').first();
    const scroller = () => sequence(page).evaluate((el) => {
      const box = el.closest('.bg-paper')!;
      return { scroll: box.scrollWidth, client: box.clientWidth, right: box.getBoundingClientRect().right };
    });
    await openPane(page, long);
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await sequence(page).boundingBox())?.width ?? 0).toBeGreaterThan(0);
      // At least 200px of the label shows (it is longer).
      expect((await label(1).boundingBox())!.width).toBeGreaterThanOrEqual(195);
      // A short label shows whole.
      await expect(label(2)).toHaveText('GET cart');
      expect(await label(2).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // The column is beside the diagram, which scrolls when its lanes don't fit.
      const column = (await flows(page).getByRole('region', { name: 'Use case Checkout' }).boundingBox())!;
      const box = await scroller();
      expect(box.right).toBeLessThanOrEqual(column.x + 1);
      if (size.width === 1024) {
        expect(box.scroll).toBeGreaterThan(box.client);
        // Scrolled to the far end, the last lane's header is in sight, in the sticky strip.
        await sequence(page).evaluate((el) => el.closest('.bg-paper')!.scrollTo(10_000, 0));
        const lane = (await flows(page).locator('[data-lane="events"]').boundingBox())!;
        expect(lane.x + lane.width).toBeLessThanOrEqual(box.right + 1);
      }
    }
  });

  test('Add reply is only on a request that has no answer yet', async ({ page }) => {
    await openPane(page);
    const reply = flows(page).getByRole('button', { name: 'Add reply' });
    // The checkout request is answered by the 201.
    await option(page, 1).click();
    await expect(flows(page).getByRole('region', { name: 'Selected step' })).toBeVisible();
    await expect(reply).toHaveCount(0);
    // On the main flow, the cart request waits (its answers are in the scenarios).
    await option(page, 2).click();
    await expect(reply).toBeVisible();
    // On a scenario's tab it is answered.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await option(page, 2).click();
    await expect(flows(page).getByRole('region', { name: 'Selected step' })).toContainText('Step 2');
    await expect(reply).toHaveCount(0);
  });

  test('a "+" between a step and the block after it adds there, not into the block', async ({ page }) => {
    await openPane(page);
    // After step 2, before the folded scenarios.
    await (await insertPoint(page, 'Add a step after step 2')).click();
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'cache');
    await chooseOption(composer(page).getByLabel('Goes to'), 'Checkout API');
    await composer(page).getByRole('combobox', { name: 'Answer' }).fill('hit');
    await composer(page).getByRole('button', { name: 'Add step' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache --> api : hit\n  alt "Cart cached" {\n');
  });

  test('changing the tab or the use case closes the composer and lets its ends go', async ({ page }) => {
    await openPane(page, `${SOURCE}\nusecase "Browse" {\n  shopper -> api : GET /items\n}\n`);
    const added = flows(page).getByRole('form', { name: 'New step' });
    await (await insertPoint(page, 'Add a step at the end')).click();
    await expect(composer(page)).toBeVisible();
    await flows(page).getByRole('tab', { name: 'Cart cached' }).click();
    await expect(composer(page)).toHaveCount(0);
    await expect(added).toHaveCount(0);
    await expect(flows(page).getByRole('button', { name: 'Add a step', exact: true })).toBeVisible();

    // The top bar's use case picker, while the composer is open.
    await (await insertPoint(page, 'Add a step at the end')).click();
    await expect(composer(page)).toBeVisible();
    await chooseOption(page.getByTitle(/^Use case: the flow Play runs/), 'Browse');
    await expect(flows(page).getByRole('listbox', { name: 'Sequence of Browse' })).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    await expect(added).toHaveCount(0);
    await expect(flows(page).getByRole('button', { name: 'Add a step', exact: true })).toBeVisible();
  });

  test('at the least pane height the composer opens above its "+" when there is more room there, its buttons in sight', async ({ page }) => {
    await openPane(page);
    const handle = page.getByRole('separator', { name: 'Resize the flows pane' });
    await handle.focus();
    await page.keyboard.press('Home');
    await (await insertPoint(page, 'Add a step at the end')).click();
    const box = composer(page).locator('xpath=..');
    await expect(box).toHaveAttribute('data-placement', 'above');
    // Taller than the diagram is there, its buttons are pinned in sight.
    const scroller = (await sequence(page).evaluate((el) => el.closest('.bg-paper')!.getBoundingClientRect().toJSON())) as { top: number; bottom: number };
    await expect
      .poll(async () => {
        const b = (await composer(page).getByRole('button', { name: 'Add step' }).boundingBox())!;
        return b.y >= scroller.top && b.y + b.height <= scroller.bottom + 1;
      })
      .toBe(true);
  });
});

/** A phone keeps the list of steps in its sheet, each row with its own actions. */
test.describe('the Flows list on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('edits, moves and inserts steps in their rows, and Reply answers the open request', async ({ page }) => {
    await page.goto(`app/#code=${lz.compressToEncodedURIComponent(SOURCE)}`);
    await waitForCanvas(page, 6);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const sheet = page.getByTestId('palette-dock');
    const list = sheet.getByRole('region', { name: 'Flows' });
    const steps = list.getByRole('list', { name: 'Steps' });
    await expect(page.getByTestId('flows-pane')).toHaveCount(0);
    await expect(steps.getByRole('group', { name: 'Scenario Cart expired' })).toContainText('SELECT cart');

    await steps.getByRole('button', { name: 'Edit step: Checkout API to Cart cache: GET cart' }).click();
    const edit = list.getByRole('form', { name: 'Edit step' });
    await edit.getByRole('combobox', { name: 'Operation' }).fill('MGET cart');
    await edit.getByRole('button', { name: 'Save step' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : MGET cart\n');

    // A row's actions show while it has the focus.
    await steps.getByRole('button', { name: 'Edit step: Checkout API to Cart cache: MGET cart' }).focus();
    await steps.getByRole('button', { name: 'Move up: Checkout API to Cart cache: MGET cart' }).click();
    await expect.poll(() => useCase(page)).toContain('usecase "Checkout" {\n  api -> cache : MGET cart\n  shopper -> api : POST /checkout\n');
    await steps.getByRole('button', { name: 'Edit step: Checkout API to Cart cache: MGET cart' }).press('Alt+ArrowDown');
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout\n  api -> cache : MGET cart\n');

    await steps.getByRole('button', { name: 'Edit step: Checkout API answers Shopper: 201' }).focus();
    await steps.getByRole('button', { name: 'Insert a step before: Checkout API answers Shopper: 201' }).click();
    const insert = list.getByRole('form', { name: 'New step' });
    await expect(insert.getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await chooseOption(insert.getByLabel('Goes to'), 'Email');
    await insert.getByRole('combobox', { name: 'Operation' }).fill('SEND receipt');
    await insert.getByRole('button', { name: 'Insert step' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> mail : SEND receipt\n  api --> shopper : 201\n');

    // Reply answers the latest open request, the receipt.
    await list.getByRole('button', { name: 'Reply to Checkout API' }).click();
    const reply = list.getByRole('form', { name: 'New step' });
    await expect(reply.getByLabel('Starts at')).toHaveAttribute('data-value', 'mail');
    await expect(reply.getByLabel('Goes to')).toHaveAttribute('data-value', 'api');
  });
});

test('a group made on the pane is in the code editor\'s history: Code mode undoes it', async ({ page }) => {
  await openPane(page);
  const original = await useCase(page);
  await option(page, 1).click();
  await option(page, 2).click({ modifiers: ['Shift'] });
  await flows(page).getByRole('region', { name: 'Selected steps' }).getByRole('button', { name: 'Run at the same time' }).click();
  await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n');
  await setMode(page, 'code');
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => useCase(page)).toBe(original);
});
