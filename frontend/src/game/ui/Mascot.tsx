import { useEffect, useId, useMemo, useState } from 'react';
import { primaryButton } from '../../components/Playground/ui';
import { prefersReducedMotion } from '../../design/motion';
import type { Briefing, Mood } from './briefing';
import { Modal } from './Panels';
import { TUTORIAL_STEPS, TUTORIAL_TEXT, type TutorialStep } from './tutorial';

/** The mascot's name, said in the briefing's label. */
export const MASCOT = 'Kernel';

/**
 * Kernel's own colours, the same in both themes: a sticker on a light disc,
 * so the cat reads on a dark page as well as a light one. Only the disc's
 * ring follows the theme's ink, like every other border.
 */
const CAT = {
  line: '#1f1b16',
  fur: '#f6b23c',
  stripe: '#d98a1c',
  ear: '#f59ab4',
  hoodie: '#a78bfa',
  headset: '#2c2a35',
  white: '#fffdf7',
  disc: '#fdf0cf',
  sweat: '#5aa9ff',
} as const;

/**
 * Kernel, the cat SRE lead: an inline SVG avatar. It blinks and twitches an
 * ear while idle and moves its mouth while `talking`; the mood sets the eyes
 * and the ears. Decorative: the briefing says everything.
 */
export function CatSre({ mood, talking, className = 'h-24 w-24' }: { mood: Mood; talking: boolean; className?: string }) {
  const clip = `sf-cat-disc-${useId().replace(/:/g, '')}`;
  const ears = mood === 'alarmed' ? 'sf-cat-ears sf-cat-ears--back' : 'sf-cat-ears';
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={`sf-cat flex-shrink-0 ${className} ${talking ? 'sf-cat--talking' : ''}`}>
      <defs>
        <clipPath id={clip}>
          <circle cx="60" cy="62" r="56" />
        </clipPath>
      </defs>
      <circle cx="60" cy="62" r="56" fill={CAT.disc} />
      <g stroke={CAT.line} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
        {/* Hoodie, inside the disc. */}
        <g clipPath={`url(#${clip})`}>
          <path d="M20 122 C20 94 38 86 60 86 C82 86 100 94 100 122 Z" fill={CAT.hoodie} />
          <path d="M48 88 L52 102 M72 88 L68 102" fill="none" />
        </g>
        {/* The disc's ring, in the theme's ink like every other border; the ears overlap it. */}
        <circle cx="60" cy="62" r="56" fill="none" stroke="rgb(var(--c-ink))" />
        {/* Ears. */}
        <g className={ears}>
          <path className="sf-cat-ear sf-cat-ear--left" d="M30 46 L28 14 L54 32 Z" fill={CAT.fur} />
          <path className="sf-cat-ear sf-cat-ear--right" d="M90 46 L92 14 L66 32 Z" fill={CAT.fur} />
          <path d="M33 38 L32 22 L46 32 Z M87 38 L88 22 L74 32 Z" fill={CAT.ear} strokeWidth="0" />
        </g>
        {/* Head and stripes. */}
        <ellipse cx="60" cy="58" rx="34" ry="30" fill={CAT.fur} />
        <path d="M50 30 L52 38 M60 28 L60 37 M70 30 L68 38" fill="none" stroke={CAT.stripe} strokeWidth="3" />
        {/* Headset: band, cups and the mic boom. */}
        <path d="M24 56 C24 16 96 16 96 56" fill="none" stroke={CAT.headset} strokeWidth="4.5" />
        <rect x="17" y="49" width="11" height="19" rx="4" fill={CAT.headset} />
        <rect x="92" y="49" width="11" height="19" rx="4" fill={CAT.headset} />
        <path d="M23 68 C26 82 38 84 46 80" fill="none" stroke={CAT.headset} strokeWidth="2.5" />
        <circle cx="47" cy="79" r="3.5" fill={CAT.headset} />
        {/* Eyes. */}
        <g className="sf-cat-eyes">
          {mood === 'happy' ? (
            <path d="M40 56 Q46 48 52 56 M68 56 Q74 48 80 56" fill="none" strokeWidth="3.5" />
          ) : mood === 'alarmed' ? (
            <>
              <circle cx="46" cy="54" r="7.5" fill={CAT.white} strokeWidth="2.5" />
              <circle cx="74" cy="54" r="7.5" fill={CAT.white} strokeWidth="2.5" />
              <circle cx="46" cy="54" r="3" fill={CAT.line} strokeWidth="0" />
              <circle cx="74" cy="54" r="3" fill={CAT.line} strokeWidth="0" />
            </>
          ) : (
            <>
              <ellipse cx="46" cy="54" rx="4.5" ry="6" fill={CAT.line} strokeWidth="0" />
              <ellipse cx="74" cy="54" rx="4.5" ry="6" fill={CAT.line} strokeWidth="0" />
              <circle cx="47.5" cy="51.5" r="1.5" fill={CAT.white} strokeWidth="0" />
              <circle cx="75.5" cy="51.5" r="1.5" fill={CAT.white} strokeWidth="0" />
            </>
          )}
        </g>
        {/* Nose, whiskers, mouth. */}
        <path d="M57 64 L63 64 L60 68 Z" fill={CAT.ear} strokeWidth="2" />
        <path d="M30 64 L44 66 M30 72 L44 70 M90 64 L76 66 M90 72 L76 70" fill="none" strokeWidth="2" />
        {talking ? (
          <ellipse className="sf-cat-mouth" cx="60" cy="74" rx="5" ry="4" fill={CAT.line} strokeWidth="0" />
        ) : (
          <path d="M52 72 Q56 77 60 72 Q64 77 68 72" fill="none" strokeWidth="2.5" />
        )}
        {mood === 'alarmed' && <path d="M99 30 C95 38 95 42 99 44 C103 42 103 38 99 30 Z" fill={CAT.sweat} strokeWidth="2" />}
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

/**
 * Kernel's first-wave tutorial: one step at a time, read off the plan, with
 * the step's control pulsing on the page. Not modal: the board stays usable,
 * and "Skip the tutorial" puts it away for good.
 */
export function MascotCoach({ step, onSkip }: { step: TutorialStep; onSkip: () => void }) {
  const n = TUTORIAL_STEPS.indexOf(step) + 1;
  return (
    <aside aria-label={`${MASCOT}'s tutorial`} className="sf-brief rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm">
      <div className="flex items-start gap-2 sm:gap-3">
        <CatSre mood="happy" talking={false} className="h-12 w-12 sm:h-16 sm:w-16" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Your first wave · step {n} of {TUTORIAL_STEPS.length}
          </p>
          <p className="sf-bubble relative mt-1 rounded-brutal border-bw-1 border-ink bg-paper p-2.5 text-sm" aria-live="polite">
            {TUTORIAL_TEXT[step]}
          </p>
          <div className="mt-2 flex justify-end">
            <button type="button" className="text-xs underline text-muted" onClick={onSkip}>
              Skip the tutorial
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** The one-time intro to the twists, the first time a run has them: before the mutator picker. */
export function TwistsIntro({ briefing, onClose }: { briefing: Briefing; onClose: () => void }) {
  const [first, ...rest] = briefing.lines;
  return (
    <Modal title="New: the twists">
      <div className="flex items-start gap-3">
        <CatSre mood={briefing.mood} talking={false} className="h-14 w-14 sm:h-20 sm:w-20" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{first}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rest.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" className={primaryButton} onClick={onClose}>
          Let’s go
        </button>
      </div>
    </Modal>
  );
}
