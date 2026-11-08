import type { Page } from '@playwright/test';
import { addFromPalette, answerDialog, canvasNodes, componentPalette, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

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

const addComponent = addFromPalette;

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

/** Clicks the middle of a connection, the first by default (a straight edge is a zero-width path, which Playwright will not click). */
async function clickConnection(page: Page, edge = page.locator('.react-flow__edge').first()) {
  await layoutSettled(page);
  const path = edge.locator('path.react-flow__edge-interaction');
  await expect(path).toHaveAttribute('d', /\d/);
  const line = (await path.boundingBox())!;
  await page.mouse.click(line.x + line.width / 2, line.y + line.height / 2);
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
    await node(page, 'Redis').dblclick();
    await page.locator('.ps-dialog').getByRole('textbox', { name: 'Display name' }).fill('Session cache');
    await answerDialog(page, 'Rename');
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
    // Its settings card's own button removes it too.
    await page.getByRole('region', { name: /redis.*postgresql.*settings/i }).getByRole('button', { name: /Delete/ }).click();
    await expect.poll(() => editorText(page)).not.toMatch(/->/);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await expect(canvasNodes(page)).toHaveCount(2);
  });

  for (const key of ['Delete', 'Backspace']) {
    test(`the ${key} key removes the selected connection, as one undo step`, async ({ page }) => {
      await addComponent(page, 'redis', 'Redis');
      await addComponent(page, 'postgres', 'PostgreSQL');
      await connect(page, 'Redis', 'PostgreSQL');
      await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);

      await clickConnection(page);
      await expect(page.getByRole('region', { name: /redis.*postgresql.*settings/i })).toBeVisible();
      await page.keyboard.press(key);
      await expect.poll(() => editorText(page)).not.toMatch(/->/);
      await expect(page.locator('.react-flow__edge')).toHaveCount(0);
      await expect(canvasNodes(page)).toHaveCount(2);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);
    });
  }

  test('Delete in the connection label field edits the label, not the connection', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);

    await clickConnection(page);
    const label = page.getByRole('region', { name: /redis.*postgresql.*settings/i }).getByLabel('Label or protocol');
    await label.fill('gRPC');
    await label.press('Backspace');
    await label.press('Delete');
    await expect(label).toHaveValue('gRP');
    expect(await editorText(page)).toMatch(/redis\s*->\s*postgresql/);
  });

  test('a diagram built with the mouse has no problems', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await connect(page, 'Redis', 'PostgreSQL');
    await expect.poll(() => editorText(page)).toMatch(/redis\s*->\s*postgresql/);
    await expect(page.getByText('No problems')).toBeVisible();
  });

  test('a component dragged onto the canvas is written, selected, and one Ctrl+Z takes it back', async ({ page }) => {
    const palette = await componentPalette(page);
    const pane = page.locator('.react-flow__pane');
    const box = (await pane.boundingBox())!;
    await palette.getByRole('button', { name: 'Database', exact: true }).dragTo(pane, { targetPosition: { x: box.width - 60, y: box.height - 60 } });
    await expect.poll(() => editorText(page)).toMatch(/^database "Database" \[Database\] pos -?\d+,-?\d+$/m);
    await expect(canvasNodes(page)).toHaveCount(1);
    // Selected: its settings take the palette's place.
    await expect(page.getByRole('region', { name: 'Database settings' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(() => editorText(page)).not.toContain('Database');
    await expect(canvasNodes(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => editorText(page)).toContain('[Database]');
  });

  test('replicas set in the settings form are written to the code', async ({ page }) => {
    await addComponent(page, 'postgres', 'PostgreSQL');
    await node(page, 'PostgreSQL').click();
    const settings = page.getByRole('region', { name: 'PostgreSQL settings' });
    await settings.getByRole('button', { name: 'More replicas' }).click();
    await settings.getByRole('button', { name: 'More replicas' }).click();
    await expect.poll(() => editorText(page)).toContain('postgresql "PostgreSQL" [PostgreSQL] x3');
    await settings.getByLabel('Name').fill('Orders DB');
    await settings.getByLabel('Name').press('Enter');
    await expect.poll(() => editorText(page)).toContain('postgresql "Orders DB" [PostgreSQL] x3');
  });

  test('the connect hint shows for two unconnected components, until the first connection', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await expect(page.getByRole('note').filter({ hasText: 'Connect two components' })).toHaveCount(0);
    await addComponent(page, 'postgres', 'PostgreSQL');
    const hint = page.getByRole('note').filter({ hasText: 'Connect two components' });
    await expect(hint).toBeVisible();
    await connect(page, 'Redis', 'PostgreSQL');
    await expect(hint).toBeHidden();
    await page.reload();
    await expect(page.getByRole('note').filter({ hasText: 'Connect two components' })).toHaveCount(0);
  });

  test('right-click opens a menu that deletes the component', async ({ page }) => {
    await addComponent(page, 'redis', 'Redis');
    await addComponent(page, 'postgres', 'PostgreSQL');
    await layoutSettled(page);
    await node(page, 'Redis').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Redis actions' });
    await menu.getByRole('menuitem', { name: /Delete/ }).click();
    await expect(canvasNodes(page)).toHaveCount(1);
    await expect.poll(() => editorText(page)).not.toContain('[Redis]');
  });

  test('the palette is grouped by what components do, and hides and shows from the toolbar', async ({ page }) => {
    const palette = await componentPalette(page);
    for (const group of ['Clients', 'Edge & CDN', 'Compute & APIs', 'Data stores', 'Caches', 'Queues & streams', 'External']) {
      await expect(palette.getByRole('region', { name: group })).toBeVisible();
    }
    await palette.getByRole('button', { name: 'Hide components' }).click();
    await expect(palette).toBeHidden();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Components' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add component' })).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('visual editing in practice', () => {
  test('a cache from the palette goes into the solution; the problem’s own nodes stay', async ({ page }) => {
    await page.goto('practice/#/url-shortener');
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page, 2);
    await addFromPalette(page, 'cache', 'Cache');
    await expect.poll(() => editorText(page)).toMatch(/^cache "Cache" \[Cache\]$/m);
    expect(await editorText(page)).toMatch(/^import "problem.proschi"/);
    await canvasNodes(page).filter({ hasText: 'Cache' }).click();
    const settings = page.getByRole('region', { name: 'Cache settings' });
    await expect(settings).toBeVisible();
    // Capacity is the problem's: no rps or latency fields here.
    await expect(settings.getByLabel('Latency')).toHaveCount(0);
    await settings.getByRole('button', { name: 'More replicas' }).click();
    await expect.poll(() => editorText(page)).toMatch(/^cache "Cache" \[Cache\] x2$/m);

    // The visitor is declared in problem.proschi: read-only, and Delete leaves it.
    const before = await editorText(page);
    await canvasNodes(page).filter({ hasText: 'Visitor' }).click();
    await expect(page.getByRole('region', { name: 'Visitor settings' }).getByText('Declared in problem.proschi')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('status').filter({ hasText: 'problem.proschi' })).toBeVisible();
    expect(await editorText(page)).toBe(before);
  });

  for (const key of ['Delete', 'Backspace']) {
    test(`the ${key} key removes a selected connection of the solution`, async ({ page }) => {
      await page.goto('practice/#/url-shortener');
      await expect(codeEditor(page)).toBeVisible();
      await waitForCanvas(page, 2);
      await addFromPalette(page, 'cache', 'Cache');
      await connect(page, 'Visitor', 'Cache');
      await expect.poll(() => editorText(page)).toMatch(/^visitor\s*->\s*cache$/m);

      await clickConnection(page, page.getByTestId('rf__edge-visitor->cache'));
      await expect(page.getByRole('region', { name: /visitor.*cache.*settings/i })).toBeVisible();
      await page.keyboard.press(key);
      await expect.poll(() => editorText(page)).not.toMatch(/^visitor\s*->\s*cache$/m);
      expect(await editorText(page)).toMatch(/^cache "Cache" \[Cache\]$/m);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editorText(page)).toMatch(/^visitor\s*->\s*cache$/m);
    });
  }

  test('in the narrow practice pane the palette floats over the canvas, and the diagram fits beside it unless zoomed by hand', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('practice/#/url-shortener');
    await expect(codeEditor(page)).toBeVisible();
    // Drawn on first load in dark mode too.
    await waitForCanvas(page, 2);
    await expect(canvasNodes(page).first()).toBeInViewport();
    const pane = page.locator('.pc-editable');
    const width = (await pane.boundingBox())!.width;
    const viewport = page.locator('.react-flow__viewport');
    const transform = () => viewport.getAttribute('style');

    await page.getByRole('button', { name: 'Add component' }).click();
    const dock = page.getByTestId('palette-dock');
    await expect(dock).toHaveAttribute('data-floating', 'true');
    // The canvas keeps its width; the diagram glides clear of the panel.
    expect((await pane.boundingBox())!.width).toBe(width);
    const dockLeft = (await dock.boundingBox())!.x;
    await expect.poll(async () => Math.max(...(await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))))).toBeLessThan(dockLeft);

    // Zoomed by hand: closing and opening the palette leaves the view where the reader put it.
    await page.getByRole('button', { name: 'Hide components' }).click();
    // After the diagram glides back to its full-width fit.
    await page.waitForTimeout(500);
    await page.locator('.react-flow__controls-zoomin').click();
    await page.waitForTimeout(500);
    const zoomed = await transform();
    await page.getByRole('button', { name: 'Add component' }).click();
    await expect(dock).toBeVisible();
    await page.waitForTimeout(500);
    expect(await transform()).toBe(zoomed);
  });
});
