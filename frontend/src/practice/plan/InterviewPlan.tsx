import { Suspense, lazy, useId, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { Feature } from '../../components/Feature';
import UpgradeHint from '../../components/UpgradeHint';
import type { PlanPanelProps } from './PlanPanel';

// The plan needs the whole deck: loaded after the page shows.
const PlanPanel = lazy(() => import('./PlanPanel'));

const link =
  'inline-flex min-h-[32px] items-center gap-1 rounded-sm text-sm font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-pop-blue';

/**
 * The interview-date plan on the roadmap (feature `interview_plan`, Max;
 * docs/design/paid-plans.md P55), a small link beside the roadmap's progress:
 * with the feature it shows and hides the plan, open from the start once a
 * date is set (the panel stays mounted either way, so it keeps syncing the
 * account's plan and today's list); else, where paid plans are on, the way to
 * Max; else nothing. It costs nothing to run, so a build without paid plans
 * follows the server for it (an account on Max set by hand gets it), like
 * interview_report. Placed in a wrapping flex row: the plan takes a row of
 * its own.
 */
export default function InterviewPlan(props: Omit<PlanPanelProps, 'sync'> & { base?: string }) {
  const { base = '../', ...rest } = props;
  return (
    <Feature
      name="interview_plan"
      pro={<PlanToggle {...rest} />}
      hint={
        <UpgradeHint base={base} testId="interview-plan-teaser" icon={false} className={link}>
          <CalendarDays size={14} aria-hidden="true" />
          Interview plan <span className="text-muted">· Max</span>
        </UpgradeHint>
      }
      free={(hint) => hint}
    />
  );
}

function PlanToggle(props: Omit<PlanPanelProps, 'sync'>) {
  const id = useId();
  // Closed by default, so the roadmap's "Up next" stays first; mounted while hidden, so the plan keeps syncing.
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={link} data-testid="interview-plan-toggle">
        <CalendarDays size={14} aria-hidden="true" />
        Interview plan
        <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-d1 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>
      <div id={id} hidden={!open} className="min-w-0 basis-full">
        <Suspense fallback={null}>
          <PlanPanel {...props} sync={props.account.state.status === 'signed-in'} />
        </Suspense>
      </div>
    </>
  );
}
