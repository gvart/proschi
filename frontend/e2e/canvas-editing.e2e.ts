import type { Page } from '@playwright/test';
import { answerDialog, appendCode, canvasNodes, codeEditor, editorText, expect, multiSelectClick, multiSelectSetup, test, waitForCanvas } from './fixtures';

/**
 * The canvas's editing basics: copy, paste and duplicate, moving a
 * connection's end, the right-click menu, finding a node, the minimap and the
 * shortcut sheet. Every edit lands in the code, which stays the source of truth.
 */

async function newDiagram(page: Page, code: string, nodes: number) {
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, 1);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New diagram' }).click();
  await expect(canvasNodes(page)).toHaveCount(0);
  await appendCode(page, code);
  await waitForCanvas(page, nodes);
  await layoutSettled(page);
}

const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });

/** Waits until the canvas stops moving nodes around (layout runs after every edit). */
async function layoutSettled(page: Page) {
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

/** Clicks an empty spot of the canvas, which puts the focus there. */
async function focusCanvas(page: Page) {
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 200 } });
}

const PINNED = 'title "Shop"\napi "API" [REST API] pos 0,0\ndb "Orders DB" [PostgreSQL] pos 0,220\ncache "Cache" [Redis] pos 300,0\napi -> db : reads\napi -> cache\n';

test.describe('canvas editing, copy and paste', () => {
  // Cmd+click on a Mac host, Ctrl+click elsewhere (see multiSelectSetup).
  const { userAgent } = multiSelectSetup();
  test.use(userAgent ? { userAgent } : {});

  test('the multi-select key follows the host: Cmd on a Mac, Ctrl elsewhere', () => {
    expect(multiSelectSetup('linux')).toEqual({ modifier: 'Control' });
    expect(multiSelectSetup('win32')).toEqual({ modifier: 'Control' });
    expect(multiSelectSetup('darwin')).toMatchObject({ modifier: 'Meta', userAgent: expect.stringContaining('Macintosh') });
  });

  test('Ctrl+C and Ctrl+V copy the selected components with the connections between them, renamed and moved', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await node(page, 'API').click();
    await multiSelectClick(node(page, 'Orders DB'));
    await expect(page.getByRole('toolbar', { name: 'Selection' })).toContainText('2 selected');
    await page.keyboard.press('ControlOrMeta+c');
    await expect(page.getByRole('status').filter({ hasText: 'Copied 2 components' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => editorText(page)).toContain('api2 "API" [REST API] pos 40,40\ndb2 "Orders DB" [PostgreSQL] pos 40,260\napi2 -> db2 : reads\n');
    await expect(canvasNodes(page)).toHaveCount(5);
    // Only the connection between the copied components came along.
    expect(await editorText(page)).not.toContain('api2 -> cache');

    // A second paste lands a step further; one Ctrl+Z takes a whole paste back.
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => editorText(page)).toContain('api3 "API" [REST API] pos 80,80');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => editorText(page)).not.toContain('api3');
    expect(await editorText(page)).toContain('api2 -> db2');
  });
});

