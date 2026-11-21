import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, chooseOption, codeEditor, editorText, expect, setMode, test, waitForCanvas } from './fixtures';

// The rows slide when room opens under a step; without the motion, where they end is where they are.
test.use({ mode: 'visual', contextOptions: { reducedMotion: 'reduce' } });

/**
 * Editing a use case on the Flows view's sequence diagram: an "Add step" row,
 * a "+" between the messages, a drag from one lifeline to another or N starts
 * a draft arrow there, whose ends are clicked and label typed in place, Enter
 * adding it and starting the next; "+ Lane" adds a component's lane; a
 * selected message has a toolbar under it (its kind, Add reply, move, details,
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

/** The use case with no answer from the cart cache: the cart request waits for one, and the first branch is empty. */
const UNANSWERED = SOURCE.replace('    cache --> api : cart\n', '').replace('    cache --> api : nil\n', '');

const flows = (page: Page) => page.getByRole('region', { name: 'Flows' });
const sequence = (page: Page) => flows(page).getByRole('listbox', { name: 'Sequence of Checkout' });
const option = (page: Page, n: number) => sequence(page).getByRole('option', { name: new RegExp(`^${n}\\. `) });
/** The draft arrow's row, while a new step's ends and label are being picked. */
const draft = (page: Page) => flows(page).locator('[data-draft]');
/** Its band, which takes the clicks and keys that pick a lane. */
const draftBand = (page: Page) => draft(page).locator('[data-draft-band]');
/** Its hint, saying what to pick next. */
const draftStatus = (page: Page) => draft(page).locator('[data-draft-status]');
/** Its label's field, on the arrow once both ends are known. */
const draftField = (page: Page, name: 'Operation' | 'Answer' | RegExp = /^(Operation|Answer|Event|Label)/) => draft(page).locator('[data-draft-field]').getByRole('combobox', { name });
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
  test('a "+" starts the draft arrow there, from where the last step went; "+ Lane" gives it a component not in the flow; Enter adds it and chains', async ({ page }) => {
    await openPane(page);
    await (await insertPoint(page, 'Add a step before step 2')).click();
    // It starts where step 1 went; the focus is on its row, which asks where it goes.
    await expect(draftStatus(page)).toHaveText('From Checkout API. Click where it goes.');
    await expect(draftBand(page)).toBeFocused();
    await expect(page.getByTestId('flows-news')).toHaveText('New step from Checkout API. Choose where it goes.');
    // A component that has no lane yet: "+ Lane" lists the design's others, and picks it for the draft.
    await flows(page).getByRole('button', { name: 'Lane', exact: true }).click();
    const lanes = page.getByRole('dialog', { name: 'Add a lane' });
    await expect(lanes.getByRole('option')).toHaveText([/^Email/, 'New component…']);
    await lanes.getByRole('combobox', { name: 'Component' }).fill('ema');
    await page.keyboard.press('Enter');
    await expect(flows(page).locator('[data-lane="mail"]')).toBeVisible();
    // Both ends known: the label's field on the arrow, the type's operations offered.
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('SEND receipt');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout\n  api -> mail : SEND receipt\n  api -> cache : GET cart\n');
    await expect.poll(() => editorText(page)).toContain('api -> mail');
    await expect(option(page, 2)).toHaveAccessibleName('2. Checkout API to Email: SEND receipt');
    // The next draft starts where it went, right after it.
    await expect(draftStatus(page)).toHaveText('Added. Next from Email: click where it goes. Escape to stop.');
    await expect(page.getByTestId('flows-news')).toHaveText('Step 2 added.');
    const [added, row] = [(await option(page, 2).boundingBox())!, (await draft(page).boundingBox())!];
    expect(row.y).toBeGreaterThanOrEqual(added.y + added.height - 2);
    expect(row.y + row.height).toBeLessThanOrEqual((await option(page, 3).boundingBox())!.y + 2);

    // Escape stops, the focus back on the diagram.
    await page.keyboard.press('Escape');
    await expect(draft(page)).toHaveCount(0);
    await expect(sequence(page).getByRole('option').first()).toBeFocused();

    // With a branch shown on its set's tab, its frame's "Add step" row adds to it; the request waiting for an answer is offered first.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await flows(page).getByRole('button', { name: 'Add a step to Cart expired' }).click();
    await expect(draftStatus(page)).toHaveText('From Orders DB. Click where it goes.');
    const reply = draft(page).getByRole('button', { name: /^Reply to 5: Orders DB answers Checkout API$/ });
    await expect(reply).toBeVisible();
    // Enter takes it: an answer, back to the caller.
    await page.keyboard.press('Enter');
    await expect(draft(page).getByRole('toolbar', { name: 'New step' }).getByRole('button', { name: 'Response' })).toHaveAttribute('aria-pressed', 'true');
    await expect(draftField(page, 'Answer')).toBeFocused();
    await page.keyboard.type('3 rows');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('    api -> db : SELECT cart\n    db --> api : 3 rows\n  }\n');
    await page.keyboard.press('Escape');
    await expect(draft(page)).toHaveCount(0);
  });

  test('a drag from one lifeline to another starts the draft with both ends, to a lane next to it or farther', async ({ page }) => {
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
    await expect(draft(page)).toHaveCount(0);

    // Between steps 1 and 2, from the shopper past the API to the cache: the label's field takes the focus.
    const first = (await option(page, 1).boundingBox())!;
    const top = (await lifeline('shopper')).y;
    await drag('shopper', 'cache', first.y + first.height - top + 2);
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('GET session');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  shopper -> api : POST /checkout\n  shopper -> cache : GET session\n  api -> cache : GET cart\n');
    await page.keyboard.press('Escape');

    // To the lane next to it, at the end (scrolled to the bottom).
    await surface(page).evaluate((el) => el.scrollTo(0, 10_000));
    const last = (await sequence(page).getByRole('option').last().boundingBox())!;
    await drag('api', 'cache', last.y + last.height - (await lifeline('api')).y + 1);
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('DEL cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}api --> shopper : 201\n {2}api -> cache : DEL cart\n\}$/);
  });

  test('one way to add a step: one "Add step" row per flow and frame and nothing else; N starts the draft, Enter chains, Escape cancels', async ({ page }) => {
    await openPane(page, SOURCE.replace(/ {2}par \{\n[\s\S]*?\n {2}\}\n/, ''));
    // Every add affordance there was or is, but the hover "+"s (named for the step they are by).
    const adds = () => flows(page).getByRole('button', { name: /^(add step|add a step|add the first step|new step|add alongside|add a step to .*)$/i }).filter({ visible: true });
    // The scenario frame's row and the flow's own, and nothing in the bar or on the frames' strips.
    await expect(adds()).toHaveText(['Add step', 'Add step']);
    await expect(flows(page).locator('[data-add-row]')).toHaveCount(2);

    // N, from the diagram: a draft at the end, from where the last step went (the shopper).
    await option(page, 1).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    await expect(draftStatus(page)).toHaveText('From Shopper. Click where it goes.');
    await expect(flows(page).locator('[data-add-row]')).toHaveCount(0);
    // The arrow keys aim at a lane, Enter takes it; the label, then Enter adds it and the next starts from there.
    await page.keyboard.press('ArrowRight');
    await expect(flows(page).locator('[data-draft-arrow="lane"]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('GET /orders');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}api --> shopper : 201\n {2}shopper -> api : GET \/orders\n\}$/);
    await expect(draftStatus(page)).toHaveText('Added. Next from Checkout API: click where it goes. Escape to stop.');
    await expect(draftBand(page)).toBeFocused();
    await flows(page).getByRole('button', { name: 'Pick Orders DB' }).click();
    await page.keyboard.type('SELECT orders');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}shopper -> api : GET \/orders\n {2}api -> db : SELECT orders\n\}$/);
    // Escape with a target picked and a label typed: nothing more is added, the draft is gone.
    await expect(draft(page).getByRole('button', { name: /^Reply to 6: Orders DB answers Checkout API$/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('12 rows');
    const before = await useCase(page);
    await page.keyboard.press('Escape');
    await expect(draft(page)).toHaveCount(0);
    expect(await useCase(page)).toBe(before);
    await expect(adds()).toHaveText(['Add step', 'Add step']);
    // Each added step is one undo.
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).not.toContain('SELECT orders');
    await expect.poll(() => useCase(page)).toContain('GET /orders');

    // Shift+N on a selected step: before it, from where the step before it went.
    await option(page, 2).click();
    await page.keyboard.press('Shift+N');
    await expect(draftStatus(page)).toHaveText('From Checkout API. Click where it goes.');
    const [row, second] = [(await draft(page).boundingBox())!, (await option(page, 2).boundingBox())!];
    expect(row.y + row.height).toBeLessThanOrEqual(second.y + 2);
    // A click on the start's own lane starts over: it asks where the step starts.
    await flows(page).getByRole('button', { name: 'Pick Checkout API' }).click();
    await expect(draftStatus(page)).toHaveText('Click the component that starts the flow.');
  });

  test('"+ Lane" shows a component no step uses yet, dashed; a selected step\'s end dragged onto it goes there', async ({ page }) => {
    await openPane(page);
    await flows(page).getByRole('button', { name: 'Lane', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add a lane' }).getByRole('option', { name: /^Email/ }).click();
    const mail = flows(page).locator('[data-lane="mail"]');
    await expect(mail).toBeVisible();
    await expect(mail).toHaveAttribute('data-dashed', 'true');
    await expect(page.getByTestId('flows-news')).toHaveText('Email has a lane.');
    // Its list has none of the lanes now, and goes to the architecture for a new component.
    await flows(page).getByRole('button', { name: 'Lane', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add a lane' }).getByRole('option')).toHaveText(['New component…']);
    await page.keyboard.press('Escape');

    // The cart request's head, dragged onto the new lane.
    await option(page, 2).click();
    const handle = (await flows(page).locator('[data-end-handle="to"]').boundingBox())!;
    const lane = (await mail.boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(lane.x + lane.width / 2, handle.y + handle.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => useCase(page)).toContain('  api -> mail : GET cart\n');
    await expect(mail).not.toHaveAttribute('data-dashed', 'true');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n');
    // Still shown, dashed again, until the use case changes.
    await expect(mail).toHaveAttribute('data-dashed', 'true');
  });

  test("a selected step's toolbar sits in room the rows below make: nothing of the diagram is covered, a par frame's Ungroup neither", async ({ page }) => {
    await openPane(page);
    const ungroup = flows(page).getByRole('button', { name: 'Ungroup' });
    /** Whether the point at the middle of `el` is its own (nothing drawn over it). */
    const clear = (el: ReturnType<typeof flows>) => el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    // Where each row is with nothing selected.
    const ys = await Promise.all([1, 2, 3, 4, 5, 6].map(async (k) => (await option(page, k).boundingBox())!.y));
    // The par block's first step and its last.
    for (const n of [4, 5]) {
      const below = { y: ys[n] };
      await option(page, n).click();
      const bar = toolbar(page, `Step ${n}`);
      await expect(bar).toBeVisible();
      expect(await clear(ungroup)).toBe(true);
      // Under its row; the next row moved down under it.
      const [row, box] = [(await option(page, n).boundingBox())!, (await bar.boundingBox())!];
      expect(box.y).toBeGreaterThanOrEqual(row.y + row.height);
      await expect.poll(async () => (await option(page, n + 1).boundingBox())!.y).toBeGreaterThanOrEqual(box.y + box.height);
      expect((await option(page, n + 1).boundingBox())!.y).toBeGreaterThan(below.y);
      // Every row's label is its own.
      for (let k = 1; k <= 6; k++) expect(await clear(option(page, k).locator('span').first()), `step ${k} with step ${n} selected`).toBe(true);
    }
    // Ungroup takes the click.
    await ungroup.click();
    await expect(flows(page).locator('[data-frame="parallel"]')).toHaveCount(0);
  });

  test('a selected message has its toolbar under it: its kind changes at once, by a click or 1 to 4, and undo takes each back; there is no column and no Save', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    // The side column and its form are gone: the view is the diagram alone.
    await expect(page.locator('[data-flows-column]')).toHaveCount(0);
    await expect(flows(page).getByRole('region', { name: 'Use case Checkout' })).toHaveCount(0);

    await option(page, 2).click();
    const bar = toolbar(page, 'Step 2');
    await expect(bar).toBeVisible();
    // Under the row, not on it.
    const [row, box] = [(await option(page, 2).boundingBox())!, (await bar.boundingBox())!];
    expect(box.y).toBeGreaterThanOrEqual(row.y + row.height);
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
    await option(page, 6).click();
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
    await option(page, 6).click({ modifiers: ['ControlOrMeta'] });
    await toolbar(page, '2 steps selected').getByRole('button', { name: 'Run at the same time' }).click();
    await expect(flows(page).getByRole('alert')).toHaveText(/follow each other/);
    expect(await useCase(page)).toBe(original);

    // A par frame's actions: one more step alongside (its "Add alongside" row), then ungroup.
    await option(page, 1).click();
    await flows(page).getByRole('button', { name: 'Add alongside' }).click();
    await expect(draftStatus(page)).toHaveText('From Order events. Click where it goes.');
    // A click on its start starts over: from the API, to the cache.
    await flows(page).getByRole('button', { name: 'Pick Order events' }).click();
    await flows(page).getByRole('button', { name: 'Pick Checkout API' }).click();
    await flows(page).getByRole('button', { name: 'Pick Cart cache' }).click();
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('DEL cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('    api ->> events : PUBLISH OrderPlaced\n    api -> cache : DEL cart\n  }\n');
    await page.keyboard.press('Escape');
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
    await option(page, 6).click();
    await option(page, 5).click({ modifiers: ['ControlOrMeta'] });
    await expect(flows(page).getByText(/Step 5 already runs at the same time/)).toBeVisible();
    await expect(run).toHaveCount(0);
  });

  test("while a step's ends are picked, a lane's header or its row picks its component, by the pointer or the keys", async ({ page }) => {
    await openPane(page);
    const header = (name: string) => flows(page).getByRole('button', { name: `Pick ${name}`, exact: true });
    // Nothing is being picked: the headers only show the lanes.
    await expect(header('Orders DB')).toHaveCount(0);

    await flows(page).getByRole('button', { name: 'Add step', exact: true }).click();
    // From where the last step went; a header lights up under the pointer.
    await expect(draftStatus(page)).toHaveText('From Shopper. Click where it goes.');
    const cache = header('Cart cache');
    const idle = await cache.evaluate((el) => getComputedStyle(el).backgroundColor);
    await cache.hover();
    await expect.poll(() => cache.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(idle);

    // By the keys: Tab goes from header to header, the focused one ringed, and Enter picks it.
    await page.mouse.move(0, 0);
    const db = header('Orders DB');
    const unfocused = await db.evaluate((el) => getComputedStyle(el).boxShadow);
    await cache.focus();
    await page.keyboard.press('Tab');
    await expect(db).toBeFocused();
    await expect.poll(() => db.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(unfocused);
    await page.keyboard.press('Enter');
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(draft(page)).toHaveCount(0);

    // A click on the draft's row picks the lane nearest it.
    await option(page, 1).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('n');
    const band = (await draftBand(page).boundingBox())!;
    const line = (await flows(page).locator('[data-lifeline="cache"]').boundingBox())!;
    await page.mouse.click(line.x + line.width / 2 + 6, band.y + band.height / 2);
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draftField(page)).toBeFocused();
    await page.keyboard.type('DEL cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toMatch(/ {2}shopper -> cache : DEL cart\n\}$/);
  });

  test("while a step's ends are picked, the map's components pick them, the way it goes lit up; otherwise the map is only a picture", async ({ page }) => {
    await openPane(page);
    const map = page.getByTestId('flows-map');
    // Nothing picked: no buttons on it.
    await expect(map.locator('[data-map-node]')).toHaveCount(6);
    await expect(map.getByRole('button', { name: 'Orders DB', exact: true })).toHaveCount(0);
    await flows(page).getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(draftStatus(page)).toHaveText('From Shopper. Click where it goes.');
    // The map keeps its title; what to click is a small hint in it.
    await expect(map.getByRole('heading')).toHaveText('Architecture');
    await expect(map.locator('[data-map-hint]')).toHaveText('Click where it goes');
    await onMap(page, 'Email').click();
    await expect(draftField(page)).toBeFocused();
    // Not connected: the map draws the way it would go, dashed.
    await expect(map.locator('[data-map-missing]')).toHaveCount(1);
    // Another component: it goes there instead.
    await onMap(page, 'Checkout API').click();
    await expect(map.locator('[data-map-missing]')).toHaveCount(0);
    await expect(map.locator('[data-map-edge][data-active]')).toHaveCount(1);
    // Done, it is a picture again.
    await draft(page).getByRole('button', { name: 'Stop adding steps' }).click();
    await expect(draft(page)).toHaveCount(0);
    await expect(map.getByRole('button', { name: 'Orders DB', exact: true })).toHaveCount(0);
  });

  test('Add reply answers a selected request right after it, before the block that follows', async ({ page }) => {
    await openPane(page, UNANSWERED);
    await option(page, 2).click();
    await flows(page).getByRole('button', { name: 'Add reply' }).click();
    // Both ends known, back the way the request went: an answer.
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draft(page).getByRole('toolbar', { name: 'New step' }).getByRole('button', { name: 'Response' })).toHaveAttribute('aria-pressed', 'true');
    await expect(draftField(page, 'Answer')).toBeFocused();
    await page.keyboard.type('cart');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache --> api : cart\n  alt "Cart cached" {\n  } alt "Cart expired" {\n');
    // A response has no reply.
    await option(page, 3).click();
    await expect(toolbar(page, 'Step 3')).toBeVisible();
    await expect(flows(page).getByRole('button', { name: 'Add reply' })).toHaveCount(0);
  });

  test('by the keyboard alone: a "+" takes the focus, Shift+Down selects several, and the header runs them at the same time', async ({ page }) => {
    await openPane(page);
    const end = flows(page).getByRole('button', { name: 'Add step', exact: true });
    await end.focus();
    await expect(end).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(draftBand(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(draft(page)).toHaveCount(0);

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

/** The use case with a second set of scenarios after the answer: two frames, each its own tabs. */
const TWO_SETS = SOURCE.replace('  api --> shopper : 201\n', '  api --> shopper : 201\n  alt "Mail sent" {\n    api -> mail : SEND receipt\n  } alt "Mail failed" {\n    api -x mail : SEND receipt\n  }\n');

test.describe('scenario tabs on the frames', () => {
  const strip = (page: Page, set = 0) => flows(page).locator(`[data-frame-title="scenario"][data-set="${set}"]`);
  const tab = (page: Page, name: string, set = 0) => strip(page, set).getByRole('tab', { name, exact: true });

  test("a scenario is named on its set's tab, in place; a double click renames it, its menu deletes it; each one edit of the text, undone", async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    // "+" on the strip: a field on a new tab; Escape writes nothing. Typed keys are the name's, not the view's shortcuts.
    await option(page, 1).click();
    await strip(page).getByRole('button', { name: 'Add a scenario here' }).click();
    const field = strip(page).getByRole('textbox', { name: 'New scenario' });
    await expect(field).toBeFocused();
    await field.pressSequentially('n1[]dx');
    await expect(field).toHaveValue('n1[]dx');
    await expect(draft(page)).toHaveCount(0);
    expect(await useCase(page)).toBe(original);
    await field.press('Escape');
    await expect(field).toHaveCount(0);
    expect(await useCase(page)).toBe(original);
    // Named and Enter: a branch of that set, shown, its frame empty.
    await strip(page).getByRole('button', { name: 'Add a scenario here' }).click();
    await field.fill('Cart locked');
    await field.press('Enter');
    await expect(tab(page, 'Cart locked')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => useCase(page)).toContain('    api -> db : SELECT cart\n  }\n  alt "Cart locked" {\n  }\n  par {\n');
    await expect(strip(page).getByRole('tab')).toHaveText(['Cart cached', 'Cart expired', 'Cart locked']);
    await expect(flows(page).getByText('No steps yet.')).toBeVisible();
    await expect(page.getByTestId('flows-news')).toHaveText('Scenario Cart locked added.');

    // A double click renames it on its tab.
    await tab(page, 'Cart locked').dblclick();
    const rename = strip(page).getByRole('textbox', { name: 'Rename the scenario Cart locked' });
    await expect(rename).toBeFocused();
    await rename.fill('Cart held');
    await rename.press('Enter');
    await expect(tab(page, 'Cart held')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => useCase(page)).toContain('  alt "Cart held" {\n  }\n');

    // Its menu deletes it; one that opens on the line that closes the one before can't be, and says why.
    await strip(page).getByRole('button', { name: 'Scenario Cart held actions' }).click();
    await page.getByRole('menuitem', { name: /^Delete this scenario/ }).click();
    await expect.poll(() => useCase(page)).not.toContain('Cart held');
    await expect(strip(page).getByRole('tab')).toHaveText(['Cart cached', 'Cart expired']);
    await tab(page, 'Cart expired').click();
    await strip(page).getByRole('button', { name: 'Scenario Cart expired actions' }).click();
    await expect(page.getByRole('menuitem', { name: /^Delete this scenario/ })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /^Delete this scenario/ })).toContainText('delete it in Code mode');
    await page.keyboard.press('Escape');

    // Each was one edit: undo takes them back one by one.
    for (const text of ['Cart held', 'Cart locked']) {
      await sequence(page).getByRole('option').first().click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => useCase(page)).toContain(`alt "${text}"`);
    }
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);
  });

  test('each set shows its own branch, chosen on its tabs or with [ and ]; the bar names them', async ({ page }) => {
    await openPane(page, TWO_SETS);
    await expect(flows(page).locator('[data-frame="scenario"]')).toHaveCount(2);
    await expect(strip(page, 1).getByRole('tab')).toHaveText(['Mail sent', 'Mail failed']);
    const labels = () => sequence(page).getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/^\d+\. /, '')));
    // The first branch of each, by default.
    await expect.poll(labels).toContain('Cart cache answers Checkout API: cart (response)');
    await expect.poll(labels).toContain('Checkout API to Email: SEND receipt');
    await expect(flows(page).getByTestId('flows-scenario')).toHaveText('›Cart cached›Mail sent');
    // One set's tab leaves the other's branch as it was.
    await tab(page, 'Mail failed', 1).click();
    await tab(page, 'Cart expired').click();
    await expect(tab(page, 'Mail failed', 1)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(labels).toContain('Checkout API to Email: SEND receipt (fails)');
    await expect.poll(labels).toContain('Checkout API to Orders DB: SELECT cart');
    await expect(flows(page).getByTestId('flows-scenario')).toHaveText('›Cart expired›Mail failed');
    // ] and [ on a step of a set show its next branch and the one before, its first step selected.
    await sequence(page).getByRole('option', { name: /SEND receipt \(fails\)/ }).click();
    await page.keyboard.press(']');
    await expect(tab(page, 'Mail sent', 1)).toHaveAttribute('aria-selected', 'true');
    await expect(sequence(page).getByRole('option', { name: /Email: SEND receipt$/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Cart expired')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('[');
    await expect(tab(page, 'Mail failed', 1)).toHaveAttribute('aria-selected', 'true');
    // A step of another branch of the same set added there goes to that branch: the text round-trips.
    await flows(page).getByRole('button', { name: 'Add a step to Mail failed' }).click();
    await flows(page).getByRole('button', { name: 'Pick Order events' }).click();
    await page.keyboard.type('PUBLISH MailFailed');
    await page.keyboard.press('Enter');
    // It starts where that branch's last step went, the mail sender.
    await expect.poll(() => useCase(page)).toContain('    api -x mail : SEND receipt\n    mail -> events : PUBLISH MailFailed\n  }\n}');
  });
});

test.describe('the first step and the scenarios the problem asks for', () => {
  test("the prompt of the first step never takes a click meant for the lane under it", async ({ page }) => {
    await openPane(page, SOURCE.replace(/usecase "Checkout" \{[\s\S]*\}\n/, 'usecase "Checkout" {\n}\n'));
    const prompt = draft(page).locator('[data-draft-prompt]');
    await expect(draftStatus(page)).toHaveText('Shopper starts. Click what it calls.');
    // One thing to do: no Add scenario before the first step.
    await expect(flows(page).getByRole('button', { name: 'Add scenario', exact: true })).toHaveCount(0);
    const [box, lane] = [(await prompt.boundingBox())!, (await flows(page).locator('[data-lifeline="api"]').boundingBox())!];
    const x = lane.x + lane.width / 2;
    expect(x).toBeGreaterThan(box.x);
    expect(x).toBeLessThan(box.x + box.width);
    await page.mouse.click(x, box.y + box.height / 2);
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draftField(page)).toBeFocused();
  });

  test("the problem's scenarios under a name being typed wrap, and the frame makes room for them: its first row stays its own", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    const mix = 'traffic {\n  "Checkout" 10 rps mix "Cart cached" 50%, "Cart expired" 20%, "Cart locked by another session" 10%, "Coupon rejected at the till" 10%, "Payment provider down" 10%\n}\n';
    await openPane(page, `${SOURCE}\n${mix}`);
    await flows(page).locator('[data-frame-title="scenario"]').getByRole('button', { name: 'Add a scenario here' }).click();
    const chips = flows(page).getByRole('group', { name: 'Scenarios the problem asks for' });
    await expect(chips.getByRole('button')).toHaveText(['Cart locked by another session', 'Coupon rejected at the till', 'Payment provider down']);
    // Under the chips, the branch's first row: nothing over its label.
    const row = option(page, 3);
    const [c, r] = [(await chips.boundingBox())!, (await row.boundingBox())!];
    expect(c.y + c.height).toBeLessThanOrEqual(r.y + 2);
    expect(await row.locator('span').first().evaluate((el) => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); })).toBe(true);
    // A chip adds that scenario, shown.
    await chips.getByRole('button', { name: 'Coupon rejected at the till' }).click();
    await expect(flows(page).getByRole('tab', { name: 'Coupon rejected at the till' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => useCase(page)).toContain('  alt "Coupon rejected at the till" {\n  }\n');
  });
});

test.describe('lanes no step in sight uses, at 1024px', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  /** A long first label, so the lanes don't fit, and the email sender used only in the branch not shown. */
  const FOLD = SOURCE.replace('POST /checkout', 'POST /checkout {"cart": 42, "coupon": "WINTER-SALE-2026"}').replace('    api -> db : SELECT cart\n', '    api -> db : SELECT cart\n    api ->> mail : SEND CartExpired\n');

  test('fold to a sliver when the lanes do not fit; showing its branch or a click unfolds one, and it still picks', async ({ page }) => {
    await openPane(page, FOLD);
    const mail = flows(page).locator('[data-lane="mail"]');
    await expect(mail).toHaveAttribute('data-folded', 'true');
    expect((await mail.boundingBox())!.width).toBeLessThanOrEqual(30);
    // Its branch shown, it is in use.
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await expect(mail).not.toHaveAttribute('data-folded', 'true');
    await flows(page).getByRole('tab', { name: 'Cart cached' }).click();
    await expect(mail).toHaveAttribute('data-folded', 'true');
    // While a step's ends are picked, a click on it picks it, and shows it.
    await flows(page).getByRole('button', { name: 'Add step', exact: true }).click();
    await mail.click();
    await expect(flows(page).locator('[data-draft-arrow="set"]')).toHaveCount(1);
    await expect(draftField(page)).toBeFocused();
    await expect(mail).not.toHaveAttribute('data-folded', 'true');
    await page.keyboard.press('Escape');

    // Otherwise a click only shows it.
    const other = await page.context().newPage();
    await openPane(other, FOLD);
    const folded = flows(other).locator('[data-lane="mail"]');
    await expect(folded).toHaveAttribute('data-folded', 'true');
    await folded.click();
    await expect(folded).not.toHaveAttribute('data-folded', 'true');
    await expect(draft(other)).toHaveCount(0);
  });
});

test.describe('dragging a step to move it', () => {
  test('a message dragged by its middle shows where it lands, moves there in one edit, selected; undo and Escape take it back', async ({ page }) => {
    await openPane(page);
    const original = await useCase(page);
    const drag = async (n: number, to: { x: number; y: number }, drop = true) => {
      const box = (await option(page, n).boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      if (drop) await page.mouse.up();
    };
    // The checkout request, past the cart request: the pink line under it, mid-drag, the request faded.
    const second = (await option(page, 2).boundingBox())!;
    const first = (await option(page, 1).boundingBox())!;
    await drag(1, { x: first.x + first.width / 2, y: second.y + second.height + 4 }, false);
    const line = flows(page).locator('[data-drop-indicator]');
    await expect(line).toBeVisible();
    const at = (await line.boundingBox())!;
    expect(at.y).toBeGreaterThan(second.y);
    await expect(option(page, 1)).toHaveCSS('opacity', '0.35');
    await page.mouse.up();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  shopper -> api : POST /checkout\n  alt "Cart cached" {\n');
    await expect(line).toHaveCount(0);
    await expect(sequence(page).getByRole('option', { name: /POST \/checkout/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('flows-news')).toHaveText('Step moved.');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => useCase(page)).toBe(original);

    // Into a frame: the frame it lands in lights up; the 201 into the par block.
    const insert = (await option(page, 4).boundingBox())!;
    await drag(6, { x: insert.x + insert.width / 2, y: insert.y + insert.height + 4 }, false);
    await expect(flows(page).locator('[data-frame="parallel"][data-drop]')).toHaveCount(1);
    await page.mouse.up();
    await expect.poll(() => useCase(page)).toContain('    api -> db : INSERT order\n    api --> shopper : 201\n    api ->> events : PUBLISH OrderPlaced\n  }\n');

    // Escape mid-drag lets it go where it was.
    const now = await useCase(page);
    await drag(1, { x: first.x + first.width / 2, y: second.y + second.height + 4 }, false);
    await expect(line).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(line).toHaveCount(0);
    expect(await useCase(page)).toBe(now);
    // A click is not a drag: it selects.
    await option(page, 3).click();
    await expect(option(page, 3)).toHaveAttribute('aria-selected', 'true');
    expect(await useCase(page)).toBe(now);
  });
});

test.describe('the Flows view, polished', () => {
  test('a "+" between rows shows only with the pointer on its row or the focus on it', async ({ page }) => {
    await openPane(page);
    const plus = flows(page).getByRole('button', { name: 'Add a step before step 2', exact: true });
    const other = flows(page).getByRole('button', { name: 'Add a step after step 2', exact: true });
    const opacity = (el: typeof plus) => el.evaluate((node) => Number(getComputedStyle(node).opacity));
    await page.mouse.move(0, 0);
    await expect.poll(() => opacity(plus)).toBe(0);
    // The pointer on the second row's top edge: its "+", and no other.
    const row = (await option(page, 2).boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + 2);
    await expect.poll(() => opacity(plus)).toBeGreaterThan(0.5);
    expect(await opacity(other)).toBe(0);
    // Off the diagram, gone again; by the keys, there in full.
    await page.mouse.move(0, 0);
    await expect.poll(() => opacity(plus)).toBe(0);
    await plus.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(plus).toBeFocused();
    await expect.poll(() => opacity(plus)).toBe(1);
  });

  for (const width of [1024, 1440]) {
    test(`at ${width}px the prompt of a step being added is at its arrow, inside its band, which is as tall as what it holds`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openPane(page);
      // The longest prompt: a step added, the next chained from where it went.
      await (await insertPoint(page, 'Add a step before step 2')).click();
      await flows(page).getByRole('button', { name: 'Pick Order events' }).click();
      await page.keyboard.type('PUBLISH CheckoutStarted');
      await page.keyboard.press('Enter');
      await expect(draftStatus(page)).toHaveText('Added. Next from Order events: click where it goes. Escape to stop.');
      const prompt = draft(page).locator('[data-draft-prompt]');
      const [band, box] = [(await draft(page).boundingBox())!, (await prompt.boundingBox())!];
      // What is under the arrow: the prompt, and the reply offered under it.
      const column = (await prompt.locator('xpath=..').boundingBox())!;
      // Inside the band, every side.
      expect(box.x).toBeGreaterThanOrEqual(band.x);
      expect(box.x + box.width).toBeLessThanOrEqual(band.x + band.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(band.y);
      expect(box.y + box.height).toBeLessThanOrEqual(band.y + band.height + 0.5);
      // Its text wraps rather than overflows, and is legible (14px at least).
      expect(await prompt.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await draftStatus(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
      // The band ends a little under its content, no more.
      expect(column.y + column.height).toBeLessThanOrEqual(band.y + band.height + 0.5);
      expect(band.y + band.height - (column.y + column.height)).toBeLessThanOrEqual(16);
      // By its arrow: its left near the lane the arrow starts from.
      const lane = (await flows(page).locator('[data-lifeline="events"]').boundingBox())!;
      expect(Math.abs(box.x - (lane.x + lane.width / 2))).toBeLessThanOrEqual(width === 1024 ? 300 : 40);
    });
  }

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
    // The cart request is answered in the branch shown, and in the other.
    await option(page, 2).click();
    await expect(toolbar(page, 'Step 2')).toBeVisible();
    await expect(reply).toHaveCount(0);
    await flows(page).getByRole('tab', { name: 'Cart expired' }).click();
    await option(page, 2).click();
    await expect(toolbar(page, 'Step 2')).toBeVisible();
    await expect(reply).toHaveCount(0);
    // The cart's read from the database is not.
    await option(page, 4).click();
    await expect(toolbar(page, 'Step 4')).toBeVisible();
    await expect(reply).toBeVisible();
  });

  test('a "+" between a step and the block after it adds there, not into the block', async ({ page }) => {
    await openPane(page);
    // After step 2, before the set of scenarios.
    await (await insertPoint(page, 'Add a step after step 2')).click();
    await expect(draftStatus(page)).toHaveText('From Cart cache. Click where it goes.');
    await flows(page).getByRole('button', { name: 'Pick Checkout API' }).click();
    await expect(draftField(page, 'Answer')).toBeFocused();
    await page.keyboard.type('hit');
    await page.keyboard.press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache --> api : hit\n  alt "Cart cached" {\n');
  });

  test('changing the tab or the use case puts the draft away and lets its ends go', async ({ page }) => {
    await openPane(page, `${SOURCE}\nusecase "Browse" {\n  shopper -> api : GET /items\n}\n`);
    const add = flows(page).getByRole('button', { name: 'Add step', exact: true });
    const picking = flows(page).getByRole('button', { name: /^Pick / });
    await add.click();
    await expect(draft(page)).toBeVisible();
    await flows(page).getByRole('tab', { name: 'Cart cached' }).click();
    await expect(draft(page)).toHaveCount(0);
    await expect(picking).toHaveCount(0);
    await expect(add).toBeVisible();

    // The top bar's use case picker, while a draft is there.
    await add.click();
    await expect(draft(page)).toBeVisible();
    await chooseOption(page.getByTitle(/^Use case: the flow Play runs/), 'Browse');
    await expect(flows(page).getByRole('listbox', { name: 'Sequence of Browse' })).toBeVisible();
    await expect(draft(page)).toHaveCount(0);
    await expect(picking).toHaveCount(0);
    await expect(add).toBeVisible();
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
test.describe('the draft in sight, at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a step inserted mid-diagram: the view scrolls the whole draft into sight, and the operation list is not clipped', async ({ page }) => {
    await openPane(page);
    await (await insertPoint(page, 'Add a step before step 2')).click();
    await flows(page).getByRole('button', { name: 'Pick Orders DB' }).click();
    // With both ends, the operation takes the focus and its list opens.
    const field = draftField(page, 'Operation');
    await expect(field).toBeFocused();
    const list = page.getByRole('listbox', { name: 'Labels' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option').first()).toBeVisible();

    // The whole draft, its kinds too, is in the part of the view in sight.
    const view = await diagramView(page);
    await expect.poll(async () => inside((await draft(page).boundingBox())!, view)).toBe(true);
    expect(inside((await draft(page).getByRole('toolbar', { name: 'New step' }).boundingBox())!, view)).toBe(true);
    // Rows above and below it are not under it.
    for (const n of [1, 2]) expect(overlap((await option(page, n).boundingBox())!, (await draft(page).boundingBox())!)).toBe(false);

    // The list is drawn whole, nothing over it: the top of its first option and the bottom of what it shows are its own.
    const l = (await list.boundingBox())!;
    expect(l.y + l.height).toBeLessThanOrEqual(800);
    const own = (x: number, y: number) => list.evaluate((el, [px, py]) => el.contains(document.elementFromPoint(px, py)), [x, y] as const);
    expect(await own(l.x + l.width / 2, l.y + 6)).toBe(true);
    expect(await own(l.x + l.width / 2, l.y + l.height - 6)).toBe(true);
    // It shows the first eight, the rest reached by typing; an operation from it goes in the field.
    expect(await list.getByRole('option').count()).toBeLessThanOrEqual(8);
    await field.fill('INS');
    await list.getByRole('option', { name: /^INSERT/ }).first().click();
    await expect(field).toHaveValue(/^INSERT /);
    await expect(list).toHaveCount(0);
  });

  for (const [n, name] of [
    [2, 'the cart request, high in the diagram'],
    [3, 'the order insert, low in it'],
  ] as const) {
    test(`the reply draft of ${name} never covers the request it answers, which stays in sight`, async ({ page }) => {
      await openPane(page, UNANSWERED);
      await option(page, n).click();
      await flows(page).getByRole('button', { name: 'Add reply' }).click();
      await expect(draftField(page, 'Answer')).toBeFocused();
      const view = await diagramView(page);
      await expect
        .poll(async () => {
          const [row, box] = [(await option(page, n).boundingBox())!, (await draft(page).boundingBox())!];
          return { covered: overlap(row, box), rowInSight: inside(row, view), draftInSight: inside(box, view) };
        })
        .toEqual({ covered: false, rowInSight: true, draftInSight: true });
      expect(inside((await draftField(page, 'Answer').boundingBox())!, view)).toBe(true);
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
