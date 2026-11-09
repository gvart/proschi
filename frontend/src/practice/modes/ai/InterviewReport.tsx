import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, Sparkles } from 'lucide-react';
import listings from 'virtual:practice-listings';
import DiagramCanvas from '../../../components/Diagram/DiagramCanvas';
import { useDiagramLayout } from '../../../components/Diagram/useDiagramLayout';
import type { Diagram } from '../../../dsl';
import { loadProblem } from '../../loadProblem';
import { parseSolution } from '../../workspace';
import { getReport, SKILL_LABEL, SKILLS, type InterviewReport as Report, type Skill } from './api';
import { ReportFrame, ReportScores } from './ReportFrame';

/**
 * The printable report of a finished mock interview (feature
 * `interview_report`, Max; docs/design/paid-plans.md P31): the problem, the
 * date and length, pass or fail, the score and notes per skill, the last
 * design sent with its test results, laid out as a sheet of paper in
 * ReportFrame (print or "Save as PDF" is the browser's).
 */

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const title = (id: string) => listings.find((p) => p.id === id)?.title ?? id;

export default function InterviewReport({ id, onClose }: { id: string; onClose: () => void }) {
  const [report, setReport] = useState<Report>();
  const [failed, setFailed] = useState<string>();
  const [diagram, setDiagram] = useState<Diagram>();

  useEffect(() => {
    let live = true;
    getReport(id).then(
      ({ report }) => {
        if (!live) return;
        setReport(report);
        if (report.design) {
          const source = report.design.source;
          void loadProblem(report.problem).then((problem) => live && problem && setDiagram(parseSolution(problem, source).diagram));
        }
      },
      (e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <ReportFrame ready={!!report} onClose={onClose}>
      {failed ? (
        <p role="alert" className="text-sm">
          The report could not be loaded ({failed}).
        </p>
      ) : !report ? (
        <p className="text-sm text-muted">Loading the report…</p>
      ) : (
        <Sheet report={report} diagram={diagram} />
      )}
    </ReportFrame>
  );
}

function Sheet({ report, diagram }: { report: Report; diagram?: Diagram }) {
  const { verdict } = report;
  const used = report.endedAt !== undefined ? Math.max(1, Math.round((report.endedAt - report.startedAt) / 60_000)) : undefined;
  const grade = report.design?.grade;
  return (
    <>
      <header className="report-head flex flex-wrap items-start gap-x-6 gap-y-3 border-b-bw-2 border-ink pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Proschi · Mock interview report</p>
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight">{title(report.problem)}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1">
              <dt className="text-muted">Date</dt>
              <dd>
                {day(report.startedAt)}, {time(report.startedAt)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted">Length</dt>
              <dd>
                {report.minutes} min planned{used !== undefined ? `, ${used} min used` : ''}
              </dd>
            </div>
            {report.deep && (
              <div className="flex gap-1">
                <dt className="sr-only">Verdict</dt>
                <dd data-testid="report-deep" className="inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink px-1.5 text-xs font-semibold">
                  <Sparkles size={11} aria-hidden="true" />
                  Deep verdict
                </dd>
              </div>
            )}
          </dl>
        </div>
        <p data-testid="report-result" className={`inline-flex shrink-0 items-center gap-2 rounded-sm border-bw-2 border-ink px-3 py-1.5 text-lg font-bold ${verdict.passed ? 'bg-pass/25' : 'bg-fail/20'}`}>
          {verdict.passed ? <CircleCheck size={20} aria-hidden="true" /> : <CircleX size={20} aria-hidden="true" />}
          {verdict.passed ? 'Pass' : 'Not yet a pass'}
        </p>
      </header>

      <section className="report-block mt-5">
        <h2 className="report-h2">Scores per skill, out of 5</h2>
        <ReportScores skills={SKILLS} scores={verdict.scores} />
      </section>

      <div className="report-block mt-5 grid gap-5 sm:grid-cols-2">
        <Notes title="What went well" notes={verdict.wentWell} empty="Nothing stood out yet." />
        <Notes title="What went wrong" notes={verdict.wentWrong} empty="Nothing went wrong." />
      </div>

      {verdict.nextSteps.length > 0 && (
        <section className="report-block mt-5">
          <h2 className="report-h2">Next steps</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {verdict.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="report-block report-design mt-6">
        <h2 className="report-h2">Final design</h2>
        {!report.design ? (
          <p className="mt-2 text-sm text-muted">No design to show: none was sent, or the interview is past the 90 days its details are kept.</p>
        ) : (
          <>
            <div data-testid="report-diagram" className="report-diagram mt-2 rounded-sm border-bw-1 border-ink/40">
              {diagram ? <StaticDiagram diagram={diagram} /> : <p className="p-4 text-sm text-muted">Drawing the design…</p>}
            </div>
            {grade && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">
                  Tests: <span className="tabular-nums">{grade.passed}</span> of <span className="tabular-nums">{grade.total}</span> passed
                  {grade.solved ? ' (solved)' : ''}
                </h3>
                {grade.blocked === 'errors' && grade.errors.length > 0 && (
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-ink/85">
                    {grade.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                {grade.results.length > 0 && (
                  <ul data-testid="report-tests" className="mt-2 space-y-1 text-sm">
                    {grade.results.map((r) => (
                      <li key={r.id} className="flex items-start gap-2">
                        {r.passed ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-pass" aria-label="Passed" /> : <CircleX size={15} className="mt-0.5 shrink-0 text-fail" aria-label="Failed" />}
                        <span>
                          <span className="font-semibold">{r.name}</span> <span className="text-ink/75">{r.message}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <footer className="mt-8 border-t border-ink/20 pt-2 text-xs text-muted">Written for you by proschi.app from your mock interview on {day(report.startedAt)}.</footer>
    </>
  );
}

function Notes({ title, notes, empty }: { title: string; notes: { skill: Skill; text: string }[]; empty: string }) {
  return (
    <section>
      <h2 className="report-h2">{title}</h2>
      {notes.length ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {notes.map((n, i) => (
            <li key={i} className="rounded-sm border-bw-1 border-ink/25 px-3 py-1.5">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted">{SKILL_LABEL[n.skill]}</span> {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

/** The design as the editor draws it, fitted and still: no controls, nothing to drag. */
function StaticDiagram({ diagram }: { diagram: Diagram }) {
  const { nodes, edges, settled } = useDiagramLayout(diagram);
  return <DiagramCanvas nodes={nodes} edges={edges} fitKey={String(settled)} compact still legend={diagram.legend} />;
}
