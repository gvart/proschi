import { useEffect, useMemo, useState } from 'react';
import { primaryButton } from '../../components/Playground/ui';
import { prefersReducedMotion } from '../../design/motion';
import type { Briefing, Mood } from './briefing';

/** The mascot's name, said in the briefing's label. */
export const MASCOT = 'Kernel';

/**
 * Kernel, the cat SRE lead: an inline SVG in the theme's colours. It blinks
 * and twitches an ear while idle and moves its mouth while `talking`; the
 * mood sets the eyes and the ears. Decorative: the briefing says everything.
 */
export function CatSre({ mood, talking, className = 'h-24 w-24' }: { mood: Mood; talking: boolean; className?: string }) {
  const ears = mood === 'alarmed' ? 'sf-cat-ears sf-cat-ears--back' : 'sf-cat-ears';
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={`sf-cat flex-shrink-0 ${className} ${talking ? 'sf-cat--talking' : ''}`}>
      <g stroke="rgb(var(--c-ink))" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        {/* Hoodie. */}
        <path d="M22 118 C22 92 38 84 60 84 C82 84 98 92 98 118 Z" fill="rgb(var(--c-lilac))" />
        <path d="M48 86 L52 100 M72 86 L68 100" fill="none" />
        {/* Ears. */}
        <g className={ears}>
          <path className="sf-cat-ear sf-cat-ear--left" d="M30 44 L28 12 L54 30 Z" fill="rgb(var(--c-yellow))" />
          <path className="sf-cat-ear sf-cat-ear--right" d="M90 44 L92 12 L66 30 Z" fill="rgb(var(--c-yellow))" />
          <path d="M33 36 L32 20 L46 30 Z M87 36 L88 20 L74 30 Z" fill="rgb(var(--c-pink))" strokeWidth="0" />
        </g>
        {/* Head. */}
        <ellipse cx="60" cy="56" rx="34" ry="30" fill="rgb(var(--c-yellow))" />
        <path d="M50 28 L52 36 M60 26 L60 35 M70 28 L68 36" fill="none" strokeWidth="2.5" />
        {/* Headset: band, cups and the mic boom. */}
        <path d="M24 54 C24 14 96 14 96 54" fill="none" strokeWidth="4" />
        <rect x="18" y="48" width="10" height="18" rx="4" fill="rgb(var(--c-ink))" />
        <rect x="92" y="48" width="10" height="18" rx="4" fill="rgb(var(--c-ink))" />
        <path d="M23 66 C26 80 38 82 46 78" fill="none" strokeWidth="2.5" />
        <circle cx="47" cy="77" r="3" fill="rgb(var(--c-ink))" />
        {/* Eyes. */}
        <g className="sf-cat-eyes">
          {mood === 'happy' ? (
            <path d="M40 54 Q46 46 52 54 M68 54 Q74 46 80 54" fill="none" strokeWidth="3.5" />
          ) : mood === 'alarmed' ? (
            <>
              <circle cx="46" cy="52" r="7" fill="rgb(var(--c-surface))" />
              <circle cx="74" cy="52" r="7" fill="rgb(var(--c-surface))" />
              <circle cx="46" cy="52" r="3" fill="rgb(var(--c-ink))" strokeWidth="0" />
              <circle cx="74" cy="52" r="3" fill="rgb(var(--c-ink))" strokeWidth="0" />
            </>
          ) : (
            <>
              <ellipse cx="46" cy="52" rx="4" ry="6" fill="rgb(var(--c-ink))" strokeWidth="0" />
              <ellipse cx="74" cy="52" rx="4" ry="6" fill="rgb(var(--c-ink))" strokeWidth="0" />
            </>
          )}
        </g>
        {/* Nose, whiskers, mouth. */}
        <path d="M57 62 L63 62 L60 66 Z" fill="rgb(var(--c-pink))" strokeWidth="2" />
        <path d="M30 62 L44 64 M30 70 L44 68 M90 62 L76 64 M90 70 L76 68" fill="none" strokeWidth="2" />
        {talking ? (
          <ellipse className="sf-cat-mouth" cx="60" cy="72" rx="5" ry="4" fill="rgb(var(--c-ink))" strokeWidth="0" />
        ) : (
          <path d="M52 70 Q56 75 60 70 Q64 75 68 70" fill="none" strokeWidth="2.5" />
        )}
        {mood === 'alarmed' && <path d="M98 30 C94 38 94 42 98 44 C102 42 102 38 98 30 Z" fill="rgb(var(--c-blue))" strokeWidth="2" />}
      </g>
    </svg>
  );
}

/**
 * The cat's briefing at the start of a wave's plan: a speech bubble that
 * types itself out. A tap shows it all at once; "Got it" puts it away. Screen
 * readers get the whole text at once.
 */
export function MascotBriefing({ briefing, boss, onClose }: { briefing: Briefing; boss: boolean; onClose: () => void }) {
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const total = useMemo(() => briefing.lines.reduce((a, l) => a + l.length, 0), [briefing]);
  const [shown, setShown] = useState(reduced ? total : 0);
  const talking = shown < total;

  useEffect(() => {
    if (!talking) return;
    const t = setInterval(() => setShown((n) => Math.min(total, n + 2)), 22);
    return () => clearInterval(t);
  }, [talking, total]);

  // Cut the text at `shown` characters, line by line.
  let left = shown;
  const typed = briefing.lines.map((l) => {
    const part = l.slice(0, Math.max(0, left));
    left -= l.length;
    return part;
  });

  return (
    <aside aria-label={`${MASCOT}'s briefing`} className={`sf-brief rounded-brutal border-bw-2 border-ink p-3 shadow-brutal-sm ${boss ? 'bg-fail/10' : 'bg-surface'}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <CatSre mood={briefing.mood} talking={talking} className={boss ? 'h-16 w-16 sm:h-28 sm:w-28' : 'h-14 w-14 sm:h-20 sm:w-20'} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {MASCOT}, your SRE lead {boss && <span className="ml-1 inline-block whitespace-nowrap rounded bg-fail px-1.5 py-0.5 text-white">Boss wave</span>}
          </p>
          <div className="sf-bubble relative mt-1 cursor-pointer rounded-brutal border-bw-1 border-ink bg-paper p-2.5 text-sm space-y-1.5" onClick={() => setShown(total)} aria-hidden="true">
            {typed.map((t, i) =>
              t ? (
                <p key={i} className={i === 0 && boss ? 'font-semibold' : ''}>
                  {t}
                </p>
              ) : null,
            )}
          </div>
          <div className="sr-only">
            {briefing.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {talking && (
              <button type="button" className="text-xs underline text-muted" onClick={() => setShown(total)}>
                Show it all
              </button>
            )}
            <button type="button" className={primaryButton} onClick={onClose}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
