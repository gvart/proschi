import type { Page } from '@playwright/test';
import { answerDialog, appendCode, canvasNodes, chooseOption, codeEditor, editorText, expect, expectTopBarClear, test, waitForCanvas } from './fixtures';

/**
 * The practice canvas and the editor's behave the same (6.1): the practice
 * canvas pins dragged nodes, has Auto-layout, the load overlay and the right-
 * click menu; the editor has the Flows builder. The interview's whiteboard has
 * no load overlay, which would give its estimates away.
 */

const node = (page: Page, name: string) => canvasNodes(page).filter({ hasText: name });

/** Waits until the layout is done and the nodes stop moving. */
async function layoutSettled(page: Page) {
  await expect(page.locator('[data-layout-busy]')).toHaveCount(0);
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

async function drag(page: Page, name: string, dx: number, dy: number) {
  const box = (await node(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

async function openProblem(page: Page) {
  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, 2);
  await layoutSettled(page);
}

test.describe('the practice canvas', () => {
  test('shows the load overlay by default, with its legend and the edges’ load, and remembers turning it off', async ({ page }) => {
    await openProblem(page);
    const toggle = page.getByRole('button', { name: 'Overlay: load' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // The pane is narrow: the legend starts folded, and the diagram fits below the whole top bar.
    const legend = page.getByRole('group', { name: 'Load legend' });
    await expect(legend).toBeVisible();
    await expect(legend).not.toHaveAttribute('open', '');
    await expectTopBarClear(page);
    // Opened by hand, it stays open.
    await legend.locator('summary').click();
    await expect(page.getByText('Bottleneck: at 70% or more')).toBeVisible();
    await expect(page.locator('.pc-edge-load').first()).toContainText('rps');
    await page.reload();
    await waitForCanvas(page, 2);
    await expect(page.getByRole('group', { name: 'Load legend' })).toHaveAttribute('open', '');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.pc-edge-load')).toHaveCount(0);
    await page.reload();
    await waitForCanvas(page, 2);
    await expect(page.getByRole('button', { name: 'Overlay: load' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('dragging a component pins it in the code, Auto-layout unpins it, and the problem’s own stay', async ({ page }) => {
    await openProblem(page);
    await expect(page.getByRole('button', { name: 'Auto-layout' })).toHaveCount(0);
    await drag(page, 'Shortener API', 120, 60);
    await expect.poll(() => editorText(page)).toMatch(/^api "Shortener API" \[REST API\] pos -?\d+,-?\d+$/m);
    await layoutSettled(page);

    // The visitor is the problem's: it goes back, and the code is left alone.
    const before = (await node(page, 'Visitor').boundingBox())!;
    await drag(page, 'Visitor', -150, 0);
    await expect(page.getByRole('status').filter({ hasText: '"Visitor" is part of problem.proschi' })).toBeVisible();
    await expect.poll(async () => Math.abs((await node(page, 'Visitor').boundingBox())!.x - before.x)).toBeLessThan(3);
    expect(await editorText(page)).not.toMatch(/^visitor .*pos/m);

    await page.getByRole('button', { name: 'Auto-layout' }).click();
    await expect.poll(() => editorText(page)).not.toContain(' pos ');
    await expect(page.getByRole('button', { name: 'Auto-layout' })).toHaveCount(0);
  });

  test('the right-click menu renames, duplicates, connects and unpins', async ({ page }) => {
    await openProblem(page);
    await node(page, 'Shortener API').click({ button: 'right' });
    const menu = page.getByRole('menu', { name: 'Shortener API actions' });
    await expect(menu.getByRole('menuitem', { name: 'Unpin position' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: /Duplicate/ }).click();
    await expect.poll(() => editorText(page)).toMatch(/^api2 "Shortener API" \[REST API\]/m);
    await waitForCanvas(page, 3);
    await layoutSettled(page);

    await node(page, 'Shortener API').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename…' }).click();
    await page.locator('.ps-dialog').getByRole('textbox').fill('Links API');
    await answerDialog(page, 'Rename');
    await expect.poll(() => editorText(page)).toMatch(/^api "Links API" \[REST API\]/m);
    await layoutSettled(page);

    await node(page, 'Links API').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Connect to…' }).click();
    const finder = page.getByRole('dialog', { name: 'Connect Links API to' });
    await finder.getByRole('combobox').fill('api2');
    await page.keyboard.press('Enter');
    await expect.poll(() => editorText(page)).toMatch(/^api -> api2$/m);
  });

  test('Ctrl+D duplicates the selection and / finds a component', async ({ page }) => {
    await openProblem(page);
    await node(page, 'Shortener API').click();
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => editorText(page)).toMatch(/^api2 "Shortener API"/m);
    await layoutSettled(page);
    await page.locator('.react-flow__pane').click({ position: { x: 30, y: 300 } });
    await page.keyboard.press('/');
    await expect(page.getByRole('dialog', { name: 'Find a component' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Find a component' })).toHaveCount(0);
  });

  test('has the minimap toggle', async ({ page }) => {
    await openProblem(page);
    await page.getByRole('button', { name: 'Minimap' }).click();
    await expect(page.locator('.react-flow__minimap')).toBeVisible();
    await page.getByRole('button', { name: 'Minimap' }).click();
    await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  });
});

test.describe('the interview whiteboard', () => {
  test('has no load overlay', async ({ page }) => {
    await page.goto('practice/#/interview');
    await page.getByRole('radio', { name: 'Choose a problem' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a problem' });
    await picker.getByRole('searchbox', { name: 'Search problems' }).fill('URL Shortener');
    await picker.getByRole('list', { name: 'Problems' }).getByRole('button', { name: /URL Shortener/ }).first().click();
    const setup = page.getByTestId('interview-setup');
    while ((await setup.getAttribute('data-step')) !== 'review') await setup.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('button', { name: 'Start the interview' }).click();
    for (const label of ['Estimate', 'Design']) await page.getByRole('button', { name: `Next: ${label}` }).click();
    await waitForCanvas(page, 2);
    await expect(page.getByRole('region', { name: 'Whiteboard' }).getByRole('button', { name: 'Add component' })).toBeVisible();
    await expect(page.getByRole('button', { name: /load$/ })).toHaveCount(0);
    await expect(page.locator('.pc-edge-load')).toHaveCount(0);
  });
});

test.describe('the editor canvas', () => {
  test('has the Flows builder: a use case and a step picked on the canvas', async ({ page }) => {
    await page.goto('app/');
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page, 1);
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: 'New diagram' }).click();
    await expect(canvasNodes(page)).toHaveCount(0);
    await appendCode(page, 'user "User" [Actor]\napi "API" [REST API]\nuser -> api\n');
    await waitForCanvas(page, 2);
    await layoutSettled(page);

    await page.getByRole('button', { name: 'Flows' }).click();
    const flows = page.getByRole('region', { name: 'Flows' });
    // One use case select, whose last option turns it into a name field: Escape goes back, Enter adds.
    const picker = flows.getByRole('combobox', { name: 'Use case' });
    await chooseOption(picker, '+ New use case…');
    const name = flows.getByRole('textbox', { name: 'New use case' });
    await expect(name).toBeFocused();
    await name.press('Escape');
    await expect(picker).toBeFocused();
    await chooseOption(picker, '+ New use case…');
    await name.fill('Browse');
    await name.press('Enter');
    await expect.poll(() => editorText(page)).toContain('usecase "Browse"');
    await expect(picker).toHaveText(/Browse/);
    await chooseOption(picker, '+ New use case…');
    await name.fill('Search');
    await name.press('Enter');
    await expect.poll(() => editorText(page)).toContain('usecase "Search"');
    // The builder and the top bar's picker show the same use case, either way.
    const topBar = page.getByTitle(/^Use case: the flow Play runs/);
    await expect(topBar).toHaveAttribute('data-value', 'search');
    await chooseOption(topBar, 'Browse');
    await expect(picker).toHaveAttribute('data-value', 'browse');
    await expect(flows.getByRole('region', { name: 'Use case Browse' })).toBeVisible();
    await flows.getByRole('button', { name: 'Add a step' }).click();
    const step = flows.getByRole('form', { name: 'New step' });
    await expect(step.getByRole('status')).toHaveText('Click the component the step starts at.');
    await node(page, 'User').click();
    await expect(step.getByRole('status')).toHaveText('Now click the component it goes to.');
    await node(page, 'API').click();
    await expect(step.getByLabel('Starts at')).toHaveAttribute('data-value', 'user');
    await expect(step.getByLabel('Goes to')).toHaveAttribute('data-value', 'api');
    // Picking selects nothing, so no settings open in the builder's place.
    await expect(page.getByRole('region', { name: /settings/ })).toHaveCount(0);
    await step.getByRole('textbox', { name: 'Label' }).fill('GET /items');
    await step.getByRole('button', { name: 'Add step' }).click();
    await expect.poll(() => editorText(page)).toMatch(/user -> api : GET \/items/);

    // The builder and the palette take turns.
    await page.getByRole('button', { name: 'Add component' }).click();
    await expect(flows).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Components' })).toBeVisible();
  });

  test('with Flows open the canvas is narrow: the legend folds, no node sits under the top bar, the hint shortens clear of the controls', async ({ page }) => {
    await page.goto('app/');
    await waitForCanvas(page, 3);
    await layoutSettled(page);
    const legend = page.getByRole('group', { name: 'Load legend' });
    await expect(legend).toHaveAttribute('open', '');
    await expectTopBarClear(page);

    await page.getByRole('button', { name: 'Flows' }).click();
    await expect(page.getByRole('region', { name: 'Flows' })).toBeVisible();
    await expect(legend).not.toHaveAttribute('open', '');
    // After the diagram glides to its new fit.
    await page.waitForTimeout(600);
    await layoutSettled(page);
    await expectTopBarClear(page);
    const hint = page.getByText('? for shortcuts', { exact: true });
    await expect(hint).toBeVisible();
    const [h, c] = [(await hint.boundingBox())!, (await page.locator('.react-flow__controls:visible').boundingBox())!];
    expect(h.x > c.x + c.width || h.y > c.y + c.height || h.y + h.height < c.y).toBe(true);
  });
});
