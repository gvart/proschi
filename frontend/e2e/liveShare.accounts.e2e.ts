import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { canvasNodes, codeEditor, copiedText, editorText, expect, mockClipboard, test, waitForCanvas } from './fixtures';
import { Account, ORDERS, seed } from './versions';

/**
 * Live share links in the build with accounts (API mocked): the read-only
 * page at /share/<token> for anyone, signed out included, and the editor's
 * File → Share link… for a Pro account.
 */

const TOKEN = 'Q2hlY2tvdXQtbGl2ZS0x_A';
const SHARED = `title "Live Orders"

user "Shopper"   [Browser]
api  "Shop API"  [REST API]   x2
db   "Orders DB" [PostgreSQL] x2

user -> api : HTTPS
api  -> db  : SQL

usecase "Place order" {
  user -> api  : POST /orders
  api  -> db   : INSERT order
  api --> user : 201
}

traffic {
  "Place order" 500 rps
}

requirements {
  p99 "Place order" < 100ms
}
`;

/** The browser logs the 4xx answers the page expects as console errors; only those are dropped. */
function allowStatus(errors: string[], status: number) {
  const re = new RegExp(`Failed to load resource: the server responded with a status of ${status}`);
  for (let i = errors.length - 1; i >= 0; i--) if (re.test(errors[i])) errors.splice(i, 1);
}

/** What the Worker does for /share/<token>: the share page (`vite preview` serves it at share/). */
async function serveSharePage(page: Page) {
  await page.route((url) => url.pathname.endsWith(`/share/${TOKEN}`) && !url.pathname.startsWith('/api/'), async (route) => {
    const response = await route.fetch({ url: new URL('./', route.request().url()).href });
    await route.fulfill({ response });
  });
}

async function mockSignedOut(page: Page) {
  await page.route(
    (url) => /^\/(api|auth)\//.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/auth/providers') return route.fulfill({ json: { providers: ['github'] } });
      if (pathname === `/api/share/${TOKEN}`) return route.fulfill({ json: { name: 'orders.proschi', title: 'Live Orders', source: SHARED, updatedAt: Date.UTC(2026, 10, 2) } });
      return route.fulfill({ status: 401, json: { error: 'Sign in first' } });
    },
  );
}

test('signed out, a share link opens the diagram read-only, with its simulation', async ({ page, errors }) => {
  await mockSignedOut(page);
  await serveSharePage(page);
  await page.goto(`share/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Live Orders' })).toBeVisible();
  await expect(page).toHaveTitle('Live Orders · Shared · Proschi');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByText('Shared by link, read-only')).toBeVisible();

  // Read-only code, the diagram, and its use case plays.
  await expect(codeEditor(page)).toHaveAttribute('contenteditable', 'false');
  expect(await editorText(page)).toBe(SHARED);
  await waitForCanvas(page, 3);
  await expect(canvasNodes(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();

  // The simulation runs here too.
  await page.getByRole('tab', { name: /Results/ }).click();
  await expect(page.locator('#view-panel-results')).toContainText('Total cost');
  await expect(page.locator('#view-panel-results')).toContainText('All 1 passing');

  // No copy without an account.
  await expect(page.getByRole('link', { name: 'Make a copy' })).toHaveCount(0);
  allowStatus(errors, 401);
});

test('a revoked or guessed link says it does not work', async ({ page, errors }) => {
  await page.route(
    (url) => /^\/(api|auth)\//.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/auth/providers') return route.fulfill({ json: { providers: ['github'] } });
      if (pathname.startsWith('/api/share/')) return route.fulfill({ status: 404, json: { error: 'No such share link' } });
      return route.fulfill({ status: 401, json: { error: 'Sign in first' } });
    },
  );
  await serveSharePage(page);
  await page.goto(`share/${TOKEN}`);
  await expect(page.getByRole('alert')).toHaveText(/does not work any more/);
  await expect(page.getByRole('link', { name: 'Open the Proschi editor' })).toBeVisible();
  allowStatus(errors, 404);
  allowStatus(errors, 401);
});

test('signed in, Make a copy opens the diagram in the editor', async ({ page }) => {
  await mockSignedIn(page);
  await page.route(`**/api/share/${TOKEN}`, (route) => route.fulfill({ json: { name: 'orders.proschi', title: 'Live Orders', source: SHARED, updatedAt: 1 } }));
  await serveSharePage(page);
  await page.goto(`share/${TOKEN}`);
  await page.getByRole('link', { name: 'Make a copy' }).click();
  await expect(page).toHaveURL(/\/app\//);
  await expect(page.getByRole('button', { name: 'Diagrams' })).toContainText('Live Orders');
  expect(await editorText(page)).toBe(SHARED);
});

test('on Pro, File → Share link… makes a link, copies it and revokes it', async ({ page }) => {
  const account = new Account();
  await mockSignedIn(page, { ...SIGNED_IN, user: { ...SIGNED_IN.user, plan: 'pro' } as typeof SIGNED_IN.user });
  await account.mock(page);
  await mockClipboard(page);
  let share: { token: string; url: string; createdAt: number } | null = null;
  const calls: string[] = [];
  await page.route('**/api/me/documents/orders/share', (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'POST') {
      share = { token: TOKEN, url: `https://proschi.app/share/${TOKEN}`, createdAt: Date.UTC(2026, 10, 3) };
      return route.fulfill({ status: 201, json: { share } });
    }
    if (method === 'DELETE') {
      share = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { share } });
  });
  await seed(page, [{ id: 'orders', fileName: 'orders.proschi', source: ORDERS }]);
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await expect.poll(() => account.docs.get('orders')?.source).toBe(ORDERS);

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Share link…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share link' });
  await expect(dialog).toContainText('A live, revocable link to Orders');
  await dialog.getByRole('button', { name: 'Create share link' }).click();
  await expect(dialog.getByLabel('Share link')).toHaveValue(`https://proschi.app/share/${TOKEN}`);
  await dialog.getByRole('button', { name: 'Copy' }).click();
  expect(await copiedText(page)).toBe(`https://proschi.app/share/${TOKEN}`);

  page.once('dialog', (confirm) => void confirm.accept());
  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(dialog.getByRole('button', { name: 'Create share link' })).toBeVisible();
  expect(calls).toEqual(['GET', 'POST', 'DELETE']);
});

test('off Pro, without paid plans on, the File menu has no Share link', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('app/');
  await expect(codeEditor(page)).toBeVisible();
  await page.getByRole('button', { name: 'File' }).click();
  await expect(page.getByRole('menuitem', { name: 'Versions…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share link…' })).toHaveCount(0);
});
