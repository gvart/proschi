import type { Page } from '@playwright/test';
import lz from 'lz-string';
import { canvasNodes, chooseOption, editorText, expect, test, waitForCanvas } from './fixtures';

/**
 * Flows on a phone: the switch shows it as a view of its own, the steps as the
 * page (its one scroller) and one sheet over its foot for the step tapped or
 * added. Each edit applies at once and the bar's Undo takes it back; a row's ⋯
 * moves it, inserts before it, answers it, runs it with the next at the same
 * time or deletes it; a set of scenarios is a group with its branches as chips.
 */

test.use({ mode: 'visual', contextOptions: { reducedMotion: 'reduce' }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const PARTS = `shopper "Shopper" [Browser]
api "Checkout API" [REST API]
cache "Cart cache" [Redis]
db "Orders DB" [PostgreSQL]

shopper -> api : HTTPS
api -> cache : RESP
api -> db : SQL
`;

const view = (page: Page) => page.getByTestId('flows-view');
const steps = (page: Page) => view(page).getByRole('list', { name: 'Steps' });
const sheet = (page: Page) => view(page).getByRole('dialog');
const useCase = async (page: Page) => /usecase "Checkout" \{\n[\s\S]*?\n\}/.exec(await editorText(page))?.[0] ?? '';

async function openFlows(page: Page, source: string) {
  await page.goto(`app/#code=${lz.compressToEncodedURIComponent(source)}`);
  await waitForCanvas(page, 4);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Flows', exact: true }).click();
  await expect(view(page).getByRole('region', { name: 'Flows' })).toBeVisible();
}

/** The elements of the view that scroll (overflow auto or scroll) but its list, and how many of them all lie inside another. */
const scrollers = (page: Page) =>
  view(page).evaluate((root) => {
    const all = Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const style = getComputedStyle(el);
      return /(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX);
    });
    return { others: all.filter((el) => !el.hasAttribute('data-flows-scroller')).map((el) => `${el.tagName} ${el.className}`), nested: all.filter((a) => all.some((b) => b !== a && b.contains(a))).length };
  });

