import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { Dices, Printer, RotateCcw } from 'lucide-react';
import { eyebrow, outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { useFeature } from '../../components/featureState';
import { fromSummary } from '../history/solo';
import { VerdictView } from '../modes/ai/VerdictView';
import type { AiInterview } from '../modes/ai/api';
import { PHASES, formatClock, type InterviewSummary } from '../modes/session';
import type { Problem } from '../types';
import { StepTrail } from './Setup';
import { setupHref } from './links';

const SoloReport = lazy(() => import('../history/SoloReport'));

/**
 * Step 3 of the mock interview (P45): the verdict of a mock interview, or the
 * summary of one on your own, then what to do next: a new interview (a new
 * random problem) or this problem again. Below it, the progress the
 * interview made (`progress`, ResultProgress.tsx).
 */

type ResultProps = { problem: Problem; progress?: ReactNode } & ({ kind: 'mock'; interview: AiInterview } | { kind: 'solo'; summary: InterviewSummary });

export default function Result(props: ResultProps) {
  const { problem } = props;
  const actions = (
    <div className="flex flex-wrap gap-2 pt-2" data-testid="result-actions">
      <a href={setupHref()} className={`${primaryButton} !py-2 text-base`}>
        <Dices size={16} aria-hidden="true" />
        New interview
      </a>
      <a href={setupHref(problem.id, props.kind)} className={`${outlineButton} !py-2 text-base`}>
        <RotateCcw size={16} aria-hidden="true" />
        Try this problem again
      </a>
    </div>
  );
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:pt-10" data-testid="interview-result">
      <StepTrail at={2} />
      <p className={`${eyebrow} mt-6`}>{props.kind === 'mock' ? 'Mock interview' : 'On your own'}</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{problem.title}</h1>
      <div className="mt-6 rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md">
        {props.kind === 'mock' && props.interview.verdict ? (
          <VerdictView picksFor={props.interview.id} endedAt={props.interview.endedAt} deep={props.interview.deep} verdict={props.interview.verdict} actions={actions} />
        ) : props.kind === 'solo' ? (
          <Summary summary={props.summary}>{actions}</Summary>
        ) : (
          <div className="space-y-3 px-4 py-4">
            <p className="text-sm text-ink">This interview ended without a verdict.</p>
            {actions}
          </div>
        )}
      </div>
      {props.progress}
    </main>
  );
}

/** An interview on your own: the time per phase, the questions, estimates, checks and self-review; with interview_report (Max), its printable report. */
function Summary({ summary, children }: { summary: InterviewSummary; children: ReactNode }) {
  const { questions, estimates, tests, checklist } = summary;
  const report = useFeature('interview_report');
  const [printing, setPrinting] = useState(false);
  const closeReport = useCallback(() => setPrinting(false), []);
  const record = fromSummary(summary);
  const printable = record.results ? { ...record, results: record.results } : undefined;
  const rows: [string, ReactNode][] = [
    ['Questions', `${questions.asked} asked: ${questions.good} good (of ${questions.goodTotal}), ${questions.weak} weak`],
    ['Estimates', `${estimates.correct} of ${estimates.total} in range${estimates.answered < estimates.total ? `, ${estimates.total - estimates.answered} not answered` : ''}`],
    ['Checks', tests ? `${tests.passed} of ${tests.total} pass${tests.solved ? ', solved' : ''}` : 'not run'],
    ['Self-review', `${checklist.checked} of ${checklist.total} ticked`],
  ];
  return (
    <section aria-label="Interview summary" className="space-y-5 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Interview summary</h2>
        {report.ok && printable && (
          <button type="button" onClick={() => setPrinting(true)} className={`ml-auto ${toolButton}`} data-testid="summary-report" title="A printable report of this interview; save it as a PDF from the print dialog">
            <Printer size={14} aria-hidden="true" />
            Print report
          </button>
        )}
      </div>
      {printing && printable && (
        <Suspense fallback={null}>
          <SoloReport record={printable} onClose={closeReport} />
        </Suspense>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <table className="w-full text-sm">
          <caption className={`${eyebrow} pb-1 text-left`}>Time per phase</caption>
          <tbody>
            {PHASES.map((p) => (
              <tr key={p.id} className="border-b border-ink/15">
                <th scope="row" className="py-1.5 text-left font-normal text-ink">
                  {p.label}
                </th>
                <td className="py-1.5 text-right font-mono tabular-nums">{formatClock(summary.phases[p.id])}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-1.5 text-left font-semibold text-ink">
                Total
              </th>
              <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${summary.overtime ? 'text-red-700 dark:text-red-300' : ''}`}>
                {formatClock(summary.totalMs)} / {summary.durationMin}:00
              </td>
            </tr>
          </tbody>
        </table>
        <dl className="space-y-1.5 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="border-b border-ink/15 pb-1.5">
              <dt className="font-semibold text-ink">{term}</dt>
              <dd className="text-ink/80">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
    </section>
  );
}
