/** The admin panel's tabs, and the address hash that names one (#/users/<id>). */

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'health', label: 'Health' },
  { id: 'users', label: 'Users' },
  { id: 'shares', label: 'Short links' },
  { id: 'events', label: 'Events' },
  { id: 'audit', label: 'Audit log' },
  { id: 'passkeys', label: 'Passkeys' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export interface Route {
  tab: TabId;
  /** #/users/<id>: one account; #/events/<kind>: events of one kind. */
  param?: string;
}

/** The tab and its parameter from the address's hash (#/users/<id>). */
export function parseRoute(hash: string): Route {
  const [tab, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const known = TABS.find((t) => t.id === tab);
  if (!known) return { tab: 'overview' };
  const param = rest.join('/') ? decodeURIComponent(rest.join('/')) : undefined;
  return { tab: known.id, ...(param ? { param } : {}) };
}

export function routeHash({ tab, param }: Route): string {
  return `#/${tab}${param ? `/${encodeURIComponent(param)}` : ''}`;
}
