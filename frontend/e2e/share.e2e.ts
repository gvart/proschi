import { codeEditor, copiedText, expect, mockClipboard, test, waitForCanvas } from './fixtures';
import { mockProfile, PROFILE } from './profile';

/**
 * Share buttons (src/components/ShareButton.tsx, texts in src/learn/share.ts):
 * without a share sheet they copy, here to a mocked clipboard. A first solve
 * shares its cost against the reference and its p99 with the problem's page;
 * a public profile shares its own address, /u/<id>.
 */

test('a first solve can be shared with its cost and p99, linking the problem’s page', async ({ page }) => {
  await mockClipboard(page);
  await page.goto('practice/#/url-shortener');
  await expect(codeEditor(page)).toBeVisible();
  await waitForCanvas(page);
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Show reference solution' }).click();
  await page.getByRole('button', { name: 'Load into the editor' }).click();
  await page.getByRole('button', { name: 'Run tests' }).click();
  const share = page.getByRole('button', { name: 'Share your solve' });
  await expect(share).toBeVisible();
  await share.click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied to the clipboard.' })).toBeVisible();
  // The reference solution costs what the reference does.
  expect(await copiedText(page)).toMatch(/^I solved URL Shortener on Proschi at 1× the reference cost and p99 [\d.]+ m?s\nhttps:\/\/proschi\.app\/practice\/url-shortener\/$/);
});

test('a public profile shares its own address', async ({ page }) => {
  await mockClipboard(page);
  await mockProfile(page);
  await page.goto(`practice/#/u/${PROFILE.id}`);
  await page.getByRole('button', { name: 'Share profile' }).click();
  await expect.poll(() => copiedText(page)).toBe(`Ada Lovelace on Proschi\nhttps://proschi.app/u/${PROFILE.id}`);
});
