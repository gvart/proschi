import { Activity, ClipboardList, CreditCard, Inbox, KeyRound, LayoutDashboard, Link2, ScrollText, Sparkles, Users, Webhook, type LucideIcon } from 'lucide-react';
import { GROUPS, routeHash, type PageId } from './route';

const ICONS: Record<PageId, LucideIcon> = {
  overview: LayoutDashboard,
  users: Users,
  inbox: Inbox,
  billing: CreditCard,
  ai: Sparkles,
  links: Link2,
  health: Activity,
  events: ScrollText,
  webhooks: Webhook,
  audit: ClipboardList,
  passkeys: KeyRound,
};

/** The grouped sidebar: each page as a link to its hash, the current one marked. Under 900px it is one scrolling row. */
export default function Nav({ current, counts = {} }: { current: PageId; counts?: Partial<Record<PageId, number>> }) {
  return (
    <nav className="adm-nav" aria-label="Admin sections">
      {GROUPS.map((group) => (
        <div key={group.label} className="adm-nav__group">
          {/* A group of one named like its page (Overview) needs no heading. */}
          {group.items.length > 1 || group.items[0].label !== group.label ? <p className="adm-nav__heading">{group.label}</p> : null}
          <ul>
            {group.items.map((item) => {
              const Icon = ICONS[item.id];
              return (
                <li key={item.id}>
                  <a className="adm-nav__item" href={routeHash({ page: item.id })} aria-current={item.id === current ? 'page' : undefined}>
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    <span>{item.label}</span>
                    {counts[item.id] ? (
                      <span className="adm-nav__count">
                        {counts[item.id]}
                        <span className="adm-sr"> unread</span>
                      </span>
                    ) : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
