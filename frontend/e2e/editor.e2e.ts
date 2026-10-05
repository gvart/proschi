import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { appendCode, canvasNodes, codeEditor, editorText, expect, expectDiagramFitted, test, waitForCanvas } from './fixtures';

/** The default document (the e-commerce example) has six components and a group. */
const DEFAULT_NODES = 6;

async function openEditor(page: Page) {
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page, DEFAULT_NODES);
}

/** Opens a bundled example from the Examples gallery. */
async function openExample(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Examples' }).click();
  const gallery = page.getByRole('dialog', { name: 'Examples' });
  await gallery.getByRole('button', { name }).click();
  await expect(gallery).toBeHidden();
}

const stepLabel = (page: Page) => page.getByText(/^Step \d+ of \d+$/);

test.describe('editor', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('renders the default example on the canvas', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('E-Commerce Platform');
    for (const name of ['API Gateway', 'Order Service', 'Orders DB', 'OrderEvents']) {
      await expect(canvasNodes(page).filter({ hasText: name })).toBeVisible();
    }
    await expect(page.getByText('No problems')).toBeVisible();
  });

  test('typing in the code editor updates the diagram', async ({ page }) => {
    const before = await canvasNodes(page).count();
    await appendCode(page, '\nzeta "Zeta Cache" [Redis]\norders -> zeta : GET\n');
    await expect(canvasNodes(page).filter({ hasText: 'Zeta Cache' })).toBeVisible();
    await expect(canvasNodes(page)).toHaveCount(before + 1);
    await expect(page.getByText('No problems')).toBeVisible();
  });

  test('a bad line shows a diagnostic', async ({ page }) => {
    await appendCode(page, '\nthis line is broken !!\n');
    const diagnostics = page.getByTestId('diagnostics');
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.getByRole('button').first()).toContainText("Unexpected character '!'");
    await expect(page.getByText('No problems')).toBeHidden();
    // The lint gutter marks the line too.
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible();
  });

  test('Play runs a use case and steps through it', async ({ page }) => {
    await expect(page.getByRole('combobox', { name: 'Use case' })).toHaveValue('create-order');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(stepLabel(page)).toHaveText(/^Step 1 of \d+$/);
    await expect(page.getByRole('button', { name: 'Back to diagram' })).toBeVisible();

    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(stepLabel(page)).toHaveText(/^Step 2 of \d+$/);
    await page.getByRole('button', { name: 'Previous step' }).click();
    await expect(stepLabel(page)).toHaveText(/^Step 1 of \d+$/);
    await expect(page).toHaveURL(/[#&]uc=create-order/);

    await page.getByRole('button', { name: 'Back to diagram' }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await waitForCanvas(page, DEFAULT_NODES);
  });

  test('scenario tabs switch the played scenario', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Scenarios of Create order' });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await tabs.getByRole('tab', { name: /Unknown user/ }).click();
    await expect(tabs.getByRole('tab', { name: /Unknown user/ })).toHaveAttribute('aria-selected', 'true');
    await expect(stepLabel(page)).toHaveText('Step 1 of 2') // responses (-->) are folded into the calls they answer;
    await expect(page).toHaveURL(/[#&]alt=unknown-user/);

    await tabs.getByRole('tab', { name: /Database down/ }).click();
    await expect(tabs.getByRole('tab', { name: /Database down/ })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: /Unknown user/ })).toHaveAttribute('aria-selected', 'false');
    await expect(stepLabel(page)).toHaveText(/^Step 1 of \d+$/);
    await expect(page).toHaveURL(/[#&]alt=database-down/);
  });

  test('share link round trip keeps the diagram and the playback step', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await appendCode(page, '\nshared "Shared Node" [Redis]\n');
    await expect(canvasNodes(page).filter({ hasText: 'Shared Node' })).toBeVisible();

    const tabs = page.getByRole('tablist', { name: 'Scenarios of Create order' });
    await tabs.getByRole('tab', { name: /Database down/ }).click();
    await page.getByRole('button', { name: 'Next step' }).click();
    await page.getByRole('button', { name: 'Next step' }).click();
    await expect(stepLabel(page)).toHaveText(/^Step 3 of \d+$/);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/\/proschi\/app\/#code=.*&uc=create-order&alt=database-down&step=3/);
    const source = await editorText(page);

    // A fresh page with no saved state must rebuild everything from the link.
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.getByText(/^Step \d+ of \d+$/)).toHaveText(/^Step 3 of \d+$/);
    await expect(other.getByRole('tablist', { name: 'Scenarios of Create order' }).getByRole('tab', { name: /Database down/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await editorText(other)).toBe(source);
    await other.getByRole('button', { name: 'Back to diagram' }).click();
    await expect(canvasNodes(other).filter({ hasText: 'Shared Node' })).toBeVisible();
    await expect(canvasNodes(other)).toHaveCount(DEFAULT_NODES + 2); // + the group + the new node
  });

  test('Format code tidies the document', async ({ page }) => {
    await appendCode(page, '\nzeta    "Zeta Cache"     [Redis]\n   orders   ->   zeta\n');
    await expect.poll(() => editorText(page)).toContain('   orders   ->   zeta');
    await page.getByRole('button', { name: 'Diagrams' }).click();
    await page.getByRole('menuitem', { name: /Format code/ }).click();
    await expect.poll(() => editorText(page)).toContain('\norders -> zeta\n');
    const text = await editorText(page);
    expect(text).toContain('zeta "Zeta Cache" [Redis]');
    expect(text).not.toContain('   orders   ->');
  });

  test('HLD tab renders the design document', async ({ page }) => {
    await page.getByRole('tablist', { name: 'Diagram view' }).getByRole('tab', { name: 'HLD' }).click();
    const nav = page.getByRole('navigation', { name: 'HLD sections' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'E-Commerce Platform' })).toBeVisible();
    const sections = page.getByRole('heading', { level: 2 });
    await expect(sections.first()).toBeVisible();
    expect(await sections.count()).toBeGreaterThan(1);
    await expect(nav.getByRole('link')).toHaveCount(await sections.count());
  });

  test('Analysis and Tests tabs render for the URL shortener', async ({ page }) => {
    await openExample(page, /URL shortener HLD/);
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('URL Shortener');
    const views = page.getByRole('tablist', { name: 'Diagram view' });

    await views.getByRole('tab', { name: 'Analysis' }).click();
    await expect(page.getByRole('heading', { name: 'Nodes' })).toBeVisible();
    await expect(page.getByRole('meter').first()).toBeVisible();
    await page.getByRole('button', { name: 'Review my design' }).click();
    await expect(page.getByTestId('review-result').getByText(/tests pass/).first()).toBeVisible();

    const testsTab = views.getByRole('tab', { name: /Tests/ });
    await expect(testsTab).toContainText(/\d+\/\d+/);
    await testsTab.click();
    await expect(page.getByText(/^(All \d+ passing|\d+ of \d+ failing)$/)).toBeVisible();
    await expect(page.getByRole('img', { name: /passed|failed/ }).first()).toBeVisible();
  });

  test('Export PNG downloads an image', async ({ page }) => {
    await page.getByRole('button', { name: 'Export image' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'PNG image' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('e-commerce-platform.png');
    const bytes = await readFile(await download.path());
    // PNG signature, and more than an empty image.
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBeGreaterThan(10_000);
  });
});

test.describe('editor on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Code and Diagram tabs switch panes', async ({ page }) => {
    await page.goto('app/');
    const panes = page.getByRole('tablist', { name: 'View', exact: true });
    const codeTab = panes.getByRole('tab', { name: /Code/ });
    const diagramTab = panes.getByRole('tab', { name: /Diagram/ });
    await expect(diagramTab).toHaveAttribute('aria-selected', 'true');
    await waitForCanvas(page, DEFAULT_NODES);
    await expect(codeEditor(page)).toHaveCount(0);

    await codeTab.click();
    await expect(codeTab).toHaveAttribute('aria-selected', 'true');
    await expect(codeEditor(page)).toBeVisible();
    await expect(canvasNodes(page)).toHaveCount(0);
    await appendCode(page, '\nphone "Phone Node" [Redis]\n');

    await diagramTab.click();
    await expect(diagramTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvasNodes(page).filter({ hasText: 'Phone Node' })).toBeVisible();
    await expect(codeEditor(page)).toHaveCount(0);
  });

  test('the diagram is fitted again after switching back from Code', async ({ page }) => {
    await page.goto('app/');
    const panes = page.getByRole('tablist', { name: 'View', exact: true });
    await waitForCanvas(page, DEFAULT_NODES);
    await expectDiagramFitted(page);
    // Edit while the canvas is hidden, then come back: the pane only gets its size again after it is shown.
    await panes.getByRole('tab', { name: /Code/ }).click();
    await appendCode(page, '\nwide "A Node With A Rather Long Name" [Redis]\norders -> wide\n');
    await panes.getByRole('tab', { name: /Diagram/ }).click();
    await expect(canvasNodes(page).filter({ hasText: 'A Node With A Rather Long Name' })).toBeVisible();
    await expectDiagramFitted(page);
    // Just switching tabs keeps it fitted too.
    await panes.getByRole('tab', { name: /Code/ }).click();
    await panes.getByRole('tab', { name: /Diagram/ }).click();
    await waitForCanvas(page, DEFAULT_NODES);
    await expectDiagramFitted(page);
  });
});
