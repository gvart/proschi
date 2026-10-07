import { ClipboardCheck, FileText, Network } from 'lucide-react';
import type { TestResult } from '../../sim';
import Tabs from '../../design/Tabs';
import type { View } from './view';

interface ViewTabsProps {
  view: View;
  onChange: (view: View) => void;
  results: TestResult[];
}

const TABS: { view: View; label: string; icon: typeof Network }[] = [
  { view: 'diagram', label: 'Diagram', icon: Network },
  { view: 'results', label: 'Results', icon: ClipboardCheck },
  { view: 'hld', label: 'HLD', icon: FileText },
];

/** Switches the right-hand pane between the canvas, the results (checks, analysis, review) and the high-level design. */
export default function ViewTabs({ view, onChange, results }: ViewTabsProps) {
  const failed = results.filter((r) => !r.passed).length;
  return (
    <div data-tour="views" className="bg-surface">
      <Tabs
        label="Diagram view"
        idPrefix="view"
        value={view}
        onChange={onChange}
        items={TABS.map(({ view: v, label, icon: Icon }) => ({
          id: v,
          label,
          icon: <Icon size={15} />,
          badge:
            v === 'results' && results.length > 0 ? (
              <span className={`tabular-nums ${failed ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`} title={failed ? `${failed} failing` : 'All passing'}>
                {results.length - failed}/{results.length}
              </span>
            ) : undefined,
        }))}
      />
    </div>
  );
}
