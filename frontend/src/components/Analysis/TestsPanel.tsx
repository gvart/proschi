import { CheckCircle2, XCircle } from 'lucide-react';
import type { SourceLoc } from '../../dsl';
import type { TestResult } from '../../sim';

interface TestsPanelProps {
  results: TestResult[];
  /** Jumps to the requirement or test line. */
  onSelect: (loc: SourceLoc) => void;
}

/** One row per requirement and `test` block; failures show the hint, and every row links to its line. */
export default function TestsPanel({ results, onSelect }: TestsPanelProps) {
  if (results.length === 0) return <EmptyState />;
  const failed = results.filter((r) => !r.passed).length;

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-3xl mx-auto px-4 py-4 text-sm">
        <p className={`mb-3 font-medium ${failed ? 'text-red-700' : 'text-green-700'}`}>
          {failed ? `${failed} of ${results.length} failing` : `All ${results.length} passing`}
        </p>
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {results.map((r) => (
            <li key={r.id} className="px-3 py-2">
              <Row passed={r.passed} title={r.name} message={r.message} hint={r.hint} loc={r.loc} onSelect={onSelect} strong />
              {r.assertions && r.assertions.length > 1 && (
                <ul className="mt-1 ml-6 space-y-1">
                  {r.assertions.map((a, i) => (
                    <li key={i}>
                      <Row passed={a.passed} message={a.message} hint={a.hint} loc={a.loc} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface RowProps {
  passed: boolean;
  title?: string;
  message: string;
  hint?: string;
  loc?: SourceLoc;
  onSelect: (loc: SourceLoc) => void;
  strong?: boolean;
}

function Row({ passed, title, message, hint, loc, onSelect, strong }: RowProps) {
  const Icon = passed ? CheckCircle2 : XCircle;
  return (
    <button
      onClick={() => loc && onSelect(loc)}
      disabled={!loc}
      className="w-full flex items-start gap-2 text-left rounded hover:bg-gray-50 disabled:hover:bg-transparent"
      title={loc ? `${loc.file ? `${loc.file}:` : 'Line '}${loc.line}` : undefined}
    >
      <Icon size={strong ? 16 : 14} className={`mt-0.5 flex-shrink-0 ${passed ? 'text-green-600' : 'text-red-600'}`} aria-label={passed ? 'passed' : 'failed'} />
      <span className="min-w-0">
        {title && <span className="block font-medium text-gray-900">{title}</span>}
        <span className={`block ${strong ? 'text-gray-600' : 'text-xs text-gray-600'}`}>{message}</span>
        {!passed && hint && <span className={`block text-amber-800 ${strong ? 'text-xs mt-0.5' : 'text-xs'}`}>{hint}</span>}
      </span>
      {loc && <span className="ml-auto flex-shrink-0 text-xs text-gray-400 tabular-nums">{loc.file ? `${loc.file}:` : ''}{loc.line}</span>}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-lg mx-auto px-6 py-10 text-sm text-gray-600 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">No requirements or tests</h2>
        <p>Requirements are checked against the analysis of your traffic; tests check how the flows work.</p>
        <pre className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-800 overflow-x-auto">
          {`requirements {
  p99 "Redirect" < 100ms
  availability >= 99.9%
  durable "Shorten"
  survive any node failure
}

test "Redirect is served from the cache" {
  "Redirect" calls any cache before any database
}`}
        </pre>
      </div>
    </div>
  );
}
