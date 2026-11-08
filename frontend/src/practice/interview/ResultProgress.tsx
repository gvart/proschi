import { useEffect } from 'react';
import { ArrowRight, Lock, Sparkles, Timer, TrendingUp } from 'lucide-react';
import { eyebrow } from '../../components/Playground/ui';
import type { AchievementsAnswer } from '../../learn/achievements';
import { MIN_INTERVIEW_MINUTES } from '../../learn/mastery';
import AchievementIcon from '../skills/AchievementIcon';
import type { AchievementsState } from '../skills/useAchievements';
import { progressChange } from './progressChange';

/**
 * "Your progress" under an interview's result (docs/design/paid-plans.md
 * P48): the XP and level the interview added, the skills it moved (before →
 * after) and the badges it earned, against the progress as it was when the
 * room opened (`before`). Without it (the result reopened later), the level
 * now and the badges earned since the interview ended. Signed out, an
 * invitation to sign in. The badges shown are marked seen, so the toast
 * does not celebrate them again.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';

export default function ResultProgress({
  state,
  before,
  endedAt,
  counts = true,
  onSeen,
}: {
  state: AchievementsState;
  before?: AchievementsAnswer;
  /** When the interview ended, Unix ms. */
  endedAt: number;
  /** It did enough to count (soloCounts); below the bar the block says so instead. */
  counts?: boolean;
  onSeen: (ids: string[]) => void;
}) {
  const after = state.status === 'ready' ? state.answer : undefined;
  // The answer the room opened with: the new one is on its way.
  const counting = !!after && after === before;
  const change = after && !counting ? progressChange(after, before, endedAt) : undefined;
  const unseen = change?.badges.filter((b) => b.unseen).map((b) => b.id).join(',') ?? '';
  useEffect(() => {
    if (unseen) onSeen(unseen.split(','));
  }, [unseen, onSeen]);

  if (!counts) {
    return (
      <section aria-label="Your progress" data-testid="result-progress" className={`mt-6 p-4 ${card}`}>
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Timer size={16} aria-hidden="true" />
          Too short to count towards your progress
        </p>
        <p className="mt-1 text-sm text-ink/80" data-testid="result-too-short">
          An interview on your own counts once it runs {MIN_INTERVIEW_MINUTES} minutes or more, or reaches Design with something drawn on the whiteboard.
        </p>
      </section>
    );
  }
  if (state.status === 'loading' || state.status === 'error') return null;
  const link = (
    <a href="#/progress" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline underline-offset-2">
      See your progress
      <ArrowRight size={14} aria-hidden="true" />
    </a>
  );
  if (state.status === 'locked') {
    return (
      <section aria-label="Your progress" data-testid="result-progress" className={`mt-6 p-4 ${card}`}>
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Lock size={16} aria-hidden="true" />
          Sign in to count your interviews
        </p>
        <p className="mt-1 text-sm text-ink/80">Signed in, every interview adds to your level, your skill map and the interview badges.</p>
        <div className="mt-2">{link}</div>
      </section>
    );
  }
  return (
    <section aria-labelledby="result-progress-title" data-testid="result-progress" className={`mt-6 overflow-hidden ${card}`}>
      <div className="h-2 border-b-bw-2 border-ink bg-pop-yellow" aria-hidden="true" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="result-progress-title" className="flex items-center gap-1.5 font-display text-lg font-bold text-ink">
            <Sparkles size={16} aria-hidden="true" />
            Your progress
          </h2>
          {change && (
            <p className="text-sm tabular-nums text-ink/80" data-testid="result-xp">
              {change.xp > 0 && <span className="font-display text-xl font-extrabold text-ink">+{change.xp} XP</span>}
              {change.xp > 0 && ' · '}
              {change.levelUp ? <span className="font-semibold text-ink">Level up: level {change.level}</span> : `Level ${change.level}`}
            </p>
          )}
        </div>
        {counting ? (
          <p role="status" className="text-sm text-muted">
            Counting this interview…
          </p>
        ) : (
          change && (
            <>
              {change.skills.length > 0 && (
                <div>
                  <h3 className={`flex items-center gap-1.5 ${eyebrow}`}>
                    <TrendingUp size={13} aria-hidden="true" />
                    Skills that moved
                  </h3>
                  <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" aria-label="Skills that moved">
                    {change.skills.map((s) => (
                      <li key={s.topic} className="flex items-baseline justify-between gap-3 border-b border-ink/15 pb-1">
                        <span className="font-semibold text-ink">{s.title}</span>
                        <span className="font-mono tabular-nums text-ink/80">
                          {s.before}% → <span className="font-bold text-ink">{s.after}%</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {change.badges.length > 0 && (
                <div>
                  <h3 className={eyebrow}>{change.badges.length === 1 ? 'New badge' : `${change.badges.length} new badges`}</h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="New badges">
                    {change.badges.map((b) => (
                      <li key={b.id} data-new-badge={b.id} className="flex items-start gap-3 rounded-brutal border-bw-1 border-ink bg-paper p-2.5 motion-safe:animate-[ps-pop_var(--d-spring)_var(--e-spring)]">
                        <AchievementIcon icon={b.icon} tier={b.tier} earned />
                        <div className="min-w-0">
                          <p className="font-display text-base font-bold leading-tight text-ink">{b.title}</p>
                          <p className="mt-0.5 text-sm text-ink/80">{b.description}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {before && change.xp === 0 && change.skills.length === 0 && change.badges.length === 0 && (
                <p className="text-sm text-ink/80">Nothing new this time: each problem adds XP once per way of interviewing, and your best interview counts towards your skills.</p>
              )}
            </>
          )
        )}
        {link}
      </div>
    </section>
  );
}
