import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Gamepad2, Layers, Radar, Zap, type LucideIcon } from 'lucide-react';
import { BAR_TABS, HUB_GROUPS, tabLink, type HubGroup, type HubTab } from './tabs';

/**
 * Practice: one hub for the problems and everything around them. Its top is
 * one slim, flat bar: **Roadmap** (the guided path), **All problems** (the
 * open list, the home `#/`), **Mock interview** (its set-up), one **Daily**
 * menu (review cards, the daily challenge, the Arcade) and **Progress** at the
 * end. Each section keeps its own address, so `#/review/<topic>` or
 * `#/roadmap/<guide>` open inside the hub with their section (and the menu)
 * marked. The bar fits one row down to 320 px (shorter names on phones, the
 * full ones kept as each link's accessible name), never a sideways scroll.
 */

const ICON: Partial<Record<HubTab, LucideIcon>> = { review: Layers, challenge: Zap, arcade: Gamepad2 };

const item =
  'relative inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-sm font-semibold max-[359px]:px-1.5 transition-colors duration-d1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue sm:px-3';
const marked = 'text-ink after:absolute after:inset-x-2 max-[359px]:after:inset-x-1.5 after:-bottom-px after:h-[3px] after:rounded-full after:bg-ink sm:after:inset-x-3';
const quiet = 'text-ink/70 hover:text-ink hover:bg-ink/5';

/** `onIntent` runs when a section is pointed at or focused, before the click: its code can start loading. */
export default function PracticeHub({
  tab,
  aside,
  onIntent,
  children,
}: {
  tab: HubTab;
  /** Under the bar, on the right: the compact streak, for those who keep one. */
  aside?: ReactNode;
  onIntent?: (tab: HubTab) => void;
  children: ReactNode;
}) {
  const link = (id: HubTab, content?: ReactNode, extra = '') => {
    const t = tabLink(id);
    const current = id === tab;
    return (
      <a
        key={id}
        href={t.href}
        className={`${item} ${current ? marked : quiet} ${extra}`}
        aria-current={current ? 'page' : undefined}
        // The full name, also where a phone shows the short one (it is part of it).
        aria-label={t.short || content ? t.label : undefined}
        onPointerEnter={() => onIntent?.(id)}
        onFocus={() => onIntent?.(id)}
      >
        {content ??
          (t.short ? (
            <>
              <span className="sm:hidden">{t.short}</span>
              <span className="max-sm:hidden">{t.label}</span>
            </>
          ) : (
            t.label
          ))}
      </a>
    );
  };
  return (
    <>
      <div className="ps-hub-top max-w-4xl mx-auto px-4 pt-4 sm:pt-6">
        <nav aria-label="Practice sections" className="flex items-center border-b-bw-1 border-ink/15 sm:gap-1">
          {BAR_TABS.map((id) => link(id))}
          {HUB_GROUPS.map((g) => (
            <SectionMenu key={g.id} group={g} tab={tab} onIntent={onIntent} />
          ))}
          <span className="flex-1" />
          {link(
            'progress',
            <>
              <Radar size={15} aria-hidden="true" />
              <span className="max-sm:hidden">Progress</span>
            </>,
          )}
        </nav>
        {aside && <div className="mt-3 flex justify-end">{aside}</div>}
      </div>
      {children}
    </>
  );
}

/** A menu of the bar: its sections as links, each with a line about it. Closes on a pick, a click outside or Escape. */
function SectionMenu({ group, tab, onIntent }: { group: HubGroup; tab: HubTab; onIntent?: (tab: HubTab) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = group.tabs.includes(tab);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const panelId = `practice-menu-${group.id}`;
  return (
    <div ref={root} className="relative" onPointerEnter={() => group.tabs.forEach((t) => onIntent?.(t))}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={`${item} ${current ? marked : quiet} ${open ? 'bg-ink/5 text-ink' : ''}`}
      >
        {group.label}
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-d1 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-40 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-brutal border-bw-2 border-ink bg-surface p-1.5 shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)] max-sm:fixed max-sm:inset-x-4 max-sm:top-auto max-sm:w-auto"
        >
          <ul>
            {group.tabs.map((id) => {
              const t = tabLink(id);
              return (
                <li key={id}>
                  <MenuLink href={t.href} icon={ICON[id]!} label={t.label} about={t.about} current={id === tab} onPick={() => setOpen(false)} onIntent={() => onIntent?.(id)} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}


/** A section in a menu: named by its label, described by its line. */
function MenuLink({ href, icon: Icon, label, about, current = false, onPick, onIntent }: { href: string; icon: LucideIcon; label: string; about?: string; current?: boolean; onPick: () => void; onIntent?: () => void }) {
  const aboutId = useId();
  return (
    <a
      href={href}
      onClick={onPick}
      onFocus={onIntent}
      aria-label={label}
      aria-describedby={about ? aboutId : undefined}
      aria-current={current ? 'page' : undefined}
      className={`flex items-start gap-2.5 rounded-sm px-2.5 py-2 hover:bg-pop-yellow/30 focus-visible:outline-hidden focus-visible:bg-pop-yellow/30 ${current ? 'bg-ink/5' : ''}`}
    >
      <Icon size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink/70" />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-ink">{label}</span>
        {about && <span id={aboutId} className="block text-xs text-muted">{about}</span>}
      </span>
    </a>
  );
}
