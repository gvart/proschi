import { Suspense, lazy, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, Gamepad2, Layers, Play, Zap, type LucideIcon } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import type { Account } from '../useAccount';
import type { ContinueTarget } from './continue';
import { useChallengeStatus, useDailyRunStatus, type Played } from './todayStatus';

/**
 * The practice hub's Today panel, at the top of `#/`: the streak and daily
 * goal, one primary "Your next step" card (the last problem left unsolved,
 * else the roadmap's next step, else today's review), and a compact row of
 * secondary chips for the cards due, today's challenge and today's daily
 * Arcade run. Kept short so the problem list starts high, on a phone too.
 * Each reads what its own page reads (the same stores and API answers), so
 * the panel and the pages always agree; it only shows the state and links
 * to the page that acts on it.
 */

// The due count needs the whole deck: loaded after the panel shows.
const DueCards = lazy(() => import('./DueCards'));

const action =
  'inline-flex min-h-[40px] max-w-full items-center gap-1.5 self-start rounded border-bw-1 border-ink bg-ink px-3 py-1.5 text-sm font-bold text-paper hover:bg-ink/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue';
const chip =
  'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border-bw-1 border-ink bg-surface px-3 py-1 text-sm font-semibold text-ink hover:bg-pop-yellow/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue';

function Chip({ href, icon: Icon, label, children }: { href: string; icon: LucideIcon; label: string; children?: ReactNode }) {
  return (
    <a href={href} className={chip}>
      <Icon size={14} aria-hidden="true" />
      {label}
      {children && <span className="font-normal text-ink/75">· {children}</span>}
    </a>
  );
}

/** "· 540" once played (with a check), nothing while unknown or not played yet. */
function PlayedNote({ played }: { played: Played }) {
  if (played.status !== 'ready' || !played.played) return null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Check size={13} aria-hidden="true" className="text-pass" />
      {typeof played.score === 'number' ? played.score.toLocaleString('en-US') : 'played'}
    </span>
  );
}

export default function TodayPanel({
  account,
  streak,
  next,
  nextTitle,
}: {
  account: Account;
  /** The streak widget (or the sign-in invitation), as PracticeApp builds it. */
  streak?: ReactNode;
  /** Where "Continue" leads, if anywhere. */
  next?: ContinueTarget;
  nextTitle?: string;
}) {
  const challenge = useChallengeStatus(account);
  const daily = useDailyRunStatus(account);
  const challengePlayed = challenge.status === 'ready' && challenge.played;
  const dailyPlayed = daily.status === 'ready' && daily.played;
  return (
    <section aria-labelledby="today-title" className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="today-title" className="font-display text-2xl font-extrabold text-ink">
          Today
        </h2>
        {streak}
      </div>
      <section aria-label="Your next step" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm">
        <div className="min-w-0 flex-1">
          <p className={`flex items-center gap-1.5 ${eyebrow}`}>
            {next?.kind === 'last' ? <Play size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}
            {next ? (next.kind === 'last' ? 'Pick up where you left off' : 'Next on the roadmap') : 'Roadmap complete'}
          </p>
          <p className="mt-0.5 min-w-0 break-words font-display text-lg font-extrabold leading-tight text-ink">{next ? (nextTitle ?? next.id) : 'Keep it fresh with today’s review'}</p>
        </div>
        <a href={next ? next.href : '#/review'} className={action}>
          {next ? 'Continue' : 'Review now'}
          <ArrowRight size={14} aria-hidden="true" />
        </a>
      </section>
      <nav aria-label="Also today" className="mt-3 flex flex-wrap gap-2">
        <Chip href="#/review" icon={Layers} label="Review">
          <Suspense fallback={<span className="text-muted">…</span>}>
            <DueCards account={account} />
          </Suspense>
        </Chip>
        <Chip href="#/challenge" icon={Zap} label="Challenge">
          {challengePlayed && <PlayedNote played={challenge} />}
        </Chip>
        <Chip href="#/arcade/daily" icon={Gamepad2} label="Arcade run">
          {dailyPlayed && <PlayedNote played={daily} />}
        </Chip>
      </nav>
    </section>
  );
}
