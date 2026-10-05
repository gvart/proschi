import { useEffect, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { AchievementStatus } from '../../learn/achievements';
import { eyebrow, iconButton } from '../../components/Playground/ui';
import { celebrationWait } from '../celebrating';
import AchievementIcon from './AchievementIcon';

/** How long the toast stays, unless hovered or focused. */
const SHOW_MS = 8000;

/**
 * "New badge": a small card in the bottom corner when badges are earned,
 * shown once. It marks them seen as soon as it appears, so a reload or
 * another device does not celebrate them again. A celebration that just
 * appeared (a session's summary, celebrating.ts) goes first: the toast waits
 * for it. It pops in only when the reader has not asked for reduced motion,
 * and stays while hovered or focused.
 */
export default function AchievementToast({ unseen, onSeen }: { unseen: AchievementStatus[]; onSeen: (ids: string[]) => void }) {
  // What is shown stays put while the parent's list is marked seen.
  const [shown, setShown] = useState<AchievementStatus[]>([]);
  const [held, setHeld] = useState(false);
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const ids = unseen.map((a) => a.id).join(',');

  const unseenRef = useRef(unseen);
  unseenRef.current = unseen;

  useEffect(() => {
    if (!ids) return;
    const show = () => {
      setShown(unseenRef.current);
      onSeenRef.current(ids.split(','));
    };
    // After a celebration's moment, if one just appeared; unseen until then, so leaving the page keeps them for later.
    const wait = celebrationWait();
    if (!wait) return show();
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
    // Only a new set of ids shows the toast again; `unseen` itself changes on every check.
  }, [ids]);

  useEffect(() => {
    if (!shown.length || held) return;
    const timer = setTimeout(() => setShown([]), SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown, held]);

  if (!shown.length) return null;
  const [first, ...more] = shown;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 sm:justify-end sm:p-5">
      <section
        role="status"
        aria-label="New badge"
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-md motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)]"
      >
        <AchievementIcon icon={first.icon} tier={first.tier} earned />
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>{shown.length === 1 ? 'New badge' : `${shown.length} new badges`}</p>
          <p className="font-display text-lg font-bold leading-tight text-ink">{first.title}</p>
          <p className="mt-0.5 text-sm text-ink/80">
            {first.description}
            {more.length > 0 && ` And ${more.map((a) => a.title).join(', ')}.`}
          </p>
          <a href="#/progress" onClick={() => setShown([])} className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-2">
            See your badges
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
        <button type="button" onClick={() => setShown([])} className={`-mr-1 -mt-1 ${iconButton}`} aria-label="Dismiss">
          <X size={16} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
