import type { Page } from '@playwright/test';
import { appendCode, canvasNodes, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

/**
 * Two-way selection sync: a canvas selection shows its declaration in the code
 * pane without taking the focus, and the code's cursor marks what its line
 * declares on the canvas without touching the canvas selection.
 */

const PINNED = 'title "Shop"\napi "API" [REST API] pos 0,0\ndb "Orders DB" [PostgreSQL] pos 0,220\ncache "Cache" [Redis] pos 300,0\napi -> db : reads\napi -> cache\n';

async function newDiagram(page: Page, code: string, nodes: number) {
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, 1);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New diagram' }).click();
  await expect(canvasNodes(page)).toHaveCount(0);
  await appendCode(page, code);
  await waitForCanvas(page, nodes);
  await settled(page);
}

/** Waits until the canvas stops moving: the layout, its glide and any fit are done. */
async function settled(page: Page) {
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify([
        await page.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform),
        await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON())),
      ]);
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [300] })
    .toBe(true);
}

const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });

/** The editor's main selection: the cursor's line and the selected text, from CodeMirror's state. */
function editorSelection(page: Page): Promise<{ line: number; text: string }> {
  return codeEditor(page).evaluate((el) => {
    type View = { state: { doc: { lineAt(pos: number): { number: number }; sliceString(from: number, to: number): string }; selection: { main: { from: number; to: number; head: number } } } };
    const host = el as HTMLElement & { cmTile?: { root?: { view?: View } }; cmView?: { view?: View; root?: { view?: View } } };
    const view = host.cmTile?.root?.view ?? host.cmView?.root?.view ?? host.cmView?.view;
    if (!view) throw new Error('editorSelection: cannot find the CodeMirror view');
    const { from, to, head } = view.state.selection.main;
    return { line: view.state.doc.lineAt(head).number, text: view.state.doc.sliceString(from, to) };
  });
}

/** The line (1-based) of the code that starts with `start`. */
const lineOf = async (page: Page, start: string) => (await editorText(page)).split('\n').findIndex((l) => l.startsWith(start)) + 1;
const focusInCode = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.cm-editor'));
/** Clicks a line of the code, which puts the cursor there. */
const clickLine = (page: Page, text: string) => page.locator('.cm-line:visible').filter({ hasText: text }).first().click();

test.describe('selection sync', () => {
  // React Flow adds to the selection with Cmd+click on a Mac; the test browser passes for one on every host.
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });

  test('selecting on the canvas selects the declaration in the code, and the canvas keeps the focus', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await node(page, 'Orders DB').click();
    await expect.poll(() => editorSelection(page)).toEqual({ line: await lineOf(page, 'db "Orders DB"'), text: 'db' });
    await expect(page.locator('.cm-linkedLine')).toHaveText(['db "Orders DB" [PostgreSQL] pos 0,220']);
    expect(await focusInCode(page)).toBe(false);
    // No loop: the cursor moved by the canvas marks nothing, and the selection stays as it was.
    await page.waitForTimeout(400);
    await expect(page.locator('.pc-linked')).toHaveCount(0);
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    // The canvas's keys still work.
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => editorText(page)).toContain('db2 "Orders DB" [PostgreSQL]');
    await waitForCanvas(page, 4);
    await settled(page);

    // A connection selects its line too.
    await page.locator('.react-flow__edge').filter({ hasText: 'reads' }).first().click({ force: true });
    await expect.poll(async () => (await editorSelection(page)).line).toBe(await lineOf(page, 'api -> db'));
  });

  test('several selected items shade their lines, and the cursor stays', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await node(page, 'API').click();
    const apiLine = await lineOf(page, 'api "API"');
    await expect.poll(async () => (await editorSelection(page)).line).toBe(apiLine);
    await node(page, 'Cache').click({ modifiers: ['Meta'] });
    await expect(page.locator('.cm-linkedLine')).toHaveCount(2);
    await expect(page.locator('.cm-linkedLine')).toHaveText(['api "API" [REST API] pos 0,0', 'cache "Cache" [Redis] pos 300,0']);
    expect((await editorSelection(page)).line).toBe(apiLine);
    // An empty selection clears them.
    await page.locator('.react-flow__pane').click({ position: { x: 30, y: 200 } });
    await expect(page.locator('.cm-linkedLine')).toHaveCount(0);
  });

  test('the cursor on a declaration rings its node or connection, leaving the selection alone', async ({ page }) => {
    await newDiagram(page, PINNED, 3);
    await node(page, 'API').click();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

    await clickLine(page, 'cache "Cache"');
    await expect(node(page, 'Cache')).toHaveClass(/pc-linked/);
    await expect(page.locator('.react-flow__node.pc-linked')).toHaveCount(1);
    // The selection is untouched.
    await expect(node(page, 'API')).toHaveClass(/selected/);
    expect(await focusInCode(page)).toBe(true);

    await clickLine(page, 'api -> cache');
    await expect(page.locator('.react-flow__edge.pc-linked')).toHaveCount(1);
    await expect(page.locator('.react-flow__node.pc-linked')).toHaveCount(0);

    await clickLine(page, 'title "Shop"');
    await expect(page.locator('.pc-linked')).toHaveCount(0);

    // Typing on a node's line keeps the ring once the text is parsed again.
    await clickLine(page, 'db "Orders DB"');
    await expect(node(page, 'Orders DB')).toHaveClass(/pc-linked/);
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await expect(node(page, 'Orders DB')).toHaveClass(/pc-linked/);
  });

  test('a ringed node out of sight is panned into view, at the same zoom', async ({ page }) => {
    // Far apart, so the fit zooms out and there is room to zoom in.
    await newDiagram(page, 'api "API" [REST API] pos 0,0\ndb "Orders DB" [PostgreSQL] pos 0,2400\ncache "Cache" [Redis] pos 3000,0\n', 3);
    const zoomIn = page.getByRole('button', { name: 'zoom in' });
    for (let i = 0; i < 6; i++) await zoomIn.click();
    await settled(page);
    const pane = (await page.locator('.react-flow').boundingBox())!;
    const inside = async (name: string) => {
      const box = await node(page, name).boundingBox();
      if (!box) return false;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      return x >= pane.x && x <= pane.x + pane.width && y >= pane.y && y <= pane.y + pane.height;
    };
    const target = (await inside('Cache')) ? 'Orders DB' : 'Cache';
    expect(await inside(target)).toBe(false);
    const scale = () => page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    const zoom = await scale();
    await clickLine(page, target === 'Cache' ? 'cache "Cache"' : 'db "Orders DB"');
    await expect.poll(() => inside(target)).toBe(true);
    expect(await scale()).toBeCloseTo(zoom, 1);
  });
});

test.describe('selection sync on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('selecting on the Diagram pane does not switch to the Code pane', async ({ page }) => {
    await page.goto('./');
    await page.goto((await page.locator('a[data-example="url-shortener"]').getAttribute('href'))!);
    await page.getByRole('tab', { name: 'Diagram' }).first().click();
    await page.locator('.react-flow__node').first().click();
    await expect(page.getByRole('region', { name: /settings$/ })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('tab', { name: 'Diagram' }).first()).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content:visible')).toHaveCount(0);
  });
});
