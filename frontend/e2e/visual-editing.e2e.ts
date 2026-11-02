import type { Page } from '@playwright/test';
import { canvasNodes, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

/**
 * Editing with the mouse: whatever is done on the canvas has to show up in the
 * code, because the text is the source of truth. Every test starts from a new,
 * empty diagram and never types in the code pane.
 */

async function newEmptyDiagram(page: Page) {
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, 1);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New diagram' }).click();
  await expect(page.getByRole('region', { name: 'Start a diagram' })).toBeVisible();
  await expect(canvasNodes(page)).toHaveCount(0);
}

/** Adds a component from the palette; `name` is the palette entry. */
async function addComponent(page: Page, search: string, name: string) {
  await page.getByRole('button', { name: 'Add component' }).click();
  const palette = page.getByRole('dialog', { name: 'Add a component' });
  await palette.getByRole('searchbox', { name: 'Search components' }).fill(search);
  await palette.getByRole('button', { name, exact: true }).click();
  await expect(palette).toBeHidden();
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

/** Drags from the bottom (source) dot of one node to the top (target) dot of another. */
async function connect(page: Page, from: string, to: string) {
  await layoutSettled(page);
  const source = (await node(page, from).locator('.react-flow__handle.source').boundingBox())!;
  const target = (await node(page, to).locator('.react-flow__handle.target').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

test.describe('visual editing', () => {
  test.beforeEach(async ({ page }) => {
    await newEmptyDiagram(page);
  });

  test('Add component works on an empty diagram, where the starter card is shown', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await expect(canvasNodes(page)).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Start a diagram' })).toBeHidden();
    expect(await editorText(page)).toContain('redis "Redis" [Redis]');
  });

  test('the starter card does not block the canvas', async ({ page }) => {
    // The card itself still takes clicks.
    await page.getByRole('region', { name: 'Start a diagram' }).getByRole('button', { name: /Template with a cheat-sheet/ }).click();
    await waitForCanvas(page, 3);
    expect(await editorText(page)).toContain('usecase');
  });

  test('connecting two components writes the connection', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await expect(canvasNodes(page)).toHaveCount(2);
    expect(await editorText(page)).not.toContain('->');

    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/^redis\s*->\s*postgresql\b/m);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  });

  test('dragging a component pins its position in the code', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    expect(await editorText(page)).not.toMatch(/\bpos\b/);

    await layoutSettled(page);
    const box = (await node(page, 'Redis').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => editorText(page)).toMatch(/redis "Redis" \[Redis\] pos -?\d+,-?\d+/);

    // Dragging again moves the pinned position; it is not added twice.
    const before = (await editorText(page)).match(/pos (-?\d+),(-?\d+)/)!;
    // The settings card opens on the selected node; click the empty canvas to put it away first.
    await page.locator('.react-flow__pane').click({ position: { x: 60, y: 300 } });
    await layoutSettled(page);
    const moved = (await node(page, 'Redis').boundingBox())!;
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.move(moved.x + moved.width / 2 - 100, moved.y + moved.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await editorText(page)).match(/pos (-?\d+),(-?\d+)/)?.[1]).not.toBe(before[1]);
    expect((await editorText(page)).match(/\bpos\b/g)).toHaveLength(1);
  });

  test('renaming a component rewrites its display name', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    page.once('dialog', (dialog) => dialog.accept('Session cache'));
    await node(page, 'Redis').dblclick();
    await expect(node(page, 'Session cache')).toBeVisible();
    expect(await editorText(page)).toContain('"Session cache" [Redis]');
  });

  test('deleting a component removes its line and its connections', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);

    await node(page, 'Redis').click();
    await page.getByRole('region', { name: 'Redis settings' }).getByRole('button', { name: /Delete/ }).click();
    await expect(canvasNodes(page)).toHaveCount(1);
    await expect.poll(() => editorText(page)).not.toContain('redis');
    expect(await editorText(page)).toContain('[PostgreSQL]');
  });

  test('the Delete key removes the selected component', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await node(page, 'PostgreSQL').click();
    await page.keyboard.press('Delete');
    await expect(canvasNodes(page)).toHaveCount(1);
    await expect.poll(() => editorText(page)).not.toContain('PostgreSQL');
    expect(await editorText(page)).toContain('[Redis]');
  });

  test('deleting a connection keeps both components', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);

    // A straight edge is a zero-width path, which Playwright will not click; click its middle.
    const line = (await page.locator('.react-flow__edge path.react-flow__edge-interaction').first().boundingBox())!;
    await page.mouse.click(line.x, line.y + line.height / 2);
    // The connection's card focuses its label field, where Delete types; its own button removes it.
    await page.getByRole('region', { name: /redis.*postgresql.*settings/i }).getByRole('button', { name: /Delete/ }).click();
    await expect.poll(() => editorText(page)).not.toMatch(/->/);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await expect(canvasNodes(page)).toHaveCount(2);
  });

  test('a diagram built with the mouse has no problems', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);
    await expect(page.getByText('No problems')).toBeVisible();
  });
});
