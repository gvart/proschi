import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production build, served by `vite preview`
 * under a sub-path like GitHub Pages (https://<user>.github.io/proschi/), so
 * the relative base ('./') is exercised too. Run `npm run build` first, or use
 * `npm run e2e`, which builds and then runs the suite.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_PATH = '/proschi/';
const BASE_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;
/** The build with accounts (VITE_ACCOUNTS=true, `npm run build:accounts`), on the next port, for *.accounts.e2e.ts. */
const ACCOUNTS_URL = `http://127.0.0.1:${PORT + 1}${BASE_PATH}`;
const ACCOUNTS = /\.accounts\.e2e\.ts$/;

// `vite preview` serves whatever is in dist/; a missing build would only show up as confusing 404s.
if (!existsSync(new URL('./dist/index.html', import.meta.url))) {
  throw new Error('No production build in frontend/dist. Run `npm run build` first, or `npm run e2e:build`.');
}
if (!existsSync(new URL('./dist-accounts/index.html', import.meta.url))) {
  throw new Error('No build with accounts in frontend/dist-accounts. Run `npm run build:accounts` first, or `npm run e2e:build`.');
}

// A sandbox with a pre-installed Chromium that doesn't match this Playwright
// version can point at it. CI uses `npx playwright install chromium` instead.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  // Not *.spec.ts / *.test.ts, so vitest never picks these up.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ACCOUNTS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: executablePath && existsSync(executablePath) ? { executablePath } : {},
      },
    },
    {
      // The site as deployed, with sign-in: the API is mocked with page.route (e2e/accounts.ts).
      name: 'accounts',
      testMatch: ACCOUNTS,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ACCOUNTS_URL,
        viewport: { width: 1440, height: 900 },
        launchOptions: executablePath && existsSync(executablePath) ? { executablePath } : {},
      },
    },
  ],
  webServer: [
    {
      command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort --base ${BASE_PATH}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${PORT + 1} --strictPort --base ${BASE_PATH} --outDir dist-accounts`,
      url: ACCOUNTS_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
