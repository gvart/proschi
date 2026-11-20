import { droneLink } from './drone';
import { addFromPalette, canvasNodes, codeEditor, copiedText, editorText, expect, MODE_KEY, mockClipboard, setMode, test, waitForCanvas } from './fixtures';

/**
 * The editor's two exclusive modes (S10): Visual gives the canvas the page and
 * shows the code read-only under View code; Code puts the code beside a
 * diagram that only looks. One choice for the editor, practice and the
 * interview, remembered in this browser; a first visit lands in Visual.
 */
const modeSwitch = (page: import('@playwright/test').Page) => page.getByRole('radiogroup', { name: 'Editor mode' });

test.describe('editor modes', () => {
  test('a first visit lands in Visual, and the mode chosen is remembered across reloads', async ({ page }) => {
    await page.goto('app/');
    await waitForCanvas(page);
    await expect(modeSwitch(page).getByRole('radio', { name: 'Visual' })).toBeChecked();
    await expect(codeEditor(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add component' })).toBeVisible();

    await setMode(page, 'code');
    await expect(codeEditor(page)).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), MODE_KEY)).toBe('"code"');
    await page.reload();
    await expect(modeSwitch(page).getByRole('radio', { name: 'Code' })).toBeChecked();
    await expect(codeEditor(page)).toBeVisible();

    // Ctrl/Cmd+\ switches too, from inside the code editor.
    await codeEditor(page).click();
    await page.keyboard.press('ControlOrMeta+Backslash');
    await expect(modeSwitch(page).getByRole('radio', { name: 'Visual' })).toBeChecked();
    await expect(codeEditor(page)).toHaveCount(0);
  });

  test.describe('switching', () => {
    test.use({ mode: 'visual' });

    test('keeps the document, and the canvas undo still takes back an edit made before it', async ({ page }) => {
      await page.goto('app/');
      await waitForCanvas(page);
      const before = await editorText(page);
      const count = await canvasNodes(page).count();
      await addFromPalette(page, 'redis', 'Redis');
      await expect(canvasNodes(page)).toHaveCount(count + 1);
      expect(await editorText(page)).toContain('redis "Redis" [Redis]');

      await setMode(page, 'code');
      expect(await editorText(page)).toContain('redis "Redis" [Redis]');
      await setMode(page, 'visual');
      await expect(canvasNodes(page)).toHaveCount(count + 1);

      // The canvas's undo is the hidden code editor's: its history came through both switches.
      // On the right: the open palette covers the canvas's left.
      const pane = (await page.locator('.react-flow__pane').boundingBox())!;
      await page.mouse.click(pane.x + pane.width - 40, pane.y + pane.height - 120);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toBe(before);
      await expect(canvasNodes(page)).toHaveCount(count);
    });

    test('View code shows the source read-only, with no completion, and copies it', async ({ page }) => {
      await mockClipboard(page);
      await page.goto('app/');
      await waitForCanvas(page);
      const source = await editorText(page);
      await page.getByRole('button', { name: 'View code' }).click();
      const drawer = page.getByRole('complementary', { name: 'Code, read-only' });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
      await expect(drawer.locator('.cm-content')).toContainText('title "Hello Proschi"');

      // Typing and asking for completion do nothing.
      await drawer.locator('.cm-content').click();
      await page.keyboard.type('zzz');
      await page.keyboard.press('Control+Space');
      await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0);
      expect(await editorText(page)).toBe(source);
      await expect(drawer.locator('.cm-content')).not.toContainText('zzz');

      await drawer.getByRole('button', { name: 'Copy' }).click();
      expect(await copiedText(page)).toBe(source);

      // An edit on the canvas shows in the open drawer at once.
      await addFromPalette(page, 'redis', 'Redis');
      await expect(drawer.locator('.cm-content')).toContainText('redis "Redis" [Redis]');

      // Editing the text is Code mode's, one click away.
      await drawer.getByRole('button', { name: 'Edit in Code' }).click();
      await expect(modeSwitch(page).getByRole('radio', { name: 'Code' })).toBeChecked();
      await expect(drawer).toHaveCount(0);
      await expect(codeEditor(page)).toBeVisible();
    });
  });

  test.describe('Code mode', () => {
    test.use({ mode: 'code' });

    test("the diagram only looks: no palette, Flows, connecting, dragging, renaming, settings or deleting", async ({ page }) => {
      await page.goto('app/');
      await waitForCanvas(page);
      const source = await editorText(page);
      await expect(page.getByRole('button', { name: 'Add component' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Flows' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'View code' })).toHaveCount(0);
      await expect(page.locator('.react-flow__node.draggable')).toHaveCount(0);
      await expect(page.locator('.react-flow__handle.connectable')).toHaveCount(0);
      await expect(page.locator('.pc-editable')).toHaveCount(0);

      // Selecting a node finds its line in the code, and offers no settings, Rename or Delete.
      const api = canvasNodes(page).filter({ hasText: 'Notes API' });
      await api.click();
      await expect(page.locator('.cm-selectionMatch, .cm-line.pc-linked, .cm-selectionBackground').first()).toBeAttached();
      await expect(page.getByRole('region', { name: 'Notes API settings' })).toHaveCount(0);
      await expect(page.getByRole('toolbar', { name: 'Selection' })).toHaveCount(0);
      await page.keyboard.press('Delete');
      await api.dblclick();
      await expect(page.locator('.pc-node__name-field')).toHaveCount(0);
      // Dragging moves nothing.
      const box = (await api.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
      await page.mouse.up();

      // The right-click menu only looks too.
      await api.click({ button: 'right' });
      const menu = page.getByRole('menu', { name: 'Notes API actions' });
      await expect(menu.getByRole('menuitem')).toHaveText(['Jump to code', 'Simulate down']);
      await page.keyboard.press('Escape');

      expect(await editorText(page)).toBe(source);
      await expect(canvasNodes(page)).toHaveCount(3);
    });

    test('on a phone, the code shows first, with a peek at the diagram', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('app/');
      await expect(codeEditor(page)).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Code' })).toHaveCount(0);
      const peek = page.getByRole('button', { name: 'Preview' });
      await peek.click();
      await expect(peek).toHaveAttribute('aria-pressed', 'true');
      await waitForCanvas(page);
      await expect(codeEditor(page)).toHaveCount(0);
      await setMode(page, 'visual');
      await expect(page.getByRole('button', { name: 'Add component' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
    });
  });
});

test.describe('a read-only team file in Visual mode', () => {
  test.use({ mode: 'visual' });

  test('View code shows the team file the diagram has opened', async ({ page }) => {
    await page.goto(droneLink(100));
    await page.locator('.react-flow__node-systemNode', { hasText: 'Order Processing' }).dblclick();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]')).toHaveText('Order Processing');
    await page.getByRole('button', { name: 'View code' }).click();
    const drawer = page.getByRole('complementary', { name: 'Code, read-only' });
    await expect(drawer).toContainText('teams/orders.proschi');
    await expect(drawer.locator('.cm-content')).toContainText('title "Order Processing"');
  });
});

test.describe('practice modes', () => {
  test.use({ mode: 'visual' });

  test('the full editor uses the same switch: Visual hides the code, Code shows it beside a view-only canvas', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    const visualRadio = modeSwitch(page).getByRole('radio', { name: 'Visual' });
    await expect(visualRadio).toBeChecked();
    await expect(codeEditor(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Diagram' }).getByRole('button', { name: 'Add component' })).toBeVisible();
    await page.getByRole('button', { name: 'View code' }).click();
    await expect(page.getByRole('complementary', { name: 'Code, read-only' })).toContainText('import');

    await setMode(page, 'code');
    await expect(codeEditor(page)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diagram' }).getByRole('button', { name: 'Add component' })).toHaveCount(0);

    // One choice for the editor and practice.
    await page.goto('app/');
    await expect(modeSwitch(page).getByRole('radio', { name: 'Code' })).toBeChecked();
  });
});