test.describe('Flows on a phone', () => {
  test('a flow built end to end: steps added in the sheet, a label and a kind changed, a step moved, two run at the same time, a scenario; one scroller, nothing nested', async ({ page }) => {
    await openFlows(page, `${PARTS}\nusecase "Checkout" {\n}\n`);
    // A view of its own, over the canvas: no tab of the canvas's sheet.
    await expect(page.getByTestId('palette-dock')).toHaveCount(0);
    expect(await scrollers(page)).toEqual({ others: [], nested: 0 });

    // One Add step: the sheet starts it from where the flow starts; Add step (or Enter) adds it and starts the next from where it went.
    await view(page).getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(sheet(page)).toHaveAccessibleName('New step 1');
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'shopper');
    await chooseOption(sheet(page).getByLabel('To'), 'Checkout API');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).fill('POST /checkout');
    await sheet(page).getByRole('button', { name: 'Add step' }).click();
    await expect(sheet(page)).toHaveAccessibleName('New step 2');
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'api');
    await chooseOption(sheet(page).getByLabel('To'), 'Cart cache');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).fill('GET cart');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).press('Enter');
    await expect(sheet(page)).toHaveAccessibleName('New step 3');
    // It starts where the last went, the cache; its start is changed in the sheet.
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'cache');
    await chooseOption(sheet(page).getByLabel('From'), 'Checkout API');
    await chooseOption(sheet(page).getByLabel('To'), 'Orders DB');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).fill('INSERT order');
    await sheet(page).getByRole('button', { name: 'Add step' }).click();
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(() => useCase(page)).toBe('usecase "Checkout" {\n  shopper -> api : POST /checkout\n  api -> cache : GET cart\n  api -> db : INSERT order\n}');

    // A tap on a step opens its sheet, the only overlay: the list behind it stays where it is, and the sheet scrolls nothing.
    const before = await steps(page).boundingBox();
    await steps(page).getByRole('button', { name: 'Step 2: Checkout API to Cart cache: GET cart' }).click();
    await expect(sheet(page)).toHaveAccessibleName('Step 2');
    expect((await steps(page).boundingBox())!.y).toBe(before!.y);
    expect(await scrollers(page)).toEqual({ others: [], nested: 0 });
    // Its operation applies when Enter is pressed, its kind on a tap, and Undo takes each back.
    await sheet(page).getByRole('combobox', { name: 'Operation' }).fill('MGET cart');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).press('Enter');
    await expect.poll(() => useCase(page)).toContain('  api -> cache : MGET cart\n');
    await sheet(page).getByRole('radio', { name: 'Message' }).click();
    await expect.poll(() => useCase(page)).toContain('  api ->> cache : MGET cart\n');
    await view(page).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : MGET cart\n');
    await expect(sheet(page).getByRole('radio', { name: 'Request' })).toHaveAttribute('aria-checked', 'true');
    await view(page).getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n');
    // The sheet follows the undo.
    await expect(sheet(page).getByRole('combobox', { name: 'Operation' })).toHaveValue('GET cart');
    await sheet(page).getByRole('button', { name: 'Done' }).click();

    // A row's ⋯ moves it.
    await steps(page).getByRole('button', { name: 'Step 3 actions' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> db : INSERT order\n  api -> cache : GET cart\n');
    await steps(page).getByRole('button', { name: 'Step 2 actions' }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  api -> db : INSERT order\n');

    // Two run at the same time, and the group's Ungroup takes them apart again.
    await steps(page).getByRole('button', { name: 'Step 2 actions' }).click();
    await page.getByRole('menuitem', { name: 'Run at the same time as the next' }).click();
    await expect.poll(() => useCase(page)).toMatch(/ {2}par \{\n {4}api -> cache : GET cart\n {4}api -> db : INSERT order\n {2}\}/);
    const together = steps(page).getByRole('group', { name: 'At the same time' });
    await expect(together.getByRole('button', { name: /^Step \d: / })).toHaveCount(2);
    await together.getByRole('button', { name: 'Ungroup' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  api -> db : INSERT order\n}');

    // A scenario: named in place at the end, its steps added from its group, a second branch next to it.
    await view(page).getByRole('button', { name: 'Add scenario' }).click();
    await view(page).getByRole('textbox', { name: 'Name the first scenario' }).fill('Paid');
    await view(page).getByRole('textbox', { name: 'Name the first scenario' }).press('Enter');
    const set = steps(page).getByRole('group', { name: 'Scenarios Paid' });
    await expect(set.getByRole('radio', { name: 'Paid' })).toHaveAttribute('aria-checked', 'true');
    await set.getByRole('button', { name: 'Add a step to Paid' }).click();
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'db');
    await chooseOption(sheet(page).getByLabel('To'), 'Checkout API');
    await sheet(page).getByRole('combobox', { name: 'Answer' }).fill('1 row');
    await sheet(page).getByRole('button', { name: 'Add step' }).click();
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => useCase(page)).toMatch(/alt "Paid" \{\n\s+db --> api : 1 row\n\s+\}/);
    await set.getByRole('button', { name: 'Add a scenario here' }).click();
    await view(page).getByRole('textbox', { name: 'Name the new scenario' }).fill('Declined');
    await view(page).getByRole('textbox', { name: 'Name the new scenario' }).press('Enter');
    const both = steps(page).getByRole('group', { name: 'Scenarios Paid, Declined' });
    await expect(both.getByRole('radio', { name: 'Declined' })).toHaveAttribute('aria-checked', 'true');
    await expect(both).toContainText('No steps in Declined yet.');
    await both.getByRole('radio', { name: 'Paid' }).click();
    await expect(both.getByRole('button', { name: /^Step 4: Orders DB answers Checkout API/ })).toBeVisible();
    expect(await scrollers(page)).toEqual({ others: [], nested: 0 });
  });

  test("a row's ⋯ inserts a step before it and answers a request; a step's sheet shows it on the architecture", async ({ page }) => {
    await openFlows(page, `${PARTS}\nusecase "Checkout" {\n  shopper -> api : POST /checkout\n  api -> cache : GET cart\n  api --> shopper : 201\n}\n`);
    await steps(page).getByRole('button', { name: 'Step 3 actions' }).click();
    await page.getByRole('menuitem', { name: 'Insert a step before' }).click();
    await expect(sheet(page)).toHaveAccessibleName('New step 3');
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'cache');
    await chooseOption(sheet(page).getByLabel('To'), 'Orders DB');
    await sheet(page).getByRole('combobox', { name: 'Operation' }).fill('SELECT cart');
    await sheet(page).getByRole('button', { name: 'Add step' }).click();
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache -> db : SELECT cart\n  api --> shopper : 201\n');

    // Reply answers the request: the callee back to its caller, right after it.
    await steps(page).getByRole('button', { name: 'Step 2 actions' }).click();
    await page.getByRole('menuitem', { name: 'Reply' }).click();
    await expect(sheet(page).getByLabel('From')).toHaveAttribute('data-value', 'cache');
    await expect(sheet(page).getByLabel('To')).toHaveAttribute('data-value', 'api');
    await sheet(page).getByRole('combobox', { name: 'Answer' }).fill('cart');
    await sheet(page).getByRole('button', { name: 'Add step' }).click();
    await sheet(page).getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => useCase(page)).toContain('  api -> cache : GET cart\n  cache --> api : cart\n  cache -> db : SELECT cart\n');

    // Show on the architecture: the canvas, with the step's two components selected.
    await steps(page).getByRole('button', { name: /^Step 1: / }).click();
    await sheet(page).getByRole('button', { name: 'Show on the architecture' }).click();
    await expect(view(page)).toHaveCount(0);
    await expect(canvasNodes(page).filter({ hasText: 'Shopper' })).toHaveClass(/selected/);
    await expect(canvasNodes(page).filter({ hasText: 'Checkout API' })).toHaveClass(/selected/);
  });
});

