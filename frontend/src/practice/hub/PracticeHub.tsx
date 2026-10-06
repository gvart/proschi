import type { ReactNode } from 'react';
import { Gamepad2, GraduationCap, Layers, List, Map as MapIcon, Radar, Zap, type LucideIcon } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import { HUB_TABS, type HubTab } from './tabs';

/**
 * Practice: one hub for the problem list, the roadmap, daily review, the
 * daily challenge, the Arcade (Scale or Fail) and progress. Its top holds the
 * Today panel on the home (`#/`), or the compact streak on the other tabs,
 * and one bar of tabs, links to each section's own address, so
 * `#/review/<topic>` or `#/roadmap/<guide>` open inside it with their tab
 * marked. The bar scrolls sideways on a narrow phone rather than wrap.
 */

const ICON: Record<HubTab, LucideIcon> = { problems: List, roadmap: MapIcon, review: Layers, challenge: Zap, arcade: Gamepad2, progress: Radar };

export default function PracticeHub({ tab, streak, today, children }: { tab: HubTab; streak?: ReactNode; today?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 pt-6 sm:pt-10">
        {today ?? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={`flex items-center gap-1.5 ${eyebrow}`}>
              <GraduationCap size={14} aria-hidden="true" />
              Practice
            </p>
            {streak}
          </div>
        )}
        <nav aria-label="Practice sections" className="ps-tabs mt-4">
          {HUB_TABS.map((t) => {
            const Icon = ICON[t.id];
            return (
              <a key={t.id} href={t.href} className="ps-tab" aria-current={t.id === tab ? 'page' : undefined}>
                <Icon size={15} aria-hidden="true" />
                <span>{t.label}</span>
              </a>
            );
          })}
        </nav>
      </div>
      {children}
    </>
  );
}