test.describe('canvas editing', () => {
  test('Ctrl+D duplicates the selection, but not while typing in the code', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await node(page, 'Cache').click();
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => editorText(page)).toContain('cache2 "Cache" [Redis] pos 340,40');
    await expect(canvasNodes(page)).toHaveCount(4);
    // The copy is selected: its settings are open.
    await expect(page.getByRole('region', { name: 'Cache settings' })).toBeVisible();
    // In the code editor the same keys are the editor's own.
    const before = await editorText(page);
    await codeEditor(page).click();
    await page.keyboard.press('ControlOrMeta+d');
    await page.keyboard.press('ControlOrMeta+v');
    await page.keyboard.type('/?');
    expect((await editorText(page)).match(/\[Redis\]/g)).toHaveLength(2);
    expect((await editorText(page)).length).toBeGreaterThan(before.length);
    await expect(page.getByRole('dialog', { name: 'Find a component' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  });

  test('dragging the end of a connection onto another component moves it in the code', async ({ page }) => {
    await newDiagram(page, 'web [Web App]\napi [REST API]\ncache [Redis]\nweb -> api : calls\n', 3);
    const end = page.locator('.react-flow__edge .react-flow__edgeupdater-target').first();
    const from = (await end.boundingBox())!;
    const to = (await node(page, 'Redis').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => editorText(page)).toMatch(/^web -> cache : calls$/m);
    expect(await editorText(page)).not.toMatch(/web -> api/);
  });

  test('the right-click menu duplicates, renames, connects, unpins and jumps to the code', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    const open = async (name: string) => {
      await layoutSettled(page);
      await node(page, name).click({ button: 'right' });
      return page.getByRole('menu', { name: `${name} actions` });
    };

    let menu = await open('Cache');
    for (const item of ['Settings', 'Rename…', /Duplicate/, 'Connect to…', 'Unpin position', 'Jump to code', /Delete/]) {
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    }
    await menu.getByRole('menuitem', { name: 'Unpin position' }).click();
    await expect.poll(() => editorText(page)).toMatch(/^cache "Cache" \[Redis\]$/m);

    menu = await open('Cache');
    await expect(menu.getByRole('menuitem', { name: 'Unpin position' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Connect to…' }).click();
    const finder = page.getByRole('dialog', { name: 'Connect Cache to' });
    // Not to itself.
    await expect(finder.getByRole('option')).toHaveCount(2);
    await finder.getByRole('combobox').fill('postgres');
    await finder.getByRole('combobox').press('Enter');
    await expect.poll(() => editorText(page)).toMatch(/^cache -> db$/m);

    menu = await open('Cache');
    await menu.getByRole('menuitem', { name: 'Rename…' }).click();
    await page.locator('.ps-dialog').getByRole('textbox', { name: 'Display name' }).fill('Sessions');
    await answerDialog(page, 'Rename');
    await expect.poll(() => editorText(page)).toMatch(/^cache "Sessions" \[Redis\]$/m);

    menu = await open('Sessions');
    await menu.getByRole('menuitem', { name: /Duplicate/ }).click();
    await expect.poll(() => editorText(page)).toMatch(/^cache2 "Sessions" \[Redis\]$/m);

    menu = await open('API');
    await menu.getByRole('menuitem', { name: 'Jump to code' }).click();
    await expect(codeEditor(page)).toBeFocused();
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected).toContain('api');
  });

  test('/ and Ctrl+F find a component, then fit and select it', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await focusCanvas(page);
    await page.keyboard.press('/');
    const finder = page.getByRole('dialog', { name: 'Find a component' });
    await expect(finder.getByRole('option')).toHaveCount(3);
    await finder.getByRole('combobox').fill('psql');
    await expect(finder.getByRole('option')).toHaveText([/Orders DB/]);
    await finder.getByRole('combobox').press('Enter');
    await expect(finder).toBeHidden();
    await expect(page.getByRole('region', { name: 'Orders DB settings' })).toBeVisible();

    await focusCanvas(page);
    await page.keyboard.press('ControlOrMeta+f');
    await expect(finder).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(finder).toBeHidden();
  });

  test('the minimap is toggled from the canvas controls and remembered', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    const toggle = page.getByRole('button', { name: 'Minimap' });
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.reload();
    await waitForCanvas(page, 3);
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.getByRole('button', { name: 'Minimap' }).click();
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  });

  test('? and Help → Keyboard shortcuts open the shortcut sheet', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await focusCanvas(page);
    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    for (const section of ['Canvas', 'Code editor', 'Everywhere']) await expect(sheet.getByRole('region', { name: section })).toBeVisible();
    await expect(sheet.getByText('Duplicate the selection')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('canvas editing on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('there is no minimap to cover the diagram', async ({ page }) => {
    await page.goto('app/');
    await page.getByRole('tab', { name: 'Preview' }).click();
    await waitForCanvas(page, 2);
    await expect(page.getByRole('button', { name: 'Minimap' })).toHaveCount(0);
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  });
});
