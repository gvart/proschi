import type { ReactNode } from 'react';
import { ArrowRight, GraduationCap, Layers, Map as MapIcon, Radar, Swords, type LucideIcon } from 'lucide-react';
import summary from 'virtual:practice-cards-summary';
import { eyebrow } from '../../components/Playground/ui';
import { PREP_TABS, type PrepTab } from './tabs';

/**
 * Interview prep: the hub around the roadmap, daily review and the skill
 * map. Its top holds the streak and today's goal (compact) and the tabs,
 * links to each section's own address, so `#/review/<topic>` or
 * `#/roadmap/<guide>` open inside it with their tab marked. The tabs scroll
 * sideways on a narrow phone rather than wrap.
 */

const ICON: Record<PrepTab, LucideIcon> = { roadmap: MapIcon, review: Layers, challenge: Swords, progress: Radar };

export default function PrepHub({ tab, streak, children }: { tab: PrepTab; streak?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="max-w-4xl mx-auto px-4 pt-6 sm:pt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`flex items-center gap-1.5 ${eyebrow}`}>
            <GraduationCap size={14} aria-hidden="true" />
            Interview prep
          </p>
          {streak}
        </div>
        <nav aria-label="Interview prep" className="ps-tabs mt-4">
          {PREP_TABS.map((t) => {
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

/** The problem list's one pointer to the hub: small, so the list stays about problems. */
export function PrepBanner() {
  return (
    <a
      href="#/roadmap"
      className="group mt-4 flex items-center gap-2 rounded-brutal border-bw-1 border-dashed border-ink/60 bg-surface px-3 py-2 text-sm text-ink hover:border-solid hover:border-ink"
    >
      <GraduationCap size={16} aria-hidden="true" className="flex-shrink-0" />
      <span className="min-w-0 flex-1">
        Preparing for an interview? <strong>Interview prep</strong> has the roadmap, {summary.cards > 0 ? `${summary.cards} review cards` : 'review cards'} and your skill map.
      </span>
      <ArrowRight size={14} aria-hidden="true" className="flex-shrink-0 transition-transform duration-d1 group-hover:translate-x-0.5" />
    </a>
  );
}
