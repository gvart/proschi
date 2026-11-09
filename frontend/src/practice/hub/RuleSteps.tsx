import { useMemo, type ReactNode } from 'react';
import deck from 'virtual:practice-cards';
import problems from 'virtual:practice-listings';
import { ArrowRight, Layers, Play, Puzzle, RotateCcw, Zap, type LucideIcon } from 'lucide-react';
import { relatedProblems, skills as skillMap } from '../../learn/mastery';
import { nextSteps, type NextStep, type NextStepKind } from '../../learn/nextSteps';
import { overview } from '../../learn/review';
import type { Progress } from '../progress';
import type { Account } from '../useAccount';
import { useTodayCards, type TodayCards } from './todayCards';
import { loadMistakes } from './recentMistakes';
import { useChallengeStatus } from './todayStatus';

/**
 * The free "Your next steps" (learn/nextSteps.ts) with this learner's data:
 * the skill map (the server's, or computed here from the cards and the
 * solves when there is none, e.g. signed out), the cards due, the mistakes
 * kept in this browser, the problems solved or started and today's
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
  /** Problems shown elsewhere on the page, e.g. by Continue. */
  exclude?: readonly string[];
  limit?: number;
  /** Kinds the page already offers (learn/nextSteps.ts `omit`). */
  omit?: readonly NextStepKind[];
  /** The card states when the page loaded them already (one load, one request); else loaded here. */
  cards?: TodayCards;
  /** Places the list (null without steps). */
  render: (list: ReactNode | null) => ReactNode;
}

/** Where a step leads on the practice page. */
function stepHref(step: NextStep): string {
  if (step.kind === 'review') return step.topic ? `#/review/${step.topic}` : '#/review';
  if (step.kind === 'challenge') return '#/challenge';
  return `#/${step.problem}`;
}

const KIND: Record<NextStepKind, { label: string; icon: LucideIcon }> = {
  retry: { label: 'Retry', icon: RotateCcw },
  review: { label: 'Cards', icon: Layers },
  challenge: { label: 'Challenge', icon: Zap },
  practise: { label: 'Problem', icon: Puzzle },
  finish: { label: 'Problem', icon: Play },
};

export default function RuleSteps({ account, progress, skills, streak, exclude, limit, omit, cards, render }: RuleStepsProps) {
  const own = useTodayCards(account, !cards);
  const today = cards ?? own;
  const challenge = useChallengeStatus(account);
  const challengeKnown = challenge.status === 'ready' || challenge.status === 'unknown';
  const steps = useMemo(() => {
    if (!today || !challengeKnown) return undefined;
    const now = Math.floor(Date.now() / 1000);
    const solved = Object.keys(progress).filter((id) => progress[id].status === 'solved');
    const attempted = Object.keys(progress).filter((id) => progress[id].status === 'attempted');
    const stats = overview(deck.cards, today.loaded.states, deck.topics, { now, deck: today.signedOut ? 'sample' : undefined });
    const mastery = new Map(
      (skills ?? skillMap({ cards: deck.cards, topics: deck.topics, states: today.loaded.states, now, problems, solved, estimateRatings: [] }).topics).map((t) => [t.topic, t.mastery]),
    );
    return nextSteps({
      topics: deck.topics.filter((t) => mastery.has(t.id)).map((t) => ({ id: t.id, title: t.title, mastery: mastery.get(t.id)!, related: relatedProblems(t.id, deck.cards, problems) })),
      due: { total: stats.due, byTopic: Object.fromEntries(stats.topics.map((t) => [t.topic.id, t.due])) },
      problems,
      solved,
      attempted,
      mistakes: loadMistakes(),
      challengeDone: challenge.status === 'ready' ? challenge.played : undefined,
      streak,
      exclude,
      omit,
      limit,
    });
  }, [today, challengeKnown, challenge, progress, skills, streak, exclude, omit, limit]);
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
