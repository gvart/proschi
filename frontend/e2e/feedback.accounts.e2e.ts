import type { Page } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { FEEDBACK_BUG, mockAdmin, PNG_1PX } from './admin';
import { answerDialog, expect, test } from './fixtures';

/**
 * Send feedback (src/feedback/) in the build with accounts, API mocked: a bug
 * with a screenshot and the diagram from the editor's help menu, the context
 * shown before sending and the thank-you after; signed out, the dialog asks
 * to sign in; the footer and Settings open it too. And the admin's Inbox:
 * the unread count, the open messages on the overview, a message with its
 * context, diagram and screenshot, its status and note, and deleting it.
 */

/** Records POST /api/feedback (multipart) and answers 201. */
async function mockSend(page: Page) {
  const sent: string[] = [];
  await page.route('**/api/feedback', (route) => {
    sent.push(route.request().postDataBuffer()?.toString('latin1') ?? '');
    return route.fulfill({ status: 201, json: { id: 'x' } });
  });
  return sent;
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Send feedback' });

test.describe('send feedback', () => {
  test('sends a bug with a screenshot and the diagram from the editor', async ({ page }) => {
    await mockSignedIn(page);
    const sent = await mockSend(page);
    await page.goto('app/');
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Send feedback' }).click();

    const form = dialog(page);
    await expect(form).toBeVisible();
    await expect(form.getByRole('radio', { name: 'Bug' })).toBeChecked();
    await form.getByLabel('Subject').fill('Playback stops');
    await form.getByLabel('Message').fill('The dots stop at the cache.');
    await form.getByLabel('Screenshots', { exact: true }).setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(form.getByRole('img', { name: 'shot.png' })).toBeVisible();
    // A GIF is refused before sending.
    await form.getByLabel('Screenshots', { exact: true }).setInputFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(form.getByText('Screenshots must be PNG, JPEG or WebP images.')).toBeVisible();
    await form.getByLabel('Attach my current diagram').check();
    // What goes along is listed before sending.
    await form.getByText('Sent with your message').click();
    await expect(form.getByText('/proschi/app/')).toBeVisible();
    await expect(form.getByText(/^Chrome \d+ on /)).toBeVisible();

    await form.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('dialog', { name: 'Message sent' })).toBeVisible();
    await expect(page.getByText('We read every message.')).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('name="kind"\r\n\r\nbug');
    expect(sent[0]).toContain('name="subject"\r\n\r\nPlayback stops');
    expect(sent[0]).toContain('The dots stop at the cache.');
    expect(sent[0]).toContain('name="diagram"');
    expect(sent[0]).toContain('name="screenshot"; filename="shot.png"');
    expect(sent[0]).not.toContain('anim.gif');

    await page.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('needs a message before sending', async ({ page }) => {
    await mockSignedIn(page);
    const sent = await mockSend(page);
    await page.goto('app/');
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Send feedback' }).click();
    await dialog(page).getByRole('button', { name: 'Send' }).click();
    await expect(dialog(page).getByText('Write a message first.')).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  test('signed out, the footer link asks to sign in first', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill({ status: 401, json: { error: 'Sign in first' } }));
    await page.route('**/auth/providers', (route) => route.fulfill({ json: { providers: ['github'] } }));
    await page.goto('./');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Send feedback' }).click();
    await expect(dialog(page).getByText('Sign in to send feedback')).toBeVisible();
    await expect(dialog(page).getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute('href', /\/auth\/github\/start\?return=/);
  });

  test('Settings has Contact us', async ({ page }) => {
    await mockSignedIn(page);
    await page.goto('practice/#/me');
    await page.getByRole('button', { name: 'Contact us' }).click();
    await expect(dialog(page)).toBeVisible();
  });
});

test.describe('admin inbox', () => {
  test('counts unread, lists, opens a message, changes its status and deletes it', async ({ page }) => {
    const posts = await mockAdmin(page, { passkeys: true, setupAvailable: false, signedIn: true });
    await page.goto('admin/');
    await expect(page.getByRole('link', { name: 'Inbox 1 unread' })).toBeVisible();
    await expect(page.getByText('2 open, 1 unread')).toBeVisible();

    await page.getByRole('link', { name: 'Inbox 1 unread' }).click();
    await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open 2' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Playback stops at the cache/ }).click();

    await expect(page).toHaveURL(new RegExp(`#/inbox/${FEEDBACK_BUG}$`));
    await expect(page.getByRole('heading', { name: 'Playback stops at the cache' })).toBeVisible();
    // Plain text: the markup in the message is shown, not run.
    await expect(page.getByText('<script>alert(1)</script>', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reply to ada@example.com' })).toHaveAttribute('href', /^mailto:ada@example\.com\?subject=/);
    await expect(page.getByText('v0.42.0', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open read-only' })).toHaveAttribute('href', /embed\/#code=/);
    await expect(page.getByRole('img', { name: 'Screenshot 1' })).toBeVisible();

    await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'In progress' }).click();
    await page.getByLabel('Internal note').fill('Repro on Safari');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => posts.find((p) => p.method === 'PATCH')?.body).toEqual({ status: 'in_progress', note: 'Repro on Safari' });

    await expect(page.getByRole('button', { name: 'Delete message' })).toBeDisabled();
    await page.getByLabel('Reason for deleting').fill('Duplicate');
    await page.getByRole('button', { name: 'Delete message' }).click();
    await answerDialog(page, 'Delete');
    await expect.poll(() => posts.find((p) => p.method === 'DELETE')).toMatchObject({ path: `/api/admin/feedback/${FEEDBACK_BUG}`, body: { reason: 'Duplicate' } });
    await expect(page).toHaveURL(/#\/inbox$/);
  });
});
