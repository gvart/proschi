import { ArrowRight, Zap } from 'lucide-react';
import summary from 'virtual:practice-cards-summary';
import { CHALLENGE_SIZE, MAX_SCORE } from '../learn/challenge';
import { eyebrow } from '../components/Playground/ui';

/**
 * The daily challenge's card on the problem list, next to daily review's:
 * what it is and the way in. The cards themselves load with the challenge.
 */
export default function ChallengeCard() {
  if (summary.cards === 0) return null;
  return (
    <div className="mt-4 rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md overflow-hidden">
      <div className="h-3 bg-pop-pink border-b-bw-2 border-ink" aria-hidden="true" />
      <div className="p-5 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className={eyebrow}>The same for everyone · resets at 00:00 UTC</p>
          <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold leading-tight text-ink">
            <Zap size={22} aria-hidden="true" className="shrink-0" />
            Daily challenge
          </h2>
          <p className="mt-2 text-sm text-ink/80">
            {CHALLENGE_SIZE} cards a day, scored for accuracy and a little for speed, up to {MAX_SCORE} points. Compare your score on today’s leaderboard.
          </p>
        </div>
        <a
          href="#/challenge"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start sm:self-auto min-h-[44px] px-4 rounded border-bw-2 border-ink bg-pop-yellow text-on-accent font-bold shadow-brutal-sm hover:shadow-brutal-md transition-[box-shadow,transform] duration-d1 hover:-translate-x-px hover:-translate-y-px"
        >
          Play today’s challenge
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
