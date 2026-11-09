import { Suspense, lazy } from 'react';
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
