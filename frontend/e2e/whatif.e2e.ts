import type { Page } from '@playwright/test';
import { canvasNodes, codeEditor, editorText, expect, test } from './fixtures';
import { diagramTab, openDoc, resultsTab, WHATIF_DOC, WITH_WHATIFS } from './whatif';

/**
 * The live what-if (docs/design/paid-plans.md P57): the traffic slider and
 * "Simulate down" re-run the analysis without touching the text, "Save as
 * what-if" and "Write to traffic" write it down, and both undo. With
 * WHATIF_SHOTS=<dir>, saves screenshots there.
 */

const SHOTS = process.env.WHATIF_SHOTS;

async function shot(page: Page, name: string) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });
const slider = (page: Page) => page.getByRole('slider', { name: 'Traffic multiplier' });
const pill = (page: Page) => page.getByTestId('whatif-open');

/** The what-if card, opened from its pill if it is closed. */
async function control(page: Page) {
  const card = page.getByTestId('whatif-control');
  if (!(await card.isVisible())) await pill(page).click();
  await expect(card).toBeVisible();
  return card;
}

/** No node of the default fit lies under the canvas's top-right toolbar (the what-if pill and the overlay toggle). */
async function expectToolbarClear(page: Page) {
  const bar = (await pill(page).locator('xpath=../..').boundingBox())!;
  for (const box of await canvasNodes(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))) {
    const overlaps = box.left < bar.x + bar.width && box.right > bar.x && box.top < bar.y + bar.height && box.bottom > bar.y;
    expect(overlaps).toBe(false);
  }
}

test('the traffic slider multiplies the load without editing the text, and writes it to the traffic block', async ({ page }) => {
  await openDoc(page, WHATIF_DOC);
  // Closed, the what-if is a pill in the toolbar that covers no node.
  await expect(pill(page)).toHaveText('×1.0');
  await expect(page.getByTestId('whatif-control')).toHaveCount(0);
  await expectToolbarClear(page);
  let card = await control(page);
  await expect(card.getByTestId('whatif-value')).toHaveText('×1.0 · 500 rps');
  await expect(page.locator('.pc-node[data-bottleneck]')).toHaveCount(0);

  // ×3 (stop 6) makes the API the bottleneck at 75%.
  await slider(page).fill('6');
  await expect(card.getByTestId('whatif-value')).toHaveText('×3.0 · 1.5k rps');
  await expect(card.getByTestId('whatif-badge')).toHaveText('What-if: Traffic ×3');
  await expect(node(page, 'Notes API').locator('.pc-node')).toHaveAttribute('data-bottleneck', 'true');
  await expect(node(page, 'Notes API')).toContainText('75%');
  await expect(page.locator('.pc-edge-load').filter({ hasText: '1.5k rps' }).first()).toBeVisible();
  expect(await editorText(page)).toContain('"Read a note" 500 rps');
  if (SHOTS) await shot(page, 'slider-x3-open');

  // Escape folds it back to the pill, which keeps the what-if and its reset.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(pill(page)).toHaveText('What-if ×3.0');
  await expect(pill(page)).toHaveAttribute('data-active', 'true');
  await expectToolbarClear(page);
  if (SHOTS) {
    await shot(page, 'slider-x3-bottleneck');
    await page.locator('.pc-edge-load').filter({ hasText: '1.5k rps' }).first().screenshot({ path: `${SHOTS}/edge-chip.png` });
  }

  // Results is the what-if's, with what it does against the design as written.
  await resultsTab(page).click();
  const impact = page.getByTestId('whatif-impact');
  await expect(impact).toContainText('What-if: Traffic ×3');
  await expect(page.getByText(/^api at 75%/)).toBeVisible();
  await diagramTab(page).click();

  card = await control(page);
  await slider(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(card.getByTestId('whatif-value')).toHaveText('×2.0 · 1k rps');
  await page.keyboard.press('ArrowRight');

  // Write to traffic: the rate in the code, the slider back to ×1, and one undo takes it back.
  await card.getByRole('button', { name: 'Write to traffic' }).click();
  await expect.poll(() => editorText(page)).toContain('"Read a note" 1.5k rps');
  await expect(card.getByTestId('whatif-value')).toHaveText('×1.0 · 1.5k rps');
  await expect(card.getByTestId('whatif-badge')).toHaveCount(0);
  await expect(node(page, 'Notes API').locator('.pc-node')).toHaveAttribute('data-bottleneck', 'true');
  await node(page, 'Notes API').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorText(page)).toContain('"Read a note" 500 rps');

  // The pill's reset puts it back as written.
  await control(page);
  await slider(page).fill('6');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reset the what-if' }).click();
  await expect(pill(page)).toHaveText('×1.0');
  await expect(page.locator('.pc-node[data-bottleneck]')).toHaveCount(0);
});

