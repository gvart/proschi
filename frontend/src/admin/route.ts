/** The admin panel's pages, grouped as the sidebar shows them, and the address hash that names one (#/users/<id>). */

export const GROUPS = [
  { label: 'Overview', items: [{ id: 'overview', label: 'Overview', description: 'Growth, revenue and AI at a glance, and what needs attention.' }] },
  { label: 'People', items: [{ id: 'users', label: 'Users', description: 'Search accounts, open one, and moderate it.' }] },
  { label: 'Revenue', items: [{ id: 'billing', label: 'Billing', description: 'Pro accounts, pack orders and refunds. Amounts live in Polar.' }] },
  { label: 'AI', items: [{ id: 'ai', label: 'AI usage', description: 'Interviews, reviews and what they cost over the last 30 days.' }] },
  { label: 'Content', items: [{ id: 'links', label: 'Links', description: 'Short links and live share links: the user content other people see.' }] },
  {
    label: 'System',
    items: [
      { id: 'health', label: 'Health', description: 'The database, scheduled jobs, errors, email and configuration.' },
      { id: 'events', label: 'Events', description: 'Errors, cron runs, sign-in failures and rate limits, kept 30 days.' },
      { id: 'webhooks', label: 'Webhooks', description: "Polar's webhook deliveries and what was done with each, kept 90 days." },
      { id: 'audit', label: 'Audit log', description: 'Every change made in the admin panel, kept 400 days.' },
      { id: 'passkeys', label: 'Passkeys', description: 'The passkeys that can sign in here, and the admin sessions.' },
    ],
  },
] as const;

export type PageId = (typeof GROUPS)[number]['items'][number]['id'];

export interface PageInfo {
  id: PageId;
  label: string;
  description: string;
}

export const PAGES: readonly PageInfo[] = GROUPS.flatMap((g): readonly PageInfo[] => g.items);

/** Hashes the panel used before the sidebar, still accepted: #/shares is now #/links. */
const ALIASES: Record<string, PageId> = { shares: 'links' };

export interface Route {
  page: PageId;
  /** #/users/<id>: one account; #/events/<kind>: events of one kind; #/overview/<days>: the time range. */
  param?: string;
}

/** The page and its parameter from the address's hash (#/users/<id>). */
export function parseRoute(hash: string): Route {
  const [name, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const id = ALIASES[name] ?? PAGES.find((p) => p.id === name)?.id;
  if (!id) return { page: 'overview' };
  const param = rest.join('/') ? decodeURIComponent(rest.join('/')) : undefined;
  return { page: id, ...(param ? { param } : {}) };
}

export function routeHash({ page, param }: Route): string {
  return `#/${page}${param ? `/${encodeURIComponent(param)}` : ''}`;
}

export const pageOf = (id: PageId) => PAGES.find((p) => p.id === id)!;
