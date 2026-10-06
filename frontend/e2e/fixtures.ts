import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared fixtures: every test fails on an uncaught page error or a console
 * error in any page of its browser context, unless the message matches
 * ALLOWED_CONSOLE_ERRORS below, or on a request to another host: the site
 * loads nothing from third parties, so the suite runs offline.
 */

/** Known-benign console errors. Each entry needs a comment saying why it is harmless. */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [];

/** The key src/onboarding/seen.ts keeps the first-run tours' "seen" flags in. */
export const ONBOARDING_KEY = 'proschi.onboarding';

export const test = base.extend<{ errors: string[]; onboarding: 'seen' | 'fresh'; onboardingSeen: void }>({
  /**
   * First-run tours would cover the pages most tests look at, so by default
   * every page starts with them marked as seen. Tests of the tours themselves
   * use `test.use({ onboarding: 'fresh' })`.
   */
  onboarding: ['seen', { option: true }],
  onboardingSeen: [
    async ({ context, onboarding }, use) => {
      if (onboarding === 'seen') {
        await context.addInitScript((key) => {
          try {
            window.localStorage.setItem(key, JSON.stringify({ editor: true, practice: true }));
          } catch {
            // Storage blocked: the tours fall back to memory.
          }
        }, ONBOARDING_KEY);
      }
      await use();
    },
    { auto: true },
  ],
  errors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      context.on('weberror', (error) => errors.push(`pageerror: ${error.error().stack ?? error.error().message}`));
      context.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (ALLOWED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
        const { url, lineNumber } = msg.location();
        errors.push(`console.error: ${text}${url ? ` (${url}:${lineNumber})` : ''}`);
      });
      // Every page, fonts included, is served by the site itself: a request
      // anywhere else is a bug (and would make the suite depend on the network).
      await context.route(
        (url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost',
        (route) => {
          errors.push(`external request: ${route.request().url()}`);
          return route.abort();
        },
      );
      await use(errors);
      expect(errors, 'page errors / console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The React Flow nodes on the visible canvas. */
export function canvasNodes(page: Page): Locator {
  return page.locator('.react-flow__node:visible');
}

/** Waits until the canvas has laid out and rendered at least `min` nodes (layout runs async, possibly in a worker). */
export async function waitForCanvas(page: Page, min = 1): Promise<void> {
  await expect.poll(() => canvasNodes(page).count(), { message: 'canvas nodes rendered' }).toBeGreaterThanOrEqual(min);
}

/** The editable area of the (visible) CodeMirror editor. */
export function codeEditor(page: Page): Locator {
  return page.locator('.cm-content:visible');
}

/** Puts the cursor at the end of the document and inserts `text` without triggering autocompletion. */
export async function appendCode(page: Page, text: string): Promise<void> {
  const editor = codeEditor(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}

/**
 * The whole text of the visible editor, read from CodeMirror's state: the DOM
 * only holds the lines in view. This mirrors EditorView.findFromDOM (newer
 * @codemirror/view links DOM to its tree as `cmTile`, older as `cmView`), and
 * throws rather than guessing if neither is there after an upgrade.
 */
export async function editorText(page: Page): Promise<string> {
  return codeEditor(page).evaluate((el) => {
    type Doc = { state: { doc: { toString(): string } } };
    const node = el as HTMLElement & { cmTile?: { root?: { view?: Doc } }; cmView?: { view?: Doc; root?: { view?: Doc } } };
    const view = node.cmTile?.root?.view ?? node.cmView?.root?.view ?? node.cmView?.view;
    if (!view) throw new Error('editorText: cannot find the CodeMirror view behind .cm-content');
    return view.state.doc.toString();
  });
}

/** The box around every visible canvas node, in page pixels. */
export async function nodesBox(page: Page): Promise<{ left: number; top: number; right: number; bottom: number }> {
  return canvasNodes(page).evaluateAll((els) => {
    const rects = els.map((e) => e.getBoundingClientRect());
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  });
}

/**
 * A clipboard that keeps what is copied (and no share sheet, so share buttons
 * copy), for tests of share buttons; read it back with copiedText.
 */
export async function mockClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, '__copied', { value: copied });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
  });
}

/** The last text copied since mockClipboard, or '' for none. */
export function copiedText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1) ?? '');
}

/** Waits until every canvas node lies inside the visible canvas (the view is fitted), optionally above `bottomLimit`. */
export async function expectDiagramFitted(page: Page, bottomLimit = Infinity): Promise<void> {
  await expect
    .poll(
      async () => {
        const pane = await page.locator('.react-flow:visible').boundingBox();
        if (!pane) return 'no canvas';
        const box = await nodesBox(page);
        const inside =
          box.left >= pane.x - 1 &&
          box.right <= pane.x + pane.width + 1 &&
          box.top >= pane.y - 1 &&
          box.bottom <= Math.min(pane.y + pane.height, bottomLimit) + 1;
        return inside ? 'fitted' : JSON.stringify({ pane, box });
      },
      { message: 'diagram fitted inside the canvas' },
    )
    .toBe('fitted');
}
