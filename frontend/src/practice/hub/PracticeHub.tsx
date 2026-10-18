import type { ReactNode } from 'react';
import { Gamepad2, Layers, List, Map as MapIcon, Radar, Zap, type LucideIcon } from 'lucide-react';
import { HUB_TABS, type HubTab } from './tabs';

/**
 * Practice: one hub for the problem list, the roadmap, daily review, the
 * daily challenge, the Arcade (Scale or Fail) and progress. Its top holds one
 * bar of sections, links to each section's own address, so
 * `#/review/<topic>` or `#/roadmap/<guide>` open inside it with their section
 * marked; below it, the Today panel on the home (`#/`), or the compact streak
 * on the other sections. The bar comes first so it stays in the same place
 * on every section, and every section shows at once: one row of buttons on a
 * desktop, a grid of three by two on a phone (never a sideways scroll).
 */

const ICON: Record<HubTab, LucideIcon> = { problems: List, roadmap: MapIcon, review: Layers, challenge: Zap, arcade: Gamepad2, progress: Radar };

const section =
  'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-brutal border-bw-2 border-ink px-2 py-1.5 text-[13px] font-bold leading-tight transition-[background-color,box-shadow,transform] duration-d1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue md:min-h-[44px] md:flex-row md:gap-1.5 md:text-sm';

/** `onIntent` runs when a section is pointed at or focused, before the click: its code can start loading. */
export default function PracticeHub({
  tab,
  streak,
  today,
  onIntent,
  children,
}: {
  tab: HubTab;
  streak?: ReactNode;
  today?: ReactNode;
  onIntent?: (tab: HubTab) => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="ps-hub-top max-w-4xl mx-auto px-4 pt-6 sm:pt-10">
        <nav aria-label="Practice sections" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {HUB_TABS.map((t) => {
            const Icon = ICON[t.id];
            const current = t.id === tab;
            return (
              <a
                key={t.id}
                href={t.href}
                className={`${section} ${current ? 'bg-pop-yellow text-on-accent shadow-brutal-sm' : 'bg-surface text-ink hover:-translate-y-px hover:bg-pop-yellow/30'}`}
                aria-current={current ? 'page' : undefined}
                onPointerEnter={() => onIntent?.(t.id)}
                onFocus={() => onIntent?.(t.id)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t.label}</span>
              </a>
            );
          })}
        </nav>
        {today ?? (streak && <div className="mt-4 flex justify-end">{streak}</div>)}
      </div>
      {children}
    </>
  );
}
