import type { Page } from '@playwright/test';
import { mockSignedIn, SIGNED_IN } from './accounts';
import { expect, test } from './fixtures';

/**
 * The header with the practice page's account and help menus, signed in (the
 * build with accounts, API mocked): on a phone the row must not get wider
 * than the screen, and the menus' panels must open inside it. The build
 * without accounts has no account menu, so mobile.e2e.ts cannot see this.
 */

const PAGES = ['practice/', 'practice/#/review', 'practice/#/progress', 'practice/#/url-shortener'];

async function pageWidth(page: Page): Promise<{ scrollWidth: number; width: number }> {
  return page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
}

/** The box of `locator`'s element is within the viewport, and the page does not scroll sideways. */
async function expectInside(page: Page, selector: ReturnType<Page['locator']>, where: string): Promise<void> {
  const box = (await selector.boundingBox())!;
  const { scrollWidth, width } = await pageWidth(page);
  expect(scrollWidth, `${where}: the page scrolls sideways`).toBeLessThanOrEqual(width);
  expect(box.x, `${where}: sticks out on the left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${where}: sticks out on the right`).toBeLessThanOrEqual(width);
}

for (const width of [320, 390]) {
  test.describe(`signed-in header at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true });

    test('fits the screen on every practice page, and the account and help menus open inside it', async ({ page }) => {
      await mockSignedIn(page);
      for (const path of PAGES) {
        await page.goto(path);
        const header = page.locator('.ps-header');
        const account = header.getByRole('button', { name: 'Account' });
        await expect(account).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectInside(page, header.locator('.ps-menu__button'), `${path}: the menu button`);
        await expectInside(page, account, `${path}: the account button`);

        for (const name of ['Account', 'Help']) {
          await header.getByRole('button', { name }).click();
          const menu = page.getByRole('menu');
          await expect(menu).toBeVisible();
          if (name === 'Account') await expect(menu).toContainText(`Signed in as ${SIGNED_IN.user.displayName} with GitHub`);
          else await expect(menu.getByRole('menuitem').first()).toBeVisible();
          // After the pop-in animation.
          await expect.poll(() => menu.evaluate((el) => el.getAnimations().length)).toBe(0);
          await expectInside(page, menu, `${path}: the ${name} menu`);
          await page.keyboard.press('Escape');
          await expect(menu).toBeHidden();
        }
      }
    });
  });
}

test('on a desktop the header keeps the account name and the editor button', async ({ page }) => {
  await mockSignedIn(page);
  await page.goto('practice/');
  const header = page.locator('.ps-header');
  await expect(header.getByRole('button', { name: 'Account' })).toContainText(SIGNED_IN.user.displayName);
  await expect(header.getByRole('link', { name: /Open the editor/ })).toBeVisible();
  await expect(header.getByRole('navigation', { name: 'Main' })).toBeVisible();
  const { scrollWidth, width } = await pageWidth(page);
  expect(scrollWidth).toBeLessThanOrEqual(width);
});
