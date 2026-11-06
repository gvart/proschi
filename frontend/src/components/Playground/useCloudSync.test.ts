import { describe, expect, it } from 'vitest';
import { cloudFull, cloudLabel } from './useCloudSync';

describe('cloudLabel and cloudFull', () => {
  it('count the free plan, and show Pro as unlimited', () => {
    expect(cloudLabel({ kind: 'saved', used: 3, limit: 5 })).toBe('Saved to your account (3 of 5)');
    expect(cloudFull({ kind: 'saved', used: 3, limit: 5 })).toBe(false);
    expect(cloudFull({ kind: 'saved', used: 5, limit: 5 })).toBe(true);
    // Past the limit after a downgrade.
    expect(cloudFull({ kind: 'saved', used: 7, limit: 5 })).toBe(true);
    expect(cloudLabel({ kind: 'saved', used: 40, limit: 1000 })).toBe('Saved to your account');
    expect(cloudFull({ kind: 'saved', used: 1000, limit: 1000 })).toBe(false);
    expect(cloudFull({ kind: 'saving' })).toBe(false);
  });
});
