import type { Page, Request } from '@playwright/test';
import { mockSignedIn } from './accounts';
import { expect, test } from './fixtures';

/**
 * Email reminders on the account page (`#/me`), signed in with the API
 * mocked: opting in sends the address with the browser's time zone and asks
 * to confirm it; a confirmed address shows the per-type switches, a paused
 * one the resume button; the address can be removed.
 */

type Prefs = Record<string, unknown>;

/** Answers /api/me/email from `state`, keeping each PUT, PATCH and DELETE body; the rest as mockSignedIn does. */
async function mockEmail(page: Page, state: { prefs: Prefs }) {
  const calls: { method: string; body: unknown }[] = [];
  await mockSignedIn(page);
  await page.route('**/api/challenge/today', (route) =>
    route.fulfill({
      json: { day: new Date().toISOString().slice(0, 10), cardIds: [], endsAt: Math.floor(Date.now() / 1000) + 3600, maxScore: 600, attempt: null, startedAt: null, streak: null, best: null },
    }),
  );
  await page.route('**/api/me/email', (route) => {
    const request: Request = route.request();
    const method = request.method();
    const body = request.postDataJSON() as Prefs | null;
    if (method !== 'GET') calls.push({ method, body });
    if (method === 'PUT') state.prefs = { email: body!.email, confirmed: false, timeZone: body!.timeZone, streak: true, cards: true, recap: true, paused: false, confirmationSent: true };
    if (method === 'PATCH') state.prefs = { ...state.prefs, ...body, ...(body!.resume ? { paused: false } : {}) };
    if (method === 'DELETE') {
      state.prefs = { email: null };
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: state.prefs });
  });
  return calls;
}

test('opting in sends the address and time zone, and waits for the confirmation', async ({ page }) => {
  const state = { prefs: { email: null } as Prefs };
  const calls = await mockEmail(page, state);
  await page.goto('practice/#/me');
  const section = page.getByRole('region', { name: 'Email reminders' });
  await expect(section).toBeVisible();

  await section.getByLabel('Email address').fill('not-an-address');
  await section.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(section.getByRole('alert')).toContainText('Enter an email address');
  expect(calls).toHaveLength(0);

  await section.getByLabel('Email address').fill('me@example.com');
  await section.getByRole('button', { name: 'Send confirmation link' }).click();
  await expect(section.getByRole('status')).toContainText('We sent a confirmation link to me@example.com');
  // playwright.config.ts runs the browser in UTC.
  expect(calls).toEqual([{ method: 'PUT', body: { email: 'me@example.com', timeZone: 'UTC' } }]);
  await expect(section).toContainText('Waiting for you to confirm me@example.com');
  await expect(section.getByRole('switch')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Resend the link' })).toBeVisible();
});

test('a confirmed address has a switch per reminder, resumes after a pause, and can be removed', async ({ page }) => {
  const state = { prefs: { email: 'me@example.com', confirmed: true, timeZone: 'UTC', streak: true, cards: true, recap: true, paused: true } as Prefs };
  const calls = await mockEmail(page, state);
  await page.goto('practice/#/me');
  const section = page.getByRole('region', { name: 'Email reminders' });
  await expect(section).toContainText('Reminders go to me@example.com.');

  await section.getByRole('button', { name: 'Resume reminders' }).click();
  await expect(section.getByRole('button', { name: 'Resume reminders' })).toHaveCount(0);

  const cards = section.getByRole('switch', { name: /Cards due/ });
  await expect(cards).toBeChecked();
  await cards.click();
  await expect(cards).not.toBeChecked();
  expect(calls.slice(0, 2)).toEqual([
    { method: 'PATCH', body: { resume: true } },
    { method: 'PATCH', body: { cards: false } },
  ]);

  await section.getByRole('button', { name: 'Remove address' }).click();
  await expect(section.getByRole('status')).toContainText('Your address was removed');
  await expect(section.getByLabel('Email address')).toBeVisible();
  expect(calls.at(-1)).toEqual({ method: 'DELETE', body: null });
});
