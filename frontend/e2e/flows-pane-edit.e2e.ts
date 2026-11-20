import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, chooseOption, codeEditor, editorText, expect, setMode, test, waitForCanvas } from './fixtures';

test.use({ mode: 'visual' });

/**
 * Editing a use case on the Flows view's sequence diagram: a "+" between the
 * messages or a drag from one lifeline to another opens a composer there; a
 * selected message has a toolbar over it (its kind, Add reply, move, details,
 * delete), its label is edited on its arrow and its ends are dragged to other
 * lanes, each change at once and undoable; Alt+Up and Down move it and Delete
 * removes it, several selected run at the same time, and a par frame ungroups
 * or takes one more. Every edit is one of the text, which the code editor's
 * undo takes back.
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
/** The toolbar over the selected step (or steps). */
const toolbar = (page: Page, name: string | RegExp = /^Step \d+$/) => flows(page).getByRole('toolbar', { name });
/** A component on the Flows view's architecture map, which picks a step's end while one is picked. */
const onMap = (page: Page, name: string) => page.getByTestId('flows-map').getByRole('button', { name, exact: true });
/** The Flows view's one scrolling surface. */
const surface = (page: Page) => page.locator('[data-flows-scroller]');
/** The use case's text, from the code editor. */
const useCase = async (page: Page) => /usecase "Checkout" \{\n[\s\S]*?\n\}/.exec(await editorText(page))?.[0] ?? '';

