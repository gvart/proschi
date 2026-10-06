import { describe, expect, it } from 'vitest';
import { browserTimeZone, isEmailAddress, REMINDER_KINDS } from './emailReminders';

describe('email reminders form helpers', () => {
  it('accepts plausible addresses only', () => {
    expect(isEmailAddress('me@example.com')).toBe(true);
    expect(isEmailAddress('first.last+proschi@mail.example.co')).toBe(true);
    for (const bad of ['', 'me', 'me@', '@example.com', 'me@example', 'me @example.com', 'a@b.c', `${'a'.repeat(250)}@example.com`]) {
      expect(isEmailAddress(bad), bad).toBe(false);
    }
  });

  it('reads the browser time zone, falling back to UTC', () => {
    expect(browserTimeZone()).toMatch(/\S/);
    const empty = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: '' }) }) } as unknown as typeof Intl;
    expect(browserTimeZone(empty)).toBe('UTC');
    const throws = {
      DateTimeFormat: () => {
        throw new Error('no Intl');
      },
    } as unknown as typeof Intl;
    expect(browserTimeZone(throws)).toBe('UTC');
  });

  it('lists the three kinds the server knows', () => {
    expect(REMINDER_KINDS.map((k) => k.key)).toEqual(['streak', 'cards', 'recap']);
  });
});
