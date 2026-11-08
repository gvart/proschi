import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CircleCheck, Layers, Map as MapIcon, Timer } from 'lucide-react';
import problems from 'virtual:practice-listings';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import Markdown from '../Markdown';
import type { Problem } from '../types';
import { redactedStatement, type Interview } from '../modes/interviewFile';
import { Brief, PinnedBrief, RequirementsCard, StageHeading, Worksheet } from '../interview/StageParts';
import { questionRowId, type WorksheetRow } from '../interview/stages';
import { setupHref } from '../interview/links';
import { ROADMAP, roadmapFor, roadmapHref, roadmapState } from '../roadmap';
import { useRelatedTopics } from '../relatedTopics';
import type { Progress } from '../progress';
import { checkEstimate, factsOf, type StageNotes } from './flow';
import '../interview/room.css';

/**
 * The stage screens of a practice problem that are not the whiteboard
 * (P50): Clarify, Estimate and Wrap-up. Each asks for the learner's own
 * answer first, then shows what to compare it with.
 */

type Update = (update: (n: StageNotes) => StageNotes) => void;

const stageEyebrow = (n: number, label: string) => `Stage ${n} of 5 · ${label}`;

function Notes({ label, hint, value, onChange, placeholder, rows = 6 }: { label: string; hint?: ReactNode; value: string; onChange: (v: string) => void; placeholder: string; rows?: number }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-bold text-ink">
        {label}
      </label>
      {hint && <p className="text-sm text-ink/75">{hint}</p>}
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value.slice(0, 8000))} rows={rows} placeholder={placeholder} className={`w-full resize-y leading-relaxed ${field} !px-3 !py-2.5 text-[15px]`} />
    </div>
  );
}