async function openPane(page: Page, source = SOURCE) {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(source)}`);
  await waitForCanvas(page, 6);
  await page.getByRole('button', { name: 'Flows', exact: true }).click();
  await expect(sequence(page)).toBeVisible();
}

/** The "+"s show while the pointer is over the diagram (here its first lane's header, which no toolbar covers). */
async function insertPoint(page: Page, name: string) {
  await flows(page).locator('[data-lane]').first().hover();
  return flows(page).getByRole('button', { name, exact: true });
}

test.describe('editing on the Flows view', () => {
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
    await expect(toolbar(page, 'Step 2')).toBeVisible();

    // On a scenario's tab, the "+" at the end of its frame adds to it.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await (await insertPoint(page, 'Add a step at the end of Cart expired')).click();
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'db');
    await onMap(page, 'Checkout API').click();
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
    await surface(page).evaluate((el) => el.scrollTo(0, 10_000));
    const last = (await sequence(page).getByRole('option').last().boundingBox())!;
    await drag('api', 'cache', last.y + last.height - (await lifeline('api')).y + 14);
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await expect(composer(page).getByLabel('Goes to')).toHaveAttribute('data-value', 'cache');
    await page.keyboard.type('DEL cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}api --> shopper : 201\n {2}api -> cache : DEL cart\n\}$/);
  });

  test('a selected message has its toolbar over it: its kind changes at once, by a click or 1 to 4, and undo takes each back; there is no column and no Save', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    // The side column and its form are gone: the view is the diagram alone.
    await expect(page.locator('[data-flows-column]')).toHaveCount(0);
    await expect(flows(page).getByRole('region', { name: 'Use case Checkout' })).toHaveCount(0);

    await option(page, 2).click();
    const bar = toolbar(page, 'Step 2');
    await expect(bar).toBeVisible();
    // Over the row, not on it.
    const [row, box] = [(await option(page, 2).boundingBox())!, (await bar.boundingBox())!];
    expect(box.y + box.height).toBeLessThanOrEqual(row.y + 4);
    await expect(bar.getByRole('button', { name: 'Request' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Save step$/ })).toHaveCount(0);
    await expect(flows(page).getByRole('form', { name: 'Edit step' })).toHaveCount(0);

    // A click on a kind writes it, the step still selected, and says so.
    await bar.getByRole('button', { name: 'Message' }).click();
    await expect.poll(() => useCase(page)).toContain('  api ->> cache : GET cart\n');
    await expect(option(page, 2)).toHaveAccessibleName('2. Checkout API to Cart cache: GET cart (message)');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toBeFocused();
    await expect(page.getByTestId('flows-news')).toHaveText('Step 2 is now a message.');
    // 4 makes it fail, by the keys.
    await page.keyboard.press('4');
    await expect.poll(() => useCase(page)).toContain('  api -x cache : GET cart\n');
    await expect(option(page, 2)).toHaveAccessibleName(/\(fails\)$/);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toContain('  api ->> cache : GET cart\n');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);

    // The toolbar by the keys: Tab from the step reaches it, the arrows go along it, Escape goes back to the step.
    await option(page, 2).click();
    await page.keyboard.press('Tab');
    await expect(bar.getByRole('button', { name: 'Request' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('button', { name: 'Response' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api --> cache : GET cart\n');
    await page.keyboard.press('Escape');
    await expect(option(page, 2)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test('the label is edited on its arrow: Enter or a double click, the type\'s operations listed (no scroll), Enter applies, Escape keeps the old', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    await option(page, 2).click();
    await page.keyboard.press('Enter');
    const field = flows(page).getByRole('combobox', { name: 'Operation' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('GET cart');
    // On the arrow, in place of the label.
    const [row, box] = [(await option(page, 2).boundingBox())!, (await field.boundingBox())!];
    expect(box.y).toBeGreaterThanOrEqual(row.y - 2);
    expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height + 2);

    // Redis's operations: at most eight, the rest reached by typing, and the list does not scroll.
    await field.fill('');
    const list = page.getByRole('listbox', { name: 'Labels' });
    await expect(list).toBeVisible();
    expect(await list.getByRole('option').count()).toBeLessThanOrEqual(8);
    await expect(list).toContainText(/\d+ more, keep typing/);
    expect(await list.evaluate((el) => el.scrollHeight <= el.clientHeight && !/(auto|scroll)/.test(getComputedStyle(el).overflowY))).toBe(true);
    await field.fill('MGET cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : MGET cart\n');
    await expect(field).toHaveCount(0);
    await expect(option(page, 2)).toBeFocused();
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');

    // A double click edits it too; Escape puts back what was there before this edit, and writes nothing.
    await option(page, 2).dblclick();
    await expect(field).toHaveValue('MGET cart');
    await field.fill('XADD cart');
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(option(page, 2)).toHaveAccessibleName('2. Checkout API to Cart cache: MGET cart');
    await expect(option(page, 2)).toBeFocused();
    expect(await useCase(page)).toContain('  api -> cache : MGET cart\n');
    // Unchanged and left: nothing written, so one undo takes the edit back.
    await page.keyboard.press('Enter');
    await expect(field).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test("an end handle dragged to another lane changes where the step goes or starts, at once; onto the step's other end it is refused", async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    await option(page, 2).click();
    const dragEnd = async (end: 'from' | 'to', lane: string) => {
      const handle = (await flows(page).locator(`[data-end-handle="${end}"]`).boundingBox())!;
      const target = (await flows(page).locator(`[data-lane="${lane}"]`).boundingBox())!;
      const y = handle.y + handle.height / 2;
      await page.mouse.move(handle.x + handle.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, y, { steps: 10 });
      return { drop: () => page.mouse.up() };
    };
    // The head, from the cache to the orders DB: lit up while dragged, written when dropped.
    const head = await dragEnd('to', 'db');
    await expect(flows(page).locator('[data-end-ghost="lane"]')).toHaveCount(1);
    await head.drop();
    await expect.poll(() => useCase(page)).toContain('  api -> db : GET cart\n');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('flows-news')).toHaveText('Step 2 now goes to Orders DB.');
    await expect
      .poll(() => page.getByTestId('flows-map').locator('[data-map-node][data-active]').evaluateAll((els) => els.map((e) => e.getAttribute('data-map-node')).sort()))
      .toEqual(['api', 'db']);

    // The tail onto the head's lane: a step to itself, refused and said so; the text stays.
    const tail = await dragEnd('from', 'db');
    await expect(flows(page).locator('[data-end-ghost="refused"]')).toHaveCount(1);
    await tail.drop();
    await expect(flows(page).getByRole('alert')).toHaveText("A step can't go from a component to itself.");
    expect(await useCase(page)).toContain('  api -> db : GET cart\n');

    // By the keys: Alt+Right moves the head a lane on (the lanes are in the order the steps meet them), X swaps the ends.
    await option(page, 2).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n');
    await page.keyboard.press('x');
    await expect.poll(() => useCase(page)).toContain('  cache -> api : GET cart\n');
    // Each one undo step.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test('the details card opens from the toolbar or D, at the arrow and with no scroll of its own; a header applies at once, a field when left, and undo takes each back', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    await option(page, 1).click();
    await toolbar(page, 'Step 1').getByRole('button', { name: 'Headers, payload and fan-out' }).click();
    const card = flows(page).getByRole('dialog', { name: 'Details of step 1' });
    await expect(card).toBeVisible();
    expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    // Under the step, not over it or its toolbar.
    const [row, box, bar] = [(await option(page, 1).boundingBox())!, (await card.boundingBox())!, (await toolbar(page, 'Step 1').boundingBox())!];
    expect(box.y).toBeGreaterThanOrEqual(row.y + row.height - 2);
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 2);

    await card.getByPlaceholder('Filter headers').fill('author');
    await card.getByRole('button', { name: '+ Authorization' }).click();
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout header Authorization\n');
    await card.getByLabel('Payload or note').fill('{"sku": 7}');
    await expect.poll(() => useCase(page)).not.toContain('{"sku": 7}');
    await card.getByLabel('Payload or note').press('Tab');
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout header Authorization {"sku": 7}\n');
    // Escape closes it, back on the step; D opens it again.
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(option(page, 1)).toBeFocused();
    await page.keyboard.press('d');
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test('the editor has one use case picker, in its header: the bar shows the name (a click renames it) and a menu adds or deletes one', async ({ page }) => {
    await openPane(page);
    await expect(flows(page).getByRole('combobox', { name: 'Use case' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Use case' })).toHaveCount(1);
    await flows(page).getByRole('button', { name: 'Rename the use case Checkout' }).click();
    const rename = flows(page).getByRole('textbox', { name: 'Rename the use case Checkout' });
    await rename.fill('Place order');
    await rename.press('Enter');
    await expect.poll(() => editorText(page)).toContain('usecase "Place order" {');
    await expect(flows(page).getByRole('button', { name: 'Rename the use case Place order' })).toBeVisible();

    await flows(page).getByRole('button', { name: 'Use case actions' }).click();
    await page.getByRole('menuitem', { name: 'New use case…' }).click();
    const name = flows(page).getByRole('textbox', { name: 'New use case' });
    await name.fill('Browse');
    await name.press('Enter');
    await expect(page.getByTitle(/^Use case: the flow Play runs/)).toHaveText(/Browse/);
    await expect(flows(page).getByRole('button', { name: 'Rename the use case Browse' })).toBeVisible();
    await flows(page).getByRole('button', { name: 'Use case actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete this use case' }).click();
    await expect.poll(() => editorText(page)).not.toContain('usecase "Browse"');
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
    const selected = toolbar(page, '2 steps selected');
    await expect(selected).toBeVisible();
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

    // Steps that can't run at the same time say why, under the bar; Cmd/Ctrl-click adds one to the selection.
    await option(page, 1).click();
    await option(page, 5).click({ modifiers: ['ControlOrMeta'] });
    await toolbar(page, '2 steps selected').getByRole('button', { name: 'Run at the same time' }).click();
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
    await expect(run).toHaveCount(1);
    await run.click();
    await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n    api -> cache : GET cart\n  }\n');
    // The block's first step, alone: its toolbar, without the action.
    await expect(option(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(option(page, 2)).toHaveAttribute('aria-selected', 'false');
    await expect(toolbar(page, 'Step 1')).toBeVisible();
    await expect(run).toHaveCount(0);
    // Both steps of the new block, selected again: not offered, and the toolbar says why.
    await option(page, 2).click({ modifiers: ['Shift'] });
    await expect(toolbar(page, '2 steps selected')).toBeVisible();
    await expect(run).toHaveCount(0);
    await expect(flows(page).getByText('already runs at the same time as others: ungroup its block first')).toBeVisible();
    // A step of the block with one outside it: not offered either.
    await option(page, 5).click();
    await option(page, 4).click({ modifiers: ['ControlOrMeta'] });
    await expect(flows(page).getByText(/Step 4 already runs at the same time/)).toBeVisible();
    await expect(run).toHaveCount(0);
  });

  test("while a step's ends are picked, a lane's header or lifeline picks its component, by the pointer or the keys", async ({ page }) => {
    await openPane(page);
    const header = (name: string) => flows(page).getByRole('button', { name: `Pick ${name}`, exact: true });
    // Nothing is being picked: the headers only show the lanes.
    await expect(header('Orders DB')).toHaveCount(0);

    await flows(page).getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = flows(page).getByRole('form', { name: 'New step' });
    // From where the last step went; the form asks for where it goes, and a header (lit up under the pointer) picks it.
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'shopper');
    await expect(step).toContainText('Now click the component it goes to.');
    const api = header('Checkout API');
    const idle = await api.evaluate((el) => getComputedStyle(el).backgroundColor);
    await api.hover();
    await expect.poll(() => api.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(idle);
    await api.click();
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'api');

    // By the keys: Tab goes from header to header, the focused one ringed, and Enter picks it; after both ends, a pick starts over, as on the canvas.
    await page.mouse.move(0, 0);
    const db = header('Orders DB');
    const unfocused = await db.evaluate((el) => getComputedStyle(el).boxShadow);
    await api.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(db).toBeFocused();
    await expect.poll(() => db.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(unfocused);
    await page.keyboard.press('Enter');
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'db');
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', '');

    // A click on a lifeline picks too (at its top, scrolled back into sight).
    await surface(page).evaluate((el) => el.scrollTo(0, 0));
    const line = (await flows(page).locator('[data-lifeline="cache"]').boundingBox())!;
    await page.mouse.click(line.x + line.width / 2, line.y + 8);
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'cache');

    // The composer of a "+" picks from the headers too. (With both ends the operation list opened under its field: Escape puts it away.)
    await page.keyboard.press('Escape');
    await step.getByRole('button', { name: 'Cancel' }).click();
    await (await insertPoint(page, 'Add a step before step 2')).click();
    await expect(composer(page).getByLabel('Goes to')).toBeFocused();
    await header('Order events').click();
    await expect(composer(page).getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await expect(composer(page).getByLabel('Goes to')).toHaveAttribute('data-value', 'events');
  });

  test("while a step's ends are picked, the map's components pick them, the way it goes lit up; otherwise the map is only a picture", async ({ page }) => {
    await openPane(page);
    const map = page.getByTestId('flows-map');
    // Nothing picked: no buttons on it.
    await expect(map.locator('[data-map-node]')).toHaveCount(6);
    await expect(map.getByRole('button', { name: 'Orders DB', exact: true })).toHaveCount(0);
    await flows(page).getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = flows(page).getByRole('form', { name: 'New step' });
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'shopper');
    await expect(map).toContainText('Click where it goes');
    await onMap(page, 'Orders DB').click();
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'db');
    // Not connected: the map draws the way it would go, dashed.
    await expect(map.locator('[data-map-missing]')).toHaveCount(1);
    await onMap(page, 'Checkout API').click();
    // A click after both ends starts over, from there.
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'api');
    await onMap(page, 'Orders DB').click();
    await expect(map.locator('[data-map-missing]')).toHaveCount(0);
    await expect(map.locator('[data-map-edge][data-active]')).toHaveCount(1);
    // Done picking, it is a picture again. (With both ends the operation list opened under its field: Escape puts it away.)
    await page.keyboard.press('Escape');
    await step.getByRole('button', { name: 'Cancel' }).click();
    await expect(map.getByRole('button', { name: 'Orders DB', exact: true })).toHaveCount(0);
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

test.describe('the Flows view, polished', () => {
  test('labels keep a sensible width: the view scrolls sideways rather than starve them', async ({ page }) => {
    const long = SOURCE.replace('POST /checkout', 'POST /checkout {"cart": 42, "coupon": "WINTER-SALE-2026"}');
    const label = (n: number) => option(page, n).locator('span.truncate').first();
    const scroller = () => surface(page).evaluate((box) => ({ scroll: box.scrollWidth, client: box.clientWidth }));
    await openPane(page, long);
    for (const size of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(size);
      await expect.poll(async () => (await sequence(page).boundingBox())?.width ?? 0).toBeGreaterThan(0);
      // At least 200px of the label shows (it is longer).
      expect((await label(1).boundingBox())!.width).toBeGreaterThanOrEqual(195);
      // A short label shows whole.
      await expect(label(2)).toHaveText('GET cart');
      expect(await label(2).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // Where the lanes don't fit, the view scrolls sideways to the far end; where they do, they are all in sight.
      const right = await surface(page).evaluate((el) => el.getBoundingClientRect().left + el.clientWidth);
      const box = await scroller();
      const lane = async () => (await flows(page).locator('[data-lane="events"]').boundingBox())!;
      if (size.width === 1024) {
        expect(box.scroll).toBeGreaterThan(box.client);
        await surface(page).evaluate((el) => el.scrollTo(10_000, 0));
        const last = await lane();
        expect(last.x + last.width).toBeLessThanOrEqual(right + 1);
        await surface(page).evaluate((el) => el.scrollTo(0, 0));
      } else {
        expect(box.scroll).toBeLessThanOrEqual(box.client);
        const last = await lane();
        expect(last.x + last.width).toBeLessThanOrEqual(right + 1);
      }
    }
  });

  test('Add reply is only on a request that has no answer yet', async ({ page }) => {
    await openPane(page);
    const reply = flows(page).getByRole('button', { name: 'Add reply' });
    // The checkout request is answered by the 201.
    await option(page, 1).click();
    await expect(toolbar(page, 'Step 1')).toBeVisible();
    await expect(reply).toHaveCount(0);
    // On the main flow, the cart request waits (its answers are in the scenarios).
    await option(page, 2).click();
    await expect(reply).toBeVisible();
    // On a scenario's tab it is answered.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await option(page, 2).click();
    await expect(toolbar(page, 'Step 2')).toBeVisible();
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
});

type Box = { x: number; y: number; width: number; height: number };
/** The part of the diagram in sight: the view's scrolling surface, less the sticky lane headers at its top. */
async function diagramView(page: Page): Promise<{ top: number; bottom: number; left: number; right: number }> {
  return surface(page).evaluate((el) => {
    const box = el.getBoundingClientRect();
    const headers = el.querySelector('[data-lane]')!.parentElement!.getBoundingClientRect();
    return { top: headers.bottom, bottom: box.top + el.clientHeight, left: box.left, right: box.left + el.clientWidth };
  });
}
const inside = (b: Box, v: { top: number; bottom: number; left: number; right: number }) => b.y >= v.top - 0.5 && b.y + b.height <= v.bottom + 0.5 && b.x >= v.left - 0.5 && b.x + b.width <= v.right + 0.5;
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** At 1280x800, as the blog's clips were recorded. */
test.describe('the composer in sight, at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a step inserted mid-diagram: the view scrolls the whole form into sight (it has no scroll of its own), and the operation list is not clipped', async ({ page }) => {
    await openPane(page);
    await (await insertPoint(page, 'Add a step before step 2')).click();
    const step = composer(page);
    await chooseOption(step.getByLabel('Goes to'), 'Orders DB');
    // With both ends, the operation takes the focus and its list opens (no click, which would scroll the page as a test does).
    const field = step.getByRole('combobox', { name: 'Operation' });
    await expect(field).toBeFocused();
    const list = page.getByRole('listbox', { name: 'Labels' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option').first()).toBeVisible();

    const view = await diagramView(page);
    // The whole form, its buttons too, is in the part of the view in sight, and nothing in it scrolls.
    await expect.poll(async () => inside((await step.boundingBox())!, view)).toBe(true);
    expect(inside((await step.getByRole('button', { name: 'Add step' }).boundingBox())!, view)).toBe(true);
    expect(await step.evaluate((el) => el.scrollHeight <= el.clientHeight && getComputedStyle(el).overflowY === 'visible')).toBe(true);

    // The list is drawn whole, nothing over it: the top of its first option and the bottom of what it shows are its own.
    const l = (await list.boundingBox())!;
    expect(l.y + l.height).toBeLessThanOrEqual(800);
    const own = (x: number, y: number) => list.evaluate((el, [px, py]) => el.contains(document.elementFromPoint(px, py)), [x, y] as const);
    expect(await own(l.x + l.width / 2, l.y + 6)).toBe(true);
    expect(await own(l.x + l.width / 2, l.y + l.height - 6)).toBe(true);
    // It shows the first eight, the rest reached by typing; an operation from it goes in the field; typed again, the list is back, and a click elsewhere closes it.
    expect(await list.getByRole('option').count()).toBeLessThanOrEqual(8);
    await field.fill('INS');
    await list.getByRole('option', { name: /^INSERT/ }).first().click();
    await expect(field).toHaveValue(/^INSERT /);
    await expect(list).toHaveCount(0);
    await field.fill('SEL');
    await expect(list).toBeVisible();
    await step.getByRole('radio', { name: 'Message' }).click();
    await expect(list).toHaveCount(0);
  });

  for (const [n, name] of [
    [2, 'the cart request, high in the diagram'],
    [3, 'the order insert, low in it'],
  ] as const) {
    test(`the reply composer of ${name} never covers the request it answers, which stays in sight`, async ({ page }) => {
      await openPane(page);
      await option(page, n).click();
      await flows(page).getByRole('button', { name: 'Add reply' }).click();
      const step = composer(page);
      await expect(step.getByRole('radio', { name: 'Response' })).toHaveAttribute('aria-checked', 'true');
      const view = await diagramView(page);
      await expect
        .poll(async () => {
          const [row, form] = [(await option(page, n).boundingBox())!, (await step.boundingBox())!];
          return { covered: overlap(row, form), rowInSight: inside(row, view), formInSight: inside(form, view) };
        })
        .toEqual({ covered: false, rowInSight: true, formInSight: true });
      // Its field has the focus, in sight, and the form has no scroll of its own.
      const field = step.getByRole('combobox', { name: 'Answer' });
      await expect(field).toBeFocused();
      expect(inside((await field.boundingBox())!, view)).toBe(true);
      expect(await step.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    });
  }
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
    await expect(page.getByTestId('flows-view')).toHaveCount(0);
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

  test("while a step's ends are picked, a click anywhere on a node picks it: its \"+\" and dots are put away", async ({ page }) => {
    await page.goto(`app/#code=${lz.compressToEncodedURIComponent(SOURCE)}`);
    await waitForCanvas(page, 6);
    await page.getByRole('button', { name: 'Flows', exact: true }).click();
    const list = page.getByTestId('palette-dock').getByRole('region', { name: 'Flows' });
    await list.getByRole('button', { name: 'Add a step', exact: true }).click();
    const step = list.getByRole('form', { name: 'New step' });
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'shopper');
    const node = canvasNodes(page).filter({ hasText: 'Checkout API' });
    await expect(node.getByRole('button', { name: 'Add a component after Checkout API' })).toHaveCount(0);
    // Where the "+" is when nothing is picked: on the node's right edge, half way down.
    const box = (await node.boundingBox())!;
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page.getByRole('dialog', { name: 'Add after Checkout API' })).toHaveCount(0);
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'api');
    // Where its dot is, at the bottom: picked too (it starts over), no connection dragged.
    const edges = await page.locator('.react-flow__edge').count();
    const shopper = canvasNodes(page).filter({ hasText: 'Shopper' });
    const at = (await shopper.boundingBox())!;
    await page.mouse.click(at.x + at.width / 2, at.y + at.height - 1);
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'shopper');
    await expect(page.locator('.react-flow__edge')).toHaveCount(edges);
  });
});

test('a group made on the view is in the code editor\'s history: Code mode undoes it', async ({ page }) => {
  await openPane(page);
  const original = await useCase(page);
  await option(page, 1).click();
  await option(page, 2).click({ modifiers: ['Shift'] });
  await toolbar(page, '2 steps selected').getByRole('button', { name: 'Run at the same time' }).click();
  await expect.poll(() => useCase(page)).toContain('  par {\n    shopper -> api : POST /checkout\n');
  await setMode(page, 'code');
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => useCase(page)).toBe(original);
});
