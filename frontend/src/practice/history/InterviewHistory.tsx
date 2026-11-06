import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, CircleX, History as HistoryIcon, Sparkles } from 'lucide-react';
import problems from 'virtual:practice-listings';
import { eyebrow, outlineButton } from '../../components/Playground/ui';
import PaneLoading from '../../components/PaneLoading';
import { billingEnabled, pricingHref } from '../../services/billing';
import { getInterview, type AiInterview } from '../modes/ai/api';
import { VerdictView } from '../modes/ai/AiInterviewPanel';
import { formatDay, getHistory, verdictHref, type History, type HistorySession } from './api';
import SkillTrends from './SkillTrends';

/**
 * "Interview history" on the progress page (docs/design/paid-plans.md P1,
 * P8): the AI interviews' verdicts, each linking to its verdict
 * (`#/progress/interview/<id>`), and the score per skill over time. Pro sees
 * every session and the trends; other plans see the latest verdict, with the
 * way to Pro where paid plans are on. Without the AI on the server (501) the
 * section is left out.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-md';
const SHOWN = 8;

const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;

function Result({ passed }: { passed: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink px-1.5 py-px text-xs font-bold text-ink ${passed ? 'bg-pass/25' : 'bg-fail/20'}`}>
      {passed ? <CircleCheck size={12} aria-hidden="true" /> : <CircleX size={12} aria-hidden="true" />}
      {passed ? 'Pass' : 'Not yet'}
    </span>
  );
}

function SessionRow({ s }: { s: HistorySession }) {
  return (
    <li>
      <a href={verdictHref(s.id)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:bg-pop-yellow/25">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{titleOf(s.problem)}</span>
          <span className="block text-xs tabular-nums text-muted">
            {formatDay(s.startedAt)} · {s.minutes} min
          </span>
        </span>
        <Result passed={s.passed} />
        <span className="hidden text-sm font-semibold text-ink sm:inline">Verdict</span>
        <ArrowRight size={14} className="shrink-0 text-ink" aria-hidden="true" />
      </a>
    </li>
  );
}

export default function InterviewHistory() {
  const [history, setHistory] = useState<History | null>();
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    void getHistory().then((a) => live && setHistory(a.status === 'ok' ? a.data : null));
    return () => {
      live = false;
    };
  }, []);
  // Loading, or no AI interviews on this server.
  if (!history) return null;

  const { sessions, full, total } = history;
  const shown = all ? sessions : sessions.slice(0, SHOWN);
  const earlier = total - sessions.length;
  return (
    <section aria-labelledby="interview-history" className="mt-10" data-testid="interview-history">
      <h2 id="interview-history" className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink">
        <HistoryIcon size={22} aria-hidden="true" />
        Interview history
      </h2>
      {total === 0 ? (
        <p className={`mt-3 p-4 text-sm text-ink/80 ${card}`}>No AI interviews yet. Start one from any problem with Interview mode, then its verdict and scores show up here.</p>
      ) : (
        <>
          {full && sessions.length > 0 && (
            <div className={`mt-3 p-4 sm:p-5 ${card}`}>
              <h3 className={eyebrow}>Score per skill over time</h3>
              <div className="mt-3">
                <SkillTrends sessions={sessions} problemTitle={titleOf} />
              </div>
            </div>
          )}
          <div className={`mt-3 overflow-hidden ${card}`}>
            {!full && <h3 className={`px-4 pt-3 ${eyebrow}`}>Your latest interview</h3>}
            <ul className="divide-y divide-ink/15" data-testid="history-list">
              {shown.map((s) => (
                <SessionRow key={s.id} s={s} />
              ))}
            </ul>
            {full && sessions.length > SHOWN && !all && (
              <div className="border-t border-ink/15 px-4 py-2.5">
                <button type="button" onClick={() => setAll(true)} className={outlineButton}>
                  Show all {sessions.length}
                </button>
              </div>
            )}
          </div>
          {!full && billingEnabled && (
            <p className="mt-3 text-sm text-ink/80" data-testid="history-upgrade">
              <Sparkles size={14} className="mr-1 inline-block -mt-0.5 text-ink" aria-hidden="true" />
              {earlier > 0 ? `${earlier} earlier ${earlier === 1 ? 'interview is' : 'interviews are'} kept. ` : ''}Pro shows every verdict and how each skill trends.{' '}
              <a href={pricingHref('../')} className="font-semibold text-ink underline decoration-pop-yellow decoration-2 underline-offset-2 hover:decoration-ink">
                Upgrade to Pro
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** `#/progress/interview/<id>`: one past session's verdict, with the picks made after it (Pro). */
export function InterviewVerdictPage({ id, pro }: { id: string; pro: boolean }) {
  const [interview, setInterview] = useState<AiInterview | null>();
  useEffect(() => {
    let live = true;
    getInterview(id).then(
      (r) => live && setInterview(r.interview),
      () => live && setInterview(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => {
    document.title = 'Interview verdict · Proschi practice';
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 pt-6 pb-8 sm:pb-14">
      <a href="#/progress" className="inline-flex items-center gap-1 text-sm font-semibold text-ink hover:underline">
        <ArrowLeft size={14} aria-hidden="true" />
        Your progress
      </a>
      {interview === undefined ? (
        <PaneLoading label="Loading the verdict…" />
      ) : interview?.verdict ? (
        <>
          <h1 className="mt-3 font-display text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold leading-[1.1] text-ink">{titleOf(interview.problem)}</h1>
          <p className="mt-1 text-sm tabular-nums text-muted">
            AI interview · {formatDay(interview.startedAt)} · {interview.minutes} min
          </p>
          <div className={`mt-4 ${card}`}>
            <VerdictView picksFor={pro ? interview.id : undefined} verdict={interview.verdict} />
          </div>
          <a href={`#/${interview.problem}`} className={`mt-4 ${outlineButton}`}>
            Open the problem
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </>
      ) : (
        <p role="alert" className={`mt-4 p-4 text-sm text-ink ${card}`}>
          This verdict could not be loaded.
        </p>
      )}
    </main>
  );
}
