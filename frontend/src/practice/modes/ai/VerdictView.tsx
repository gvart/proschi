import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Printer, Sparkles } from 'lucide-react';
import { eyebrow, toolButton } from '../../../components/Playground/ui';
import { SKILL_LABEL, SKILLS, type Hint, type Skill, type Verdict } from './api';
import { HINT_ICON, HINT_LABEL, HINT_STYLE } from './hints';
import listings from 'virtual:practice-listings';
import { PICK_PENDING_MS } from '../../history/api';
import { useFeature } from '../../../components/featureState';
import { NoNewPicks, Picking, PickList } from '../../history/NextForYou';
import { useRoadmapNext } from '../../history/useRoadmapNext';

const InterviewReport = lazy(() => import('./InterviewReport'));


export function CoachingCard({ hint }: { hint: Hint }) {
  const Icon = HINT_ICON[hint.kind];
  return (
    <aside aria-label={`Coaching: ${HINT_LABEL[hint.kind]}`} data-testid="coaching-card" className={`rounded-sm border-bw-1 border-ink px-3 py-2 text-sm text-ink ${HINT_STYLE[hint.kind]}`}>
      <p className={`${eyebrow} !text-ink inline-flex items-center gap-1`}>
        <Icon size={13} aria-hidden="true" />
        {HINT_LABEL[hint.kind]}
      </p>
      <p className="mt-0.5">{hint.text}</p>
    </aside>
  );
}

const problemTitle = (id: string) => listings.find((p) => p.id === id)?.title;

/**
 * The verdict: pass or fail, a score per skill, what went well and wrong, and
 * what to practise next, with the AI roadmap's picks made after it linked
 * (`picksFor`, the session's id; with the ai_roadmap feature only). The interview
 * room's result ends it with its `actions`; the progress page's history without them.
 * A Deep verdict (Max) says so; with interview_report (Max) the session's
 * printable report opens from it.
 */
export function VerdictView({ picksFor, endedAt, deep, verdict, actions }: { picksFor?: string; endedAt?: number; deep?: boolean; verdict: Verdict; /** What to do next (the interview room's result: a new interview, this problem again). */ actions?: ReactNode }) {
  // A verdict that just ended may still be getting its picks: they are asked for again a few times.
  const [wait] = useState(() => endedAt !== undefined && Date.now() - endedAt < PICK_PENDING_MS);
  const roadmap = useFeature('ai_roadmap');
  const picks = useRoadmapNext(roadmap.ok && !!picksFor, { interview: picksFor, wait });
  const report = useFeature('interview_report');
  const [printing, setPrinting] = useState(false);
  const closeReport = useCallback(() => setPrinting(false), []);
  return (
    <section aria-label="Interview verdict" className="px-4 py-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold text-ink">Interview verdict</h2>
        {deep && (
          <span data-testid="verdict-deep" className="inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink bg-pop-lilac/30 px-1.5 py-0.5 text-xs font-semibold text-ink">
            <Sparkles size={12} aria-hidden="true" />
            Deep verdict
          </span>
        )}
        {report.ok && picksFor && (
          <button type="button" onClick={() => setPrinting(true)} className={`ml-auto ${toolButton}`} data-testid="verdict-report" title="A printable report of this interview; save it as a PDF from the print dialog">
            <Printer size={14} aria-hidden="true" />
            Print report
          </button>
        )}
      </div>
      {printing && picksFor && (
        <Suspense fallback={null}>
          <InterviewReport id={picksFor} onClose={closeReport} />
        </Suspense>
      )}
      <p
        data-testid="verdict-result"
        className={`inline-flex items-center gap-2 rounded-sm border-bw-1 border-ink px-3 py-1.5 text-base font-bold ${verdict.passed ? 'bg-pass/20 text-ink' : 'bg-fail/20 text-ink'}`}
      >
        {verdict.passed ? <CircleCheck size={18} aria-hidden="true" /> : <CircleX size={18} aria-hidden="true" />}
        {verdict.passed ? 'Pass' : 'Not yet a pass'}
      </p>
      <table className="w-full text-sm">
        <caption className={`${eyebrow} text-left`}>Scores per skill, out of 5</caption>
        <tbody>
          {SKILLS.map((s) => (
            <tr key={s} className="border-b border-ink/15">
              <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                {SKILL_LABEL[s]}
              </th>
              <td className="py-1.5 w-full">
                <span className="flex items-center gap-2">
                  <span className="flex flex-1 gap-0.5" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className={`h-2.5 flex-1 rounded-[2px] border border-ink/60 ${n <= verdict.scores[s] ? (verdict.scores[s] >= 3 ? 'bg-pass' : 'bg-fail') : 'bg-transparent'}`} />
                    ))}
                  </span>
                  <span className="w-8 text-right font-mono tabular-nums">{verdict.scores[s]}/5</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NoteList title="What went well" notes={verdict.wentWell} empty="Nothing stood out yet." />
      <NoteList title="What went wrong" notes={verdict.wentWrong} empty="Nothing went wrong." />
      {verdict.nextSteps.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ink">Next steps</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
            {verdict.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
      {(picks.status === 'picking' || (picks.status === 'ready' && (picks.next || picks.missed))) && (
        <div className="space-y-2" data-testid="verdict-picks">
          <h3 className="text-sm font-semibold text-ink">Practise them here</h3>
          {picks.status !== 'ready' ? <Picking /> : picks.next ? <PickList picks={picks.next.picks} problemTitle={problemTitle} /> : <NoNewPicks />}
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

function NoteList({ title, notes, empty }: { title: string; notes: { skill: Skill; text: string }[]; empty: string }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {notes.length ? (
        <ul className="space-y-1.5 text-sm text-ink">
          {notes.map((n, i) => (
            <li key={i} className="rounded-sm border-bw-1 border-ink/30 bg-paper px-3 py-1.5">
              <span className={`${eyebrow} mr-1`}>{SKILL_LABEL[n.skill]}</span> {n.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}
