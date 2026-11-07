import { describe, expect, it } from 'vitest';
import type { Health } from './api';
import { failedDeliveries, missingSecrets } from './attention';

const config: Health['config'] = {
  sessionSecret: true,
  providers: ['github'],
  appRedirects: false,
  metricsToken: false,
  setupToken: false,
  anthropicKey: true,
  aiGateway: false,
  polar: { accessToken: true, webhookSecret: true, productProMonthly: true, productProYearly: true, productMaxMonthly: true, productMaxYearly: true, productCredits1000: true },
  polarServer: 'live',
  billing: true,
};

describe('needs attention', () => {
  it('names the required secrets that are missing, never the optional ones', () => {
    expect(missingSecrets(config)).toEqual([]);
    expect(missingSecrets({ ...config, anthropicKey: false, polar: { ...config.polar, productCredits1000: false }, setupToken: true })).toEqual([
      'ANTHROPIC_API_KEY',
      'POLAR_PRODUCT_CREDITS_1000',
      'ADMIN_SETUP_TOKEN (still set: remove it)',
    ]);
    expect(missingSecrets({ ...config, providers: [] })).toEqual(['a sign-in provider']);
  });

  it('counts the failed webhook deliveries', () => {
    expect(
      failedDeliveries([
        { outcome: 'applied', n: 9 },
        { outcome: 'bad_signature', n: 2 },
        { outcome: 'error', n: 1 },
        { outcome: 'stale', n: 4 },
      ]),
    ).toBe(3);
    expect(failedDeliveries([])).toBe(0);
  });
});
