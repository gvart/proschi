import { useState } from 'react';
import { Check, ChevronRight, CircleCheck, Circle, RotateCcw, SkipForward, X } from 'lucide-react';
import Markdown, { InlineMarkdown } from '../Markdown';
import { eyebrow, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { currentStep, describeCheck, type CheckResult, type GuidedProgress, type GuidedStep } from './guidedFile';

interface GuidedPanelProps {
  steps: GuidedStep[];
  progress: GuidedProgress;
  /** Runs the current step's checks on the design in the editor. */
  onCheck: (step: number) => CheckResult[];
  onPass: (step: number) => void;
  onSkip: (step: number) => void;
  onRestart: () => void;
  onExit: () => void;
}

/** Guided mode above the statement: one step at a time, each unlocked by its checkpoint. */
export default function GuidedPanel({ steps, progress, onCheck, onPass, onSkip, onRestart, onExit }: GuidedPanelProps) {
  const current = currentStep(progress);
  const [results, setResults] = useState<{ step: number; results: CheckResult[] }>();
  const shown = results?.step === current ? results.results : undefined;
  const check = () => {
    const r = onCheck(current);
    setResults({ step: current, results: r });
    if (r.every((c) => c.passed)) onPass(current);
  };
  const finished = current >= steps.length;

  return (
    <section aria-label="Guided walkthrough" className="border-b-bw-1 border-ink bg-paper px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={eyebrow}>Guided walkthrough</span>
        <span className="text-xs text-muted">
          {Math.min(current, steps.length)} of {steps.length} steps
        </span>
        <button type="button" onClick={onExit} className={`ml-auto ${toolButton}`} aria-label="Close the walkthrough" title="Close the walkthrough (your progress is kept)">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <ol className="space-y-1">
        {steps.map((step, i) => {
          const done = progress.done[i];
          const active = i === current;
          return (
            <li key={i} aria-current={active ? 'step' : undefined} className={active ? 'rounded border-bw-1 border-ink bg-surface px-3 py-2' : 'px-1'}>
              <p className={`flex items-center gap-1.5 text-sm ${active ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-muted'}`}>
                {done === 'passed' ? (
                  <CircleCheck size={15} className="text-green-700 dark:text-green-300" aria-label="Done" />
                ) : done === 'skipped' ? (
                  <SkipForward size={15} aria-label="Skipped" />
                ) : active ? (
                  <ChevronRight size={15} aria-hidden="true" />
                ) : (
                  <Circle size={15} aria-label="Locked" />
                )}
                <span>
                  Step {i + 1}: {step.title}
                </span>
              </p>
              {active && (
                <div className="mt-2 space-y-3">
                  <Markdown source={step.explanation} />
                  <div>
                    <p className={eyebrow}>Checkpoint</p>
                    <ul className="mt-1 space-y-1" aria-label="Checkpoint">
                      {step.checks.map((_, j) => {
                        const r = shown?.[j];
                        return (
                          <li key={j} className="flex items-start gap-1.5 text-sm text-ink">
                            {r ? (
                              r.passed ? (
                                <Check size={15} className="mt-0.5 flex-shrink-0 text-green-700 dark:text-green-300" aria-label="Passed" />
                              ) : (
                                <X size={15} className="mt-0.5 flex-shrink-0 text-red-700 dark:text-red-300" aria-label="Not yet" />
                              )
                            ) : (
                              <Circle size={15} className="mt-0.5 flex-shrink-0 text-muted" aria-hidden="true" />
                            )}
                            <span>
                              <InlineMarkdown source={r?.label ?? describeCheck(step.checks[j])} />
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {shown && !shown.every((c) => c.passed) && <p className="mt-1 text-xs text-muted" role="status">Not there yet: change the design and check again.</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={check} className={primaryButton}>
                      Check my design
                    </button>
                    <button type="button" onClick={() => onSkip(current)} className={toolButton}>
                      <SkipForward size={14} aria-hidden="true" />
                      Skip this step
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {finished && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-ink">
            <strong>Walkthrough complete.</strong> Run the tests to see the whole design pass, or try the next problem on your own.
          </p>
          <button type="button" onClick={onRestart} className={outlineButton}>
            <RotateCcw size={14} aria-hidden="true" />
            Start the walkthrough again
          </button>
        </div>
      )}
    </section>
  );
}
