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
            SESSION_SECRET: 'test-secret',
            GITHUB_CLIENT_ID: 'gh-client',
            GITHUB_CLIENT_SECRET: 'gh-secret',
            GOOGLE_CLIENT_ID: 'google-client',
            GOOGLE_CLIENT_SECRET: 'google-secret',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
