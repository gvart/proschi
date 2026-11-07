import type { Health, WebhookOutcome } from './api';

/** The secrets the site needs (HealthTab's required checks) that aren't set, by name; and ADMIN_SETUP_TOKEN while it is still set. */
export function missingSecrets(config: Health['config']): string[] {
  const missing: [boolean, string][] = [
    [config.sessionSecret, 'SESSION_SECRET'],
    [config.providers.length > 0, 'a sign-in provider'],
    [config.anthropicKey, 'ANTHROPIC_API_KEY'],
    [config.polar.accessToken, 'POLAR_ACCESS_TOKEN'],
    [config.polar.webhookSecret, 'POLAR_WEBHOOK_SECRET'],
    [config.polar.productProMonthly, 'POLAR_PRODUCT_PRO_MONTHLY'],
    [config.polar.productProYearly, 'POLAR_PRODUCT_PRO_YEARLY'],
    [config.polar.productMaxMonthly, 'POLAR_PRODUCT_MAX_MONTHLY'],
    [config.polar.productMaxYearly, 'POLAR_PRODUCT_MAX_YEARLY'],
    [config.polar.productCredits1000, 'POLAR_PRODUCT_CREDITS_1000'],
  ];
  return [...missing.filter(([ok]) => !ok).map(([, name]) => name), ...(config.setupToken ? ['ADMIN_SETUP_TOKEN (still set: remove it)'] : [])];
}

/** Webhook deliveries that failed: refused for their signature, or an error applying them. */
export const FAILED_OUTCOMES: readonly WebhookOutcome[] = ['bad_signature', 'error'];

export const failedDeliveries = (counts: { outcome: WebhookOutcome; n: number }[]): number =>
  counts.filter((c) => FAILED_OUTCOMES.includes(c.outcome)).reduce((sum, c) => sum + c.n, 0);
