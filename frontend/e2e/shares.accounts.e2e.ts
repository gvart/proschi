import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { canvasNodes, codeEditor, editorText, expect, test, waitForCanvas } from './fixtures';

/**
 * Short links in the build with accounts (API mocked, e2e/accounts.ts):
 * signed in, Share → Short link with preview stores the diagram with a PNG
 * preview and copies /s/<id>; signed out, the menu says signing in gives
 * short links; ?s=<id> opens a short link's diagram in the editor and in the
 * embed page.
 */

const ID = 'Ab3dEf9hIj';
const SHARED = 'title "Shared Short"\n\nweb "Web" [React]\napi "Short API" [Go]\nweb -> api : GET /\n';

/** GET /api/shares/<ID>, as the Worker answers it. */
async function mockShare(page: Page): Promise<void> {
  await page.route(`**/api/shares/${ID}`, (route) =>
    route.fulfill({ json: { id: ID, title: 'Shared Short', source: SHARED, hasImage: true, createdAt: 1_800_000_000 } }),
  );
}

test.describe('short links', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test('signed in, Share makes a short link with a preview and copies it', async ({ page }) => {
    await mockSignedIn(page);
    let posted: { source?: string; image?: string } | undefined;
    await page.route('**/api/shares', async (route) => {
      posted = route.request().postDataJSON() as typeof posted;
      await route.fulfill({ status: 201, json: { id: ID, url: `https://proschi.app/s/${ID}`, title: 'E-Commerce Platform', hasImage: true, createdAt: 1 } });
    });
    await page.goto('app/?example=ecommerce');
    await expect(codeEditor(page)).toBeVisible();
    await waitForCanvas(page, 6);

    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Short link with preview' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Short link copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://proschi.app/s/${ID}`);
    expect(posted?.source).toBe(await editorText(page));
    expect(posted?.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);

    // Embed reuses the same short link: one POST, an iframe of /embed/?s=<id>.
    const before = posted;
    posted = undefined;
    await page.getByRole('button', { name: /^(Share|Copied)$/ }).click();
    await page.getByRole('menuitem', { name: 'Embed' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Embed code copied' })).toBeVisible();
    expect(posted).toBeUndefined();
    expect(before).toBeDefined();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`^<iframe src="http://127\\.0\\.0\\.1:\\d+/proschi/embed/\\?s=${ID}"`));
  });

  test('signed out, the Share menu says signing in gives short links', async ({ page }) => {
    await page.route(
      (url) => /^\/(api|auth)\//.test(url.pathname),
      (route) => {
        const { pathname } = new URL(route.request().url());
        if (pathname === '/auth/providers') return route.fulfill({ json: { providers: ['github'] } });
        return route.fulfill({ status: 401, json: { error: 'Sign in first' } });
      },
    );
    await page.goto('app/');
    await expect(codeEditor(page)).toBeVisible();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Sign in for short links with a preview of the diagram.');
    await expect(menu.getByRole('menuitem', { name: 'Sign in with GitHub' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Short link with preview' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
  });

  test('?s=<id> opens the short link’s diagram in the editor', async ({ page }) => {
    await mockSignedIn(page);
    await mockShare(page);
    await page.goto(`app/?s=${ID}`);
    await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('Shared Short');
    await expect(canvasNodes(page).filter({ hasText: 'Short API' })).toBeVisible();
    // The parameter gives way to an ordinary #code= link.
    await expect(page).toHaveURL(/\/proschi\/app\/#code=/);
  });

  test('the embed page shows a short link’s diagram', async ({ page }) => {
    await mockShare(page);
    await page.goto(`embed/?s=${ID}`);
    await expect(page.getByRole('heading', { name: 'Shared Short' })).toBeVisible();
    await expect(canvasNodes(page).filter({ hasText: 'Short API' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in Proschi' })).toHaveAttribute('href', `../app/?s=${ID}`);
  });
});
