import { AlertCircle, AlertTriangle, CheckCircle2, FlaskConical, PartyPopper, Play, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { celebrate } from '../design/celebrate';
import { primaryButton, subBar } from '../components/Playground/ui';
import type { Diagnostic, SourceLoc } from '../dsl';
import type { RunResult } from './workspace';

interface TestPanelProps {
  /** The last run, or undefined before the first. */
  run?: RunResult;
  /** The source changed since the last run. */
  stale: boolean;
  diagnostics: Diagnostic[];
  onRun: () => void;
  /** Jumps to a line of the solution. */
  onSelect: (loc: SourceLoc) => void;
  /** How others did on this problem (CommunityStats), shown under the verdict. */
  community?: ReactNode;
  /** The AI review (src/review/ReviewPanel.tsx), shown in a view of its own next to the tests. */
  review?: ReactNode;
}

const viewButton = (on: boolean) =>
  `inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-sm font-bold border-bw-1 ${on ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink/75 hover:border-ink hover:text-ink'}`;

/** Run tests, then every requirement and test with what was measured and how to fix it. */
export default function TestPanel({ run, stale, diagnostics, onRun, onSelect, community, review }: TestPanelProps) {
  const [view, setView] = useState<'tests' | 'review'>('tests');
  // A new run brings the tests back into view.
  const [shownRun, setShownRun] = useState(run);
  if (run !== shownRun) {
    setShownRun(run);
    setView('tests');
  }
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  // The first solve on this page gets a little burst (skipped under reduced motion).
  const solvedRef = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  const solved = !!run?.solved;
  useEffect(() => {
    if (!solved || celebrated.current || !solvedRef.current) return;
    celebrated.current = true;
    void celebrate(solvedRef.current);
  }, [solved]);
  return (
    <div className="h-full flex flex-col bg-surface">
      <div className={`flex items-center gap-2 px-3 py-2 ${subBar}`}>
        {review ? (
          <>
            <button onClick={() => setView('tests')} aria-pressed={view === 'tests'} className={viewButton(view === 'tests')}>
              <FlaskConical size={14} />
              Tests
            </button>
            <button onClick={() => setView('review')} aria-pressed={view === 'review'} className={viewButton(view === 'review')}>
              <Sparkles size={14} />
              AI review
            </button>
          </>
        ) : (
          <>
            <FlaskConical size={16} className="text-muted" />
            <span className="text-sm font-bold text-ink">Tests</span>
          </>
        )}
        {run && !run.blocked && (
          <span className={`text-sm tabular-nums ${run.solved ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-ink/75'}`}>
            {run.passed} / {run.results.length} passed{stale ? ' · edited since' : ''}
          </span>
        )}
        <button
          onClick={onRun}
          data-tour="run"
          className={`ml-auto ${primaryButton}`}
        >
          <Play size={14} />
          Run tests
        </button>
      </div>

      {/* Kept mounted, so switching views keeps the review. */}
      {review && <div className={`flex-1 min-h-0 overflow-y-auto ${view === 'review' ? '' : 'hidden'}`}>{review}</div>}
      <div className={`flex-1 min-h-0 overflow-y-auto text-sm ${review && view === 'review' ? 'hidden' : ''}`}>
        {!run && <p className="px-3 py-4 text-muted">Run the tests to check your design against the problem’s requirements.</p>}

        {run?.blocked === 'no-engine' && (
          <p className="m-3 rounded border-bw-1 border-ink bg-pop-yellow/25 px-3 py-2 text-ink">
            The simulation is not available yet, so tests cannot run. You can still design and play your use cases.
          </p>
        )}
        {run?.blocked === 'errors' && (
          <p className="m-3 rounded border-bw-1 border-fail bg-fail/10 px-3 py-2 text-ink">
            Fix the {errors} error{errors === 1 ? '' : 's'} listed below first; tests run on a document without errors.
          </p>
        )}

        {run?.solved && (
          <div ref={solvedRef} role="status" className="m-3 flex items-center gap-2 rounded border-bw-2 border-ink bg-pass px-3 py-2 text-on-accent shadow-brutal-sm">
            <PartyPopper size={18} />
            <span>
              <strong>Solved.</strong> Every requirement and test passes. Compare with the reference solution, or try a harder problem.
            </span>
          </div>
        )}
        {community}

        {run && run.results.length > 0 && (
          <p className="px-3 pt-2 text-xs text-muted">
            Verdicts come from a deterministic model of your design, not a load test.{' '}
            <a href="../docs/model/#practice" target="_blank" rel="noopener" className="text-pop-blue hover:underline">
              How is this calculated?
            </a>
          </p>
        )}
        {run && run.results.length > 0 && (
          <ul className="divide-y divide-ink/10">
            {run.results.map((r) => (
              <li key={r.id} className={`flex gap-2 px-3 py-2 ${r.passed ? '' : 'shadow-[inset_4px_0_0_rgb(var(--c-fail))]'}`}>
                {r.passed ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" /> : <XCircle size={16} className="mt-0.5 flex-shrink-0 text-red-600 dark:text-red-400" />}
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {r.name} <span className="ml-1 font-mono text-[11px] font-normal uppercase tracking-wide text-muted">{r.category}</span>
                  </p>
                  <p className="text-ink/75">{r.message}</p>
                  {!r.passed && r.hint && <p className="text-xs text-muted">Fix: {r.hint}</p>}
                  {r.assertions && r.assertions.length > 1 && (
                    <ul className="mt-1 space-y-0.5">
                      {r.assertions.map((a, i) => (
                        <li key={i} className="flex gap-1.5 text-xs">
                          {a.passed ? <CheckCircle2 size={13} className="mt-px flex-shrink-0 text-green-600 dark:text-green-400" /> : <XCircle size={13} className="mt-px flex-shrink-0 text-red-600 dark:text-red-400" />}
                          <span>
                            <span className={a.passed ? 'text-ink/75' : 'text-ink'}>{a.message}</span>
                            {!a.passed && a.hint && <span className="block text-muted">Fix: {a.hint}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {diagnostics.length > 0 && (
          <ul className="border-t border-ink/10 bg-paper text-xs">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button onClick={() => onSelect(d)} className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-ink/10">
                  {d.severity === 'error' ? (
                    <AlertCircle size={14} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-px" />
                  ) : (
                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-px" />
                  )}
                  <span className="text-muted tabular-nums flex-shrink-0">
                    {d.file ? `${d.file}:` : ''}
                    {d.line}:{d.col}
                  </span>
                  <span className="text-ink">{d.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      </div>
    </div>
  );
}
