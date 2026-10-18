import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, FlaskConical, Loader2, PartyPopper, Play, XCircle } from 'lucide-react';
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
  /** A run is under way: the button spins and the last results dim until the new ones arrive. */
  running?: boolean;
  /** Jumps to a line of the solution. */
  onSelect: (loc: SourceLoc) => void;
  /** How others did on this problem (CommunityStats), folded under the results until solved. */
  community?: ReactNode;
  /** The design review (src/review/ReviewPanel.tsx), shown in a view of its own next to the tests. */
  review?: ReactNode;
  /** A first solve's celebration (SolveCelebration), under the verdict and above the results. */
  celebration?: ReactNode;
  /** After a failed run, the known mistake it matches (MistakePanel), under the results. */
  mistake?: ReactNode;
  /** Folded down to its bar (the problem page's tests before the first run): only the bar shows. */
  collapsed?: boolean;
  /** Folds or unfolds the panel; shows a toggle in the bar when given. */
  onToggle?: () => void;
}

const viewButton = (on: boolean) =>
  `flex-none inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-sm font-bold border-bw-1 ${on ? 'border-ink bg-ink text-paper' : 'border-transparent text-ink/75 hover:border-ink hover:text-ink'}`;

/** Run tests, then every requirement and test with what was measured and how to fix it. */
export default function TestPanel({ run, stale, diagnostics, onRun, running = false, onSelect, community, review, celebration, mistake, collapsed = false, onToggle }: TestPanelProps) {
  const [view, setView] = useState<'tests' | 'review'>('tests');
  // A new run brings the tests back into view.
  const [shownRun, setShownRun] = useState(run);
  if (run !== shownRun) {
    setShownRun(run);
    setView('tests');
  }
  // Picking a view unfolds a folded panel.
  const show = (v: 'tests' | 'review') => {
    setView(v);
    if (collapsed) onToggle?.();
  };
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const failed = run?.results.filter((r) => !r.passed) ?? [];
  const passed = run?.results.filter((r) => r.passed) ?? [];
  // The first solve on this page gets a little burst (skipped under reduced motion), unless the celebration brings its own.
  const solvedRef = useRef<HTMLDivElement>(null);
  const celebrated = useRef(false);
  const solved = !!run?.solved;
  const hasCelebration = !!celebration;
  useEffect(() => {
    if (!solved || celebrated.current || !solvedRef.current) return;
    celebrated.current = true;
    if (!hasCelebration) void celebrate(solvedRef.current);
  }, [solved, hasCelebration]);
  return (
    <div className="h-full flex flex-col bg-surface">
      <div className={`flex-none flex items-center gap-2 h-11 px-3 ${subBar}`}>
        {review ? (
          <>
            <button onClick={() => show('tests')} aria-pressed={view === 'tests'} className={viewButton(view === 'tests')}>
              <FlaskConical size={14} />
              Tests
            </button>
            <button onClick={() => show('review')} aria-pressed={view === 'review'} className={viewButton(view === 'review')}>
              <ClipboardCheck size={14} />
              Review
            </button>
          </>
        ) : (
          <>
            <FlaskConical size={16} className="text-muted" />
            <span className="text-sm font-bold text-ink">Tests</span>
          </>
        )}
        {run && !run.blocked && (
          <span className={`min-w-0 truncate text-sm tabular-nums ${run.solved ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-ink/75'}`}>
            {/* On phones the bar is tight: "passed" is for screen readers only there. */}
            {run.passed} / {run.results.length}
            <span className="max-sm:sr-only"> passed</span>
            {stale ? ' · edited since' : ''}
          </span>
        )}
        <button
          onClick={onRun}
          disabled={running}
          aria-busy={running}
          data-tour="run"
          className={`ml-auto flex-none whitespace-nowrap ${primaryButton} disabled:cursor-wait`}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Run tests
        </button>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show the test results' : 'Hide the test results'}
            title={collapsed ? 'Show the test results' : 'Hide the test results'}
            className="inline-flex items-center justify-center w-8 h-8 rounded border-bw-1 border-transparent text-ink/75 hover:border-ink hover:text-ink"
          >
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      {/* Kept mounted, so switching views keeps the review. */}
      {review && <div className={`flex-1 min-h-0 overflow-y-auto ${view === 'review' && !collapsed ? '' : 'hidden'}`}>{review}</div>}
      <div className={`flex-1 min-h-0 overflow-y-auto text-sm ${collapsed || (review && view === 'review') ? 'hidden' : ''}`}>
        {running && (
          <p role="status" className="flex items-center gap-2 px-3 py-2 text-ink/75">
            <Loader2 size={14} className="animate-spin text-pop-blue" />
            Running the tests against the simulation…
          </p>
        )}
        <div className={running ? 'pointer-events-none opacity-40 transition-opacity' : 'transition-opacity'}>
          {!run && !running && <p className="px-3 py-4 text-muted">Run the tests to check your design against the problem’s requirements.</p>}

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
          {celebration}

          {/* Failures first, with their fixes; what passes folds away below them. */}
          {failed.length > 0 && <ResultList results={failed} />}
          {mistake}
          {/* Not before the first run: the editor marks them as you type, and a fresh page should be quiet. */}
          {run && diagnostics.length > 0 && (
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
          {passed.length > 0 && (
            <details className="border-t border-ink/10" open={failed.length === 0 && !celebration}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">
                {passed.length} passing
              </summary>
              <ResultList results={passed} />
            </details>
          )}
          {run && run.results.length > 0 && (
            <p className="px-3 pt-2 text-xs text-muted">
              Verdicts come from a deterministic model of your design, not a load test.{' '}
              <a href="../docs/model/#practice" target="_blank" rel="noopener" className="text-pop-blue hover:underline">
                How is this calculated?
              </a>
            </p>
          )}
        </div>
        {community && (
          // Open once solved; while tests fail, the results come first.
          <details className="mt-2 border-t border-ink/10" open={solved || undefined}>
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink">How others did</summary>
            {community}
          </details>
        )}
      </div>
    </div>
  );
}

/** Requirements and tests, each with what was measured and, failing, how to fix it. */
function ResultList({ results }: { results: RunResult['results'] }) {
  return (
    <ul className="divide-y divide-ink/10">
      {results.map((r) => (
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
  );
}
