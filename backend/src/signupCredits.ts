import type { Env } from './env';
import { log } from './log';

/**
 * The one call into the credit ledger for the free sign-up credits
 * (docs/design/paid-plans.md P26), made by src/signupChecks.ts once an
 * account passes every check. Metering's `grantSignupCredits` (src/credits.ts)
 * is idempotent per user and per identity; until it lands this adapter only
 * logs, and the desk points `grant` at it at merge. An object, so tests can
 * stub it (vi.spyOn(signupLedger, 'grant')): the Worker's modules are loaded
 * before a test file's vi.mock could replace them.
 */
export const signupLedger = {
  async grant(env: Env, userId: string, identityKey: string): Promise<'granted' | 'already'> {
    void env;
    log('warn', 'Sign-up credits are not wired to the ledger yet (src/signupCredits.ts)', { userId, identity: identityKey.slice(0, 8) });
    return 'granted';
  },
};
