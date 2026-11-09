import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { SKILL_LABEL, type Skill } from './api';
import './report.css';

/**
 * A printable interview report's frame (feature `interview_report`, Max; P31,
 * P53): a toolbar to print or close it over a sheet of paper, which holds
 * `children`. Print or "Save as PDF" is the browser's (window.print());
 * report.css hides the rest of the page in print, and `.ps-light` keeps the
 * sheet light in both themes. Escape closes it.
 */
export function ReportFrame({ ready, onClose, children }: { /** The sheet is filled in: printing is offered. */ ready: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add('printing-report');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('printing-report');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Interview report" className="interview-report ps-light fixed inset-0 z-[100] overflow-y-auto">
      <div className="report-toolbar sticky top-0 z-10 flex items-center gap-2 border-b-bw-1 border-ink bg-surface px-4 py-2">
        <p className="mr-auto text-sm font-semibold text-ink">Interview report</p>
        <button type="button" onClick={() => window.print()} disabled={!ready} className="inline-flex items-center gap-1.5 rounded-sm border-bw-1 border-ink bg-pop-yellow px-3 py-1.5 text-sm font-semibold text-on-accent shadow-brutal-sm disabled:opacity-50">
          <Printer size={14} aria-hidden="true" />
          Print or save as PDF
        </button>
        <button type="button" onClick={onClose} aria-label="Close the report" className="inline-flex items-center gap-1 rounded-sm border-bw-1 border-ink/40 px-2 py-1.5 text-sm font-semibold text-ink hover:border-ink">
          <X size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>
      <article className="report-sheet mx-auto my-6 bg-white text-ink">{children}</article>
    </div>,
    document.body,
  );
}

/** The score per skill out of 5, as bars. */
export function ReportScores<S extends Skill>({ skills, scores }: { skills: readonly S[]; scores: Record<S, number> }) {
  return (
    <table className="mt-2 w-full text-sm">
      <tbody>
        {skills.map((s) => (
          <tr key={s} className="border-b border-ink/15 align-top">
            <th scope="row" className="w-32 py-2 pr-3 text-left font-semibold">
              {SKILL_LABEL[s]}
            </th>
            <td className="py-2">
              <span className="flex items-center gap-2">
                <span className="flex flex-1 gap-0.5" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`h-2.5 flex-1 rounded-[2px] border border-ink/60 ${n <= scores[s] ? (scores[s] >= 3 ? 'bg-pass' : 'bg-fail') : ''}`} />
                  ))}
                </span>
                <span className="w-8 text-right font-mono tabular-nums">{scores[s]}/5</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
