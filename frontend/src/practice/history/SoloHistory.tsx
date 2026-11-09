import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock, Printer, Sparkles } from 'lucide-react';
import problems from 'virtual:practice-listings';
import { eyebrow, outlineButton, toolButton } from '../../components/Playground/ui';
import { Feature } from '../../components/Feature';
import { useFeature } from '../../components/featureState';
import UpgradeHint from '../../components/UpgradeHint';
import { SOLO_SKILLS, type SoloResults } from '../../learn/soloInterview';
import { loadHistory } from '../modes/store';
import { setupHref } from '../interview/links';
import { formatDay, getSoloHistory, type KeptSolo } from './api';
import SkillTrends from './SkillTrends';
import { mergeSolo, soloKey, soloOutcome, soloRecordOnTime, soloTrend, type SoloRecord } from './solo';

const SoloReport = lazy(() => import('./SoloReport'));

/**
 * "Interviews on your own" on the progress page (docs/design/paid-plans.md
 * P48, P53): the sessions kept in this browser (modes/store.ts), newest
 * first, each with its date, problem and how it ended (or that it was too
 * short to count, record.ts), and a way to take it again. With
 * interview_history (Pro) the account's sessions from every device join
 * them, with the score per skill over time read from what each did
 * (SkillTrends); with interview_report (Max) each opens as a printable
 * report. Left out before the first one.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-sm';
const SHOWN = 8;

const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;

export default function SoloHistory() {
  const [local] = useState(loadHistory);
  const history = useFeature('interview_history');
  const report = useFeature('interview_report');
  const [kept, setKept] = useState<KeptSolo[]>();
  const [all, setAll] = useState(false);
  const [printing, setPrinting] = useState<SoloRecord & { results: SoloResults }>();
  const closeReport = useCallback(() => setPrinting(undefined), []);
  useEffect(() => {
    if (!history.ok) return;
    let live = true;
    void getSoloHistory().then((a) => live && setKept(a.status === 'ok' ? a.data.sessions : []));
    return () => {
      live = false;
    };
  }, [history.ok]);
  const sessions = useMemo(() => mergeSolo(local, kept), [local, kept]);
  const trend = useMemo(() => (history.ok ? soloTrend(sessions) : []), [history.ok, sessions]);
  if (sessions.length === 0) return null;
  const shown = all ? sessions : sessions.slice(0, SHOWN);
  return (
    <section aria-labelledby="solo-history" className="mt-6" data-testid="solo-history">
      <h3 id="solo-history" className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <Clock size={18} aria-hidden="true" />
        Interviews on your own
      </h3>
      {trend.length > 0 && (
        <div className={`mt-2 p-4 sm:p-5 ${card}`} data-testid="solo-trends">
          <h4 className={eyebrow}>Score per skill over time</h4>
          <p className="mt-1 text-xs text-muted">Read from what you did: good questions asked, estimates in range, checks passing and self-review ticked.</p>
          <div className="mt-3">
            <SkillTrends sessions={trend} problemTitle={titleOf} skills={SOLO_SKILLS} />
          </div>
        </div>
      )}
      <div className={`mt-2 overflow-hidden ${card}`}>
        <ul className="divide-y divide-ink/15" data-testid="solo-list">
          {shown.map((s) => {
            const onTime = s.counts && soloRecordOnTime(s);
            const tests = s.results?.tests;
            const withResults = s.results ? { ...s, results: s.results } : undefined;
            return (
              <li key={soloKey(s)} className="flex items-center">
                <a href={setupHref(s.problem, 'solo')} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:bg-pop-yellow/25">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{titleOf(s.problem)}</span>
                    <span className="block text-xs tabular-nums text-muted">
                      {formatDay(s.startedAt)} · {s.durationMin} min{tests ? ` · ${tests.passed} of ${tests.total} checks` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-sm border-bw-1 border-ink px-1.5 py-px text-xs font-bold text-ink ${onTime ? 'bg-pass/25' : s.overtime ? 'bg-fail/20' : 'bg-paper'}`}>{soloOutcome(s)}</span>
                  <span className="hidden text-sm font-semibold text-ink sm:inline">Again</span>
                  <ArrowRight size={14} className="shrink-0 text-ink" aria-hidden="true" />
                </a>
                {report.ok && withResults && (
                  <button
                    type="button"
                    onClick={() => setPrinting(withResults)}
                    className={`mr-3 shrink-0 ${toolButton}`}
                    aria-label={`Print the report of ${titleOf(s.problem)}, ${formatDay(s.startedAt)}`}
                    title="A printable report of this interview; save it as a PDF from the print dialog"
                    data-testid="solo-report"
                  >
                    <Printer size={14} aria-hidden="true" />
                    <span className="hidden sm:inline">Report</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {sessions.length > SHOWN && !all && (
          <div className="border-t border-ink/15 px-4 py-2.5">
            <button type="button" onClick={() => setAll(true)} className={outlineButton}>
              Show all {sessions.length}
            </button>
          </div>
        )}
      </div>
      <Feature
        name="interview_history"
        hint={<UpgradeHint icon={false} className="font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink" />}
        free={(hint) =>
          hint && (
            <p className="mt-3 text-sm text-ink/80" data-testid="solo-upgrade">
              <Sparkles size={14} className="mr-1 inline-block -mt-0.5 text-ink" aria-hidden="true" />
              Pro shows how each skill trends across these, from every device. {hint}
            </p>
          )
        }
      />
      {printing && (
        <Suspense fallback={null}>
          <SoloReport record={printing} onClose={closeReport} />
        </Suspense>
      )}
    </section>
  );
}
