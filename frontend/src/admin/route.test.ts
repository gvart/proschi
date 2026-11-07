import { describe, expect, it } from 'vitest';
import { GROUPS, PAGES, parseRoute, routeHash } from './route';

describe('admin routes', () => {
  it('reads the page and its parameter from the hash', () => {
    expect(parseRoute('')).toEqual({ page: 'overview' });
    expect(parseRoute('#/nope')).toEqual({ page: 'overview' });
    expect(parseRoute('#/health')).toEqual({ page: 'health' });
    expect(parseRoute('#/users/0b8f6d8e-7d5f')).toEqual({ page: 'users', param: '0b8f6d8e-7d5f' });
    expect(parseRoute('#/events/sign_in_failed')).toEqual({ page: 'events', param: 'sign_in_failed' });
    expect(parseRoute('#/overview/90')).toEqual({ page: 'overview', param: '90' });
    expect(parseRoute('#/webhooks')).toEqual({ page: 'webhooks' });
  });

  it('keeps the old tab hashes working', () => {
    expect(parseRoute('#/shares')).toEqual({ page: 'links' });
    for (const tab of ['overview', 'health', 'users', 'billing', 'ai', 'events', 'audit', 'passkeys']) expect(parseRoute(`#/${tab}`).page).toBe(tab);
  });

  it('round-trips', () => {
    for (const route of [{ page: 'users' as const, param: 'a b/c' }, { page: 'audit' as const }]) expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('lists every page once, in its group', () => {
    expect(GROUPS.map((g) => g.label)).toEqual(['Overview', 'People', 'Revenue', 'AI', 'Content', 'System']);
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
  });
});
