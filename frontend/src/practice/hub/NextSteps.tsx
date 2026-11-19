import { Suspense, lazy } from 'react';
import { ArrowRight, Layers, Play, Puzzle, RotateCcw, Zap, type LucideIcon } from 'lucide-react';
import type { NextStep, NextStepKind } from '../../learn/nextSteps';
import { stepHref } from './stepHref';
import type { RuleStepsProps } from './RuleSteps';

// The rule-based steps need the whole deck: loaded after the page shows.
const RuleSteps = lazy(() => import('./RuleSteps'));

/** The free "Your next steps" (RuleSteps.tsx), loaded lazily; nothing until it is ready. */
export default function NextSteps(props: RuleStepsProps) {
  return (
    <Suspense fallback={null}>
      <RuleSteps {...props} />
    </Suspense>
  );
}


const KIND: Record<NextStepKind, { label: string; icon: LucideIcon }> = {
  retry: { label: 'Retry', icon: RotateCcw },
  review: { label: 'Cards', icon: Layers },
  challenge: { label: 'Challenge', icon: Zap },
  practise: { label: 'Problem', icon: Puzzle },
  finish: { label: 'Problem', icon: Play },
};

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
