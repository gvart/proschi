import type { NextStep } from '../../learn/nextSteps';
import { setupHref } from '../interview/links';

/** Where a step leads on the practice page: a problem's to the interview set-up with it chosen (free, solo or mock). */
export function stepHref(step: NextStep): string {
  if (step.kind === 'review') return step.topic ? `#/review/${step.topic}` : '#/review';
  if (step.kind === 'challenge') return '#/challenge';
  return setupHref(step.problem);
}
