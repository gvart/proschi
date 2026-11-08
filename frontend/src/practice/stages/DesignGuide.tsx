import { useState, type ReactNode } from 'react';
import { FlaskConical, Lightbulb, Loader2, PanelsTopLeft } from 'lucide-react';
import { eyebrow, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import type { EstimateQuestion } from '../modes/interviewFile';
import { PinnedBrief, StageContext } from '../interview/StageParts';
import type { WorksheetRow } from '../interview/stages';
import type { RunResult } from '../workspace';

interface DesignGuideProps {
  title: string;
  statement: string;
  facts: string[];
  rows: WorksheetRow[];
  questions: EstimateQuestion[];
  hints: string[];
  run?: RunResult;
  running: boolean;
  onRun: () => void;
  /** The guided walkthrough, as step-by-step hints (GuidedPanel, or the button that opens it). */
  walkthrough?: ReactNode;
  onEditor: () => void;
}

/** The Design stage's rail beside the whiteboard (P50): what to do, what you found out, the tests, hints one at a time, and the way to the full editor. */
export default function DesignGuide({ title, statement, facts, rows, questions, hints, run, running, onRun, walkthrough, onEditor }: DesignGuideProps) {
  const [shown, setShown] = useState(0);
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper" data-testid="design-guide">
      <StageContext requirements={facts} rows={rows} questions={questions} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="space-y-1">
          <p className={eyebrow}>Stage 4 of 5 · Design</p>
          <h2 data-stage-heading tabIndex={-1} className="font-display text-xl font-bold tracking-tight text-ink outline-none">
            Draw the design
          </h2>
          <p className="text-sm leading-relaxed text-ink/80">Add components, connect them, and give each use case its steps under Flows. Run the tests as often as you like.</p>
        </div>

        <div className="space-y-2">
          <button type="button" onClick={onRun} disabled={running} className={`${primaryButton} w-full justify-center`}>
            {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={15} aria-hidden="true" />}
            {running ? 'Running…' : 'Run tests'}
          </button>
          <p className="text-sm text-ink/80" data-testid="design-tests-line">
            {!run ? 'Not run yet.' : run.blocked ? 'The design has errors to fix first: show the code to see them.' : run.solved ? `All ${run.results.length} tests pass.` : `${run.passed} of ${run.results.length} tests pass.`}
          </p>
        </div>

        {hints.length > 0 && (
          <section aria-label="Hints" className="space-y-2">
            {hints.slice(0, shown).map((hint, i) => (
              <p key={i} className="flex gap-2 rounded-sm border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-sm text-ink">
                <Lightbulb size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Hint {i + 1}.</strong> {hint}
                </span>
              </p>
            ))}
            {shown < hints.length && (
              <button type="button" onClick={() => setShown((n) => n + 1)} className={toolButton}>
                <Lightbulb size={14} aria-hidden="true" />
                {shown === 0 ? 'Stuck? Show a hint' : 'Show another hint'} ({shown} / {hints.length})
              </button>
            )}
          </section>
        )}

        {walkthrough}

        <PinnedBrief title={title} source={statement} />

        <div className="space-y-1 border-t border-ink/15 pt-4">
          <button type="button" onClick={onEditor} className={outlineButton}>
            <PanelsTopLeft size={15} aria-hidden="true" />
            Open the full editor
          </button>
          <p className="text-xs text-muted">Code, tests, scenario playback and the capacity analysis, side by side.</p>
        </div>
      </div>
    </div>
  );
}
