import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

/**
 * No test reaches a paid API. A call to Anthropic, AI Gateway or Polar that
 * the test did not mock fails loudly instead of spending money. Tests mock
 * with vi.spyOn(globalThis, 'fetch'), and those spies pass every other URL on
 * to this one.
 */
const OUTSIDE = /^https:\/\/([a-z0-9-]+\.)*(anthropic\.com|polar\.sh|gateway\.ai\.cloudflare\.com)(\/|$)/i;
const real = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (OUTSIDE.test(url)) throw new Error(`Unmocked fetch to ${url.split('?')[0]}: mock it in the test`);
  return real(input, init);
};
