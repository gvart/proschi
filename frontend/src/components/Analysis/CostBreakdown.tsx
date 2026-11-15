import type { Diagram } from '../../dsl';
import { costBreakdown, formatPercent, formatUsd, type Analysis, type CostShare } from '../../sim';

/**
 * The monthly cost by team, group and tag (docs/TESTS.md, "Budgets per team,
 * group or tag"), with each one's budget when `requirements` sets one.
 * Nothing when the design names no team, group or tag.
 */
export default function CostBreakdown({ diagram, analysis }: { diagram: Diagram; analysis: Analysis }) {
  const b = costBreakdown(diagram, analysis);
  const sections: [string, CostShare[]][] = [
    ['Team', b.unowned ? [...b.teams, b.unowned] : b.teams],
    ['Group', b.groups],
    ['Tag', b.tags],
  ];
  if (sections.every(([, rows]) => rows.length === 0)) return null;
  const budgets = new Map<string, number>();
  for (const r of diagram.requirements ?? []) {
    if (r.kind !== 'cost' || !r.scope) continue;
    budgets.set('team' in r.scope ? `@${r.scope.team}` : 'tag' in r.scope ? `.${r.scope.tag}` : r.scope.group, r.maxUsdPerMonth);
  }
  const usd = (x: number) => formatUsd(x).replace('/month', '');
  return (
    <section aria-labelledby="analysis-cost">
      <h2 id="analysis-cost" className="mb-1 font-semibold text-ink">
        Cost breakdown
      </h2>
      <p className="mb-2 text-xs text-muted">Per month. A node counts for its team, every group it is in, and its tag and its groups' tags; budgets come from cost lines in requirements.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">By</th>
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 pr-3 font-medium text-right">Cost</th>
              <th className="py-1 pr-3 font-medium text-right">Share</th>
              <th className="py-1 pr-3 font-medium text-right">Budget</th>
              <th className="py-1 font-medium">Nodes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {sections.flatMap(([by, rows]) =>
              rows.map((s, i) => {
                const budget = budgets.get(s.id);
                const over = budget !== undefined && s.costUsd > budget;
                return (
                  <tr key={`${by}:${s.id}`} className="align-top">
                    <td className="py-1.5 pr-3 text-xs text-muted">{i === 0 ? by : ''}</td>
                    <td className="py-1.5 pr-3">
                      <span className="font-medium text-ink">{s.label}</span>
                      {s.label !== s.id && s.id !== 'no team' && <span className="ml-1 text-xs text-muted">{s.id}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink/85 whitespace-nowrap">
                      {usd(s.costUsd)}
                      {s.egressUsd > 0 && <span className="block text-xs text-muted">{usd(s.egressUsd)} egress</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-ink/75">{b.totalCostUsd > 0 ? formatPercent(s.costUsd / b.totalCostUsd) : '—'}</td>
                    <td className={`py-1.5 pr-3 text-right whitespace-nowrap ${over ? 'text-red-700 dark:text-red-300 font-medium' : budget !== undefined ? 'text-green-700 dark:text-green-300' : 'text-muted'}`}>
                      {budget !== undefined ? `${usd(budget)}${over ? ' over' : ''}` : '—'}
                    </td>
                    <td className="py-1.5 text-xs text-ink/75">{s.nodes.join(', ')}</td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
