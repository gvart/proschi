import type { Locator, Page } from '@playwright/test';
import { codeEditor, expect, expectDiagramFitted, test, waitForCanvas } from './fixtures';

// Playing a use case restyles the canvas that is already on screen: the same
// React Flow viewport stays mounted, at the same pan and zoom, through Play,
// Replay and back, so nothing flashes or jumps.

/** Remembers the canvas's viewport element and its transform, once the first layout and fit have settled. */
async function markViewport(scope: Locator): Promise<string> {
  const viewport = scope.locator('.react-flow__viewport');
  const read = () => viewport.evaluate((el) => getComputedStyle(el).transform);
  await expect
    .poll(async () => {
      const first = await read();
      await scope.page().waitForTimeout(1000);
      return first === (await read());
    })
    .toBe(true);
  return viewport.evaluate((el) => {
    (window as unknown as { markedViewport: Element }).markedViewport = el;
    return getComputedStyle(el).transform;
  });
}

/** The marked viewport element is still the one on screen, at `transform`. */
async function expectSameViewport(scope: Locator, transform: string) {
  const same = await scope.locator('.react-flow__viewport').evaluate((el) => {
    const marked = (window as unknown as { markedViewport: Element }).markedViewport;
    return { same: el === marked && marked.isConnected, transform: getComputedStyle(el).transform };
  });
  expect(same).toEqual({ same: true, transform });
}

test.describe('playback keeps the canvas', () => {
  test('in a docs live example, through Play and Replay', async ({ page }) => {
    await page.goto('docs/quickstart/');
    const example = page.locator('figure[data-live]').nth(2);
    await example.scrollIntoViewIfNeeded();
    await expect.poll(() => example.locator('.react-flow__node').count()).toBe(3);
    const transform = await markViewport(example);

    await example.getByRole('button', { name: 'Play' }).click();
    await expect(example.getByText(/Step 1 of \d+/)).toBeVisible();
    await expectSameViewport(example, transform);

    await expect(example.getByText(/Step 2 of \d+/)).toBeVisible({ timeout: 5_000 });
    await example.getByRole('button', { name: 'Replay' }).click();
    await expect(example.getByText(/Step 1 of \d+/)).toBeVisible();
    await expectSameViewport(example, transform);
  });

  test('on the landing page demo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    const demo = page.locator('#live-demo');
    await waitForCanvas(page, 4);
    const transform = await markViewport(demo);

    await demo.getByRole('button', { name: /DB down/ }).click();
    await expect(demo.locator('.react-flow__node.pc-active').first()).toBeVisible();
    await expectSameViewport(demo, transform);
  });

  test('in the editor, through Play and back', async ({ page }) => {
    await page.goto('app/?example=ecommerce');
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page, 6);
    await expectDiagramFitted(page);
    const canvas = page.locator('#pane-panel-diagram');
    const transform = await markViewport(canvas);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible();
    await expect(canvas.locator('.react-flow__node.pc-active').first()).toBeVisible();
    await expect.poll(() => canvas.locator('.react-flow__viewport').evaluate((el) => el === (window as unknown as { markedViewport: Element }).markedViewport)).toBe(true);

    // The step panel takes room from the canvas, so the diagram glides to fit what is left.
    await expectDiagramFitted(page);

    await page.getByRole('button', { name: 'Back to diagram' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(canvas.locator('.react-flow__node.pc-active')).toHaveCount(0);
    // Back at the size it had, the diagram glides back to where it was.
    await expect.poll(() => canvas.locator('.react-flow__viewport').evaluate((el) => getComputedStyle(el).transform)).toBe(transform);
    await expectSameViewport(canvas, transform);
  });
});

test.describe('editor panes', () => {
  const codeWidth = async (page: Page) => (await page.locator('#pane-panel-code').boundingBox())!.width;

  test('the splitter resizes the code pane, re-fits the diagram and is remembered', async ({ page }) => {
    await page.goto('app/?example=ecommerce');
    await waitForCanvas(page, 6);
    const splitter = page.getByRole('separator', { name: 'Resize the code and diagram panes' });
    await expect(splitter).toBeVisible();
    const before = await codeWidth(page);

    const box = (await splitter.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => codeWidth(page)).toBeGreaterThan(before + 150);
    await expectDiagramFitted(page);

    // The keyboard moves it too.
    const dragged = await codeWidth(page);
    await splitter.focus();
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => codeWidth(page)).toBeLessThan(dragged);

    const kept = await codeWidth(page);
    await page.reload();
    await waitForCanvas(page, 6);
    await expect.poll(() => codeWidth(page)).toBeCloseTo(kept, -1);
  });

  test('phones keep one pane at a time, without a splitter', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('app/?example=ecommerce');
    await expect(page.getByRole('separator', { name: 'Resize the code and diagram panes' })).toBeHidden();
    const tabs = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Code' }) });
    await tabs.getByRole('tab', { name: 'Code' }).click();
    await expect(codeEditor(page)).toBeVisible();
    await expect(page.locator('#pane-panel-diagram')).toBeHidden();
    await tabs.getByRole('tab', { name: /Diagram/ }).click();
    await expect(page.locator('#pane-panel-diagram')).toBeVisible();
    await expect(page.locator('#pane-panel-code')).toBeHidden();
    const pane = (await page.locator('#pane-panel-diagram').boundingBox())!;
    expect(pane.width).toBeGreaterThan(380);
    await context.close();
  });
});