/** Clarify: the brief (its scale and constraints held back), the learner's own questions, then the interviewer's answers to compare. */
export function ClarifyStage({ problem, interview, notes, onNotes, onNext }: { problem: Problem; interview?: Interview; notes: StageNotes; onNotes: Update; onNext: () => void }) {
  // The brief types itself out once per problem.
  const [reveal] = useState(() => !notes.briefRead);
  useEffect(() => {
    if (!notes.briefRead) onNotes((n) => ({ ...n, briefRead: true }));
  }, [notes.briefRead, onNotes]);
  const brief = useMemo(() => (interview ? redactedStatement(problem.statement) : problem.statement), [interview, problem.statement]);
  const good = interview?.questions.map((q, i) => ({ q, i })).filter(({ q }) => q.good) ?? [];
  const weak = interview?.questions.filter((q) => !q.good) ?? [];
  const covered = good.filter(({ i }) => notes.covered.includes(i)).length;
  const toggle = (i: number, on: boolean) => onNotes((n) => ({ ...n, covered: on ? [...new Set([...n.covered, i])] : n.covered.filter((x) => x !== i) }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-paper" data-testid="stage-clarify">
      <Brief
        title={problem.title}
        source={brief}
        reveal={reveal}
        eyebrow={`${stageEyebrow(2, 'Clarify')} · The brief`}
        footer={
          <div className="space-y-6">
            <section aria-labelledby="clarify-yours" className="space-y-3 rounded-sm border-bw-1 border-ink bg-surface p-4 shadow-brutal-sm sm:p-5">
              <h3 id="clarify-yours" className="font-display text-xl font-bold tracking-tight text-ink">
                What would you ask before designing?
              </h3>
              <Notes
                label="Your clarifying questions and assumptions"
                hint={interview ? 'The scale and the constraints are not in the brief. Write the questions you would ask the interviewer, and what you would assume.' : 'Write what you would ask, and what you would assume.'}
                value={notes.questions}
                onChange={(questions) => onNotes((n) => ({ ...n, questions }))}
                placeholder={'How many requests a second at peak?\nHow fast must it answer?\n…'}
              />
              {interview && !notes.revealed && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button type="button" onClick={() => onNotes((n) => ({ ...n, revealed: true }))} disabled={!notes.questions.trim()} className={`${primaryButton} disabled:opacity-50`}>
                    Compare with the interviewer’s answers
                  </button>
                  {!notes.questions.trim() && (
                    <button type="button" onClick={() => onNotes((n) => ({ ...n, revealed: true }))} className="text-sm font-semibold text-muted underline underline-offset-4 hover:text-ink">
                      Show them without writing
                    </button>
                  )}
                </div>
              )}
            </section>

            {interview && notes.revealed && (
              <section aria-labelledby="clarify-answers" className="space-y-3" data-testid="clarify-answers">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 id="clarify-answers" className="font-display text-xl font-bold tracking-tight text-ink">
                    What the interviewer would tell you
                  </h3>
                  <p className="text-sm text-muted" aria-live="polite">
                    You covered <strong className="text-ink">{covered}</strong> of {good.length}
                  </p>
                </div>
                <p className="text-sm text-ink/75">Tick the ones your notes already asked. The rest are worth remembering for next time.</p>
                <ul className="space-y-2.5">
                  {good.map(({ q, i }) => (
                    <li key={i} className="rounded-sm border-bw-1 border-ink/30 bg-surface px-4 py-3">
                      <label className="flex items-start gap-2.5 text-[15px] font-semibold leading-snug text-ink">
                        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-ink" checked={notes.covered.includes(i)} onChange={(e) => toggle(i, e.target.checked)} />
                        <span>{q.question}</span>
                      </label>
                      <div className="mt-1.5 pl-[26px] text-sm leading-relaxed text-ink/85">
                        <Markdown source={q.answer} />
                      </div>
                    </li>
                  ))}
                </ul>
                {weak.length > 0 && (
                  <details className="rounded-sm border-bw-1 border-ink/20 bg-surface px-4 py-2.5 text-sm">
                    <summary className="cursor-pointer font-semibold text-ink">Questions that matter less ({weak.length}), and why</summary>
                    <ul className="mt-2 space-y-2.5">
                      {weak.map((q, i) => (
                        <li key={i}>
                          <p className="font-semibold text-ink">{q.question}</p>
                          <div className="text-ink/80">
                            <Markdown source={q.answer} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <button type="button" onClick={onNext} className={primaryButton}>
                  Next: Estimate
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </section>
            )}
          </div>
        }
      />
    </div>
  );
}

/** Estimate: the facts and the full brief beside a worksheet whose rows are the problem's estimates, each checked against its range after you commit to it. */
export function EstimateStage({ problem, interview, notes, onNotes, onNext, phone }: { problem: Problem; interview?: Interview; notes: StageNotes; onNotes: Update; onNext: () => void; phone: boolean }) {
  const questions = interview?.estimates ?? [];
  const rows: WorksheetRow[] = notes.rows ?? questions.map((e, i) => ({ id: questionRowId(i), label: e.question, expression: '', unit: e.unit }));
  const done = Object.keys(notes.estimates).length >= questions.length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="stage-estimate">
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:items-start lg:py-10">
        <div className="space-y-4 lg:sticky lg:top-0">
          <StageHeading stage="estimate" eyebrow={stageEyebrow(3, 'Estimate')} title="Back-of-the-envelope numbers">
            Work each number out yourself and commit to it with Check. The accepted range and the worked answer show after.
          </StageHeading>
          <RequirementsCard items={factsOf(interview)} collapsible={phone} empty="Estimate from the brief." />
          <PinnedBrief title="Full brief, with scale" source={problem.statement} />
        </div>
        <div className="space-y-4">
          <Worksheet
            rows={rows}
            onChange={(next) => onNotes((n) => ({ ...n, rows: next }))}
            scoring={{ questions, answers: notes.estimates, onCheck: (index, value) => onNotes((n) => checkEstimate(n, index, questions[index], value)) }}
          />
          {done && (
            <button type="button" onClick={onNext} className={primaryButton}>
              Next: Design
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The next problem on the roadmap after this one is solved (or the next one not solved yet). */
function useNextOnRoadmap(problemId: string, progress: Progress): { id: string; title: string } | undefined {
  return useMemo(() => {
    const stages = roadmapFor(ROADMAP, problems.map((p) => p.id));
    const next = roadmapState(stages, { ...progress, [problemId]: { ...progress[problemId], status: 'solved' } }).next;
    return next && next.id !== problemId ? { id: next.id, title: problems.find((p) => p.id === next.id)?.title ?? next.id } : undefined;
  }, [problemId, progress]);
}

interface WrapupProps {
  problem: Problem;
  progress: Progress;
  solved: boolean;
  notes: StageNotes;
  onNotes: Update;
  /** The tests and the free design review (TestPanel), run from here. */
  tests: ReactNode;
}

/** Wrap-up: the tests and the review, a recall prompt, then where to go next. */
export function WrapupStage({ problem, progress, solved, notes, onNotes, tests }: WrapupProps) {
  const topics = useRelatedTopics(problem.id);
  const next = useNextOnRoadmap(problem.id, progress);
  const link = 'inline-flex items-center gap-1.5 font-semibold text-ink underline decoration-2 underline-offset-2 hover:decoration-pop-blue';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="stage-wrapup">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-10">
        <StageHeading stage="wrapup" eyebrow={stageEyebrow(5, 'Wrap-up')} title="Look back before you move on">
          Check the design against the tests and the review, then put what you learned into your own words.
        </StageHeading>

        <p role="status" className={`flex items-center gap-2 rounded-sm border-bw-1 border-ink px-4 py-2.5 text-sm font-semibold text-ink ${solved ? 'bg-pass/20' : 'bg-pop-yellow/20'}`} data-testid="wrapup-status">
          {solved ? <CircleCheck size={16} aria-hidden="true" /> : null}
          {solved ? 'Solved: every test passes.' : 'Not solved yet: run the tests. Passing them all marks the problem solved.'}
        </p>

        <section aria-label="Tests and review" className="h-[min(34rem,70dvh)] overflow-hidden rounded-sm border-bw-1 border-ink shadow-brutal-sm">
          {tests}
        </section>

        <section aria-labelledby="recall" className="space-y-3 rounded-sm border-bw-1 border-ink bg-surface p-4 shadow-brutal-sm sm:p-5">
          <h3 id="recall" className="font-display text-xl font-bold tracking-tight text-ink">
            Recall it
          </h3>
          <Notes
            label="Without looking back: what breaks first at 10× the traffic, and what would you change?"
            hint="Writing it down from memory is what makes it stick."
            value={notes.reflection}
            onChange={(reflection) => onNotes((n) => ({ ...n, reflection }))}
            placeholder="At 10× the reads, the … runs out first, because …"
            rows={4}
          />
        </section>

        <section aria-labelledby="keep-going" className="space-y-3">
          <h3 id="keep-going" className="font-display text-xl font-bold tracking-tight text-ink">
            Keep going
          </h3>
          {next && (
            <a href={roadmapHref(next.id)} className={solved ? primaryButton : outlineButton} data-testid="wrapup-next">
              <MapIcon size={15} aria-hidden="true" />
              Next on the roadmap: {next.title}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          )}
          <ul className="space-y-1.5 text-sm">
            {topics.map(({ topic, count }) => (
              <li key={topic.id}>
                <a href={`#/review/${topic.id}`} className={link}>
                  <Layers size={14} aria-hidden="true" />
                  Review {count === 1 ? 'the card' : `${count} cards`} on {topic.title}
                </a>
              </li>
            ))}
            {problem.interview !== undefined && (
              <li>
                <a href={setupHref(problem.id)} className={link}>
                  <Timer size={14} aria-hidden="true" />
                  Practice this as a mock interview, against the clock
                </a>
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
