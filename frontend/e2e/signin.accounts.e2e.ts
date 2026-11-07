import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The sign-in page (/signin/, src/auth/) with the email sign-in API mocked
 * (backend src/emailAuth.ts): sign up, confirm from the link and get the
 * sign-up credits; a wrong password; an unconfirmed sign-in with resend; and
 * a password reset. Turnstile is off (no site key), as in local development.
 */

const PASSWORD = 'a long passphrase 42';

interface State {
  signedIn: boolean;
  confirmed: boolean;
  credits: { outcome: string; reason: string } | null;
  calls: { path: string; body: unknown }[];
}

async function mockEmailAuth(page: Page, state: State) {
  await page.route(
    (url) => url.pathname.startsWith('/auth/'),
    (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const body = request.postDataJSON() as Record<string, unknown> | null;
      if (request.method() === 'POST') state.calls.push({ path, body });
      const status = () =>
        state.signedIn ? { signedIn: true, email: 'ada@example.com', confirmed: state.confirmed, signupCredits: state.credits } : { signedIn: false };
      switch (path) {
        case '/auth/providers':
          return route.fulfill({ json: { providers: ['github', 'google', 'email'] } });
        case '/auth/email/status':
          return route.fulfill({ json: status() });
        case '/auth/email/signup':
          return route.fulfill({ status: 202, json: { message: 'If that address can be used, we sent it a link. Check your inbox to finish signing up.' } });
        case '/auth/email/confirm':
          if (body?.token !== 'good-token') return route.fulfill({ status: 400, json: { error: 'This link has expired or was already used. Sign in to get a new one.' } });
          Object.assign(state, { signedIn: true, confirmed: true });
          return route.fulfill({ json: { confirmed: true, signupCredits: state.credits } });
        case '/auth/email/login':
          if (body?.password !== PASSWORD) return route.fulfill({ status: 401, json: { error: 'Wrong email or password' } });
          state.signedIn = true;
          return route.fulfill({ json: { confirmed: state.confirmed } });
        case '/auth/email/resend':
          return route.fulfill({ status: 202, json: { sent: true, message: 'We sent a new link to ada@example.com.' } });
        case '/auth/email/reset-request':
          return route.fulfill({ status: 202, json: { message: 'If that address is registered, we sent it a link to reset the password.' } });
        case '/auth/email/reset':
          return route.fulfill({ json: { reset: true, signupCredits: state.credits } });
        default:
          return route.fulfill({ status: 404, json: { error: `not mocked: ${path}` } });
      }
    },
  );
}

const fresh = (): State => ({ signedIn: false, confirmed: false, credits: { outcome: 'granted', reason: 'granted' }, calls: [] });

test('sign up, confirm from the email link, and get the sign-up credits', async ({ page }) => {
  const state = fresh();
  await mockEmailAuth(page, state);
  await page.goto('signin/');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Proschi' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue with GitHub' })).toBeVisible();
  await page.getByRole('tab', { name: 'Create account' }).click();
  const form = page.getByRole('form', { name: 'Create account' });
  await form.getByLabel('Email').fill('ada@example.com');
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm your address' })).toBeVisible();
  await expect(page.getByText('If that address can be used, we sent it a link.')).toBeVisible();
  expect(state.calls).toEqual([{ path: '/auth/email/signup', body: { email: 'ada@example.com', password: PASSWORD } }]);

  // The link in the email, opened anew: a button confirms (opening the link alone changes nothing).
  await page.goto('about:blank');
  await page.goto('signin/#confirm=good-token');
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(state.calls).toHaveLength(1);
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your address is confirmed' })).toBeVisible();
  await expect(page.getByText('Your free sign-up credits are in your account.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/practice/');
});

test('a second account is told plainly why it has no free credits', async ({ page }) => {
  const state = { ...fresh(), credits: { outcome: 'refused', reason: 'seen_before' } };
  await mockEmailAuth(page, state);
  await page.goto('signin/#confirm=good-token');
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page.getByText('Free credits are limited to one account per person')).toBeVisible();
});

test('a used link says so', async ({ page }) => {
  await mockEmailAuth(page, fresh());
  await page.goto('signin/#confirm=old-token');
  await page.getByRole('button', { name: 'Confirm my address' }).click();
  await expect(page.getByRole('alert')).toHaveText('This link has expired or was already used. Sign in to get a new one.');
});

test('a wrong password shows one error, and the right one signs in and goes back', async ({ page }) => {
  const state = { ...fresh(), confirmed: true };
  await mockEmailAuth(page, state);
  await page.route('**/practice/**', (route) => route.fulfill({ body: '<!doctype html><title>Practice</title><p>back on practice</p>', contentType: 'text/html' }));
  await page.goto('signin/?return=%2Fpractice%2F%23%2Fme');
  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Email').fill('ada@example.com');
  await form.getByLabel('Password', { exact: true }).fill('not the password');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password');
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/practice\/#\/me$/);
});

test('signed in unconfirmed, it asks for the confirmation and resends the link', async ({ page }) => {
  const state = { ...fresh(), credits: { outcome: 'pending', reason: 'unconfirmed' } };
  await mockEmailAuth(page, state);
  await page.goto('signin/');
  const form = page.getByRole('form', { name: 'Sign in' });
  await form.getByLabel('Email').fill('ada@example.com');
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByText('Until you confirm, this account gets no free sign-up credits.')).toBeVisible();
  await page.getByRole('button', { name: 'Resend the link' }).click();
  await expect(page.getByText('We sent a new link to ada@example.com.')).toBeVisible();
});

test('reset a forgotten password from the email link', async ({ page }) => {
  const state = { ...fresh(), confirmed: true };
  await mockEmailAuth(page, state);
  await page.goto('signin/');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  const ask = page.getByRole('form', { name: 'Reset your password' });
  await ask.getByLabel('Email').fill('ada@example.com');
  await ask.getByRole('button', { name: 'Send the reset link' }).click();
  await expect(page.getByText('If that address is registered, we sent it a link to reset the password.')).toBeVisible();

  await page.goto('about:blank');
  await page.goto('signin/#reset=reset-token');
  const set = page.getByRole('form', { name: 'Set a new password' });
  await set.getByLabel('New password').fill('a brand new password');
  await set.getByRole('button', { name: 'Set the new password' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your password is changed' })).toBeVisible();
  expect(state.calls.at(-1)).toEqual({ path: '/auth/email/reset', body: { token: 'reset-token', password: 'a brand new password' } });
});
