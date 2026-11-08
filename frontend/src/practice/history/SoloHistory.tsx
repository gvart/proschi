import { useState } from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import problems from 'virtual:practice-listings';
import { outlineButton } from '../../components/Playground/ui';
import { loadHistory } from '../modes/store';
import { soloOnTime, soloSummaryCounts } from '../interview/record';
import { setupHref } from '../interview/links';
import { formatDay } from './api';

/**
 * "Interviews on your own" on the progress page (docs/design/paid-plans.md
 * P48): the sessions kept in this browser (modes/store.ts), newest first,
 * each with its date, problem and how it ended (or that it was too short to
 * count, record.ts), and a way to take it again.
 * Left out before the first one.
 */

const card = 'rounded-brutal border-bw-2 border-ink bg-surface shadow-brutal-sm';
const SHOWN = 8;

const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;

export default function SoloHistory() {
  const [sessions] = useState(() => [...loadHistory()].sort((a, b) => b.startedAt - a.startedAt));
  const [all, setAll] = useState(false);
  if (sessions.length === 0) return null;
  const shown = all ? sessions : sessions.slice(0, SHOWN);
  return (
    <section aria-labelledby="solo-history" className="mt-6" data-testid="solo-history">
      <h3 id="solo-history" className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <Clock size={18} aria-hidden="true" />
        Interviews on your own
      </h3>
      <div className={`mt-2 overflow-hidden ${card}`}>
        <ul className="divide-y divide-ink/15">
          {shown.map((s) => {
            const counts = soloSummaryCounts(s);
            const onTime = counts && soloOnTime(s);
            const outcome = !counts ? 'Too short to count' : onTime ? 'Solved on time' : s.overtime ? 'Over time' : s.tests?.solved ? 'Solved' : 'Finished';
            return (
              <li key={`${s.problem}-${s.startedAt}`}>
                <a href={setupHref(s.problem, 'solo')} className="flex items-center gap-3 px-4 py-2.5 hover:bg-pop-yellow/25 focus-visible:outline-hidden focus-visible:bg-pop-yellow/25">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{titleOf(s.problem)}</span>
                    <span className="block text-xs tabular-nums text-muted">
                      {formatDay(s.startedAt)} · {s.durationMin} min{s.tests ? ` · ${s.tests.passed} of ${s.tests.total} checks` : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-sm border-bw-1 border-ink px-1.5 py-px text-xs font-bold text-ink ${onTime ? 'bg-pass/25' : s.overtime ? 'bg-fail/20' : 'bg-paper'}`}>{outcome}</span>
                  <span className="hidden text-sm font-semibold text-ink sm:inline">Again</span>
                  <ArrowRight size={14} className="shrink-0 text-ink" aria-hidden="true" />
                </a>
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
    </section>
  );
}
