import { expect, test } from './fixtures';

/**
 * Signed out, in the build with accounts and paid plans (API mocked), the
 * free "Your next steps" still come from this browser's progress, on the
 * roadmap (never on the home).
 */

test('signed out: the rule-based steps from this browser’s progress', async ({ page, errors }) => {
  await page.route(
    (url) => /^\/(api|auth)\//.test(url.pathname),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/me') return route.fulfill({ status: 401, json: { error: 'signed out' } });
      if (pathname === '/auth/providers') return route.fulfill({ json: { providers: ['github'] } });
      return route.fulfill({ status: 404, json: { error: `not mocked: ${pathname}` } });
    },
  );
  await page.addInitScript((now) => {
    localStorage.setItem('proschi.practice', JSON.stringify({ pastebin: { status: 'attempted', source: 'x' } }));
    localStorage.setItem('proschi.practice.mistakes', JSON.stringify([{ problem: 'pastebin', title: 'Pastes kept only in the cache', at: now }]));
  }, Math.floor(Date.now() / 1000));

  await page.goto('practice/');
  await expect(page.getByRole('link', { name: /URL Shortener/ }).first()).toBeVisible();
  await expect(page.getByText('Your next steps')).toHaveCount(0);

  await page.goto('practice/#/roadmap');
  const roadmap = page.getByRole('region', { name: 'Your next steps' });
  await expect(roadmap.getByTestId('next-steps').getByRole('link').first()).toContainText('Retry Pastebin');
  await expect(roadmap.getByTestId('next-steps').getByRole('link').first()).toHaveAttribute('href', '#/interview?problem=pastebin');
  await expect(roadmap.getByTestId('next-steps').getByRole('link').filter({ hasText: 'Do today’s daily challenge' })).toHaveAttribute('href', '#/challenge');
  await expect(roadmap.getByTestId('roadmap-picks')).toHaveCount(0);

  // Signed out, GET /api/me answers 401, which Chromium logs as a failed resource load; the unmocked API calls 404.
  for (let i = errors.length - 1; i >= 0; i--) if (/status of (401|404)/.test(errors[i])) errors.splice(i, 1);
});
