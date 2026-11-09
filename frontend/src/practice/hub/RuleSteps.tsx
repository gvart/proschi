import { useMemo, type ReactNode } from 'react';
import { ArrowRight, Layers, Play, Puzzle, RotateCcw, Zap, type LucideIcon } from 'lucide-react';
import { nextSteps, type NextStep, type NextStepKind } from '../../learn/nextSteps';
import type { Progress } from '../progress';
import type { Account } from '../useAccount';
import { setupHref } from '../interview/links';
import { useTodayCards } from './todayCards';
import { learnerInput } from './learnerInput';
import { useRecentMistakes } from './recentMistakes';
import { useChallengeStatus } from './todayStatus';

/**
 * The free "Your next steps" (learn/nextSteps.ts) with this learner's data:
 * the skill map (the server's, or computed here from the cards and the
 * solves when there is none, e.g. signed out), the cards due, the mistakes
 * kept in this browser (and the account's, signed in), the problems solved or started and today's
 * challenge. Waits for the cards and the challenge so the list doesn't
 * reorder. Loaded lazily: it bundles every card.
 */

export interface RuleStepsProps {
  account: Account;
  progress: Progress;
  /** The server's (or this browser's) skill map, when ready. */
  skills?: readonly { topic: string; mastery: number }[];
  /** The current daily streak in days. */
  streak?: number;
  /** Places the list (null without steps). */
  render: (list: ReactNode | null) => ReactNode;
}

/** Where a step leads on the practice page: a problem's to the interview set-up with it chosen (free, solo or mock). */
function stepHref(step: NextStep): string {
  if (step.kind === 'review') return step.topic ? `#/review/${step.topic}` : '#/review';
  if (step.kind === 'challenge') return '#/challenge';
  return setupHref(step.problem);
}

const KIND: Record<NextStepKind, { label: string; icon: LucideIcon }> = {
  retry: { label: 'Retry', icon: RotateCcw },
  review: { label: 'Cards', icon: Layers },
  challenge: { label: 'Challenge', icon: Zap },
  practise: { label: 'Problem', icon: Puzzle },
  finish: { label: 'Problem', icon: Play },
};

export default function RuleSteps({ account, progress, skills, streak, render }: RuleStepsProps) {
  const today = useTodayCards(account);
  const challenge = useChallengeStatus(account);
  const challengeKnown = challenge.status === 'ready' || challenge.status === 'unknown';
  // Re-read when a mistake is recorded or the account's join them.
  const mistakes = useRecentMistakes();
  const steps = useMemo(() => {
    if (!today || !challengeKnown) return undefined;
    return nextSteps({
      ...learnerInput(progress, today, skills, Math.floor(Date.now() / 1000), mistakes),
      challengeDone: challenge.status === 'ready' ? challenge.played : undefined,
      streak,
    });
  }, [today, challengeKnown, challenge, progress, skills, streak, mistakes]);
  if (!steps) return null;
  return render(steps.length ? <StepList steps={steps} /> : null);
}

/** The steps as the AI picks show theirs (history/NextForYou.tsx PickList). */
export function StepList({ steps }: { steps: readonly NextStep[] }) {
  return (
    <ol className="space-y-2" data-testid="next-steps">
      {steps.map((s, i) => {
        const { label, icon: Icon } = KIND[s.kind];
        return (
          <li key={s.key}>
            <a
              href={stepHref(s)}
              data-kind={s.kind}
              className="group flex items-start gap-3 rounded-sm border-bw-1 border-ink bg-paper px-3 py-2.5 transition-colors duration-d1 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue"
            >
              <span className="mt-0.5 font-display text-base font-extrabold tabular-nums text-ink" aria-hidden="true">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-ink group-hover:underline">{s.title}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                    <Icon size={11} aria-hidden="true" />
                    {label}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-ink/80">{s.reason}</span>
              </span>
              <ArrowRight size={16} className="mt-1 shrink-0 text-ink" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ol>
  );
}
