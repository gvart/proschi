import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared fixtures: every test fails on an uncaught page error or a console
 * error in any page of its browser context, unless the message matches
 * ALLOWED_CONSOLE_ERRORS below. External requests are stubbed so the suite
 * runs offline and never depends on third-party uptime.
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
      // The landing page loads IBM Plex from Google Fonts; serve an empty
      // stylesheet so tests are offline and deterministic.
      await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
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
