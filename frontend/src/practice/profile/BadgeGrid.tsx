import { useEffect, useId, useState } from 'react';
import { Lock, X } from 'lucide-react';
import type { Tier } from '../../learn/achievements';
import { eyebrow, toolButton } from '../../components/Playground/ui';
import AchievementIcon from '../skills/AchievementIcon';
import type { ProfileBadge } from './profile';

/**
 * Every badge as a compact grid of small medals (44px): earned ones in their
 * tier's colour, locked ones dimmed. Hovering shows a badge's title; tapping
 * or clicking one opens its details under the grid (title, tier, what earns
 * it, and when it was earned or how far along it is), so the badges never
 * take the whole page. Used by the account page, public profiles and the
 * progress page.
 */

const TIER_LABEL: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/** "3 May 2026", in the reader's language. */
const dateOf = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A locked badge's progress, e.g. "12/100" or "40/60%". */
const progressText = (b: ProfileBadge) => (b.progress ? `${b.progress.current}/${b.progress.target}${b.rule.kind === 'mastery' ? '%' : ''}` : '');

/** What a medal's button says to a screen reader. */
function buttonLabel(b: ProfileBadge): string {
  if (b.earned) return `${b.title}: earned${b.earnedAt ? ` ${dateOf(b.earnedAt)}` : ''}`;
  return `${b.title}: locked${b.progress ? `, ${progressText(b)}` : ''}`;
}

export default function BadgeGrid({ badges, label = 'Badges', headingLevel = 2 }: { badges: ProfileBadge[]; label?: string; headingLevel?: 2 | 3 }) {
  const [open, setOpen] = useState<string>();
  const ids = useId();
  const detailId = `${ids}-detail`;
  const headingId = `${ids}-heading`;
  const selected = badges.find((b) => b.id === open);
  const earned = badges.filter((b) => b.earned).length;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  // Escape closes the details.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading id={headingId} className="font-display text-xl font-bold text-ink">
          {label}
        </Heading>
        <p className="text-sm tabular-nums text-muted">
          {earned} of {badges.length} earned
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" data-testid="badge-grid">
        {badges.map((b) => (
          <li key={b.id} data-achievement={b.id} data-earned={b.earned ? 'true' : 'false'}>
            <button
              type="button"
              title={b.title}
              aria-label={buttonLabel(b)}
              aria-expanded={open === b.id}
              aria-controls={open === b.id ? detailId : undefined}
              onClick={() => setOpen((o) => (o === b.id ? undefined : b.id))}
              className={`block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-safe:transition-transform motion-safe:duration-d1 hover:-translate-y-px ${
                open === b.id ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : ''
              }`}
            >
              <AchievementIcon icon={b.icon} tier={b.tier} earned={b.earned} />
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div
          id={detailId}
          role="region"
          aria-label={`Badge: ${selected.title}`}
          data-achievement-detail={selected.id}
          className={`mt-3 flex max-w-xl items-start gap-3 rounded-brutal border-bw-2 p-3 ${selected.earned ? 'border-ink bg-surface shadow-brutal-sm' : 'border-ink/40 bg-paper'}`}
        >
          <AchievementIcon icon={selected.icon} tier={selected.tier} earned={selected.earned} />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 font-display text-base font-bold leading-tight text-ink">
              {selected.title}
              {selected.tier && <span className={eyebrow}>{TIER_LABEL[selected.tier]}</span>}
            </p>
            <p className="mt-0.5 text-sm text-ink/80">{selected.description}</p>
            {selected.earned ? (
              <p className="mt-1 text-xs font-semibold text-green-700 dark:text-green-400">Earned{selected.earnedAt ? ` ${dateOf(selected.earnedAt)}` : ''}</p>
            ) : selected.progress ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div
                  role="progressbar"
                  aria-label={`${selected.title}: progress`}
                  aria-valuemin={0}
                  aria-valuemax={selected.progress.target}
                  aria-valuenow={selected.progress.current}
                  className="h-2 flex-1 overflow-hidden rounded-full border-bw-1 border-ink/40 bg-surface"
                >
                  <div className="h-full bg-ink/45" style={{ width: `${selected.progress.target > 0 ? Math.min(1, selected.progress.current / selected.progress.target) * 100 : 0}%` }} />
                </div>
                <span className="text-xs tabular-nums text-muted">{progressText(selected)}</span>
              </div>
            ) : (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                <Lock size={12} aria-hidden="true" />
                Locked
              </p>
            )}
          </div>
          <button type="button" onClick={() => setOpen(undefined)} className={`-mr-1.5 -mt-1 ${toolButton}`} aria-label="Close the badge details">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