test.describe('Play follows the branch Flows shows', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  const SOURCE = `${PARTS}\nusecase "Checkout" {\n  shopper -> api : POST /checkout\n  api -> cache : GET cart\n  alt "Cart cached" {\n    cache --> api : cart\n  } alt "Cart expired" {\n    cache --> api : nil\n    api -> db : SELECT cart\n  }\n  api --> shopper : 201\n}\n`;

  test('a branch shown on its frame is the scenario Play plays, and a scenario played shows its branch on the frame', async ({ page }) => {
    await openFlows(page, SOURCE);
    const bar = page.getByRole('tablist', { name: 'Scenarios of Checkout' });
    const frame = view(page).getByRole('tablist', { name: 'Scenarios', exact: true });
    await expect(bar.getByRole('tab', { name: /Cart cached/ })).toHaveAttribute('aria-selected', 'true');
    await frame.getByRole('tab', { name: 'Cart expired' }).click();
    await expect(bar.getByRole('tab', { name: /Cart expired/ })).toHaveAttribute('aria-selected', 'true');
    await expect(view(page).getByTestId('flows-scenario')).toHaveText(/Cart expired/);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/[#&]alt=cart-expired/);
    await bar.getByRole('tab', { name: /Cart cached/ }).click();
    await expect(page).toHaveURL(/[#&]alt=cart-cached/);
    await page.getByRole('button', { name: 'Exit playback' }).click();
    await expect(frame.getByRole('tab', { name: 'Cart cached' })).toHaveAttribute('aria-selected', 'true');
    await expect(view(page).getByTestId('flows-scenario')).toHaveText(/Cart cached/);
  });
});
