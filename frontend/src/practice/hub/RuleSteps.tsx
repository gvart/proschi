import { useMemo, type ReactNode } from 'react';
import { nextSteps, type NextStep } from '../../learn/nextSteps';
import type { Progress } from '../progress';
import type { Account } from '../useAccount';
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
  /** Problems never to suggest: on the roadmap, those locked there. */
  exclude?: readonly string[];
  /** Places the steps (empty without any). */
  render: (steps: readonly NextStep[]) => ReactNode;
}

export default function RuleSteps({ account, progress, skills, streak, exclude, render }: RuleStepsProps) {
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
      exclude,
    });
  }, [today, challengeKnown, challenge, progress, skills, streak, mistakes, exclude]);
  if (!steps) return null;
  return render(steps);
}
