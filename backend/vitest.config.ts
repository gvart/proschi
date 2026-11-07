import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with a local D1 that test/setup.ts migrates.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: 'test-secret-at-least-32-characters-long',
            GITHUB_CLIENT_ID: 'gh-client',
            GITHUB_CLIENT_SECRET: 'gh-secret',
            GOOGLE_CLIENT_ID: 'google-client',
            GOOGLE_CLIENT_SECRET: 'google-secret',
            APP_REDIRECT_URIS: 'proschi://auth, https://app.proschi.test/callback?x=1',
            METRICS_TOKEN: 'test-metrics-token-0123456789',
            ADMIN_SETUP_TOKEN: 'test-admin-setup-token-0123456789',
            POLAR_ACCESS_TOKEN: 'polar-test-token',
            POLAR_WEBHOOK_SECRET: 'polar_whs_test-secret',
            POLAR_SERVER: 'sandbox',
            POLAR_PRODUCT_PRO_MONTHLY: 'prod-pro-monthly',
            POLAR_PRODUCT_PRO_YEARLY: 'prod-pro-yearly',
            POLAR_PRODUCT_MAX_MONTHLY: 'prod-max-monthly',
            POLAR_PRODUCT_MAX_YEARLY: 'prod-max-yearly',
            POLAR_PRODUCT_CREDITS_1000: 'prod-credits-1000',
            // Never a developer's .dev.vars, which wrangler reads: the AI is off unless a test sets a key, with fetch mocked.
            ANTHROPIC_API_KEY: '',
            AI_GATEWAY_URL: '',
            AI_GATEWAY_TOKEN: '',
            // Turnstile off unless a test sets the secret (with Siteverify mocked).
            TURNSTILE_SITE_KEY: '',
            TURNSTILE_SECRET_KEY: '',
            // The Cloudflare usage page is off unless a test sets them (with the API mocked).
            CF_API_TOKEN: '',
            CF_ACCOUNT_ID: '',
            CF_ZONE_ID: '',
            CF_PLAN: '',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
