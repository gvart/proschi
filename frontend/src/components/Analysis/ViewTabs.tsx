import { FlaskConical, Gauge, Network } from 'lucide-react';
import type { TestResult } from '../../sim';

export type View = 'diagram' | 'analysis' | 'tests';

interface ViewTabsProps {
  view: View;
  onChange: (view: View) => void;
  results: TestResult[];
}

const TABS: { view: View; label: string; icon: typeof Network }[] = [
  { view: 'diagram', label: 'Diagram', icon: Network },
  { view: 'analysis', label: 'Analysis', icon: Gauge },
  { view: 'tests', label: 'Tests', icon: FlaskConical },
];

/** Switches the right-hand pane between the canvas, the capacity analysis and the test results. */
export default function ViewTabs({ view, onChange, results }: ViewTabsProps) {
  const failed = results.filter((r) => !r.passed).length;
  return (
    <div role="tablist" aria-label="Diagram view" className="flex items-center gap-1 px-2 bg-white border-b border-gray-200">
      {TABS.map(({ view: v, label, icon: Icon }) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px ${
            view === v ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          <Icon size={15} />
          {label}
          {v === 'tests' && results.length > 0 && (
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${failed ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
              title={failed ? `${failed} failing` : 'All passing'}
            >
              {results.length - failed}/{results.length}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
