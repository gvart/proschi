import { Suspense, lazy, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, Gamepad2, Layers, Play, Zap, type LucideIcon } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import type { Account } from '../useAccount';
import type { ContinueTarget } from './continue';
import { useChallengeStatus, useDailyRunStatus, type Played } from './todayStatus';

/**
 * The practice hub's Today panel, at the top of `#/`: the streak and daily
 * goal, the cards due with "Review now", today's challenge, today's daily
 * Arcade run, and "Continue". Each reads what its own page reads (the same
 * stores and API answers), so the panel and the pages always agree; it only
 * shows the state and links to the page that acts on it.
 */

// The due count needs the whole deck: loaded after the panel shows.
const DueCards = lazy(() => import('./DueCards'));

const tile = 'flex min-w-0 flex-col gap-2 rounded-brutal border-bw-2 border-ink bg-surface p-3 shadow-brutal-sm';
const action =
  'inline-flex min-h-[40px] max-w-full items-center gap-1.5 self-start rounded border-bw-1 border-ink bg-ink px-3 py-1.5 text-sm font-bold text-paper hover:bg-ink/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue';
const quiet =
  'inline-flex min-h-[40px] max-w-full items-center gap-1.5 self-start rounded border-bw-1 border-ink bg-surface px-3 py-1.5 text-sm font-bold text-ink hover:bg-pop-yellow/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pop-blue';

function Tile({ icon: Icon, title, label, children }: { icon: LucideIcon; title: string; label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={tile}>
      <p className={`flex items-center gap-1.5 ${eyebrow}`}>
        <Icon size={13} aria-hidden="true" />
        {title}
      </p>
      {children}
    </section>
  );
}

function PlayedTile({ played, icon, title, label, href, play, see }: { played: Played; icon: LucideIcon; title: string; label: string; href: string; play: string; see: string }) {
  const max = played.status === 'ready' && played.played ? played.maxScore : undefined;
  return (
    <Tile icon={icon} title={title} label={label}>
      {played.status === 'loading' ? (
        <span className="text-sm text-muted">Checking…</span>
      ) : played.status === 'ready' && played.played ? (
        <span className="inline-flex items-center gap-1.5 font-display text-lg font-extrabold tabular-nums text-ink">
          <Check size={16} aria-hidden="true" className="text-pass" />
          {typeof played.score === 'number' ? `${played.score.toLocaleString('en-US')}${max ? ` / ${max}` : ''}` : 'Played'}
        </span>
      ) : (
        <span className="font-display text-lg font-extrabold text-ink">{played.status === 'ready' ? 'Not played yet' : 'Ready when you are'}</span>
      )}
      <a href={href} className={played.status === 'ready' && played.played ? quiet : action}>
        {played.status === 'ready' && played.played ? see : play}
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    </Tile>
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
  return (
    <section aria-labelledby="today-title" className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="today-title" className="font-display text-2xl font-extrabold text-ink">
          Today
        </h2>
        {streak}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile icon={Layers} title="Daily review" label="Cards due">
          <Suspense fallback={<span className="text-sm text-muted">Counting your cards…</span>}>
            <DueCards account={account} />
          </Suspense>
          <a href="#/review" className={action}>
            Review now
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </Tile>
        <PlayedTile played={challenge} icon={Zap} title="Daily challenge" label="Daily challenge status" href="#/challenge" play="Take the challenge" see="See your result" />
        <PlayedTile played={daily} icon={Gamepad2} title="Arcade daily run" label="Arcade daily run status" href="#/arcade/daily" play="Play the daily run" see="See the daily run" />
        <Tile icon={next?.kind === 'last' ? Play : CalendarDays} title={next?.kind === 'last' ? 'Pick up where you left off' : 'Next on the roadmap'} label="Continue">
          {next ? (
            <>
              <span className="min-w-0 break-words font-display text-lg font-extrabold leading-tight text-ink">{nextTitle ?? next.id}</span>
              <a href={next.href} className={action}>
                Continue
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </>
          ) : (
            <>
              <span className="font-display text-lg font-extrabold text-ink">Roadmap complete</span>
              <a href="#/progress" className={quiet}>
                See your progress
                <ArrowRight size={14} aria-hidden="true" />
              </a>
            </>
          )}
        </Tile>
      </div>
    </section>
  );
}
