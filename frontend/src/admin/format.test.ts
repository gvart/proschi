import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes, formatDayAgo, humanize } from './format';

describe('admin formatting', () => {
  it('says how long ago', () => {
    expect(formatAgo(null)).toBe('never');
    expect(formatAgo(1000, 1030)).toBe('just now');
    expect(formatAgo(1000, 1000 + 300)).toBe('5 min ago');
    expect(formatAgo(1000, 1000 + 7200)).toBe('2 h ago');
    expect(formatAgo(1000, 1000 + 86_400)).toBe('yesterday');
    expect(formatAgo(1000, 1000 + 3 * 86_400)).toBe('3 days ago');
  });

  it('says how many days ago a UTC day was', () => {
    expect(formatDayAgo(null)).toBe('never');
    expect(formatDayAgo('2026-10-09', '2026-10-09')).toBe('today');
    expect(formatDayAgo('2026-10-08', '2026-10-09')).toBe('yesterday');
    expect(formatDayAgo('2026-09-29', '2026-10-09')).toBe('10 days ago');
  });

  it('sizes bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
  });

  it('turns names into labels', () => {
    expect(humanize('sign_in_failed')).toBe('Sign in failed');
    expect(humanize('user.email.delete')).toBe('User email delete');
  });
});
