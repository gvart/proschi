import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash } from './route';

describe('admin routes', () => {
  it('reads the tab and its parameter from the hash', () => {
    expect(parseRoute('')).toEqual({ tab: 'overview' });
    expect(parseRoute('#/nope')).toEqual({ tab: 'overview' });
    expect(parseRoute('#/health')).toEqual({ tab: 'health' });
    expect(parseRoute('#/users/0b8f6d8e-7d5f')).toEqual({ tab: 'users', param: '0b8f6d8e-7d5f' });
    expect(parseRoute('#/events/sign_in_failed')).toEqual({ tab: 'events', param: 'sign_in_failed' });
  });

  it('round-trips', () => {
    for (const route of [{ tab: 'users' as const, param: 'a b/c' }, { tab: 'audit' as const }]) expect(parseRoute(routeHash(route))).toEqual(route);
  });
});
