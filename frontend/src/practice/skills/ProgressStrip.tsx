import { ArrowRight, Lock, Radar } from 'lucide-react';
import { percent } from '../../learn/mastery';
import { ACHIEVEMENTS } from '../achievementList';
import type { AchievementsState } from './useAchievements';
import AchievementIcon from './AchievementIcon';

/** How many of the latest badges the strip shows. */
const SHOWN = 4;

/**
 * A compact line on the problem list: the interview-ready score, the badges
 * earned and the latest few, linking to the progress page. Signed out, an
 * invitation to see the preview.
 */
export default function ProgressStrip({ state }: { state: AchievementsState }) {
  const answer = state.status === 'ready' ? state.answer : undefined;
  const earned = (answer?.achievements ?? []).filter((a) => a.earned).sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0));
  return (
    <a
      href="#/progress"
      aria-label={answer ? `Your progress: ${percent(answer.skills.readiness)}% interview ready, ${earned.length} of ${answer.achievements.length} badges` : 'Your progress: skill map and badges'}
      className="group mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-brutal border-bw-2 border-ink bg-surface px-4 py-3 shadow-brutal-sm transition-[box-shadow,transform] duration-d1 hover:-translate-x-px hover:-translate-y-px hover:shadow-brutal-md"
    >
      <Radar size={18} aria-hidden="true" className="shrink-0 text-ink" />
      {answer ? (
        <>
          <span className="text-sm text-ink">
            <span className="font-display text-xl font-extrabold tabular-nums">{percent(answer.skills.readiness)}%</span> interview ready
          </span>
          <span className="text-sm tabular-nums text-ink/80">
            {earned.length} of {answer.achievements.length} badges
          </span>
          {earned.length > 0 && (
            <span className="flex gap-1.5" aria-hidden="true">
              {earned.slice(0, SHOWN).map((a) => (
                <span key={a.id} title={a.title} className="[&>span]:h-8 [&>span]:w-8">
                  <AchievementIcon icon={a.icon} tier={a.tier} earned />
                </span>
              ))}
            </span>
          )}
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-ink">
          {state.status === 'locked' && <Lock size={14} aria-hidden="true" />}
          <span className="font-semibold">Skill map and badges</span>
          <span className="text-ink/80">· {state.status === 'locked' ? 'sign in to track them' : `${ACHIEVEMENTS.length} badges to earn`}</span>
        </span>
      )}
      <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-ink">
        Your progress
        <ArrowRight size={14} aria-hidden="true" className="transition-transform duration-d1 group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}
