import type { Env } from './env';
import { log } from './log';

/**
 * The one call into the credit ledger for the free sign-up credits
 * (docs/design/paid-plans.md P26), made by src/signupChecks.ts once an
 * account passes every check. `identityKey` is the account's normalized
 * verified address, for every sign-in method, so one inbox gets the credits
 * once however it signs in; an OAuth account without one passes
 * `${provider}\n${subject}`.
 *
 * Metering's `grantSignupCredits` (src/credits.ts) is idempotent per user
 * and per identity. Until it lands, `grant` only logs; wiring it is
 * `grant: grantSignupCredits,` (imported from './credits'). An object, so
 * tests can stub it (vi.spyOn(signupLedger, 'grant')): the Worker's modules
 * are loaded before a test file's vi.mock could replace them.
 */
type Grant = (env: Pick<Env, 'DB' | 'SESSION_SECRET'>, userId: string, identityKey: string, at?: number) => Promise<'granted' | 'already'>;

const notWiredYet: Grant = async (_env, userId) => {
  log('warn', 'Sign-up credits are not wired to the ledger yet (src/signupCredits.ts)', { userId });
  return 'granted';
};

export const signupLedger: { grant: Grant } = { grant: notWiredYet };
