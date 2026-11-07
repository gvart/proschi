import listings from 'virtual:practice-listings';
import type { Kind } from './prefs';

/**
 * The screens of the set-up wizard (Setup.tsx), one decision each: who
 * interviews you (only where the interviewer exists), the problem, the
 * length, voice or text (the interviewer only), then the review with Start.
 * Pure, so the order is tested without a page.
 */

export type StepId = 'who' | 'problem' | 'length' | 'talk' | 'review';

export function setupSteps({ who, kind }: { who: boolean; kind: Kind }): StepId[] {
  const steps: StepId[] = who ? ['who', 'problem', 'length'] : ['problem', 'length'];
  if (kind === 'mock') steps.push('talk');
  steps.push('review');
  return steps;
}

/** The step shown for `at`: itself while it is one of `steps`, else the first. */
export const currentStep = (steps: readonly StepId[], at: StepId): StepId => (steps.includes(at) ? at : steps[0]);

/** The step after `at` (the review stays the review). */
export const nextStep = (steps: readonly StepId[], at: StepId): StepId => steps[Math.min(steps.length - 1, steps.indexOf(at) + 1)];

/** The step before `at`, or undefined on the first. */
export const prevStep = (steps: readonly StepId[], at: StepId): StepId | undefined => (steps.indexOf(at) > 0 ? steps[steps.indexOf(at) - 1] : undefined);

/** The problem on the set-up's second screen: a surprise, one chosen by name, or the last one again. */
export type ProblemChoice = 'surprise' | 'choose' | 'last';

export const titleOf = (id: string): string => listings.find((p) => p.id === id)?.title ?? id;
