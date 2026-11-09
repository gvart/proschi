import { Suspense, lazy } from 'react';
import { CalendarDays } from 'lucide-react';
import { Feature } from '../../components/Feature';
import { eyebrow } from '../../components/Playground/ui';
import UpgradeHint from '../../components/UpgradeHint';
import type { PlanPanelProps } from './PlanPanel';

// The plan needs the whole deck: loaded after the page shows.
const PlanPanel = lazy(() => import('./PlanPanel'));

/**
 * The interview-date plan on the roadmap (feature `interview_plan`, Max;
 * docs/design/paid-plans.md P54): the plan with the feature; else, where
 * paid plans are on, a short teaser with the way to Max; else nothing. It
 * costs nothing to run, so a build without paid plans follows the server
 * for it (an account on Max set by hand gets it), like interview_report.
 */
export default function InterviewPlan(props: Omit<PlanPanelProps, 'sync'> & { base?: string }) {
  const { base = '../', ...rest } = props;
  const signedIn = rest.account.state.status === 'signed-in';
  return (
    <Feature
      name="interview_plan"
      pro={
        <Suspense fallback={null}>
          <PlanPanel {...rest} sync={signedIn} />
        </Suspense>
      }
      hint={
        <UpgradeHint base={base} testId="interview-plan-upgrade" className="mt-2 inline-flex items-start gap-1 text-sm font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink">
          Get Max
        </UpgradeHint>
      }
      free={(hint) =>
        hint && (
          <section aria-labelledby="interview-plan-teaser" className="mt-6 rounded-brutal border-bw-2 border-dashed border-ink/60 bg-surface px-4 py-3" data-testid="interview-plan-teaser">
            <h2 id="interview-plan-teaser" className={`flex items-center gap-1.5 ${eyebrow}`}>
              <CalendarDays size={13} aria-hidden="true" />
              Interview plan · Max
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink/80">
              Pick your interview date and get a plan for every day until then: problems for your weakest skills, mock interviews, then review. Today’s list ticks
              itself off as you practise.
            </p>
            {hint}
          </section>
        )
      }
    />
  );
}
