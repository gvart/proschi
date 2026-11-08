import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared fixtures: every test fails on an uncaught page error or a console
 * error in any page of its browser context, unless the message matches
 * ALLOWED_CONSOLE_ERRORS below, or on a request to another host: the site
 * loads nothing from third parties, so the suite runs offline.
 */

/** Known-benign console errors, matched against the message and its ` (url:line)`. Each entry needs a comment saying why it is harmless. */
const ALLOWED_CONSOLE_ERRORS: RegExp[] = [
  // Signed out (build with accounts), GET /api/me answers 401 and the page reads that as signed out; Chromium logs every non-2xx load.
  /^Failed to load resource: the server responded with a status of 401 \(Unauthorized\) \(http:\/\/127\.0\.0\.1:\d+\/api\/me:0\)$/,
  // The sign-in page's forms (signin.accounts.e2e.ts): a wrong password answers 401 and a used link 400, which the page shows as a message.
  /^Failed to load resource: the server responded with a status of 40[01] \([^)]+\) \(http:\/\/127\.0\.0\.1:\d+\/auth\/email\/(login|confirm|reset):0\)$/,
  // The admin's email preview is a sandboxed srcdoc iframe without scripts: the tests' own init scripts (addInitScript) are refused in it, as intended.
  /^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.( \(about:srcdoc:0\))?$/,
  // The admin's Cloudflare usage page before it is set up (cfUsage.accounts.e2e.ts): 501, which the page shows as the setup steps.
  /^Failed to load resource: the server responded with a status of 501 \(Not Implemented\) \(http:\/\/127\.0\.0\.1:\d+\/api\/admin\/cf-usage:0\)$/,
];

/** The key src/onboarding/seen.ts keeps the first-run tours' "seen" flags in. */
export const ONBOARDING_KEY = 'proschi.onboarding';

/** The key src/practice/hub/goal.ts keeps what the visitor is on the practice page for in. */
export const GOAL_KEY = 'proschi.practice.goal';

/**
 * Answers the practice home's "What are you here for?" before every load of
 * `page`: a daily habit shows the streak and today's review, challenge and
 * Arcade run; interview prep the roadmap's next step and the mock interview.
 */
export async function setPracticeGoal(page: Page, goals: ('solve' | 'interview' | 'habit')[]): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [GOAL_KEY, JSON.stringify({ goals, asked: true })] as const);
}

/** The menu of the practice hub's bar (src/practice/hub/tabs.ts HUB_GROUPS) holding each section; Problems and Progress are links on the bar itself. */
const SECTION_MENU: Record<string, RegExp> = {
  Roadmap: /^Interview/,
  'Mock interview': /^Interview/,
  'Review cards': /^More/,
  'Daily challenge': /^More/,
  Arcade: /^More/,
};

/** The practice hub's link to `section`, its menu opened first when it sits in one (on a phone the menus are named "Interview" and "More"). */
export async function sectionLink(page: Page, section: string): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Practice sections' });
  const menu = SECTION_MENU[section];
  if (menu) {
    const button = nav.getByRole('button', { name: menu });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  }
  return nav.getByRole('link', { name: section, exact: true });
}

/** The key src/practice/progress.ts keeps the lessons read in. */
export const LESSONS_KEY = 'proschi.lessons';

/** The key prefix src/practice/stages/flow.ts keeps each problem's stage notes under. */
export const STAGES_KEY = 'proschi.practice.stages.';

