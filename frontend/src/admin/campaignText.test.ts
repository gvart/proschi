import { describe, expect, it } from 'vitest';
import { audienceReady, describeAudience, summarize } from './campaignText';

describe('campaign words', () => {
  const count = { accounts: 30, emails: 27, optedOut: 2, unconfirmed: 1 };

  it('says exactly what sending does', () => {
    expect(summarize({ credits: 150, email: true, inapp: true }, count)).toEqual({
      sentence: 'Grant 150 credits to 30 accounts, email 27 and show the announcement to 30.',
      skipped: '3 skipped for email: 2 turned product news off, 1 has no confirmed address.',
    });
    expect(summarize({ credits: 0, email: true, inapp: false }, count).sentence).toBe('Email 27 accounts.');
    expect(summarize({ credits: 1, email: false, inapp: false }, { ...count, accounts: 1 })).toEqual({ sentence: 'Grant 1 credit to 1 account.' });
    expect(summarize({ credits: 0, email: false, inapp: true }, count).sentence).toBe('Show the announcement to 30 accounts.');
  });

  it('names audiences and knows when one can be counted', () => {
    expect(describeAudience({ type: 'plan', plan: 'pro' })).toBe('Accounts on Pro');
    expect(describeAudience({ type: 'active', days: 1 })).toBe('Active in the last 1 day');
    expect(audienceReady({ type: 'signup' })).toBe(false);
    expect(audienceReady({ type: 'user', id: '' })).toBe(false);
    expect(audienceReady({ type: 'active', days: 30 })).toBe(true);
  });
});
