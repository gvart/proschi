import { AlertCircle, AlertTriangle, CheckCircle2, FlaskConical, PartyPopper, Play, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
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
}

/** Run tests, then every requirement and test with what was measured and how to fix it. */
export default function TestPanel({ run, stale, diagnostics, onRun, onSelect, community }: TestPanelProps) {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <FlaskConical size={16} className="text-gray-500" />
        <span className="text-sm font-medium text-gray-800">Tests</span>
        {run && !run.blocked && (
          <span className={`text-sm ${run.solved ? 'text-green-700' : 'text-gray-600'}`}>
            {run.passed} / {run.results.length} passed{stale ? ' · edited since' : ''}
          </span>
        )}
        <button
          onClick={onRun}
          data-tour="run"
          className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          <Play size={14} />
          Run tests
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto text-sm">
        {!run && <p className="px-3 py-4 text-gray-500">Run the tests to check your design against the problem’s requirements.</p>}

        {run?.blocked === 'no-engine' && (
          <p className="m-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            The simulation is not available yet, so tests cannot run. You can still design and play your use cases.
          </p>
        )}
        {run?.blocked === 'errors' && (
          <p className="m-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            Fix the {errors} error{errors === 1 ? '' : 's'} listed below first; tests run on a document without errors.
          </p>
        )}

        {run?.solved && (
          <div role="status" className="m-3 flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-800">
            <PartyPopper size={18} />
            <span>
              <strong>Solved.</strong> Every requirement and test passes. Compare with the reference solution, or try a harder problem.
            </span>
          </div>
        )}
        {community}

        {run && run.results.length > 0 && (
          <p className="px-3 pt-2 text-xs text-gray-500">
            Verdicts come from a deterministic model of your design, not a load test.{' '}
            <a href="../docs/model/#practice" target="_blank" rel="noopener" className="text-blue-700 hover:underline">
              How is this calculated?
            </a>
          </p>
        )}
        {run && run.results.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {run.results.map((r) => (
              <li key={r.id} className="flex gap-2 px-3 py-2">
                {r.passed ? <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-green-600" /> : <XCircle size={16} className="mt-0.5 flex-shrink-0 text-red-600" />}
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {r.name} <span className="ml-1 text-xs font-normal text-gray-400">{r.category}</span>
                  </p>
                  <p className="text-gray-600">{r.message}</p>
                  {!r.passed && r.hint && <p className="text-xs text-gray-500">Fix: {r.hint}</p>}
                  {r.assertions && r.assertions.length > 1 && (
                    <ul className="mt-1 space-y-0.5">
                      {r.assertions.map((a, i) => (
                        <li key={i} className="flex gap-1.5 text-xs">
                          {a.passed ? <CheckCircle2 size={13} className="mt-px flex-shrink-0 text-green-600" /> : <XCircle size={13} className="mt-px flex-shrink-0 text-red-600" />}
                          <span>
                            <span className={a.passed ? 'text-gray-600' : 'text-gray-800'}>{a.message}</span>
                            {!a.passed && a.hint && <span className="block text-gray-500">Fix: {a.hint}</span>}
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
          <ul className="border-t border-gray-100 bg-gray-50 text-xs">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button onClick={() => onSelect(d)} className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-100">
                  {d.severity === 'error' ? (
                    <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-px" />
                  ) : (
                    <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-px" />
                  )}
                  <span className="text-gray-500 tabular-nums flex-shrink-0">
                    {d.file ? `${d.file}:` : ''}
                    {d.line}:{d.col}
                  </span>
                  <span className="text-gray-800">{d.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      </div>
    </div>
  );
}