export const test = base.extend<{ errors: string[]; onboarding: 'seen' | 'fresh'; onboardingSeen: void; lessons: 'skip' | 'fresh'; lessonsSkipped: void; stages: 'editor' | 'fresh'; stagesSkipped: void }>({
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
  /**
   * A problem opens on its lesson until the lesson is read, which would put
   * a page of reading in front of every test of the workspace. By default,
   * opening `practice/#/<problem id>` (loaded or navigated to) marks that
   * problem's lesson read just before the page reads it, so the workspace
   * opens as for someone who has read it. Only the lesson of the problem
   * opened is marked; `#/<id>/lesson` and `#/roadmap/…` are left alone, and
   * so is every other lesson. Tests of the lesson stage use
   * `test.use({ lessons: 'fresh' })`.
   */
  lessons: ['skip', { option: true }],
  lessonsSkipped: [
    async ({ context, lessons }, use) => {
      if (lessons === 'skip') {
        await context.addInitScript((key) => {
          // The hub's own pages: not problems.
          const PAGES = new Set(['roadmap', 'review', 'progress', 'challenge', 'arcade', 'me']);
          const markRead = () => {
            if (!window.location.pathname.includes('/practice/')) return;
            const id = /^#\/([a-z0-9-]+)$/.exec(window.location.hash)?.[1];
            if (!id || PAGES.has(id)) return;
            try {
              const read = JSON.parse(window.localStorage.getItem(key) ?? '{}');
              if (read[id] !== true) window.localStorage.setItem(key, JSON.stringify({ ...read, [id]: true }));
            } catch {
              // Storage blocked: the lesson shows first.
            }
          };
          markRead();
          // Registered before the app's own listener, so it runs first.
          window.addEventListener('hashchange', markRead);
        }, LESSONS_KEY);
      }
      await use();
    },
    { auto: true },
  ],
  /**
   * A problem is worked through in stages (Clarify, Estimate, Design,
   * Wrap-up), and Design opens on the whiteboard. Most tests are about the
   * full editor, so by default a problem opened (`#/<id>`, `#/<id>/lesson`
   * or `#/roadmap/<id>`) whose stages were never touched opens on Design in
   * the full editor, every stage reached, as for someone who has been through
   * them. Its lesson still shows first until read (see `lessons`). Tests of
   * the stages use `test.use({ stages: 'fresh' })`.
   */
  stages: ['editor', { option: true }],
  stagesSkipped: [
    async ({ context, stages }, use) => {
      if (stages === 'editor') {
        await context.addInitScript((prefix) => {
          const PAGES = new Set(['roadmap', 'review', 'progress', 'challenge', 'arcade', 'me', 'interview', 'guide']);
          const skip = () => {
            if (!window.location.pathname.includes('/practice/')) return;
            const m = /^#\/(?:roadmap\/)?([a-z0-9-]+)(?:\/lesson)?$/.exec(window.location.hash);
            const id = m?.[1];
            if (!id || PAGES.has(id)) return;
            try {
              if (window.localStorage.getItem(prefix + id) === null) window.localStorage.setItem(prefix + id, JSON.stringify({ stage: 'design', reached: 'wrapup', editor: true, briefRead: true }));
            } catch {
              // Storage blocked: the stages show.
            }
          };
          skip();
          window.addEventListener('hashchange', skip);
        }, STAGES_KEY);
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
        const { url, lineNumber } = msg.location();
        const text = `${msg.text()}${url ? ` (${url}:${lineNumber})` : ''}`;
        if (ALLOWED_CONSOLE_ERRORS.some((re) => re.test(text))) return;
        errors.push(`console.error: ${text}`);
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

/** Answers the open confirm or prompt (src/design/dialogs.ts) with its button named `name`. */
export async function answerDialog(page: Page, name: string): Promise<void> {
  await page.locator('.ps-dialog').getByRole('button', { name, exact: true }).click();
}

/**
 * The mock interview's set-up wizard (practice/interview/Setup.tsx): Continue
 * until the screen `step` shows ('who', 'problem', 'length', 'talk' or
 * 'review', the last one with Start). The screens before it keep their defaults.
 */
export async function toSetupStep(page: Page, step: 'who' | 'problem' | 'length' | 'talk' | 'review' = 'review'): Promise<Locator> {
  const setup = page.getByTestId('interview-setup');
  await expect(setup).toBeVisible();
  for (let i = 0; i < 5; i++) {
    const at = await setup.getAttribute('data-step');
    if (at === step) break;
    await setup.getByRole('button', { name: /^(Continue|Back to review)/ }).click();
    await expect(setup).not.toHaveAttribute('data-step', at ?? '');
  }
  await expect(setup).toHaveAttribute('data-step', step);
  return setup;
}

/** Loads the open problem's reference solution into the editor, saying yes to both confirms. */
export async function loadReferenceSolution(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Show reference solution' }).click();
  await answerDialog(page, 'Show solution');
  await page.getByRole('button', { name: 'Load into the editor' }).click();
  await answerDialog(page, 'Replace');
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

/**
 * The component palette beside the canvas (a bottom sheet on phones), opened if it is not shown:
 * it starts hidden, and a selection's settings take its place until the toggle brings it back.
 */
export async function componentPalette(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: 'Add component' });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const palette = page.getByRole('region', { name: 'Components' });
  await expect(palette).toBeVisible();
  return palette;
}

/** Adds a component from the palette by searching for it; `name` is the palette entry. */
export async function addFromPalette(page: Page, search: string, name: string): Promise<void> {
  const palette = await componentPalette(page);
  await palette.getByRole('searchbox', { name: 'Search components' }).fill(search);
  await palette.getByRole('button', { name, exact: true }).click();
}

/** Opens one of the design system's selects (src/design/Select.tsx) and picks the option with this exact label. */
export async function chooseOption(select: Locator, option: string): Promise<void> {
  await select.click();
  await select.page().getByRole('option', { name: option, exact: true }).click();
}