test('Simulate down takes nodes down, Results shows the availability lost, and it saves as a what-if', async ({ page }) => {
  await openDoc(page, WHATIF_DOC);
  await node(page, 'Notes DB').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Notes DB actions' }).getByRole('menuitem', { name: 'Simulate down' }).click();
  await expect(node(page, 'Notes DB').locator('.pc-node')).toHaveAttribute('data-load', 'down');
  await expect(node(page, 'Notes DB')).toContainText('down');
  await expect(pill(page)).toHaveAccessibleName('What-if: db down');
  await expect(pill(page)).toContainText('1 down');
  if (SHOTS) await shot(page, 'node-down');

  await resultsTab(page).click();
  const impact = page.getByTestId('whatif-impact');
  await expect(impact).toContainText('What-if: db down');
  await expect(impact.getByText(/^was 99\.9/)).toHaveClass(/text-fail/);
  await expect(impact).toContainText(/Checks: 2 of 2 as written → 1 of 2 pass/);
  if (SHOTS) await shot(page, 'node-down-results');
  await diagramTab(page).click();

  // A second node down, then both back up in one click.
  await node(page, 'Notes API').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Simulate down' }).click();
  await expect(pill(page)).toHaveAccessibleName('What-if: db and api down');
  let card = await control(page);
  await card.getByRole('button', { name: 'Bring all up' }).click();
  await expect(page.locator('.pc-node[data-load="down"]')).toHaveCount(0);

  // Down again, and saved: a whatif block at the end; Ctrl+Z takes it back.
  await node(page, 'Notes DB').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Simulate down' }).click();
  card = await control(page);
  await slider(page).fill('6');
  await card.getByRole('button', { name: 'Save as what-if' }).click();
  await expect.poll(() => editorText(page)).toContain('whatif "Traffic ×3, db down" {\n  traffic "Read a note" x3\n  fail db\n}');
  await expect(page.getByRole('status').filter({ hasText: 'Saved as what-if' })).toBeVisible();
  await node(page, 'Notes API').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => editorText(page)).not.toContain('whatif');

  // The menu brings a node down back up.
  await node(page, 'Notes DB').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Bring back up' }).click();
  await expect(page.locator('.pc-node[data-load="down"]')).toHaveCount(0);
});

test('typing in the code never moves the what-if', async ({ page }) => {
  await openDoc(page, WHATIF_DOC);
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n# notes');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(pill(page)).toHaveText('×1.0');
});

test('without an account, saved what-ifs show by name only (no paid plans in this build)', async ({ page }) => {
  await openDoc(page, WITH_WHATIFS);
  await resultsTab(page).click();
  const teaser = page.getByTestId('whatif-teaser');
  await expect(teaser.getByRole('listitem')).toHaveText(['Launch day', 'Database down']);
  await expect(page.getByTestId('saved-whatifs')).toHaveCount(0);
  await expect(page.getByTestId('sweep')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the slider opens in a bottom sheet', async ({ page }) => {
    await openDoc(page, WHATIF_DOC);
    await expect(pill(page)).toHaveText('×1.0');
    await pill(page).click();
    const sheet = page.getByRole('dialog', { name: 'What-if' });
    await expect(sheet).toBeInViewport();
    await sheet.getByRole('slider', { name: 'Traffic multiplier' }).fill('6');
    await expect(sheet.getByTestId('whatif-value')).toHaveText('×3.0 · 1.5k rps');
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    if (SHOTS) await shot(page, 'phone-sheet');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(pill(page)).toHaveText('What-if ×3.0');
    await expect(pill(page)).toHaveAttribute('data-active', 'true');
    if (SHOTS) await shot(page, 'phone-canvas');
  });

  test('a tap on a node offers Simulate down in its settings', async ({ page }) => {
    await openDoc(page, WHATIF_DOC);
    await node(page, 'Notes DB').tap();
    const settings = page.getByRole('region', { name: 'Notes DB settings' });
    await settings.getByRole('button', { name: 'Simulate Notes DB down' }).tap();
    await expect(node(page, 'Notes DB').locator('.pc-node')).toHaveAttribute('data-load', 'down');
    await expect(pill(page)).toContainText('1 down');
    if (SHOTS) await shot(page, 'phone-node-down');
    await settings.getByRole('button', { name: 'Bring Notes DB back up' }).tap();
    await expect(page.locator('.pc-node[data-load="down"]')).toHaveCount(0);
  });
});
