import { describe, expect, it } from 'vitest';
import { creditsMessage, readPlace, safeReturn } from './signin';

describe('the sign-in page’s address', () => {
  it('reads the return path, link mode and the email links’ token', () => {
    expect(readPlace('https://proschi.app/signin/?return=%2Fpractice%2F%23%2Fme&link=1')).toEqual({ returnTo: '/practice/#/me', link: true });
    expect(readPlace('https://proschi.app/signin/#confirm=abc_123')).toEqual({ returnTo: '/practice/', link: false, confirm: 'abc_123' });
    expect(readPlace('https://proschi.app/signin/#reset=xyz')).toMatchObject({ reset: 'xyz' });
  });

  it('never returns to another site', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)', null]) expect(safeReturn(bad)).toBe('/practice/');
    expect(safeReturn('/pricing/')).toBe('/pricing/');
  });
});

describe('the sign-up credits message', () => {
  it('says plainly why there are no free credits', () => {
    expect(creditsMessage({ outcome: 'granted', reason: 'granted' })?.tone).toBe('good');
    expect(creditsMessage({ outcome: 'pending', reason: 'unconfirmed' })?.text).toMatch(/Confirm your email/);
    expect(creditsMessage({ outcome: 'refused', reason: 'seen_before' })?.text).toMatch(/^Free credits are limited to one account per person/);
    expect(creditsMessage({ outcome: 'refused', reason: 'ip_limit' })?.text).toMatch(/^Free credits are limited to one account per person/);
    expect(creditsMessage({ outcome: 'refused', reason: 'disposable' })?.text).toMatch(/disposable/);
    expect(creditsMessage(null)).toBeUndefined();
    for (const r of ['granted', 'seen_before', 'disposable'] as const) expect(creditsMessage({ outcome: r === 'granted' ? 'granted' : 'refused', reason: r })?.text).not.toMatch(/\bAI\b/);
  });
});
