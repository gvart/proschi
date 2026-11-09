import { useId, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, CircleAlert, CircleCheck, Compass, FlaskConical, Lightbulb, Loader2 } from 'lucide-react';
import { primaryButton, toolButton } from '../../components/Playground/ui';
import { tabPanelProps } from '../../design/classes';
import Tabs from '../../design/Tabs';
import Markdown from '../Markdown';
import type { EstimateQuestion } from '../modes/interviewFile';
import { EstimatesSummary } from '../interview/StageParts';
import type { WorksheetRow } from '../interview/stages';
import type { RunResult } from '../workspace';

interface DesignGuideProps {
  statement: string;
  facts: string[];
  rows: WorksheetRow[];
  questions: EstimateQuestion[];
  hints: string[];
  run?: RunResult;
  running: boolean;
  onRun: () => void;
  /** Opens the guided walkthrough (step-by-step hints); absent when the problem has none or it is open. */
  onWalkthrough?: () => void;
  /** The guided walkthrough, once open (GuidedPanel). */
  walkthrough?: ReactNode;
}

/**
 * The Design stage's rail beside the whiteboard (P50): the brief and what
 * was found out folded into one line at the top, Run tests as the one
 * primary action with its result under it, and help when stuck (hints one
 * at a time, the walkthrough) as one quiet row. The full editor is in the
 * stage bar.
 */
export default function DesignGuide({ statement, facts, rows, questions, hints, run, running, onRun, onWalkthrough, walkthrough }: DesignGuideProps) {
  const [shown, setShown] = useState(0);
  const helps = hints.length > 0 || onWalkthrough || walkthrough;
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-paper" data-testid="design-guide">
      <BriefAndNotes statement={statement} facts={facts} rows={rows} questions={questions} />
      <div className="space-y-8 px-5 py-6">
        <div className="space-y-3">
          <h2 data-stage-heading tabIndex={-1} className="text-sm leading-relaxed text-ink/80 outline-none">
            Draw it on the whiteboard, then run the tests.
          </h2>
          <button type="button" onClick={onRun} disabled={running} className={`${primaryButton} w-full justify-center`}>
            {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FlaskConical size={15} aria-hidden="true" />}
            {running ? 'Running…' : 'Run tests'}
          </button>
          <p className={`flex items-start gap-1.5 text-sm ${run?.solved ? 'font-semibold text-ink' : 'text-ink/80'}`} data-testid="design-tests-line" aria-live="polite">
            {run && (run.solved ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-green-700 dark:text-green-300" aria-hidden="true" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />)}
            <span>{!run ? 'Not run yet.' : run.blocked ? 'The design has errors to fix first: show the code to see them.' : run.solved ? `All ${run.results.length} tests pass.` : `${run.passed} of ${run.results.length} tests pass.`}</span>
          </p>
        </div>

        {helps && (
          <section aria-label="Help when stuck" className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <span className="mr-1 text-sm text-muted">Stuck?</span>
              {hints.length > 0 && (
                <button type="button" onClick={() => setShown((n) => n + 1)} disabled={shown >= hints.length} className={`${toolButton} disabled:cursor-default disabled:text-muted disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:shadow-none`} title={shown >= hints.length ? 'Every hint is shown' : 'Show the next hint'}>
                  <Lightbulb size={14} aria-hidden="true" />
                  Hint
                  <span className="font-mono text-xs font-normal text-muted">
                    {shown}/{hints.length}
                  </span>
                </button>
              )}
              {onWalkthrough && (
                <button type="button" onClick={onWalkthrough} className={toolButton} aria-label="Walk me through it, step by step" title="Build the design step by step, with a check after each step">
                  <Compass size={14} aria-hidden="true" />
                  Walk me through it
                </button>
              )}
            </div>
            {shown > 0 && (
              <ol className="space-y-2" aria-label="Hints">
                {hints.slice(0, shown).map((hint, i) => (
                  <li key={i} className="rounded-sm border-l-4 border-pop-yellow bg-pop-yellow/15 px-3 py-2 text-sm leading-relaxed text-ink">
                    <strong>Hint {i + 1}.</strong> {hint}
                  </li>
                ))}
              </ol>
            )}
            {walkthrough && <div className="-mx-5 border-y-bw-1 border-ink">{walkthrough}</div>}
          </section>
        )}
      </div>
    </div>
  );
}

type Part = 'brief' | 'requirements' | 'estimates';

/** The brief, the requirements found out in Clarify and the estimates, folded to one line until opened; one at a time when open. */
function BriefAndNotes({ statement, facts, rows, questions }: { statement: string; facts: string[]; rows: WorksheetRow[]; questions: EstimateQuestion[] }) {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<Part>('brief');
  const id = useId();
  const estimates = rows.filter((r) => r.expression.trim()).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return (
    <section aria-label="Brief and notes" className="border-b-bw-1 border-ink bg-surface" data-testid="stage-context">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-12 w-full items-center gap-2 px-5 py-2.5 text-left hover:bg-ink/5">
        <BookOpen size={15} className="shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink">Brief &amp; notes</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {plural(facts.length, 'requirement')} · {plural(estimates, 'estimate')}
        </span>
        <ChevronDown size={15} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={id}>
          <Tabs
            label="Brief and notes"
            idPrefix={`${id}-part`}
            fill
            value={part}
            onChange={setPart}
            items={[
              { id: 'brief', label: 'Brief' },
              { id: 'requirements', label: 'Requirements', badge: facts.length },
              { id: 'estimates', label: 'Estimates', badge: estimates },
            ]}
          />
          <div {...tabPanelProps(`${id}-part`, part)} className="px-5 py-4 outline-none">
            {part === 'brief' && <Markdown source={statement} />}
            {part === 'requirements' &&
              (facts.length ? (
                <ul className="space-y-1.5 text-sm leading-relaxed text-ink">
                  {facts.map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-ink/60" />
                      <span className="min-w-0">{f}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Nothing yet beyond the brief.</p>
              ))}
            {part === 'estimates' && <EstimatesSummary rows={rows} questions={questions} plain />}
          </div>
        </div>
      )}
    </section>
  );
}
