import listings from 'virtual:practice-listings';
import { SOLO_PHASES, SOLO_SKILLS, soloScores, type SoloResults } from '../../learn/soloInterview';
import { ReportFrame, ReportScores } from '../modes/ai/ReportFrame';
import { formatClock, PHASES } from '../modes/session';
import { soloOutcome, soloRecordOnTime, type SoloRecord } from './solo';

/**
 * The printable report of an interview on your own (feature
 * `interview_report`, Max; docs/design/paid-plans.md P53): the problem, the
 * date and length, how it ended, the score per skill read from what was done
 * (soloInterview.ts soloScores), what was done and the time per phase, on the
 * same sheet as the AI interview's report (ReportFrame). Made in the browser
 * from the session, so it asks the server for nothing.
 */

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const title = (id: string) => listings.find((p) => p.id === id)?.title ?? id;

export default function SoloReport({ record, onClose }: { record: SoloRecord & { results: SoloResults }; onClose: () => void }) {
  const { results } = record;
  const { questions, estimates, tests, checklist } = results;
  const done = soloRecordOnTime(record);
  const rows: [string, string][] = [
    ['Questions', `${questions.asked} asked: ${questions.good} good (of ${questions.goodTotal}), ${questions.weak} weak`],
    ['Estimates', `${estimates.correct} of ${estimates.total} in range${estimates.answered < estimates.total ? `, ${estimates.total - estimates.answered} not answered` : ''}`],
    ['Checks', tests ? `${tests.passed} of ${tests.total} pass${record.solved ? ', solved' : ''}` : 'not run'],
    ['Self-review', `${checklist.checked} of ${checklist.total} ticked`],
  ];
  const label = (id: (typeof SOLO_PHASES)[number]) => PHASES.find((p) => p.id === id)?.label ?? id;
  return (
    <ReportFrame ready onClose={onClose}>
      <header className="report-head flex flex-wrap items-start gap-x-6 gap-y-3 border-b-bw-2 border-ink pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Proschi · Interview on your own</p>
          <h1 className="mt-1 font-display text-2xl font-bold leading-tight">{title(record.problem)}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <div className="flex gap-1">
              <dt className="text-muted">Date</dt>
              <dd>
                {day(record.startedAt)}, {time(record.startedAt)}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted">Length</dt>
              <dd>
                {record.durationMin} min planned, {Math.max(1, Math.round(record.totalMs / 60_000))} min used
              </dd>
            </div>
          </dl>
        </div>
        <p data-testid="report-result" className={`inline-flex shrink-0 items-center rounded-sm border-bw-2 border-ink px-3 py-1.5 text-lg font-bold ${done ? 'bg-pass/25' : record.overtime ? 'bg-fail/20' : 'bg-paper'}`}>
          {soloOutcome(record)}
        </p>
      </header>

      <section className="report-block mt-5">
        <h2 className="report-h2">Scores per skill, out of 5</h2>
        <p className="mt-1 text-xs text-muted">Read from what you did: the good questions asked, the estimates in range, the checks passing and the self-review ticked. Communication needs an interviewer.</p>
        <ReportScores skills={SOLO_SKILLS} scores={soloScores(results)} />
      </section>

      <div className="report-block mt-5 grid gap-5 sm:grid-cols-2">
        <section>
          <h2 className="report-h2">What you did</h2>
          <dl className="mt-2 space-y-1.5 text-sm" data-testid="report-done">
            {rows.map(([term, value]) => (
              <div key={term} className="border-b border-ink/15 pb-1.5">
                <dt className="font-semibold">{term}</dt>
                <dd className="text-ink/80">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2 className="report-h2">Time per phase</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {SOLO_PHASES.map((p) => (
                <tr key={p} className="border-b border-ink/15">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {label(p)}
                  </th>
                  <td className="py-1.5 text-right font-mono tabular-nums">{formatClock(results.phases[p])}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-1.5 text-left font-semibold">
                  Total
                </th>
                <td className="py-1.5 text-right font-mono font-semibold tabular-nums">
                  {formatClock(record.totalMs)} / {record.durationMin}:00
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer className="mt-8 border-t border-ink/20 pt-2 text-xs text-muted">Written for you by proschi.app from your interview on your own on {day(record.startedAt)}.</footer>
    </ReportFrame>
  );
}
